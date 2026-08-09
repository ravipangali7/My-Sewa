"""
Wallet views: Get balance, transaction history
"""
from decimal import Decimal

from django.db.models import Sum
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


def _money(value):
    return float(value or 0)


def _sum_or_zero(qs, field='amount'):
    return qs.aggregate(t=Sum(field))['t'] or Decimal('0')


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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_transaction_history(request):
    """Get transaction history (deposits, remittances, topups, bank transfers, bills, data packs, adjustments)"""
    deposits = Deposit.objects.filter(user=request.user).order_by('-created_at')
    remittances = RemittanceTransaction.objects.filter(user=request.user).order_by('-created_at')
    topups = TopupTransaction.objects.filter(user=request.user).order_by('-created_at')
    transfers = BankTransferTransaction.objects.filter(user=request.user).order_by('-created_at')
    internet_bills = InternetBillTransaction.objects.filter(user=request.user).order_by('-created_at')
    water_bills = WaterBillTransaction.objects.filter(user=request.user).order_by('-created_at')
    electricity_bills = ElectricityBillTransaction.objects.filter(user=request.user).order_by('-created_at')
    community_electricity = CommunityElectricityTransaction.objects.filter(
        user=request.user,
    ).order_by('-created_at')
    data_packs = DataPackTransaction.objects.filter(user=request.user).order_by('-created_at')
    adjustments = WalletAdjustment.objects.filter(user=request.user).order_by('-created_at')

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
        'deposits': DepositSerializer(deposits, many=True).data,
        'remittances': RemittanceTransactionSerializer(remittances, many=True).data,
        'topups': TopupTransactionSerializer(topups, many=True).data,
        'bank_transfers': BankTransferTransactionSerializer(transfers, many=True).data,
        'internet_bills': InternetBillTransactionSerializer(internet_bills, many=True).data,
        'water_bills': WaterBillTransactionSerializer(water_bills, many=True).data,
        'electricity_bills': ElectricityBillTransactionSerializer(electricity_bills, many=True).data,
        'community_electricity': CommunityElectricityTransactionSerializer(
            community_electricity, many=True,
        ).data,
        'data_packs': DataPackTransactionSerializer(data_packs, many=True).data,
        'wallet_adjustments': WalletAdjustmentSerializer(adjustments, many=True).data,
        'summary': {
            'total_volume': _money(total_credit + total_debit),
            'total_credit': _money(total_credit),
            'total_debit': _money(total_debit),
            'total_amount': _money(total_credit + total_debit),
            'today_amount': _money(today_credit + today_debit),
            'monthly_amount': _money(month_credit + month_debit),
        },
    }, status=status.HTTP_200_OK)
