"""
Wallet views: Get balance, transaction history
"""
from decimal import Decimal
import logging

from django.db.models import Sum
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import (
    Wallet,
    Deposit,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    WaterBillTransaction,
    ElectricityBillTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    WalletAdjustment,
    _ensure_electricity_bill_table,
)
from ..serializers import (
    WalletSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    BankTransferTransactionSerializer,
    RemittanceTransactionSerializer,
    InternetBillTransactionSerializer,
    WaterBillTransactionSerializer,
    ElectricityBillTransactionSerializer,
    CommunityElectricityTransactionSerializer,
    DataPackTransactionSerializer,
    WalletAdjustmentSerializer,
)

logger = logging.getLogger(__name__)


def _money(value):
    return float(value or 0)


def _sum_or_zero(qs, field='amount'):
    try:
        return qs.aggregate(t=Sum(field))['t'] or Decimal('0')
    except (OperationalError, ProgrammingError):
        # Missing table after a partial deploy (e.g. electricity migration not applied).
        return Decimal('0')


def _user_ordered(model, user):
    """Return user txs, or empty qs if the model table is missing."""
    qs = model.objects.filter(user=user).order_by('-created_at')
    try:
        qs.exists()
        return qs
    except (OperationalError, ProgrammingError) as exc:
        msg = str(exc).lower()
        if model is ElectricityBillTransaction and 'electricitybilltransaction' in msg:
            try:
                _ensure_electricity_bill_table()
                qs = model.objects.filter(user=user).order_by('-created_at')
                qs.exists()
                return qs
            except Exception:
                logger.exception('Failed to self-heal electricity bill table')
        return model.objects.none()


