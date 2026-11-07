"""
API endpoints for GGR Coins, Payment API, and Shareholder Revenue & Withdrawals.
"""
from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..authentication import ApiKeyAuthentication, TokenAuthentication
from django.db import transaction
from ..models import (
    CustomUser,
    Wallet,
    Deposit,
    BankTransferTransaction,
    GgrWallet,
    GgrTransaction,
    MonthlyGgrSettlement,
    PlatformServiceFeeConfig,
    ShareholderWallet,
    ShareholderRevenueLog,
    ShareholderWithdrawal,
    ShareholderPayoutAccount,
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
    sync_historical_revenue_to_shareholders,
)
from .admin_views import IsStaffOrShareholder, IsStaffUser
from ..models import ApiFundTransferLog, ApiPayinLog, GgrTransaction

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


def _require_ggr_access(user):
    check = _require_api_access(user)
    if check:
        return check
    if not (getattr(user, 'is_ggr_user', False) or getattr(user, 'is_ggr', False)):
        return Response(
            {
                'error': 'GGR service access required',
                'message': 'GGR Coin gaming service is not enabled for your account. Please contact an administrator.',
                'code': 'ggr_disabled',
                'is_ggr_enabled': False,
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_ggr_dashboard(request):
    """
    Dashboard for API user:
    Returns Cash balance, deposit and payout stats, and unified recent merchant transactions.
    """
    check = _require_api_access(request.user)
    if check:
        return check

    user = request.user
    user_wallet, _ = Wallet.objects.get_or_create(user=user)
    fee_config = get_service_fee_config()
    is_ggr_enabled = bool(getattr(user, 'is_ggr_user', False) or getattr(user, 'is_ggr', False))

    # Reconcile any past approved API deposits initiated by this merchant where merchant wallet was not synced
    try:
        uncredited_api_deposits = Deposit.objects.filter(
            initiated_by=user,
            status=Deposit.STATUS_APPROVED,
            source=Deposit.SOURCE_API,
        )
        for dep in uncredited_api_deposits:
            payload = dep.provider_payload or {}
            if not payload.get('merchant_wallet_synced') and dep.user != user:
                with transaction.atomic():
                    w = Wallet.objects.select_for_update().get(pk=user_wallet.pk)
                    fee_pct = user.get_api_deposit_percent() if hasattr(user, 'get_api_deposit_percent') else Decimal('0.00')
                    fee_amt = round(dep.amount * (fee_pct / Decimal('100.00')), 2)
                    net_credit = max(Decimal('0.00'), dep.amount - fee_amt)
                    w.balance = (w.balance or Decimal('0.00')) + net_credit
                    w.save(update_fields=['balance', 'updated_at'])
                    dep.provider_payload = dict(payload)
                    dep.provider_payload['merchant_wallet_synced'] = True
                    dep.provider_payload['merchant_credited_amount'] = str(net_credit)
                    dep.provider_payload['merchant_balance_after'] = str(w.balance)
                    dep.save(update_fields=['provider_payload', 'updated_at'])
                    user_wallet.refresh_from_db(fields=['balance'])
    except Exception as exc:
        logger.warning('Failed to reconcile API deposits for user %s: %s', user.pk, exc)

    # Deposit statistics (approved deposits for this merchant)
    approved_deposits = Deposit.objects.filter(
        Q(user=user) | Q(initiated_by=user),
        status=Deposit.STATUS_APPROVED,
    )
    total_deposited = approved_deposits.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    total_deposits_count = approved_deposits.count()

    # Withdrawal / Payout statistics (successful bank transfers for this merchant)
    successful_payouts = BankTransferTransaction.objects.filter(
        user=user,
        status='success',
    )
    total_withdrawn = successful_payouts.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
    total_payouts_count = successful_payouts.count()

    # GGR Coins / Settlements
    if is_ggr_enabled:
        ggr_wallet = ensure_ggr_wallet(user)
        ggr_txns = GgrTransaction.objects.filter(wallet=ggr_wallet).order_by('-created_at')[:50]
        settlements = MonthlyGgrSettlement.objects.filter(user=user).order_by('-created_at')[:12]

        net_profit_estimate = (ggr_wallet.total_won or Decimal('0.00')) - (ggr_wallet.total_lost or Decimal('0.00'))
        estimated_monthly_fee = max(
            Decimal('0.00'),
            round(net_profit_estimate * (fee_config.ggr_monthly_profit_percent / Decimal('100.00')), 2)
        )
        coin_balance = str(ggr_wallet.coin_balance)
        total_bought = str(ggr_wallet.total_bought)
        total_won = str(ggr_wallet.total_won)
        total_lost = str(ggr_wallet.total_lost)
    else:
        ggr_txns = []
        settlements = []
        net_profit_estimate = Decimal('0.00')
        estimated_monthly_fee = Decimal('0.00')
        coin_balance = '0.00'
        total_bought = '0.00'
        total_won = '0.00'
        total_lost = '0.00'

    # Unified Production Transaction Ledger (Deposits, Payouts, API Transfers, GGR)
    all_txns = []

    # 1. Deposits (App & Payin API)
    merchant_deposits = Deposit.objects.filter(
        Q(user=user) | Q(initiated_by=user)
    ).select_related('user').order_by('-created_at')[:50]
    for d in merchant_deposits:
        type_lbl = 'API Payin Deposit' if d.source == Deposit.SOURCE_API else 'Wallet Deposit'
        payer_phone = getattr(d.user, 'phone', '') if (d.user and d.user != user) else ''
        notes = (
            f"Payin received from {payer_phone}" if payer_phone
            else (d.note or f"Deposit via {d.bank_name or d.provider}")
        )
        bal_after = str(d.balance_after) if d.balance_after is not None else (
            str((d.provider_payload or {}).get('merchant_balance_after', ''))
        )
        all_txns.append({
            'id': f"dep-{d.id}",
            'txn_type': 'deposit',
            'type_label': type_lbl,
            'amount': str(d.amount),
            'balance_after': bal_after,
            'reference': d.client_reference or d.purchase_order_identifier or f"DEP-{d.id}",
            'notes': notes,
            'status': d.status,
            'created_at_dt': d.created_at,
            'created_at': d.created_at.isoformat(),
        })

    # 2. Bank Transfers / Payouts
    merchant_payouts = BankTransferTransaction.objects.filter(
        user=user
    ).order_by('-created_at')[:50]
    for w in merchant_payouts:
        all_txns.append({
            'id': f"wth-{w.id}",
            'txn_type': 'withdraw',
            'type_label': 'Bank Payout (Withdraw)',
            'amount': str(w.amount),
            'balance_after': str(w.balance_after or ''),
            'reference': w.client_reference or w.merchant_txn_id or f"WTH-{w.id}",
            'notes': f"Payout to {w.destination_bank_name or 'Bank'} ({w.destination_acc_no})",
            'status': w.status,
            'created_at_dt': w.created_at,
            'created_at': w.created_at.isoformat(),
        })

    # 3. API Fund Transfers
    fund_transfers = ApiFundTransferLog.objects.filter(
        user=user
    ).order_by('-created_at')[:50]
    for f in fund_transfers:
        all_txns.append({
            'id': f"trans-{f.id}",
            'txn_type': 'transfer',
            'type_label': 'API Fund Transfer',
            'amount': str(f.amount) if f.amount is not None else '0.00',
            'balance_after': '',
            'reference': f.reference or f.transaction_id or f"TXN-{f.id}",
            'notes': f"Transfer to {f.receiver}",
            'status': f.status,
            'created_at_dt': f.created_at,
            'created_at': f.created_at.isoformat(),
        })

    # 4. GGR Transactions (if enabled)
    for g in ggr_txns:
        all_txns.append({
            'id': f"ggr-{g.id}",
            'txn_type': g.txn_type,
            'type_label': g.get_txn_type_display(),
            'amount': str(g.amount),
            'balance_after': str(g.balance_after),
            'reference': g.reference,
            'notes': g.notes,
            'status': 'success',
            'created_at_dt': g.created_at,
            'created_at': g.created_at.isoformat(),
        })

    # Sort all transactions chronologically descending
    all_txns.sort(key=lambda x: x['created_at_dt'], reverse=True)
    recent_transactions = [
        {k: v for k, v in item.items() if k != 'created_at_dt'}
        for item in all_txns[:50]
    ]

    return Response({
        'user': {
            'id': user.id,
            'phone': user.phone,
            'first_name': user.first_name,
            'is_api_user': user.is_api_user,
            'is_ggr_user': is_ggr_enabled,
            'is_ggr': is_ggr_enabled,
        },
        'is_ggr_enabled': is_ggr_enabled,
        'cash_balance': str(user_wallet.balance),
        'total_deposited': str(total_deposited),
        'total_deposits_count': total_deposits_count,
        'total_withdrawn': str(total_withdrawn),
        'total_payouts_count': total_payouts_count,
        'ggr_coin_balance': coin_balance,
        'total_bought': total_bought,
        'total_won': total_won,
        'total_lost': total_lost,
        'net_profit_estimate': str(net_profit_estimate),
        'estimated_monthly_fee': str(estimated_monthly_fee),
        'service_fees': {
            'ggr_monthly_profit_percent': str(fee_config.ggr_monthly_profit_percent),
            'payment_api_deposit_percent': str(user.get_api_deposit_percent()) if hasattr(user, 'get_api_deposit_percent') else str(fee_config.payment_api_deposit_percent),
            'payment_api_withdraw_percent': str(user.get_api_withdraw_percent()) if hasattr(user, 'get_api_withdraw_percent') else str(fee_config.payment_api_withdraw_percent),
        },
        'recent_transactions': recent_transactions,
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
    check = _require_ggr_access(request.user)
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
    check = _require_ggr_access(request.user)
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
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
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
    shareholder_wallet = None
    if user.role == User.ROLE_SHAREHOLDER or user.is_superuser:
        shareholder_wallet = ensure_shareholder_wallet(user)
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

    # Developer API Partners (exclusively driving shareholder revenue)
    api_partners = User.objects.filter(Q(is_api_user=True) | Q(is_ggr_user=True) | Q(can_api_payin=True)).select_related('wallet').order_by('-date_joined')
    api_partners_data = []
    for p in api_partners:
        p_payin_vol = ApiPayinLog.objects.filter(user=p, status='success').aggregate(t=Sum('amount'))['t'] or Decimal('0.00')
        p_payout_vol = ApiFundTransferLog.objects.filter(user=p, status='success').aggregate(t=Sum('amount'))['t'] or Decimal('0.00')
        try:
            p_ggr_wallet = getattr(p, 'ggr_wallet', None)
        except Exception:
            p_ggr_wallet = None
        api_partners_data.append({
            'id': p.id,
            'phone': p.phone,
            'first_name': p.first_name,
            'last_name': p.last_name,
            'business_name': getattr(p, 'business_name', '') or '',
            'pan_no': getattr(p, 'pan_no', '') or '',
            'company_registration_no': getattr(p, 'company_registration_no', '') or '',
            'citizenship_no': getattr(p, 'citizenship_no', '') or getattr(p, 'citizenship_number', '') or '',
            'services': {
                'ggr': bool(getattr(p, 'is_ggr_user', False)),
                'payin': bool(getattr(p, 'can_api_payin', False)),
                'payout': bool(getattr(p, 'can_api_payout', True)),
            },
            'is_api_user': bool(p.is_api_user),
            'payin_volume': str(p_payin_vol),
            'payout_volume': str(p_payout_vol),
            'ggr_balance': str(getattr(p_ggr_wallet, 'coin_balance', getattr(p_ggr_wallet, 'balance', '0.00')) if p_ggr_wallet else '0.00'),
            'created_at': p.date_joined.isoformat(),
        })

    # Recent Developer API Transactions (Payment API and GGR only)
    api_txns = []
    for row in ApiPayinLog.objects.select_related('user').order_by('-created_at')[:30]:
        api_txns.append({
            'id': f'payin-{row.id}',
            'service': 'payin',
            'service_label': 'Pay In API',
            'partner_id': row.user_id,
            'partner_phone': row.user.phone if row.user else '—',
            'partner_business': getattr(row.user, 'business_name', '') or (row.user.get_full_name() if row.user else '—'),
            'reference': row.reference or row.order_id or '—',
            'amount': str(row.amount) if row.amount is not None else '0.00',
            'fee_cut': str(round(Decimal(str(row.amount or 0)) * ((row.user.get_api_deposit_percent() if row.user and hasattr(row.user, 'get_api_deposit_percent') else fee_config.payment_api_deposit_percent) / Decimal('100.00')), 2)) if row.amount and row.status == 'success' else '0.00',
            'status': row.status,
            'created_at': row.created_at.isoformat(),
        })
    for row in ApiFundTransferLog.objects.select_related('user').order_by('-created_at')[:30]:
        api_txns.append({
            'id': f'payout-{row.id}',
            'service': 'payout',
            'service_label': 'Pay Out API',
            'partner_id': row.user_id,
            'partner_phone': row.user.phone if row.user else '—',
            'partner_business': getattr(row.user, 'business_name', '') or (row.user.get_full_name() if row.user else '—'),
            'reference': row.reference or row.transaction_id or '—',
            'amount': str(row.amount) if row.amount is not None else '0.00',
            'fee_cut': str(round(Decimal(str(row.amount or 0)) * (fee_config.payment_api_withdraw_percent / Decimal('100.00')), 2)) if row.amount and row.status == 'success' else '0.00',
            'status': row.status,
            'created_at': row.created_at.isoformat(),
        })
    for row in GgrTransaction.objects.select_related('wallet__user').order_by('-created_at')[:30]:
        partner = row.wallet.user if row.wallet else None
        api_txns.append({
            'id': f'ggr-{row.id}',
            'service': 'ggr',
            'service_label': f'GGR ({row.get_txn_type_display()})',
            'partner_id': partner.id if partner else None,
            'partner_phone': partner.phone if partner else '—',
            'partner_business': getattr(partner, 'business_name', '') or (partner.get_full_name() if partner else '—'),
            'reference': row.reference or f'GGR-{row.id}',
            'amount': str(abs(row.amount)),
            'fee_cut': str(abs(row.amount)) if row.txn_type == GgrTransaction.TXN_MONTHLY_FEE else '0.00',
            'status': 'SUCCESS',
            'created_at': row.created_at.isoformat(),
        })
    api_txns.sort(key=lambda x: x['created_at'], reverse=True)
    developer_api_transactions = api_txns[:50]

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
            'api_partners_count': api_partners.count(),
        },
        'developer_api_partners': api_partners_data,
        'developer_api_transactions': developer_api_transactions,
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
        'payout_accounts': [
            {
                'id': pa.id,
                'shareholder_id': pa.shareholder_id,
                'shareholder_phone': pa.shareholder.phone,
                'method': pa.method,
                'label': pa.label,
                'account_name': pa.account_name,
                'account_number': pa.account_number,
                'bank_name': pa.bank_name,
                'bank_code': pa.branch or '',
                'branch': pa.branch,
                'is_default': pa.is_default,
                'created_at': pa.created_at.isoformat(),
            }
            for pa in ShareholderPayoutAccount.objects.filter(shareholder=user).order_by('-is_default', '-created_at')
        ],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_shareholder_withdraw(request):
    """
    Shareholder withdraws their balance.
    Body: {"amount": 5000, "payout_account_id": 1}
    or: {"amount": 5000, "payout_method": "bank", "account_name": "Ravi", "account_number": "123", "bank_name": "Nabil", "save_account": true}
    """
    user = request.user
    if user.role != User.ROLE_SHAREHOLDER and not user.is_superuser:
        return Response(
            {'error': 'Permission denied', 'message': 'Only shareholders can withdraw service revenue.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    raw_amount = request.data.get('amount')
    payout_account_id = request.data.get('payout_account_id')
    payout_method = request.data.get('payout_method', 'bank')
    account_name = request.data.get('account_name', '').strip()
    account_number = request.data.get('account_number', '').strip()
    bank_name = request.data.get('bank_name', '').strip()
    branch = request.data.get('branch', '').strip()
    save_account = bool(request.data.get('save_account', False))
    account_label = request.data.get('account_label', '').strip()

    if payout_account_id:
        pa = ShareholderPayoutAccount.objects.filter(pk=payout_account_id, shareholder=user).first()
        if not pa:
            return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)
        payout_method = pa.method
        account_name = pa.account_name
        account_number = pa.account_number
        bank_name = pa.bank_name
    elif not account_name or not account_number:
        return Response(
            {'error': 'Validation error', 'message': 'Account name and account number are required, or choose a saved payout account.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    else:
        # If shareholder chose to save custom account for future withdrawals
        if save_account:
            has_accounts = ShareholderPayoutAccount.objects.filter(shareholder=user).exists()
            pa = ShareholderPayoutAccount.objects.create(
                shareholder=user,
                method=payout_method if payout_method in ('bank', 'esewa', 'khalti') else 'bank',
                label=account_label or (f"{bank_name or payout_method.upper()} - {account_name}"[:100]),
                account_name=account_name,
                account_number=account_number,
                bank_name=bank_name,
                branch=branch,
                is_default=not has_accounts,
            )
            payout_account_id = pa.id

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
            payout_account_id=payout_account_id,
        )
        wallet = ensure_shareholder_wallet(user)
        return Response({
            'success': True,
            'message': f'Withdrawal of NPR {amount} processed successfully.',
            'withdrawal_id': withdrawal.id,
            'remaining_balance': str(wallet.balance),
            'payout_account_id': payout_account_id,
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
        target_users = User.objects.filter(pk=user_id, is_api_user=True, is_ggr_user=True)
    else:
        target_users = User.objects.filter(is_api_user=True, is_ggr_user=True, is_active=True)

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


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_shareholder_payout_accounts(request):
    """
    List or create payout accounts for the authenticated shareholder.
    """
    user = request.user
    if user.role != User.ROLE_SHAREHOLDER and not user.is_superuser:
        return Response({'error': 'Shareholder access required.'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = ShareholderPayoutAccount.objects.filter(shareholder=user).order_by('-is_default', '-created_at')
        data = [
            {
                'id': pa.id,
                'shareholder_id': pa.shareholder_id,
                'shareholder_phone': pa.shareholder.phone,
                'method': pa.method,
                'label': pa.label,
                'account_name': pa.account_name,
                'account_number': pa.account_number,
                'bank_name': pa.bank_name,
                'bank_code': pa.branch or '',
                'branch': pa.branch,
                'is_default': pa.is_default,
                'created_at': pa.created_at.isoformat(),
            }
            for pa in qs
        ]
        return Response({'payout_accounts': data})

    # POST create
    method = request.data.get('method', 'bank')
    label = request.data.get('label', '').strip()
    account_name = request.data.get('account_name', '').strip()
    account_number = request.data.get('account_number', '').strip()
    bank_name = request.data.get('bank_name', '').strip()
    bank_code = request.data.get('bank_code', '').strip()
    branch = bank_code or request.data.get('branch', '').strip()
    is_default = bool(request.data.get('is_default', False))

    if not account_name or not account_number:
        return Response(
            {'error': 'Account name and account number are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if method not in ('bank', 'esewa', 'khalti'):
        return Response({'error': 'Invalid payout method. Must be bank, esewa, or khalti.'}, status=status.HTTP_400_BAD_REQUEST)

    if is_default:
        ShareholderPayoutAccount.objects.filter(shareholder=user).update(is_default=False)
    elif not ShareholderPayoutAccount.objects.filter(shareholder=user).exists():
        is_default = True

    pa = ShareholderPayoutAccount.objects.create(
        shareholder=user,
        method=method,
        label=label,
        account_name=account_name,
        account_number=account_number,
        bank_name=bank_name,
        branch=branch,
        is_default=is_default,
    )

    return Response({
        'success': True,
        'message': 'Payout account saved successfully.',
        'payout_account': {
            'id': pa.id,
            'method': pa.method,
            'label': pa.label,
            'account_name': pa.account_name,
            'account_number': pa.account_number,
            'bank_name': pa.bank_name,
            'bank_code': pa.branch or '',
            'branch': pa.branch,
            'is_default': pa.is_default,
            'created_at': pa.created_at.isoformat(),
        }
    }, status=status.HTTP_201_CREATED)


@api_view(['PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_shareholder_payout_account_detail(request, pk):
    user = request.user
    pa = ShareholderPayoutAccount.objects.filter(pk=pk).first()
    if not pa or (pa.shareholder != user and not user.is_superuser):
        return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        pa.delete()
        return Response({'success': True, 'message': 'Payout account deleted successfully.'})

    # PUT or PATCH
    for field in ('method', 'label', 'account_name', 'account_number', 'bank_name', 'branch'):
        if field in request.data:
            setattr(pa, field, str(request.data[field]).strip())

    if 'is_default' in request.data:
        is_def = bool(request.data['is_default'])
        if is_def:
            ShareholderPayoutAccount.objects.filter(shareholder=user).update(is_default=False)
        pa.is_default = is_def

    pa.save()
    return Response({
        'success': True,
        'message': 'Payout account updated successfully.',
        'payout_account': {
            'id': pa.id,
            'method': pa.method,
            'label': pa.label,
            'account_name': pa.account_name,
            'account_number': pa.account_number,
            'bank_name': pa.bank_name,
            'branch': pa.branch,
            'is_default': pa.is_default,
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_sync_historical_revenue(request):
    """
    Backfill / sync platform fees from all historical deposits and withdrawals to shareholders.
    """
    if not (request.user.is_superuser or request.user.role == User.ROLE_SHAREHOLDER):
        return Response({'error': 'Super Admin or Shareholder access required.'}, status=status.HTTP_403_FORBIDDEN)

    result = sync_historical_revenue_to_shareholders()
    return Response({
        'success': True,
        'message': f"Synced {result['synced_deposits_count']} deposits and {result['synced_withdraws_count']} withdrawals. Total fees distributed: NPR {result['total_fees_synced']}",
        'data': result,
    })
