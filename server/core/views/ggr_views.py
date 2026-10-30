"""
API endpoints for GGR Coins, Payment API, and Shareholder Revenue & Withdrawals.
"""
from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from django.contrib.auth import get_user_model
from django.db.models import Sum
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..authentication import ApiKeyAuthentication, TokenAuthentication
from ..models import (
    CustomUser,
    Wallet,
    GgrWallet,
    GgrTransaction,
    MonthlyGgrSettlement,
    PlatformServiceFeeConfig,
    ShareholderWallet,
    ShareholderRevenueLog,
    ShareholderWithdrawal,
    ApiPayinLog,
    ApiFundTransferLog,
)
from ..services.ggr_service import (
    get_service_fee_config,
    ensure_ggr_wallet,
    ensure_shareholder_wallet,
    buy_ggr_coins,
    process_game_event,
    settle_monthly_ggr_for_user,
    process_payment_api_deposit,
    process_payment_api_withdraw,
    execute_shareholder_withdrawal,
)
from .admin_views import IsStaffUser

logger = logging.getLogger(__name__)
User = get_user_model()


def _require_api_access(user):
    if not getattr(user, 'is_api_user', False):
        return Response(
            {
                'error': 'API access required',
                'message': 'GGR Coin service and Payment API are restricted to API users enabled by Super Admin.',
                'code': 'api_user_required',
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_ggr_dashboard(request):
    """
    Dashboard for API user:
    Returns Cash balance, GGR coin balance, stats, and recent GGR transactions.
    """
    check = _require_api_access(request.user)
    if check:
        return check

    user = request.user
    user_wallet, _ = Wallet.objects.get_or_create(user=user)
    ggr_wallet = ensure_ggr_wallet(user)
    fee_config = get_service_fee_config()

    txns = GgrTransaction.objects.filter(wallet=ggr_wallet).order_by('-created_at')[:50]
    settlements = MonthlyGgrSettlement.objects.filter(user=user).order_by('-created_at')[:12]

    # Calculate current net profit estimate for user
    net_profit_estimate = (ggr_wallet.total_won or Decimal('0.00')) - (ggr_wallet.total_lost or Decimal('0.00'))
    estimated_monthly_fee = max(
        Decimal('0.00'),
        round(net_profit_estimate * (fee_config.ggr_monthly_profit_percent / Decimal('100.00')), 2)
    )

    return Response({
        'user': {
            'id': user.id,
            'phone': user.phone,
            'first_name': user.first_name,
            'is_api_user': user.is_api_user,
        },
        'cash_balance': str(user_wallet.balance),
        'ggr_coin_balance': str(ggr_wallet.coin_balance),
        'total_bought': str(ggr_wallet.total_bought),
        'total_won': str(ggr_wallet.total_won),
        'total_lost': str(ggr_wallet.total_lost),
        'net_profit_estimate': str(net_profit_estimate),
        'estimated_monthly_fee': str(estimated_monthly_fee),
        'service_fees': {
            'ggr_monthly_profit_percent': str(fee_config.ggr_monthly_profit_percent),
            'payment_api_deposit_percent': str(fee_config.payment_api_deposit_percent),
            'payment_api_withdraw_percent': str(fee_config.payment_api_withdraw_percent),
        },
        'recent_transactions': [
            {
                'id': t.id,
                'txn_type': t.txn_type,
                'type_label': t.get_txn_type_display(),
                'amount': str(t.amount),
                'balance_after': str(t.balance_after),
                'reference': t.reference,
                'notes': t.notes,
                'created_at': t.created_at.isoformat(),
            }
            for t in txns
        ],
        'monthly_settlements': [
            {
                'id': s.id,
                'month_key': s.month_key,
                'starting_balance': str(s.starting_balance),
                'ending_balance': str(s.ending_balance),
                'net_profit': str(s.net_profit),
                'fee_percent': str(s.fee_percent),
                'fee_amount': str(s.fee_amount),
                'status': s.status,
                'created_at': s.created_at.isoformat(),
            }
            for s in settlements
        ],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_buy_ggr_coins(request):
    """
    Buy GGR coins using main wallet cash balance.
    Body: {"amount": 10000}
    """
    check = _require_api_access(request.user)
    if check:
        return check

    raw_amount = request.data.get('amount')
    try:
        amount = Decimal(str(raw_amount))
        if amount <= Decimal('0.00'):
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError):
        return Response(
            {'error': 'Invalid amount', 'message': 'Amount must be a valid positive number.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        txn = buy_ggr_coins(request.user, amount)
        ggr_wallet = txn.wallet
        return Response({
            'success': True,
            'message': f'Successfully purchased {amount} GGR coins.',
            'coin_balance': str(ggr_wallet.coin_balance),
            'cash_balance': str(request.user.wallet.balance),
            'transaction_id': txn.id,
            'reference': txn.reference,
        })
    except (ValueError, PermissionError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_game_event(request):
    """
    Record player gameplay outcome:
    Body: {"event_type": "player_win" | "player_loss", "amount": 500, "reference": "GAME123"}
    """
    check = _require_api_access(request.user)
    if check:
        return check

    event_type = request.data.get('event_type')
    raw_amount = request.data.get('amount')
    reference = request.data.get('reference', '')

    if event_type not in ('player_win', 'player_loss'):
        return Response(
            {'error': 'Invalid event_type', 'message': 'event_type must be player_win or player_loss.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(raw_amount))
        if amount <= Decimal('0.00'):
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError):
        return Response(
            {'error': 'Invalid amount', 'message': 'Amount must be positive.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        txn = process_game_event(request.user, event_type, amount, reference)
        return Response({
            'success': True,
            'event_type': event_type,
            'amount': str(txn.amount),
            'resulting_coin_balance': str(txn.balance_after),
            'reference': txn.reference,
            'notes': txn.notes,
        })
    except (ValueError, PermissionError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@authentication_classes([ApiKeyAuthentication, TokenAuthentication])
@permission_classes([IsAuthenticated])
def payment_api_deposit(request):
    """
    Payment API: End-player deposit (Payin).
    Body: {"amount": 1000, "player_id": "player_99", "reference": "REF_DEP_1"}
    """
    check = _require_api_access(request.user)
    if check:
        return check

    raw_amount = request.data.get('amount')
    player_id = str(request.data.get('player_id', '') or '')
    reference = str(request.data.get('reference', '') or '')

    try:
        amount = Decimal(str(raw_amount))
        if amount <= Decimal('0.00'):
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError):
        return Response({'error': 'Amount must be a positive number'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        res = process_payment_api_deposit(request.user, amount, player_id, reference)
        return Response({'success': True, **res})
    except (ValueError, PermissionError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@authentication_classes([ApiKeyAuthentication, TokenAuthentication])
@permission_classes([IsAuthenticated])
def payment_api_withdraw(request):
    """
    Payment API: End-player payout (Withdraw).
    Body: {"amount": 500, "player_id": "player_99", "reference": "REF_WTH_1", "payout_details": {...}}
    """
    check = _require_api_access(request.user)
    if check:
        return check

    raw_amount = request.data.get('amount')
    player_id = str(request.data.get('player_id', '') or '')
    reference = str(request.data.get('reference', '') or '')
    payout_details = request.data.get('payout_details', {})

    try:
        amount = Decimal(str(raw_amount))
        if amount <= Decimal('0.00'):
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError):
        return Response({'error': 'Amount must be a positive number'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        res = process_payment_api_withdraw(request.user, amount, player_id, reference, payout_details)
        return Response({'success': True, **res})
    except (ValueError, PermissionError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


# ============================================================================
# Admin / Shareholder Endpoints
# ============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_shareholder_dashboard(request):
    """
    Shareholder & Admin overview of service revenue from GGR and Payment API.
    Shareholder can view their balance and execute withdrawals.
    """
    user = request.user
    fee_config = get_service_fee_config()

    total_revenue_distributed = ShareholderRevenueLog.objects.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    ggr_revenue = ShareholderRevenueLog.objects.filter(source=ShareholderRevenueLog.SOURCE_GGR).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    api_deposit_revenue = ShareholderRevenueLog.objects.filter(source=ShareholderRevenueLog.SOURCE_API_DEPOSIT).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    api_withdraw_revenue = ShareholderRevenueLog.objects.filter(source=ShareholderRevenueLog.SOURCE_API_WITHDRAW).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')

    # Current user's shareholder wallet (if user is shareholder)
    shareholder_wallet = ShareholderWallet.objects.filter(shareholder=user).first()
    my_balance = str(shareholder_wallet.balance) if shareholder_wallet else '0.00'
    my_total_earned = str(shareholder_wallet.total_earned) if shareholder_wallet else '0.00'
    my_total_withdrawn = str(shareholder_wallet.total_withdrawn) if shareholder_wallet else '0.00'

    # All shareholders list
    shareholders = User.objects.filter(role=User.ROLE_SHAREHOLDER, is_active=True).select_related('shareholder_wallet')
    shareholders_data = []
    for s in shareholders:
        sw = getattr(s, 'shareholder_wallet', None)
        shareholders_data.append({
            'id': s.id,
            'phone': s.phone,
            'first_name': s.first_name,
            'last_name': s.last_name,
            'share_percent': str(s.share_percent),
            'balance': str(sw.balance if sw else '0.00'),
            'total_earned': str(sw.total_earned if sw else '0.00'),
            'total_withdrawn': str(sw.total_withdrawn if sw else '0.00'),
        })

    recent_logs = ShareholderRevenueLog.objects.select_related('shareholder').order_by('-created_at')[:50]
    recent_withdrawals = ShareholderWithdrawal.objects.select_related('shareholder').order_by('-created_at')[:30]

    return Response({
        'is_shareholder': user.role == User.ROLE_SHAREHOLDER,
        'my_wallet': {
            'balance': my_balance,
            'total_earned': my_total_earned,
            'total_withdrawn': my_total_withdrawn,
            'share_percent': str(user.share_percent or '0.00'),
        },
        'totals': {
            'total_platform_revenue': str(total_revenue_distributed),
            'ggr_revenue': str(ggr_revenue),
            'api_deposit_revenue': str(api_deposit_revenue),
            'api_withdraw_revenue': str(api_withdraw_revenue),
        },
        'service_fee_config': {
            'ggr_monthly_profit_percent': str(fee_config.ggr_monthly_profit_percent),
            'payment_api_deposit_percent': str(fee_config.payment_api_deposit_percent),
            'payment_api_withdraw_percent': str(fee_config.payment_api_withdraw_percent),
        },
        'shareholders': shareholders_data,
        'recent_logs': [
            {
                'id': l.id,
                'shareholder_phone': l.shareholder.phone,
                'amount': str(l.amount),
                'source': l.source,
                'source_label': l.get_source_display(),
                'reference': l.reference,
                'notes': l.notes,
                'created_at': l.created_at.isoformat(),
            }
            for l in recent_logs
        ],
        'recent_withdrawals': [
            {
                'id': w.id,
                'shareholder_phone': w.shareholder.phone,
                'amount': str(w.amount),
                'payout_method': w.payout_method,
                'account_name': w.account_name,
                'account_number': w.account_number,
                'bank_name': w.bank_name,
                'status': w.status,
                'created_at': w.created_at.isoformat(),
            }
            for w in recent_withdrawals
        ],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_shareholder_withdraw(request):
    """
    Shareholder withdraws their balance.
    Body: {"amount": 5000, "payout_method": "bank", "account_name": "Ravi", "account_number": "123", "bank_name": "Nabil"}
    """
    user = request.user
    if user.role != User.ROLE_SHAREHOLDER and not user.is_superuser:
        return Response(
            {'error': 'Permission denied', 'message': 'Only shareholders can withdraw service revenue.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    raw_amount = request.data.get('amount')
    payout_method = request.data.get('payout_method', 'bank')
    account_name = request.data.get('account_name', '').strip()
    account_number = request.data.get('account_number', '').strip()
    bank_name = request.data.get('bank_name', '').strip()

    if not account_name or not account_number:
        return Response(
            {'error': 'Validation error', 'message': 'Account name and account number are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(raw_amount))
        if amount <= Decimal('0.00'):
            raise ValueError()
    except (InvalidOperation, ValueError, TypeError):
        return Response({'error': 'Amount must be positive'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        withdrawal = execute_shareholder_withdrawal(
            shareholder=user,
            amount=amount,
            payout_method=payout_method,
            account_name=account_name,
            account_number=account_number,
            bank_name=bank_name,
        )
        return Response({
            'success': True,
            'message': f'Withdrawal of NPR {amount} processed successfully.',
            'withdrawal_id': withdrawal.id,
            'remaining_balance': str(user.shareholder_wallet.balance),
        })
    except (ValueError, PermissionError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_service_fee_config(request):
    """
    Get or update platform service fee percentages.
    """
    config = get_service_fee_config()

    if request.method == 'POST':
        if not (request.user.is_superuser or request.user.role == User.ROLE_SHAREHOLDER):
            return Response({'error': 'Super Admin or Shareholder access required.'}, status=status.HTTP_403_FORBIDDEN)

        ggr_pct = request.data.get('ggr_monthly_profit_percent')
        dep_pct = request.data.get('payment_api_deposit_percent')
        wth_pct = request.data.get('payment_api_withdraw_percent')

        try:
            if ggr_pct is not None:
                config.ggr_monthly_profit_percent = Decimal(str(ggr_pct))
            if dep_pct is not None:
                config.payment_api_deposit_percent = Decimal(str(dep_pct))
            if wth_pct is not None:
                config.payment_api_withdraw_percent = Decimal(str(wth_pct))
            config.save()
        except (InvalidOperation, ValueError, TypeError):
            return Response({'error': 'Invalid percentage values'}, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        'ggr_monthly_profit_percent': str(config.ggr_monthly_profit_percent),
        'payment_api_deposit_percent': str(config.payment_api_deposit_percent),
        'payment_api_withdraw_percent': str(config.payment_api_withdraw_percent),
        'updated_at': config.updated_at.isoformat(),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_settle_monthly_ggr(request):
    """
    Trigger monthly GGR 10% fee calculation & settlement.
    Optional body: {"user_id": 12, "month_key": "2026-10"}
    """
    user_id = request.data.get('user_id')
    month_key = request.data.get('month_key')

    if user_id:
        target_users = User.objects.filter(pk=user_id, is_api_user=True)
    else:
        target_users = User.objects.filter(is_api_user=True, is_active=True)

    settlements = []
    for u in target_users:
        s = settle_monthly_ggr_for_user(u, month_key)
        settlements.append({
            'user_id': u.id,
            'phone': u.phone,
            'net_profit': str(s.net_profit),
            'fee_amount': str(s.fee_amount),
            'status': s.status,
        })

    return Response({
        'success': True,
        'count': len(settlements),
        'settlements': settlements,
    })
