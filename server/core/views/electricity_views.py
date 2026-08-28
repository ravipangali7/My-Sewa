"""
NEA electricity bill payment views via HimalPay.
"""
import uuid
import logging
import traceback
from decimal import Decimal

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction

from ..models import Wallet, ElectricityBillTransaction
from ..serializers import (
    ElectricityBillTransactionSerializer,
    ElectricityBillInquirySerializer,
    ElectricityBillPaySerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError, with_himapay_response
from ..services.utility_catalog import (
    get_nea,
    build_nea_inquiry_payload,
    build_nea_pay_payload,
    normalize_utility_inquiry,
)
from ..services.himalpay_parse import detect_inquiry_vendor_failure
from ..services.app_config import (
    get_app_config,
    require_feature_enabled,
    require_account_approved,
    require_wallet_not_blocked,
    is_auto_status_verified,
)
from ..services.notifications import notify_low_balance_if_needed, notify_wallet_debit
from ..services.txn_charges import (
    TXN_ELECTRICITY,
    overlay_himalpay_debit,
    persist_transaction_charge,
    quote_charges,
)
from ..services.txn_status import resolve_provider_outcome, debit_wallet_for_txn
from ..services.wallet_guard import (
    handle_provider_success_without_wallet,
    schedule_post_transaction_reconcile,
)

logger = logging.getLogger(__name__)


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _apply_fee_fields(txn, himalpay: HimalPayAPI, response: dict, amount):
    overlay_himalpay_debit(txn, himalpay, response, amount, TXN_ELECTRICITY)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_counters(request):
    """Step 1: Fetch NEA office / powerhouse counters."""
    blocked = require_feature_enabled('electricity_bills')
    if blocked:
        return blocked

    nea = get_nea()
    himalpay = HimalPayAPI()
    try:
        raw = himalpay.fetch_service_details(nea['counter_service'], {})
        vendor_message = detect_inquiry_vendor_failure(raw)
        if vendor_message:
            return Response(
                with_himapay_response(
                    {
                        'error': 'Failed to fetch counters',
                        'message': vendor_message,
                        'data': raw,
                    },
                    raw,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            with_himapay_response(
                {'message': 'NEA counters retrieved.', 'data': raw},
                raw,
            ),
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            with_himapay_response(
                {
                    'error': 'Failed to fetch counters',
                    'message': exc.message,
                    'error_code': exc.error_code,
                    'error_type': exc.error_type,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def inquiry_bill(request):
    """Step 2: Fetch NEA account / bill details."""
    blocked = require_feature_enabled('electricity_bills')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = ElectricityBillInquirySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    sc_no = serializer.validated_data['sc_no']
    consumer_id = serializer.validated_data['consumer_id']
    office_code = serializer.validated_data['office_code']
    nea = get_nea()
    himalpay = HimalPayAPI()
    inquiry_data = build_nea_inquiry_payload(sc_no, office_code, consumer_id)

    try:
        raw = himalpay.fetch_service_details(nea['get_service'], inquiry_data)
        vendor_message = detect_inquiry_vendor_failure(raw)
        if vendor_message:
            return Response(
                with_himapay_response(
                    {
                        'error': 'Bill inquiry failed',
                        'message': vendor_message,
                        'data': normalize_utility_inquiry(
                            raw,
                            {
                                'sc_no': str(sc_no),
                                'consumer_id': str(consumer_id),
                                'office_code': office_code,
                            },
                        ),
                    },
                    raw,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        normalized = normalize_utility_inquiry(
            raw,
            {
                'sc_no': str(sc_no),
                'consumer_id': str(consumer_id),
                'office_code': office_code,
            },
        )
        if not normalized.get('session_id'):
            return Response(
                with_himapay_response(
                    {
                        'error': 'No bill found for this consumer.',
                        'message': (
                            'No payable bill or session was returned for this consumer. '
                            'Please verify the details and try again.'
                        ),
                        'data': normalized,
                    },
                    raw,
                ),
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            with_himapay_response(
                {'message': 'Bill details retrieved from provider.', 'data': normalized},
                raw,
            ),
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            with_himapay_response(
                {
                    'error': 'Bill inquiry failed',
                    'message': exc.message,
                    'error_code': exc.error_code,
                    'error_type': exc.error_type,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def pay_bill(request):
    """Step 3: Process NEA electricity bill payment from wallet balance."""
    blocked = require_feature_enabled('electricity_bills')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = ElectricityBillPaySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from ..services.pin import transaction_pin_gate
    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    sc_no = str(serializer.validated_data['sc_no']).strip()
    consumer_id = str(serializer.validated_data['consumer_id']).strip()
    office_code = serializer.validated_data['office_code'].strip()
    office_name = (serializer.validated_data.get('office_name') or '').strip()
    amount = HimalPayAPI.normalize_rupees(serializer.validated_data['amount'])
    customer_name = serializer.validated_data.get('customer_name') or ''
    session_id = serializer.validated_data.get('session_id')
    pay_data = serializer.validated_data.get('pay_data') or {}

    nea = get_nea()
    pay_service = nea['pay_service']

    if not pay_data.get('session_id') and session_id not in (None, ''):
        pay_data = build_nea_pay_payload(session_id, consumer_id)
    elif pay_data.get('session_id') and 'consumer_id' not in pay_data:
        pay_data = {**pay_data, 'consumer_id': consumer_id}
    if not pay_data.get('session_id'):
        return Response(
            {'error': 'session_id is required to pay the bill.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if pay_data.get('consumer_id') in (None, ''):
        pay_data = {**pay_data, 'consumer_id': consumer_id}

    wallet = _get_or_create_wallet(request.user)
    himalpay = HimalPayAPI()

    try:
        fee_info = himalpay.calculate_cashback_and_charge(pay_service, amount)
        provider_charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0)
        cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
    except HimalPayError as exc:
        if getattr(exc, 'is_ip_blocked', False) or exc.status_code in (401, 403):
            return Response(
                with_himapay_response(
                    {
                        'error': 'Electricity bill payment failed',
                        'message': exc.message,
                        'error_code': exc.error_code,
                        'error_type': exc.error_type,
                    },
                    exc.response_data,
                ),
                status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            )
        provider_charge = Decimal('0.00')
        cashback = Decimal('0.00')

    quote = quote_charges(
        amount, TXN_ELECTRICITY, request.user,
        provider_charge=provider_charge, cashback=cashback,
    )
    charge = quote['total_charges']
    total_required = quote['wallet_amount']

    if wallet.balance < total_required:
        return Response(
            {
                'error': 'Insufficient balance',
                'message': (
                    f'Insufficient balance. Required Rs. {total_required}, '
                    f'available Rs. {wallet.balance}.'
                ),
                'required': str(total_required),
                'available': str(wallet.balance),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = f"MYSEWA_NEA_{uuid.uuid4().hex[:12].upper()}"
    bill_txn = ElectricityBillTransaction.objects.create(
        user=request.user,
        sc_no=sc_no,
        consumer_id=consumer_id,
        office_code=office_code,
        office_name=office_name,
        customer_name=customer_name,
        session_id=str(pay_data.get('session_id') or ''),
        amount=amount,
        pay_service=pay_service,
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=charge,
        cashback=cashback,
        total_debited=total_required,
        pay_payload=pay_data,
    )
    persist_transaction_charge(bill_txn, quote)

    try:
        response = himalpay.process_payment(
            pay_service,
            amount,
            merchant_txn_id,
            pay_data,
        )
        txn_status = himalpay.normalize_status(response)
        _apply_fee_fields(bill_txn, himalpay, response, amount)

        if txn_status == 'failed':
            bill_txn.status = 'failed'
            bill_txn.save()
            failure = himalpay.extract_failure_details(response)
            return Response(
                with_himapay_response(
                    {
                        'error': 'Electricity bill payment failed',
                        'message': failure['message'],
                        'wallet_debited': False,
                        'data': ElectricityBillTransactionSerializer(bill_txn).data,
                    },
                    response,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )

        cfg = get_app_config()
        local_status = resolve_provider_outcome(txn_status, is_auto_status_verified(cfg))

        if local_status == 'success':
            with transaction.atomic():
                wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                debit = bill_txn.total_debited or amount
                if wallet.balance < debit:
                    handle_provider_success_without_wallet(
                        request.user, bill_txn, schedule=False,
                    )
                    bill_txn.status = 'failed'
                    bill_txn.save()
                    return Response(
                        with_himapay_response(
                            {'error': 'Insufficient balance after fee calculation'},
                            response,
                        ),
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                debit_wallet_for_txn(wallet, bill_txn, debit)
                bill_txn.status = 'success'
                bill_txn.save()
            notify_wallet_debit(
                request.user,
                debit,
                balance_after=wallet.balance,
                reason='NEA electricity bill',
                ref=bill_txn.merchant_txn_id,
            )
            notify_low_balance_if_needed(wallet)
            return Response(
                with_himapay_response(
                    {
                        'message': 'NEA electricity bill paid successfully',
                        'data': ElectricityBillTransactionSerializer(bill_txn).data,
                    },
                    response,
                ),
                status=status.HTTP_200_OK,
            )

        bill_txn.status = 'pending'
        bill_txn.save()
        return Response(
            with_himapay_response(
                {
                    'message': 'Payment is being processed',
                    'pending_message': response.get(
                        'message',
                        'Your payment is being processed and awaits verification.',
                    ),
                    'data': ElectricityBillTransactionSerializer(bill_txn).data,
                },
                response,
            ),
            status=status.HTTP_202_ACCEPTED,
        )

    except HimalPayError as exc:
        bill_txn.status = 'failed'
        bill_txn.provider_response = exc.response_data
        bill_txn.save()
        return Response(
            with_himapay_response(
                {
                    'error': 'Electricity bill payment failed',
                    'message': exc.message,
                    'data': ElectricityBillTransactionSerializer(bill_txn).data,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        bill_txn.status = 'failed'
        bill_txn.save()
        logger.error('NEA pay failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Payment request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    finally:
        schedule_post_transaction_reconcile(request.user, bill_txn)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def electricity_bill_history(request):
    from ..services.list_response import items_with_stats_response

    bills = ElectricityBillTransaction.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        bills,
        ElectricityBillTransactionSerializer,
        request,
        search_fields=(
            'sc_no', 'consumer_id', 'office_code', 'office_name', 'customer_name',
            'merchant_txn_id', 'reference_id', 'session_id',
        ),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def electricity_bill_status(request):
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()
    bill = ElectricityBillTransaction.objects.filter(
        user=request.user, merchant_txn_id=merchant_txn_id,
    ).first()

    try:
        result = himalpay.check_transaction_status(merchant_txn_id)
        normalized = himalpay.normalize_status(result)

        if bill and bill.status == 'pending' and normalized in ('success', 'failed', 'pending'):
            auto = is_auto_status_verified()
            local_status = resolve_provider_outcome(normalized, auto)
            if not (normalized == 'pending' and not auto):
                with transaction.atomic():
                    bill = ElectricityBillTransaction.objects.select_for_update().get(pk=bill.pk)
                    if bill.status == 'pending':
                        _apply_fee_fields(bill, himalpay, result, bill.amount)
                        if local_status == 'success':
                            wallet = _get_or_create_wallet(request.user)
                            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                            debit = bill.total_debited or bill.amount
                            if wallet.balance >= debit:
                                debit_wallet_for_txn(wallet, bill, debit)
                                bill.status = 'success'
                                bill.save()
                                notify_wallet_debit(
                                    request.user,
                                    debit,
                                    balance_after=wallet.balance,
                                    reason='NEA electricity bill payment',
                                    ref=bill.merchant_txn_id,
                                )
                                notify_low_balance_if_needed(wallet)
                            else:
                                bill.status = 'failed'
                                bill.save()
                        elif local_status == 'failed':
                            bill.status = 'failed'
                            bill.save()
                        else:
                            bill.save()

        return Response(
            with_himapay_response(
                {
                    'status': normalized,
                    'message': (
                        himalpay.extract_failure_details(result)['message']
                        if normalized == 'failed'
                        else None
                    ),
                    'data': result,
                    'local_bill': ElectricityBillTransactionSerializer(bill).data if bill else None,
                },
                result,
            ),
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            with_himapay_response(
                {'error': exc.message, 'error_code': exc.error_code},
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST,
        )