def _serialize_many(serializer_cls, qs):
    try:
        return serializer_cls(qs, many=True).data
    except (OperationalError, ProgrammingError):
        return []


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_wallet_balance(request):
    """Get current user's wallet balance"""
    try:
        wallet = Wallet.objects.get(user=request.user)
        serializer = WalletSerializer(wallet)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Wallet.DoesNotExist:
        wallet = Wallet.objects.create(user=request.user, balance=0.00)
        serializer = WalletSerializer(wallet)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except (OperationalError, ProgrammingError):
        return Response(
            {
                'id': None,
                'user': str(request.user),
                'phone': getattr(request.user, 'phone', ''),
                'balance': '0.00',
                'created_at': None,
                'updated_at': None,
            },
            status=status.HTTP_200_OK,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_transaction_history(request):
    """Get transaction history (deposits, remittances, topups, bank transfers, bills, data packs, adjustments)"""
    try:
        return _transaction_history_payload(request)
    except (OperationalError, ProgrammingError):
        logger.exception('wallet transactions failed')
        return Response({
            'deposits': [],
            'remittances': [],
            'topups': [],
            'bank_transfers': [],
            'internet_bills': [],
            'water_bills': [],
            'electricity_bills': [],
            'community_electricity': [],
            'data_packs': [],
            'wallet_adjustments': [],
            'summary': {
                'total_volume': 0,
                'total_credit': 0,
                'total_debit': 0,
                'total_amount': 0,
                'today_amount': 0,
                'monthly_amount': 0,
            },
        }, status=status.HTTP_200_OK)


def _transaction_history_payload(request):
    """Build wallet history payload. Raises if a table is missing and cannot be healed."""
    # Self-heal skipped migrate 0031 so wallet history never 500s on missing table.
    try:
        _ensure_electricity_bill_table()
    except Exception:
        logger.exception('electricity bill table ensure failed')

    deposits = _user_ordered(Deposit, request.user)
    remittances = _user_ordered(RemittanceTransaction, request.user)
    topups = _user_ordered(TopupTransaction, request.user)
    transfers = _user_ordered(BankTransferTransaction, request.user)
    internet_bills = _user_ordered(InternetBillTransaction, request.user)
    water_bills = _user_ordered(WaterBillTransaction, request.user)
    electricity_bills = _user_ordered(ElectricityBillTransaction, request.user)
    community_electricity = _user_ordered(CommunityElectricityTransaction, request.user)
    data_packs = _user_ordered(DataPackTransaction, request.user)
    adjustments = _user_ordered(WalletAdjustment, request.user)

    today = timezone.localdate()
    month_start = today.replace(day=1)

    approved_deposits = deposits.filter(status='approved')
    success_remittances = remittances.filter(status='success')
    success_topups = topups.filter(status='success')
    success_transfers = transfers.filter(status='success')
    success_internet = internet_bills.filter(status='success')
    success_water = water_bills.filter(status='success')
    success_electricity = electricity_bills.filter(status='success')
    success_community = community_electricity.filter(status='success')
    success_packs = data_packs.filter(status='success')
    credit_adjustments = adjustments.filter(adjustment_type='credit')
    debit_adjustments = adjustments.filter(adjustment_type='debit')

    deposit_credit = _sum_or_zero(approved_deposits)
    remittance_credit = _sum_or_zero(success_remittances, 'total_credited')
    if remittance_credit == 0:
        remittance_credit = _sum_or_zero(success_remittances)
    adjustment_credit = _sum_or_zero(credit_adjustments)

    def _debit(qs):
        total = _sum_or_zero(qs, 'total_debited')
        return total if total else _sum_or_zero(qs)

    adjustment_debit = abs(_sum_or_zero(debit_adjustments))
    total_credit = deposit_credit + remittance_credit + adjustment_credit
    total_debit = (
        _debit(success_topups)
        + _debit(success_transfers)
        + _debit(success_internet)
        + _debit(success_water)
        + _debit(success_electricity)
        + _debit(success_community)
        + _debit(success_packs)
        + adjustment_debit
    )

    today_credit = (
        _sum_or_zero(approved_deposits.filter(created_at__date=today))
        + (
            _sum_or_zero(success_remittances.filter(created_at__date=today), 'total_credited')
            or _sum_or_zero(success_remittances.filter(created_at__date=today))
        )
        + _sum_or_zero(credit_adjustments.filter(created_at__date=today))
    )
    today_debit = (
        _debit(success_topups.filter(created_at__date=today))
        + _debit(success_transfers.filter(created_at__date=today))
        + _debit(success_internet.filter(created_at__date=today))
        + _debit(success_water.filter(created_at__date=today))
        + _debit(success_electricity.filter(created_at__date=today))
        + _debit(success_community.filter(created_at__date=today))
        + _debit(success_packs.filter(created_at__date=today))
        + abs(_sum_or_zero(debit_adjustments.filter(created_at__date=today)))
    )
    month_credit = (
        _sum_or_zero(approved_deposits.filter(created_at__date__gte=month_start))
        + (
            _sum_or_zero(success_remittances.filter(created_at__date__gte=month_start), 'total_credited')
            or _sum_or_zero(success_remittances.filter(created_at__date__gte=month_start))
        )
        + _sum_or_zero(credit_adjustments.filter(created_at__date__gte=month_start))
    )
    month_debit = (
        _debit(success_topups.filter(created_at__date__gte=month_start))
        + _debit(success_transfers.filter(created_at__date__gte=month_start))
        + _debit(success_internet.filter(created_at__date__gte=month_start))
        + _debit(success_water.filter(created_at__date__gte=month_start))
        + _debit(success_electricity.filter(created_at__date__gte=month_start))
        + _debit(success_community.filter(created_at__date__gte=month_start))
        + _debit(success_packs.filter(created_at__date__gte=month_start))
        + abs(_sum_or_zero(debit_adjustments.filter(created_at__date__gte=month_start)))
    )

    return Response({
        'deposits': _serialize_many(DepositSerializer, deposits),
        'remittances': _serialize_many(RemittanceTransactionSerializer, remittances),
        'topups': _serialize_many(TopupTransactionSerializer, topups),
        'bank_transfers': _serialize_many(BankTransferTransactionSerializer, transfers),
        'internet_bills': _serialize_many(InternetBillTransactionSerializer, internet_bills),
        'water_bills': _serialize_many(WaterBillTransactionSerializer, water_bills),
        'electricity_bills': _serialize_many(ElectricityBillTransactionSerializer, electricity_bills),
        'community_electricity': _serialize_many(
            CommunityElectricityTransactionSerializer, community_electricity,
        ),
        'data_packs': _serialize_many(DataPackTransactionSerializer, data_packs),
        'wallet_adjustments': _serialize_many(WalletAdjustmentSerializer, adjustments),
        'summary': {
            'total_volume': _money(total_credit + total_debit),
            'total_credit': _money(total_credit),
            'total_debit': _money(total_debit),
            'total_amount': _money(total_credit + total_debit),
            'today_amount': _money(today_credit + today_debit),
            'monthly_amount': _money(month_credit + month_debit),
        },
    }, status=status.HTTP_200_OK)
