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

logger = logging.getLogger(__name__)


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _apply_fee_fields(topup_txn, himalpay: HimalPayAPI, response: dict, amount):
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    total_paisa = response.get(
        'total_debited',
        response.get('net_amount', himalpay.to_paisa(amount) + int(charge_paisa) - int(cashback_paisa)),
    )
    topup_txn.charge = himalpay.to_rupees(charge_paisa)
    topup_txn.cashback = himalpay.to_rupees(cashback_paisa)
    topup_txn.total_debited = himalpay.to_rupees(total_paisa)
    topup_txn.service_hub_txn_id = himalpay.extract_transaction_id(response)
    topup_txn.reference_id = himalpay.extract_reference_id(response)
    topup_txn.provider_response = response


def _process_topup(request, product_id: int, service_label: str):
    serializer = TopupCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if serializer.validated_data.get('product_id') != product_id:
        return Response(
            {'error': f'Invalid product_id. Use {product_id} for {service_label}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    mobile_number = serializer.validated_data['mobile_number']
    amount = serializer.validated_data['amount']
    wallet = _get_or_create_wallet(request.user)

    himalpay = HimalPayAPI()
    service_name = HimalPayAPI.SERVICE_NTC if product_id == 1 else HimalPayAPI.SERVICE_NCELL

    # Pre-calculate charge so we can validate sufficient balance
    try:
        fee_info = himalpay.calculate_cashback_and_charge(service_name, amount)
        charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0)
        cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
        total_required = amount + charge - cashback
    except HimalPayError as exc:
        logger.warning('Charge calculation failed for %s: %s', service_label, exc.message)
        charge = Decimal('0.00')
        cashback = Decimal('0.00')
        total_required = amount

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
        _apply_fee_fields(topup_txn, himalpay, response, amount)

        if txn_status == 'success':
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

            return Response(
                {
                    'message': f'{service_label} topup successful',
                    'data': TopupTransactionSerializer(topup_txn).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_200_OK,
            )

        if txn_status == 'pending':
            topup_txn.status = 'pending'
            topup_txn.save()
            return Response(
                {
                    'message': f'{service_label} topup is being processed',
                    'pending_message': response.get('message', 'Your payment is being processed!'),
                    'data': TopupTransactionSerializer(topup_txn).data,
                    'himalpay_response': response,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        topup_txn.status = 'failed'
        topup_txn.save()
        return Response(
            {
                'error': f'{service_label} topup failed',
                'message': response.get('error') or response.get('message') or 'Transaction failed',
                'data': TopupTransactionSerializer(topup_txn).data,
                'himalpay_response': response,
            },
            status=status.HTTP_400_BAD_REQUEST,
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def calculate_charge(request):
    """Calculate HimalPay cashback and charge for a service/amount"""
    serializer = CalculateChargeSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    himalpay = HimalPayAPI()
    try:
        result = himalpay.calculate_cashback_and_charge(
            serializer.validated_data['wallet_service_name'],
            serializer.validated_data['amount'],
        )
        return Response(
            {
                'wallet_service_name': serializer.validated_data['wallet_service_name'],
                'amount': str(serializer.validated_data['amount']),
                'amount_paisa': himalpay.to_paisa(serializer.validated_data['amount']),
                'charge': str(himalpay.to_rupees(result.get('charge', 0) or 0)),
                'cashback': str(himalpay.to_rupees(result.get('cashback', 0) or 0)),
                'total_debited': str(himalpay.to_rupees(result.get('total_debited', 0) or 0)),
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
        if topup and topup.status == 'pending' and normalized in ('success', 'failed'):
            with transaction.atomic():
                topup = TopupTransaction.objects.select_for_update().get(pk=topup.pk)
                if topup.status == 'pending':
                    _apply_fee_fields(topup, himalpay, result, topup.amount)
                    if normalized == 'success':
                        wallet = _get_or_create_wallet(request.user)
                        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                        debit = topup.total_debited or topup.amount
                        if wallet.balance >= debit:
                            wallet.balance -= debit
                            wallet.save()
                            topup.status = 'success'
                        else:
                            topup.status = 'failed'
                            topup.provider_response = {
                                **(topup.provider_response or {}),
                                'local_error': 'Insufficient balance on status sync',
                            }
                    else:
                        topup.status = 'failed'
                    topup.save()

        return Response(
            {
                'status': normalized,
                'himalpay_status': result.get('status'),
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
