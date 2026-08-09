"""
Mobile data pack top-up views (NTC / NCELL) via HimalPay.
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

from ..models import Wallet, DataPackTransaction
from ..serializers import (
    DataPackTransactionSerializer,
    DataPackInquirySerializer,
    DataPackPaySerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError, with_himapay_response
from ..services.himalpay_parse import parse_data_pack_inquiry
from ..services.app_config import (
    get_app_config,
    platform_topup_charge,
    require_feature_enabled,
    require_account_approved,
    is_auto_status_verified,
)
from ..services.notifications import notify_low_balance_if_needed, notify_wallet_debit
from ..services.txn_status import resolve_provider_outcome, debit_wallet_for_txn

logger = logging.getLogger(__name__)

OPERATORS = {
    'NTC': {
        'get_service': 'NTC_DATA_PACK_GET',
        'pay_service': 'NTC_DATA_PACK_PAY',
    },
    'NCELL': {
        'get_service': 'NCELL_DATA_PACK_GET',
        'pay_service': 'NCELL_DATA_PACK_PAY',
    },
}


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _platform_fee(amount, user=None) -> Decimal:
    return platform_topup_charge(amount, user=user)


def _apply_fee_fields(txn, himalpay: HimalPayAPI, response: dict, amount, platform_fee=Decimal('0.00')):
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    total_paisa = response.get(
        'total_debited',
        response.get('net_amount', himalpay.to_paisa(amount) + int(charge_paisa) - int(cashback_paisa)),
    )
    txn.charge = himalpay.to_rupees(charge_paisa) + (platform_fee or Decimal('0.00'))
    txn.cashback = himalpay.to_rupees(cashback_paisa)
    txn.total_debited = himalpay.to_rupees(total_paisa) + (platform_fee or Decimal('0.00'))
    txn.service_hub_txn_id = himalpay.extract_transaction_id(response)
    txn.reference_id = himalpay.extract_reference_id(response)
    txn.provider_response = response


def _normalize_packages(raw: dict, operator: str) -> list:
    """Extract selectable data packages from live HimalPay inquiry response."""
    return parse_data_pack_inquiry(raw, operator)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def inquiry_packages(request):
    """Fetch available data packages for NTC or NCELL."""
    blocked = require_feature_enabled('data_packs')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = DataPackInquirySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    operator = serializer.validated_data['operator'].upper()
    mobile = serializer.validated_data.get('mobile_number', '').strip()
    op_cfg = OPERATORS.get(operator)
    if not op_cfg:
        return Response({'error': 'Unsupported operator.'}, status=status.HTTP_400_BAD_REQUEST)

    himalpay = HimalPayAPI()
    # HimalPay NTC/NCELL data pack catalog is fetched with empty data per API spec.
    inquiry_data: dict = {}
    if mobile:
        inquiry_data['number'] = mobile

    try:
        raw = himalpay.fetch_service_details(op_cfg['get_service'], inquiry_data)
        packages = _normalize_packages(raw, operator)
        if not packages:
            return Response(
                with_himapay_response(
                    {
                        'error': 'No data packages available.',
                        'message': 'No data packages are currently available from the operator.',
                    },
                    raw,
                ),
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            with_himapay_response(
                {
                    'message': 'Live packages retrieved from operator.',
                    'data': {
                        'operator': operator,
                        'mobile_number': mobile,
                        'packages': packages,
                    },
                },
                raw,
            ),
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            with_himapay_response(
                {
                    'error': 'Package inquiry failed',
                    'message': exc.message,
                    'error_code': exc.error_code,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def pay_data_pack(request):
    """Purchase a data pack from wallet balance."""
    blocked = require_feature_enabled('data_packs')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = DataPackPaySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from ..services.pin import transaction_pin_gate
    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    operator = serializer.validated_data['operator'].upper()
    mobile = serializer.validated_data['mobile_number']
    amount = HimalPayAPI.normalize_rupees(serializer.validated_data['amount'])
    package_name = serializer.validated_data.get('package_name') or ''
    package_id = serializer.validated_data.get('package_id') or ''
    product_code = serializer.validated_data.get('product_code') or ''

    op_cfg = OPERATORS.get(operator)
    if not op_cfg:
        return Response({'error': 'Unsupported operator.'}, status=status.HTTP_400_BAD_REQUEST)

    wallet = _get_or_create_wallet(request.user)
    himalpay = HimalPayAPI()
    pay_service = op_cfg['pay_service']
    platform_fee = _platform_fee(amount, user=request.user)

    pay_data = {'number': mobile}
    if operator == 'NTC':
        if package_id:
            pay_data['package_id'] = int(package_id) if str(package_id).isdigit() else package_id
        if product_code:
            try:
                pay_data['product_code'] = int(product_code)
            except (TypeError, ValueError):
                pay_data['product_code'] = product_code
    else:
        if product_code:
            pay_data['product_code'] = str(product_code)

    try:
        fee_info = himalpay.calculate_cashback_and_charge(pay_service, amount)
        charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0) + platform_fee
        cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
        total_required = amount + charge - cashback
    except HimalPayError as exc:
        if getattr(exc, 'is_ip_blocked', False) or exc.status_code in (401, 403):
            return Response(
                with_himapay_response(
                    {'error': 'Data pack purchase failed', 'message': exc.message},
                    exc.response_data,
                ),
                status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            )
        charge = platform_fee
        cashback = Decimal('0.00')
        total_required = amount + platform_fee

    if wallet.balance < total_required:
        return Response(
            {
                'error': 'Insufficient balance',
                'required': str(total_required),
                'available': str(wallet.balance),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = f"MYSEWA_DATA_{uuid.uuid4().hex[:12].upper()}"
    data_txn = DataPackTransaction.objects.create(
        user=request.user,
        operator=operator,
        mobile_number=mobile,
        package_name=package_name,
        package_id=str(package_id),
        product_code=str(product_code),
        amount=amount,
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=charge,
        cashback=cashback,
        total_debited=total_required,
        inquiry_response={'operator': operator, 'package_id': package_id, 'product_code': product_code},
    )

    try:
        response = himalpay.process_payment(
            pay_service,
            amount,
            merchant_txn_id,
            pay_data,
        )
        txn_status = himalpay.normalize_status(response)
        _apply_fee_fields(data_txn, himalpay, response, amount, platform_fee=platform_fee)

        if txn_status == 'failed':
            data_txn.status = 'failed'
            data_txn.save()
            failure = himalpay.extract_failure_details(response)
            return Response(
                with_himapay_response(
                    {
                        'error': 'Data pack purchase failed',
                        'message': failure['message'],
                        'wallet_debited': False,
                        'data': DataPackTransactionSerializer(data_txn).data,
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
                debit = data_txn.total_debited or amount
                if wallet.balance < debit:
                    data_txn.status = 'failed'
                    data_txn.save()
                    return Response(
                        with_himapay_response(
                            {'error': 'Insufficient balance after fee calculation'},
                            response,
                        ),
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                debit_wallet_for_txn(wallet, data_txn, debit)
                data_txn.status = 'success'
                data_txn.save()
            notify_wallet_debit(
                request.user,
                debit,
                balance_after=wallet.balance,
                reason=f'{operator} data pack',
                ref=data_txn.merchant_txn_id,
            )
            notify_low_balance_if_needed(wallet)
            return Response(
                with_himapay_response(
                    {
                        'message': f'{operator} data pack purchased successfully',
                        'data': DataPackTransactionSerializer(data_txn).data,
                    },
                    response,
                ),
                status=status.HTTP_200_OK,
            )

        data_txn.status = 'pending'
        data_txn.save()
        return Response(
            with_himapay_response(
                {
                    'message': 'Data pack purchase is being processed',
                    'pending_message': response.get('message', 'Your purchase awaits verification.'),
                    'data': DataPackTransactionSerializer(data_txn).data,
                },
                response,
            ),
            status=status.HTTP_202_ACCEPTED,
        )

    except HimalPayError as exc:
        data_txn.status = 'failed'
        data_txn.provider_response = exc.response_data
        data_txn.save()
        return Response(
            with_himapay_response(
                {
                    'error': 'Data pack purchase failed',
                    'message': exc.message,
                    'data': DataPackTransactionSerializer(data_txn).data,
                },
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        data_txn.status = 'failed'
        data_txn.save()
        logger.error('Data pack pay failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Payment request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def data_pack_history(request):
    from ..services.list_response import items_with_stats_response

    txns = DataPackTransaction.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        txns,
        DataPackTransactionSerializer,
        request,
        search_fields=(
            'mobile_number', 'package_name', 'operator',
            'merchant_txn_id', 'reference_id',
        ),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def data_pack_status(request):
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()
    data_txn = DataPackTransaction.objects.filter(
        user=request.user, merchant_txn_id=merchant_txn_id,
    ).first()

    try:
        result = himalpay.check_transaction_status(merchant_txn_id)
        normalized = himalpay.normalize_status(result)

        if data_txn and data_txn.status == 'pending' and normalized in ('success', 'failed', 'pending'):
            auto = is_auto_status_verified()
            local_status = resolve_provider_outcome(normalized, auto)
            platform_fee = _platform_fee(data_txn.amount, user=request.user)
            if not (normalized == 'pending' and not auto):
                with transaction.atomic():
                    data_txn = DataPackTransaction.objects.select_for_update().get(pk=data_txn.pk)
                    if data_txn.status == 'pending':
                        _apply_fee_fields(
                            data_txn, himalpay, result, data_txn.amount, platform_fee=platform_fee,
                        )
                        if local_status == 'success':
                            wallet = _get_or_create_wallet(request.user)
                            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                            debit = data_txn.total_debited or data_txn.amount
                            if wallet.balance >= debit:
                                debit_wallet_for_txn(wallet, data_txn, debit)
                                data_txn.status = 'success'
                                data_txn.save()
                                notify_wallet_debit(
                                    request.user,
                                    debit,
                                    balance_after=wallet.balance,
                                    reason='Data pack purchase',
                                    ref=data_txn.merchant_txn_id,
                                )
                                notify_low_balance_if_needed(wallet)
                            else:
                                data_txn.status = 'failed'
                                data_txn.save()
                        elif local_status == 'failed':
                            data_txn.status = 'failed'
                            data_txn.save()
                        else:
                            data_txn.save()

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
                    'local_data_pack': DataPackTransactionSerializer(data_txn).data if data_txn else None,
                },
                result,
            ),
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            with_himapay_response(
                {'error': exc.message},
                exc.response_data,
            ),
            status=status.HTTP_400_BAD_REQUEST,
        )
