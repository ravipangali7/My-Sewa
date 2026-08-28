"""
Community electricity bill payment views via HimalPay
(Himchuli, Watermark, Dreamer, Softlab, BPC).
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

from ..models import Wallet, CommunityElectricityTransaction
from ..serializers import (
    CommunityElectricityTransactionSerializer,
    CommunityElectricityInquirySerializer,
    CommunityElectricityPaySerializer,
    CommunityElectricityCountersSerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError, with_himapay_response
from ..services.utility_catalog import (
    get_community_platform,
    list_community_platforms_public,
    build_community_inquiry_payload,
    build_community_pay_payload,
    build_watermark_slug_payload,
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
    TXN_COMMUNITY_ELECTRICITY,
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
    overlay_himalpay_debit(txn, himalpay, response, amount, TXN_COMMUNITY_ELECTRICITY)


def _customer_ref_from_data(platform, data) -> str:
    field = platform.get('customer_field') or 'customer_ref'
    if field == 'consumer_no':
        return str(data.get('consumer_no') or data.get('customer_ref') or '').strip()
    return str(data.get(field) or data.get('customer_ref') or '').strip()


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_providers(request):
    """List community electricity platforms enabled on the HimalPay reseller account."""
    blocked = require_feature_enabled('community_electricity')
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
        logger.warning(
            'Could not fetch HimalPay services for community electricity list: %s',
            exc.message,
        )

    return Response(
        with_himapay_response(
            {'providers': list_community_platforms_public(reseller_services)},
            himalpay_raw,
        ),
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def list_counters(request):
    """
    Fetch counters / slugs for platforms that need a pre-inquiry step.

    - bpc: BPC_GET_COUNTER (no extra fields)
    - watermark: WATERMARK_SLUGS (customer_code + service_slug)
    """
    blocked = require_feature_enabled('community_electricity')
    if blocked:
        return blocked

    serializer = CommunityElectricityCountersSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    platform_id = serializer.validated_data['platform_id']
    platform = get_community_platform(platform_id)
    if not platform:
        return Response({'error': 'Unsupported platform.'}, status=status.HTTP_400_BAD_REQUEST)

    himalpay = HimalPayAPI()
    try:
        if platform.get('counter_service'):
            raw = himalpay.fetch_service_details(platform['counter_service'], {})
        elif platform.get('slug_service'):
            customer_code = (
                serializer.validated_data.get('customer_code')
                or serializer.validated_data.get('customer_ref')
                or ''
            ).strip()
            service_slug = (serializer.validated_data.get('service_slug') or '').strip()
            if not customer_code or not service_slug:
                return Response(
                    {
                        'error': 'customer_code and service_slug are required for Watermark slugs.',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raw = himalpay.fetch_service_details(
                platform['slug_service'],
                build_watermark_slug_payload(customer_code, service_slug),
            )
        else:
            return Response(
                {'error': f'{platform["name"]} does not require a counter/slug step.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                {
                    'message': f'{platform["name"]} counters retrieved.',
                    'platform_id': platform['id'],
                    'data': raw,
                },
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
    """Fetch community electricity account / bill details."""
    blocked = require_feature_enabled('community_electricity')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = CommunityElectricityInquirySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    platform = get_community_platform(data['platform_id'])
    if not platform:
        return Response({'error': 'Unsupported platform.'}, status=status.HTTP_400_BAD_REQUEST)

    customer_ref = _customer_ref_from_data(platform, data)
    service_slug = (data.get('service_slug') or platform.get('default_service_slug') or '').strip()
    inquiry_data = build_community_inquiry_payload(
        platform,
        customer_ref=customer_ref,
        service_slug=service_slug,
        month=data.get('month'),
        counter_code=data.get('counter_code') or '',
        consumer_id=data.get('consumer_id'),
    )

    himalpay = HimalPayAPI()
    try:
        raw = himalpay.fetch_service_details(platform['get_service'], inquiry_data)
        vendor_message = detect_inquiry_vendor_failure(raw)
        extra = {
            'platform_id': platform['id'],
            'platform_name': platform['name'],
            'customer_ref': customer_ref,
            'service_slug': service_slug,
            'counter_code': inquiry_data.get('counter_code') or '',
            'consumer_id': str(inquiry_data.get('consumer_id') or ''),
            'month': inquiry_data.get('month'),
        }
        if vendor_message:
            return Response(
                with_himapay_response(
                    {
                        'error': 'Bill inquiry failed',
                        'message': vendor_message,
                        'data': normalize_utility_inquiry(raw, extra),
                    },
                    raw,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        normalized = normalize_utility_inquiry(raw, extra)
        if not normalized.get('session_id'):
            return Response(
                with_himapay_response(
                    {
                        'error': 'No bill found for this customer.',
                        'message': (
                            'No payable bill or session was returned for this account. '
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
    """Process community electricity payment from wallet balance."""
    blocked = require_feature_enabled('community_electricity')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = CommunityElectricityPaySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from ..services.pin import transaction_pin_gate
    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    data = serializer.validated_data
    platform = get_community_platform(data['platform_id'])
    if not platform:
        return Response({'error': 'Unsupported platform.'}, status=status.HTTP_400_BAD_REQUEST)

    amount = HimalPayAPI.normalize_rupees(data['amount'])
    customer_ref = _customer_ref_from_data(platform, data)
    service_slug = (data.get('service_slug') or platform.get('default_service_slug') or '').strip()
    counter_code = (data.get('counter_code') or '').strip()
    consumer_id = str(data.get('consumer_id') or '').strip()
    customer_name = data.get('customer_name') or ''
    month = data.get('month')
    session_id = data.get('session_id')
    pay_data = data.get('pay_data') or {}
    pay_service = platform['pay_service']

    if not pay_data.get('session_id') and session_id not in (None, ''):
        pay_data = build_community_pay_payload(session_id)
    if not pay_data.get('session_id'):
        return Response(
            {'error': 'session_id is required to pay the bill.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

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
                        'error': 'Community electricity payment failed',
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
        amount, TXN_COMMUNITY_ELECTRICITY, request.user,
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

    merchant_txn_id = f"MYSEWA_CE_{uuid.uuid4().hex[:12].upper()}"
    bill_txn = CommunityElectricityTransaction.objects.create(
        user=request.user,
        platform_id=platform['id'],
        platform_name=platform['name'],
        service_slug=service_slug,
        counter_code=counter_code,
        customer_ref=customer_ref,
        consumer_id=consumer_id,
        customer_name=customer_name,
        month=month,
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
                        'error': 'Community electricity payment failed',
                        'message': failure['message'],
                        'wallet_debited': False,
                        'data': CommunityElectricityTransactionSerializer(bill_txn).data,
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
                reason=f'{platform["name"]} electricity bill',
                ref=bill_txn.merchant_txn_id,
            )
            notify_low_balance_if_needed(wallet)
            return Response(
                with_himapay_response(
                    {
                        'message': f'{platform["name"]} bill paid successfully',
                        'data': CommunityElectricityTransactionSerializer(bill_txn).data,
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
                    'data': CommunityElectricityTransactionSerializer(bill_txn).data,
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
                    'error': 'Community electricity payment failed',
                    'message': exc.message,
                    'data': CommunityElectricityTransactionSerializer(bill_txn).data,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        bill_txn.status = 'failed'
        bill_txn.save()
        logger.error('Community electricity pay failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Payment request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    finally:
        schedule_post_transaction_reconcile(request.user, bill_txn)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def community_electricity_history(request):
    from ..services.list_response import items_with_stats_response

    bills = CommunityElectricityTransaction.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        bills,
        CommunityElectricityTransactionSerializer,
        request,
        search_fields=(
            'platform_id', 'platform_name', 'customer_ref', 'service_slug',
            'counter_code', 'customer_name', 'merchant_txn_id', 'reference_id',
            'session_id',
        ),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def community_electricity_status(request):
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()
    bill = CommunityElectricityTransaction.objects.filter(
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
                    bill = CommunityElectricityTransaction.objects.select_for_update().get(pk=bill.pk)
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
                                    reason='Community electricity payment',
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
                    'local_bill': (
                        CommunityElectricityTransactionSerializer(bill).data if bill else None
                    ),
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
