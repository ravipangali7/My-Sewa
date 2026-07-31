"""
Bank Transfer views via HimalPay Reseller API

Flow:
1. GET  /api/bank-transfer/banks/     — list available banks
2. POST /api/bank-transfer/verify/    — verify destination account
3. POST /api/bank-transfer/calculate/ — preview charge/cashback
4. POST /api/bank-transfer/create/    — process transfer
5. GET  /api/bank-transfer/history/   — user history
6. POST /api/bank-transfer/status/    — poll transaction status
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

from ..models import Wallet, BankTransferTransaction
from ..serializers import (
    BankTransferTransactionSerializer,
    BankAccountVerifySerializer,
    BankTransferCreateSerializer,
    CalculateChargeSerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError
from ..services.app_config import (
    get_app_config,
    resolve_transfer_fees,
    require_feature_enabled,
)
from ..services.notifications import notify_low_balance_if_needed
from django.utils import timezone
from django.db.models import Sum

logger = logging.getLogger(__name__)


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _normalize_banks(raw) -> list:
    """Extract a flat bank list from various HimalPay response shapes."""
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = (
            raw.get('banks')
            or raw.get('data')
            or raw.get('Data')
            or raw.get('result')
            or []
        )
        if isinstance(items, dict):
            items = items.get('banks') or items.get('list') or []
    else:
        items = []

    banks = []
    for item in items:
        if not isinstance(item, dict):
            continue
        code = (
            item.get('bank_code')
            or item.get('code')
            or item.get('BankCode')
            or item.get('swift_code')
            or ''
        )
        name = (
            item.get('bank_name')
            or item.get('name')
            or item.get('BankName')
            or code
        )
        if code:
            banks.append({
                'bank_code': str(code),
                'bank_name': str(name),
                'raw': item,
            })
    return banks


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_banks(request):
    """List banks available for HimalPay bank transfer."""
    blocked = require_feature_enabled('transfers')
    if blocked:
        return blocked

    himalpay = HimalPayAPI()
    try:
        raw = himalpay.list_banks()
        banks = _normalize_banks(raw)
        return Response(
            {'data': {'banks': banks}, 'banks': banks, 'raw': raw},
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            {'error': exc.message, 'error_code': exc.error_code, 'error_type': exc.error_type},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        logger.error('list_banks failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Failed to fetch bank list', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_account(request):
    """Verify destination bank account before transfer."""
    blocked = require_feature_enabled('transfers')
    if blocked:
        return blocked

    serializer = BankAccountVerifySerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    merchant_txn_id = data.get('merchant_txn_id') or f"MYSEWA_VF_{uuid.uuid4().hex[:14].upper()}"
    is_mobile = 'y' if data.get('is_mobile') else 'n'

    himalpay = HimalPayAPI()
    try:
        result = himalpay.verify_bank_account(
            bank_code=data['bank_code'],
            account_name=data['account_name'],
            account_number=data['account_number'],
            merchant_txn_id=merchant_txn_id,
            is_mobile=is_mobile,
        )
        return Response(
            {
                'message': 'Account verification completed',
                'data': {
                    'verified': True,
                    'merchant_txn_id': merchant_txn_id,
                    'provider': result,
                },
            },
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            {
                'error': 'Account verification failed',
                'message': exc.message,
                'error_code': exc.error_code,
                'error_type': exc.error_type,
                'verified': False,
                'merchant_txn_id': merchant_txn_id,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def calculate_transfer_charge(request):
    """Preview charge/cashback for a bank transfer amount (+ platform flat fee)."""
    blocked = require_feature_enabled('transfers')
    if blocked:
        return blocked

    payload = {
        'wallet_service_name': 'BANK_TRANSFER',
        'amount': request.data.get('amount'),
    }
    serializer = CalculateChargeSerializer(data=payload)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    amount = serializer.validated_data['amount']
    tx_cfg = get_app_config().get('transactions') or {}
    himalpay = HimalPayAPI()
    try:
        result = himalpay.calculate_cashback_and_charge(
            HimalPayAPI.SERVICE_BANK_TRANSFER,
            amount,
        )
        provider_charge = himalpay.to_rupees(result.get('charge', 0) or 0)
        provider_cashback = himalpay.to_rupees(result.get('cashback', 0) or 0)
        fees = resolve_transfer_fees(amount, provider_charge, provider_cashback, tx_cfg)
        return Response(
            {
                'data': {
                    'amount': str(amount),
                    'charge': str(fees['charge']),
                    'cashback': str(fees['cashback']),
                    'platform_charge': str(fees['platform_charge']),
                    'total_debited': str(fees['total_debited']),
                    'charge_enabled': bool(tx_cfg.get('transfer_charge_enabled', True)),
                    'cashback_enabled': bool(tx_cfg.get('cashback_enabled', True)),
                },
                'raw': result,
            },
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        # Still honour admin fees when provider preview fails
        fees = resolve_transfer_fees(amount, 0, 0, tx_cfg)
        if fees['charge'] > 0 or fees['cashback'] > 0 or not bool(
            tx_cfg.get('transfer_charge_enabled', True)
        ):
            return Response(
                {
                    'data': {
                        'amount': str(amount),
                        'charge': str(fees['charge']),
                        'cashback': str(fees['cashback']),
                        'platform_charge': str(fees['platform_charge']),
                        'total_debited': str(fees['total_debited']),
                        'charge_enabled': bool(tx_cfg.get('transfer_charge_enabled', True)),
                        'cashback_enabled': bool(tx_cfg.get('cashback_enabled', True)),
                    },
                    'warning': exc.message,
                },
                status=status.HTTP_200_OK,
            )
        return Response(
            {'error': exc.message, 'error_code': exc.error_code, 'error_type': exc.error_type},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_bank_transfer(request):
    """Process an outbound bank transfer via HimalPay."""
    blocked = require_feature_enabled('transfers')
    if blocked:
        return blocked

    serializer = BankTransferCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    amount = data['amount']
    wallet = _get_or_create_wallet(request.user)
    himalpay = HimalPayAPI()

    tx_cfg = get_app_config().get('transactions') or {}
    daily_limit = Decimal(str(tx_cfg.get('daily_transfer_limit') or 0))

    if daily_limit > 0:
        today = timezone.localdate()
        used = (
            BankTransferTransaction.objects.filter(
                user=request.user,
                created_at__date=today,
            )
            .exclude(status='failed')
            .aggregate(total=Sum('amount'))['total']
            or Decimal('0.00')
        )
        if used + amount > daily_limit:
            return Response(
                {
                    'error': 'Daily transfer limit exceeded',
                    'message': (
                        f'Daily transfer limit is Rs. {daily_limit}. '
                        f'You have already transferred Rs. {used} today.'
                    ),
                    'daily_limit': str(daily_limit),
                    'used_today': str(used),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    try:
        fee_info = himalpay.calculate_cashback_and_charge(
            HimalPayAPI.SERVICE_BANK_TRANSFER, amount
        )
        provider_charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0)
        provider_cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
    except HimalPayError as exc:
        logger.warning('Bank transfer charge calc failed: %s', exc.message)
        provider_charge = Decimal('0.00')
        provider_cashback = Decimal('0.00')

    fees = resolve_transfer_fees(amount, provider_charge, provider_cashback, tx_cfg)
    charge = fees['charge']
    cashback = fees['cashback']
    total_required = fees['total_debited']

    if wallet.balance < total_required:
        return Response(
            {
                'error': 'Insufficient balance',
                'required': str(total_required),
                'available': str(wallet.balance),
                'charge': str(charge),
                'cashback': str(cashback),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = data.get('merchant_txn_id') or f"MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}"
    if BankTransferTransaction.objects.filter(merchant_txn_id=merchant_txn_id).exists():
        merchant_txn_id = f"MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}"

    is_mobile = bool(data.get('is_destination_mobile'))
    transfer = BankTransferTransaction.objects.create(
        user=request.user,
        amount=amount,
        destination_bank=data['destination_bank'],
        destination_bank_name=data.get('destination_bank_name') or '',
        destination_acc_no=data['destination_acc_no'],
        destination_acc_name=data['destination_acc_name'],
        is_destination_mobile=is_mobile,
        transaction_remarks=data.get('transaction_remarks') or 'Fund Transfer',
        transaction_remarks_2=data.get('transaction_remarks_2') or '',
        transaction_remarks_3=data.get('transaction_remarks_3') or '',
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=charge,
        cashback=cashback,
        total_debited=total_required,
        verified=True,
    )

    try:
        # Verify account first (required three-step flow)
        himalpay.verify_bank_account(
            bank_code=data['destination_bank'],
            account_name=data['destination_acc_name'],
            account_number=data['destination_acc_no'],
            merchant_txn_id=merchant_txn_id,
            is_mobile='y' if is_mobile else 'n',
        )

        response = himalpay.bank_transfer(
            amount_rupees=amount,
            merchant_transaction_id=merchant_txn_id,
            destination_bank=data['destination_bank'],
            destination_acc_no=data['destination_acc_no'],
            destination_acc_name=data['destination_acc_name'],
            is_destination_mobile='y' if is_mobile else 'n',
            transaction_remarks=transfer.transaction_remarks,
            transaction_remarks_2=transfer.transaction_remarks_2,
            transaction_remarks_3=transfer.transaction_remarks_3,
        )

        txn_status = himalpay.normalize_status(response)
        charge_paisa = response.get('charge', response.get('applied_charge', himalpay.to_paisa(provider_charge))) or 0
        cashback_paisa = response.get('cashback', response.get('applied_cashback', himalpay.to_paisa(provider_cashback))) or 0
        applied = resolve_transfer_fees(
            amount,
            himalpay.to_rupees(charge_paisa),
            himalpay.to_rupees(cashback_paisa),
            tx_cfg,
        )
        transfer.charge = applied['charge']
        transfer.cashback = applied['cashback']
        transfer.total_debited = applied['total_debited']
        transfer.provider_txn_id = himalpay.extract_transaction_id(response)
        transfer.reference_id = himalpay.extract_reference_id(response)
        transfer.provider_response = response

        if txn_status == 'success':
            with transaction.atomic():
                wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                debit = transfer.total_debited or amount
                if wallet.balance < debit:
                    transfer.status = 'failed'
                    transfer.save()
                    return Response(
                        {'error': 'Insufficient balance after fee calculation'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                wallet.balance -= debit
                wallet.save()
                transfer.status = 'success'
                transfer.save()

            notify_low_balance_if_needed(wallet)

            return Response(
                {
                    'message': 'Bank transfer successful',
                    'data': BankTransferTransactionSerializer(transfer).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_200_OK,
            )

        if txn_status == 'pending':
            transfer.status = 'pending'
            transfer.save()
            return Response(
                {
                    'message': 'Bank transfer is being processed',
                    'pending_message': response.get('message', 'Your transfer is being processed!'),
                    'data': BankTransferTransactionSerializer(transfer).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        transfer.status = 'failed'
        transfer.save()
        return Response(
            {
                'error': 'Bank transfer failed',
                'message': response.get('error') or response.get('message') or 'Transaction failed',
                'data': BankTransferTransactionSerializer(transfer).data,
                'himalpay_response': response,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    except HimalPayError as exc:
        transfer.status = 'failed'
        transfer.provider_response = exc.response_data
        transfer.save()
        logger.error(
            'Bank transfer HimalPay error: %s code=%s type=%s',
            exc.message, exc.error_code, exc.error_type,
        )
        return Response(
            {
                'error': 'Bank transfer failed',
                'message': exc.message,
                'error_code': exc.error_code,
                'error_type': exc.error_type,
                'data': BankTransferTransactionSerializer(transfer).data,
            },
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )

    except Exception as exc:
        transfer.status = 'failed'
        transfer.save()
        logger.error('Bank transfer failed: %s\n%s', exc, traceback.format_exc())
        return Response(
            {'error': 'Bank transfer request failed', 'message': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def bank_transfer_history(request):
    transfers = BankTransferTransaction.objects.filter(user=request.user).order_by('-created_at')
    serializer = BankTransferTransactionSerializer(transfers, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bank_transfer_status(request):
    """Poll HimalPay status and sync local bank transfer record."""
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    himalpay = HimalPayAPI()

    try:
        result = himalpay.check_transaction_status(merchant_txn_id)
        normalized = himalpay.normalize_status(result)

        transfer = BankTransferTransaction.objects.filter(
            user=request.user, merchant_txn_id=merchant_txn_id
        ).first()

        if transfer and transfer.status == 'pending' and normalized in ('success', 'failed'):
            with transaction.atomic():
                transfer = BankTransferTransaction.objects.select_for_update().get(pk=transfer.pk)
                if transfer.status == 'pending':
                    transfer.provider_txn_id = himalpay.extract_transaction_id(result)
                    transfer.reference_id = himalpay.extract_reference_id(result)
                    transfer.provider_response = result
                    if normalized == 'success':
                        wallet = _get_or_create_wallet(request.user)
                        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                        debit = transfer.total_debited or transfer.amount
                        if wallet.balance >= debit:
                            wallet.balance -= debit
                            wallet.save()
                            transfer.status = 'success'
                        else:
                            transfer.status = 'failed'
                    else:
                        transfer.status = 'failed'
                    transfer.save()

        return Response(
            {
                'status': normalized,
                'himalpay_status': result.get('status'),
                'data': result,
                'local_transfer': BankTransferTransactionSerializer(transfer).data if transfer else None,
            },
            status=status.HTTP_200_OK,
        )
    except HimalPayError as exc:
        return Response(
            {'error': exc.message, 'error_code': exc.error_code, 'error_type': exc.error_type},
            status=status.HTTP_400_BAD_REQUEST,
        )
