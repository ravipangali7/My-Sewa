"""
Topup views: NTC / NCELL via HimalPay Reseller API
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

from ..models import Wallet, TopupTransaction
from ..serializers import (
    TopupTransactionSerializer,
    TopupCreateSerializer,
    CalculateChargeSerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError
from ..services.app_config import (
    get_app_config,
    platform_topup_charge,
    require_feature_enabled,
    require_account_approved,
    is_auto_status_verified,
)
from ..services.notifications import notify_topup_success, notify_low_balance_if_needed
from ..services.txn_status import resolve_provider_outcome

logger = logging.getLogger(__name__)


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _apply_fee_fields(topup_txn, himalpay: HimalPayAPI, response: dict, amount, platform_fee: Decimal = Decimal('0.00')):
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    total_paisa = response.get(
        'total_debited',
        response.get('net_amount', himalpay.to_paisa(amount) + int(charge_paisa) - int(cashback_paisa)),
    )
    topup_txn.charge = himalpay.to_rupees(charge_paisa) + (platform_fee or Decimal('0.00'))
    topup_txn.cashback = himalpay.to_rupees(cashback_paisa)
    topup_txn.total_debited = himalpay.to_rupees(total_paisa) + (platform_fee or Decimal('0.00'))
    topup_txn.service_hub_txn_id = himalpay.extract_transaction_id(response)
    topup_txn.reference_id = himalpay.extract_reference_id(response)
    topup_txn.provider_response = response


def _platform_fee_for_amount(amount) -> Decimal:
    cfg = get_app_config()
    tx_cfg = cfg.get('transactions') or {}
    return platform_topup_charge(amount, tx_cfg.get('topup_charge_percent', 0))


def _process_topup(request, product_id: int, service_label: str):
    blocked = require_feature_enabled('topups')
    if blocked:
        return blocked

    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = TopupCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if serializer.validated_data.get('product_id') != product_id:
        return Response(
            {'error': f'Invalid product_id. Use {product_id} for {service_label}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    mobile_number = serializer.validated_data['mobile_number']
    amount = HimalPayAPI.normalize_rupees(serializer.validated_data['amount'])
    wallet = _get_or_create_wallet(request.user)

    platform_fee = _platform_fee_for_amount(amount)

    himalpay = HimalPayAPI()
    service_name = HimalPayAPI.SERVICE_NTC if product_id == 1 else HimalPayAPI.SERVICE_NCELL
    logger.info(
        '%s topup: Rs. %s → %s paisa (user=%s)',
        service_label,
        amount,
        himalpay.to_paisa(amount),
        getattr(request.user, 'pk', None),
    )

    # Pre-calculate charge so we can validate sufficient balance
    try:
        fee_info = himalpay.calculate_cashback_and_charge(service_name, amount)
        charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0) + platform_fee
        cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
        total_required = amount + charge - cashback
    except HimalPayError as exc:
        # IP / auth failures must not be swallowed — payment would fail the same way
        if getattr(exc, 'is_ip_blocked', False) or exc.status_code in (401, 403):
            return Response(
                {
                    'error': f'{service_label} topup failed',
                    'message': exc.message,
                    'error_code': exc.error_code,
                    'error_type': exc.error_type,
                },
                status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            )
        logger.warning('Charge calculation failed for %s: %s', service_label, exc.message)
        charge = platform_fee
        cashback = Decimal('0.00')
        total_required = amount + platform_fee

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
                'charge': str(charge),
                'cashback': str(cashback),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = f"MYSEWA_{uuid.uuid4().hex[:16].upper()}"
    topup_txn = TopupTransaction.objects.create(
        user=request.user,
        mobile_number=mobile_number,
        amount=amount,
        product_id=product_id,
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=charge,
        cashback=cashback,
        total_debited=total_required,
    )

    try:
        if product_id == 1:
            response = himalpay.topup_ntc(mobile_number, amount, merchant_txn_id)
        else:
            response = himalpay.topup_ncell(mobile_number, amount, merchant_txn_id)

        txn_status = himalpay.normalize_status(response)
        _apply_fee_fields(topup_txn, himalpay, response, amount, platform_fee=platform_fee)

        if txn_status == 'failed':
            topup_txn.status = 'failed'
            topup_txn.save()
            failure = himalpay.extract_failure_details(response)
            return Response(
                {
                    'error': f'{service_label} topup failed',
                    'message': failure['message'],
                    'provider_message': failure['provider_message'],
                    'error_code': failure['error_code'],
                    'error_type': failure['error_type'],
                    'wallet_debited': False,
                    'data': TopupTransactionSerializer(topup_txn).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        cfg = get_app_config()
        local_status = resolve_provider_outcome(txn_status, is_auto_status_verified(cfg))

        if local_status == 'success':
            with transaction.atomic():
                wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                debit = topup_txn.total_debited or amount
                if wallet.balance < debit:
                    topup_txn.status = 'failed'
                    topup_txn.save()
                    return Response(
                        {'error': 'Insufficient balance after fee calculation'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                wallet.balance -= debit
                wallet.save()
                topup_txn.status = 'success'
                topup_txn.save()

            notify_topup_success(topup_txn)
            notify_low_balance_if_needed(wallet)

            return Response(
                {
                    'message': f'{service_label} topup successful',
                    'data': TopupTransactionSerializer(topup_txn).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_200_OK,
            )

        # Awaiting Super Admin verification (provider success/pending, auto off)
        topup_txn.status = 'pending'
        topup_txn.save()
        return Response(
            {
                'message': f'{service_label} topup is awaiting verification',
                'pending_message': response.get(
                    'message',
                    'Your payment is being processed and awaits admin verification.',
                ),
                'data': TopupTransactionSerializer(topup_txn).data,
                'himalpay_response': response,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    except HimalPayError as exc:
        topup_txn.status = 'failed'
        topup_txn.provider_response = exc.response_data
        topup_txn.save()
        logger.error(
            '%s HimalPay error: %s code=%s type=%s',
            service_label, exc.message, exc.error_code, exc.error_type,
        )
        return Response(
            {
                'error': f'{service_label} topup failed',
                'message': exc.message,
                'error_code': exc.error_code,
                'error_type': exc.error_type,
                'data': TopupTransactionSerializer(topup_txn).data,
            },
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )

    except Exception as exc:
        topup_txn.status = 'failed'
        topup_txn.save()
        logger.error(
            '%s topup failed for user %s: %s\n%s',
            service_label, request.user.phone, exc, traceback.format_exc(),
        )
        return Response(
            {'error': 'Topup request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def topup_ntc(request):
    """Topup NTC mobile number via HimalPay"""
    return _process_topup(request, product_id=1, service_label='NTC')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def topup_ncell(request):
    """Topup NCELL mobile number via HimalPay"""
    return _process_topup(request, product_id=2, service_label='NCELL')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def topup_history(request):
    """Get topup transaction history for current user"""
    topups = TopupTransaction.objects.filter(user=request.user).order_by('-created_at')
    serializer = TopupTransactionSerializer(topups, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def topup_services(request):
    """
    List HimalPay reseller services available for mobile top-up (NTC / NCELL).
    Matches GET /details/my-reseller-services filtered to top-up operators.
    """
    blocked = require_feature_enabled('topups')
    if blocked:
        return blocked

    himalpay = HimalPayAPI()
    try:
        services = himalpay.list_services()
        if not isinstance(services, list):
            services = []
        allowed = {HimalPayAPI.SERVICE_NTC, HimalPayAPI.SERVICE_NCELL}
        filtered = [
            {
                'id': item.get('id'),
                'name': item.get('name'),
                'logo_image_url': item.get('logo_image_url'),
            }
            for item in services
            if isinstance(item, dict) and str(item.get('name', '')).upper() in allowed
        ]
        # Fallback to doc-defined operators when provider returns none
        if not filtered:
            filtered = [
                {'id': 1, 'name': HimalPayAPI.SERVICE_NTC, 'logo_image_url': None},
                {'id': 2, 'name': HimalPayAPI.SERVICE_NCELL, 'logo_image_url': None},
            ]
        return Response({'services': filtered}, status=status.HTTP_200_OK)
    except HimalPayError as exc:
        return Response(
            {
                'error': exc.message,
                'error_code': exc.error_code,
                'error_type': exc.error_type,
                'services': [
                    {'id': 1, 'name': HimalPayAPI.SERVICE_NTC, 'logo_image_url': None},
                    {'id': 2, 'name': HimalPayAPI.SERVICE_NCELL, 'logo_image_url': None},
                ],
            },
            status=status.HTTP_200_OK,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def calculate_charge(request):
    """Calculate HimalPay cashback and charge for a service/amount (+ platform fee)."""
    service = (request.data.get('wallet_service_name') or '').upper()
    blocked = None
    if service in ('NTC', 'NCELL'):
        blocked = require_feature_enabled('topups')
    elif 'DATA_PACK' in service:
        blocked = require_feature_enabled('data_packs')
    elif service.endswith('_PAY') or service.endswith('_GET'):
        blocked = require_feature_enabled('internet_bills')
    if blocked:
        return blocked

    serializer = CalculateChargeSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    himalpay = HimalPayAPI()
    amount = serializer.validated_data['amount']
    service = serializer.validated_data['wallet_service_name']
    tx_cfg = get_app_config().get('transactions') or {}
    service_upper = service.upper()
    platform_fee = (
        platform_topup_charge(amount, tx_cfg.get('topup_charge_percent', 0))
        if service_upper in ('NTC', 'NCELL') or 'DATA_PACK' in service_upper
        else Decimal('0.00')
    )
    try:
        result = himalpay.calculate_cashback_and_charge(service, amount)
        provider_charge = himalpay.to_rupees(result.get('charge', 0) or 0)
        charge = provider_charge + platform_fee
        cashback = himalpay.to_rupees(result.get('cashback', 0) or 0)
        total = amount + charge - cashback
        return Response(
            {
                'wallet_service_name': service,
                'amount': str(amount),
                'amount_paisa': himalpay.to_paisa(amount),
                'provider_charge': str(provider_charge),
                'platform_charge': str(platform_fee),
                'charge': str(charge),
                'cashback': str(cashback),
                'total_debited': str(total),
                'raw': result,
            },
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            {'error': exc.message, 'error_code': exc.error_code, 'error_type': exc.error_type},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def check_transaction_status(request):
    """Check HimalPay transaction status by merchant_transaction_id"""
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()

    try:
        result = himalpay.check_transaction_status(merchant_txn_id)
        normalized = himalpay.normalize_status(result)

        # Sync local topup if owned by this user
        topup = TopupTransaction.objects.filter(
            user=request.user, merchant_txn_id=merchant_txn_id
        ).first()
        if topup and topup.status == 'pending' and normalized in ('success', 'failed', 'pending'):
            auto = is_auto_status_verified()
            local_status = resolve_provider_outcome(normalized, auto)
            platform_fee = _platform_fee_for_amount(topup.amount)
            # Skip no-op poll while still waiting on provider and auto is off
            if normalized == 'pending' and not auto:
                pass
            else:
                with transaction.atomic():
                    topup = TopupTransaction.objects.select_for_update().get(pk=topup.pk)
                    if topup.status == 'pending':
                        _apply_fee_fields(
                            topup, himalpay, result, topup.amount, platform_fee=platform_fee,
                        )
                        if local_status == 'success':
                            wallet = _get_or_create_wallet(request.user)
                            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                            debit = topup.total_debited or topup.amount
                            if wallet.balance >= debit:
                                wallet.balance -= debit
                                wallet.save()
                                topup.status = 'success'
                                topup.save()
                                notify_topup_success(topup)
                                notify_low_balance_if_needed(wallet)
                            else:
                                topup.status = 'failed'
                                topup.provider_response = {
                                    **(topup.provider_response or {}),
                                    'local_error': 'Insufficient balance on status sync',
                                }
                                topup.save()
                        elif local_status == 'failed':
                            topup.status = 'failed'
                            topup.save()
                        else:
                            # Provider success/pending but awaiting admin — keep pending
                            topup.save()

        return Response(
            {
                'status': normalized,
                'himalpay_status': result.get('status'),
                'message': (
                    himalpay.extract_failure_details(result)['message']
                    if normalized == 'failed'
                    else None
                ),
                'data': result,
                'local_topup': TopupTransactionSerializer(topup).data if topup else None,
            },
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            {'error': exc.message, 'error_code': exc.error_code, 'error_type': exc.error_type},
            status=status.HTTP_400_BAD_REQUEST,
        )
