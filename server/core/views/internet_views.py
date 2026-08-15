"""
Internet / ISP bill payment views via HimalPay.
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

from ..models import Wallet, InternetBillTransaction
from ..serializers import (
    InternetBillTransactionSerializer,
    InternetBillInquirySerializer,
    InternetBillPaySerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError, with_himapay_response
from ..services.isp_catalog import (
    get_isp,
    list_isps_public,
    build_inquiry_payload,
    normalize_inquiry,
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
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    total_paisa = response.get(
        'total_debited',
        response.get('net_amount', himalpay.to_paisa(amount) + int(charge_paisa) - int(cashback_paisa)),
    )
    txn.charge = himalpay.to_rupees(charge_paisa)
    txn.cashback = himalpay.to_rupees(cashback_paisa)
    txn.total_debited = himalpay.to_rupees(total_paisa)
    txn.service_hub_txn_id = himalpay.extract_transaction_id(response)
    txn.reference_id = himalpay.extract_reference_id(response)
    txn.provider_response = response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_isps(request):
    """List ISP bill payment services enabled on the HimalPay reseller account."""
    blocked = require_feature_enabled('internet_bills')
    if blocked:
        return blocked

    himalpay = HimalPayAPI()
    reseller_services = None
    himalpay_raw = None
    try:
        services = himalpay.list_services()
        himalpay_raw = services
        if isinstance(services, list):
            reseller_services = services
    except HimalPayError as exc:
        himalpay_raw = exc.response_data
        logger.warning('Could not fetch HimalPay services for ISP list: %s', exc.message)

    return Response(
        with_himapay_response(
            {'isps': list_isps_public(reseller_services)},
            himalpay_raw,
        ),
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def inquiry_bill(request):
    """Inquiry: fetch customer bill details and available packages."""
    blocked = require_feature_enabled('internet_bills')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = InternetBillInquirySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    isp_id = serializer.validated_data['isp_id']
    customer_id = serializer.validated_data['customer_id'].strip()
    isp = get_isp(isp_id)
    if not isp:
        return Response({'error': 'Unsupported ISP.'}, status=status.HTTP_400_BAD_REQUEST)

    himalpay = HimalPayAPI()
    inquiry_data = build_inquiry_payload(isp, customer_id)
    try:
        raw = himalpay.fetch_service_details(isp['get_service'], inquiry_data)
        vendor_message = detect_inquiry_vendor_failure(raw)
        if vendor_message:
            return Response(
                with_himapay_response(
                    {
                        'error': 'Bill inquiry failed',
                        'message': vendor_message,
                        'data': normalize_inquiry(isp, customer_id, raw),
                    },
                    raw,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        normalized = normalize_inquiry(isp, customer_id, raw)
        if not normalized['packages']:
            return Response(
                with_himapay_response(
                    {
                        'error': 'No bill or package found for this customer ID.',
                        'message': (
                            'No active subscription or payable bill was found for this customer ID. '
                            'Please verify the ID and try again.'
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
    """Process ISP bill payment from wallet balance."""
    blocked = require_feature_enabled('internet_bills')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = InternetBillPaySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from ..services.pin import transaction_pin_gate
    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    isp_id = serializer.validated_data['isp_id']
    customer_id = serializer.validated_data['customer_id'].strip()
    amount = HimalPayAPI.normalize_rupees(serializer.validated_data['amount'])
    package_name = serializer.validated_data.get('package_name') or ''
    customer_name = serializer.validated_data.get('customer_name') or ''
    pay_data = serializer.validated_data['pay_data']

    isp = get_isp(isp_id)
    if not isp:
        return Response({'error': 'Unsupported ISP.'}, status=status.HTTP_400_BAD_REQUEST)

    wallet = _get_or_create_wallet(request.user)
    himalpay = HimalPayAPI()
    pay_service = isp['pay_service']

    try:
        fee_info = himalpay.calculate_cashback_and_charge(pay_service, amount)
        charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0)
        cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
        total_required = amount + charge - cashback
    except HimalPayError as exc:
        if getattr(exc, 'is_ip_blocked', False) or exc.status_code in (401, 403):
            return Response(
                with_himapay_response(
                    {
                        'error': 'Internet bill payment failed',
                        'message': exc.message,
                        'error_code': exc.error_code,
                        'error_type': exc.error_type,
                    },
                    exc.response_data,
                ),
                status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            )
        charge = Decimal('0.00')
        cashback = Decimal('0.00')
        total_required = amount

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

    merchant_txn_id = f"MYSEWA_ISP_{uuid.uuid4().hex[:12].upper()}"
    bill_txn = InternetBillTransaction.objects.create(
        user=request.user,
        isp_id=isp['id'],
        isp_name=isp['name'],
        customer_id=customer_id,
        customer_name=customer_name,
        package_name=package_name,
        amount=amount,
        pay_service=pay_service,
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=charge,
        cashback=cashback,
        total_debited=total_required,
        pay_payload=pay_data,
    )

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
                        'error': 'Internet bill payment failed',
                        'message': failure['message'],
                        'wallet_debited': False,
                        'data': InternetBillTransactionSerializer(bill_txn).data,
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
                reason=f'{isp["name"]} internet bill',
                ref=bill_txn.merchant_txn_id,
            )
            notify_low_balance_if_needed(wallet)
            return Response(
                with_himapay_response(
                    {
                        'message': f'{isp["name"]} bill paid successfully',
                        'data': InternetBillTransactionSerializer(bill_txn).data,
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
                    'data': InternetBillTransactionSerializer(bill_txn).data,
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
                    'error': 'Internet bill payment failed',
                    'message': exc.message,
                    'data': InternetBillTransactionSerializer(bill_txn).data,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        bill_txn.status = 'failed'
        bill_txn.save()
        logger.error('ISP pay failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Payment request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    finally:
        schedule_post_transaction_reconcile(request.user, bill_txn)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def internet_bill_history(request):
    from ..services.list_response import items_with_stats_response

    bills = InternetBillTransaction.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        bills,
        InternetBillTransactionSerializer,
        request,
        search_fields=(
            'isp_name', 'customer_id', 'customer_name', 'package_name',
            'merchant_txn_id', 'reference_id',
        ),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def internet_bill_status(request):
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()
    bill = InternetBillTransaction.objects.filter(
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
                    bill = InternetBillTransaction.objects.select_for_update().get(pk=bill.pk)
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
                                    reason='Internet bill payment',
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
                    'local_bill': InternetBillTransactionSerializer(bill).data if bill else None,
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
