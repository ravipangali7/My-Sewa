"""
Service layer for GGR Coin Management, Game Events, Monthly Profit Settlement,
Payment API service fees, and Shareholder Revenue Distribution.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from datetime import datetime
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..models import (
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

logger = logging.getLogger(__name__)
User = get_user_model()


def get_service_fee_config() -> PlatformServiceFeeConfig:
    return PlatformServiceFeeConfig.get_config()


def ensure_ggr_wallet(user) -> GgrWallet:
    wallet, _ = GgrWallet.objects.get_or_create(user=user)
    return wallet


def ensure_shareholder_wallet(shareholder) -> ShareholderWallet:
    wallet, _ = ShareholderWallet.objects.get_or_create(shareholder=shareholder)
    return wallet


def distribute_platform_fee(
    fee_amount: Decimal,
    source: str,
    reference: str = '',
    notes: str = '',
) -> list[ShareholderRevenueLog]:
    """
    Distribute service fee cut to active shareholders based on their share_percent.
    If no share percentages are specified, splits equally among all active shareholders.
    """
    fee_amount = Decimal(str(fee_amount))
    if fee_amount <= Decimal('0.00'):
        return []

    shareholders = list(User.objects.filter(role=User.ROLE_SHAREHOLDER, is_active=True))
    if not shareholders:
        logger.info("No active shareholders found. Fee of %s retained in platform.", fee_amount)
        return []

    total_shares = sum((s.share_percent for s in shareholders if s.share_percent > 0), Decimal('0.00'))
    created_logs = []

    for s in shareholders:
        if total_shares > 0:
            if s.share_percent <= 0:
                continue
            share_portion = fee_amount * (s.share_percent / total_shares)
        else:
            share_portion = fee_amount / Decimal(str(len(shareholders)))

        share_portion = round(share_portion, 2)
        if share_portion <= Decimal('0.00'):
            continue

        with transaction.atomic():
            wallet = ShareholderWallet.objects.select_for_update().filter(shareholder=s).first()
            if not wallet:
                wallet = ShareholderWallet.objects.create(shareholder=s)
            
            wallet.balance = (wallet.balance or Decimal('0.00')) + share_portion
            wallet.total_earned = (wallet.total_earned or Decimal('0.00')) + share_portion
            wallet.save(update_fields=['balance', 'total_earned', 'updated_at'])

            log = ShareholderRevenueLog.objects.create(
                shareholder=s,
                amount=share_portion,
                source=source,
                reference=str(reference),
                notes=notes,
            )
            created_logs.append(log)

    return created_logs


def buy_ggr_coins(user, amount: Decimal) -> GgrTransaction:
    """
    API user buys GGR coins using their main wallet cash balance.
    1 NPR = 1 GGR Coin.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Amount must be greater than zero.")

    if not getattr(user, 'is_api_user', False):
        raise PermissionError("Only API users can purchase GGR coins.")

    with transaction.atomic():
        user_wallet = Wallet.objects.select_for_update().get(user=user)
        if getattr(user_wallet, 'is_frozen', False):
            raise ValueError("Your wallet is frozen. Cannot purchase GGR coins.")
        if getattr(user_wallet, 'transactions_blocked', False):
            raise ValueError("Transactions are currently blocked on your wallet.")
        if user_wallet.balance < amount:
            raise ValueError(f"Insufficient cash balance. Available: NPR {user_wallet.balance}, required: NPR {amount}")

        # Debit cash balance
        user_wallet.balance -= amount
        user_wallet.save(update_fields=['balance', 'updated_at'])

        # Credit GGR coins
        ggr_wallet = GgrWallet.objects.select_for_update().filter(user=user).first()
        if not ggr_wallet:
            ggr_wallet = GgrWallet.objects.create(user=user)

        ggr_wallet.coin_balance = (ggr_wallet.coin_balance or Decimal('0.00')) + amount
        ggr_wallet.total_bought = (ggr_wallet.total_bought or Decimal('0.00')) + amount
        ggr_wallet.save(update_fields=['coin_balance', 'total_bought', 'updated_at'])

        txn = GgrTransaction.objects.create(
            wallet=ggr_wallet,
            txn_type=GgrTransaction.TXN_BUY,
            amount=amount,
            balance_after=ggr_wallet.coin_balance,
            reference=f"BUY-{timezone.now().strftime('%Y%m%d%H%M%S')}",
            notes=f"Purchased {amount} GGR coins from main cash balance.",
        )

    return txn


def process_game_event(user, event_type: str, amount: Decimal, reference: str = '') -> GgrTransaction:
    """
    Process gameplay event for user's game platform:
    - player_loss: GGR coins decrease by amount.
    - player_win: GGR coins increase by amount + 10% (1.10x).
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Amount must be positive.")

    if not getattr(user, 'is_api_user', False):
        raise PermissionError("Only API users can process game events.")

    with transaction.atomic():
        ggr_wallet = GgrWallet.objects.select_for_update().filter(user=user).first()
        if not ggr_wallet:
            ggr_wallet = GgrWallet.objects.create(user=user)

        if event_type == 'player_loss':
            # Player lost: GGR coins decrease
            ggr_wallet.coin_balance = max(Decimal('0.00'), (ggr_wallet.coin_balance or Decimal('0.00')) - amount)
            ggr_wallet.total_lost = (ggr_wallet.total_lost or Decimal('0.00')) + amount
            delta = -amount
            notes = f"Player loss of {amount} coins debited from GGR reserve."
        elif event_type == 'player_win':
            # Player won: GGR coins increase by 10%
            increase = round(amount * Decimal('1.10'), 2)
            ggr_wallet.coin_balance = (ggr_wallet.coin_balance or Decimal('0.00')) + increase
            ggr_wallet.total_won = (ggr_wallet.total_won or Decimal('0.00')) + increase
            delta = increase
            notes = f"Player win credited: base {amount} + 10% bonus = {increase} GGR coins."
        else:
            raise ValueError(f"Unknown event type: {event_type}")

        ggr_wallet.save(update_fields=['coin_balance', 'total_won', 'total_lost', 'updated_at'])

        txn = GgrTransaction.objects.create(
            wallet=ggr_wallet,
            txn_type=event_type,
            amount=delta,
            balance_after=ggr_wallet.coin_balance,
            reference=reference or f"GAME-{timezone.now().strftime('%Y%m%d%H%M%S')}",
            notes=notes,
        )

    return txn


def settle_monthly_ggr_for_user(user, month_key: str = None) -> MonthlyGgrSettlement:
    """
    Calculate net profit for the user and apply platform profit cut (e.g. 10%).
    Platform service fee is distributed to Shareholders.
    """
    if not month_key:
        month_key = timezone.now().strftime('%Y-%m')

    config = get_service_fee_config()
    fee_percent = config.ggr_monthly_profit_percent

    with transaction.atomic():
        ggr_wallet = GgrWallet.objects.select_for_update().filter(user=user).first()
        if not ggr_wallet:
            ggr_wallet = GgrWallet.objects.create(user=user)

        # Net profit calculation based on total won vs total lost or balance delta
        net_profit = (ggr_wallet.total_won or Decimal('0.00')) - (ggr_wallet.total_lost or Decimal('0.00'))

        existing = MonthlyGgrSettlement.objects.filter(user=user, month_key=month_key).first()
        if existing and existing.status == MonthlyGgrSettlement.STATUS_SETTLED:
            return existing

        if net_profit <= Decimal('0.00'):
            settlement, _ = MonthlyGgrSettlement.objects.update_or_create(
                user=user,
                month_key=month_key,
                defaults={
                    'starting_balance': ggr_wallet.month_start_balance or Decimal('0.00'),
                    'ending_balance': ggr_wallet.coin_balance or Decimal('0.00'),
                    'net_profit': net_profit,
                    'fee_percent': fee_percent,
                    'fee_amount': Decimal('0.00'),
                    'status': MonthlyGgrSettlement.STATUS_SKIPPED,
                    'notes': 'No positive net profit for this billing cycle.',
                }
            )
            return settlement

        fee_amount = round(net_profit * (fee_percent / Decimal('100.00')), 2)

        # Deduct fee from user's cash wallet (or GGR coins if cash insufficient)
        user_wallet = Wallet.objects.select_for_update().get(user=user)
        if user_wallet.balance >= fee_amount:
            user_wallet.balance -= fee_amount
            user_wallet.save(update_fields=['balance', 'updated_at'])
            deduction_source = "cash balance"
        else:
            # Fallback deduction from GGR coins
            ggr_wallet.coin_balance = max(Decimal('0.00'), ggr_wallet.coin_balance - fee_amount)
            ggr_wallet.save(update_fields=['coin_balance', 'updated_at'])
            deduction_source = "GGR coin balance"

        # Record GGR transaction
        GgrTransaction.objects.create(
            wallet=ggr_wallet,
            txn_type=GgrTransaction.TXN_MONTHLY_FEE,
            amount=-fee_amount,
            balance_after=ggr_wallet.coin_balance,
            reference=f"SETTLE-{month_key}",
            notes=f"Monthly GGR platform service fee ({fee_percent}%) deducted from {deduction_source}.",
        )

        settlement, _ = MonthlyGgrSettlement.objects.update_or_create(
            user=user,
            month_key=month_key,
            defaults={
                'starting_balance': ggr_wallet.month_start_balance or Decimal('0.00'),
                'ending_balance': ggr_wallet.coin_balance or Decimal('0.00'),
                'net_profit': net_profit,
                'fee_percent': fee_percent,
                'fee_amount': fee_amount,
                'status': MonthlyGgrSettlement.STATUS_SETTLED,
                'notes': f"Settled {fee_amount} NPR platform fee from {deduction_source}.",
            }
        )

        # Distribute fee to Shareholders!
        distribute_platform_fee(
            fee_amount=fee_amount,
            source=ShareholderRevenueLog.SOURCE_GGR,
            reference=f"GGR-{user.id}-{month_key}",
            notes=f"GGR monthly {fee_percent}% cut from {user.phone} ({month_key})",
        )

        # Reset month start balance snapshot
        ggr_wallet.month_start_balance = ggr_wallet.coin_balance
        ggr_wallet.save(update_fields=['month_start_balance', 'updated_at'])

    return settlement


def process_payment_api_deposit(
    api_user,
    amount: Decimal,
    player_id: str = '',
    reference: str = '',
) -> dict:
    """
    Payment API: End-player deposit (Payin).
    - Platform takes Payment API deposit fee % (credited to Shareholders).
    - Remaining net amount credited to api_user.wallet.balance.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Deposit amount must be positive.")

    if not getattr(api_user, 'is_api_user', False):
        raise PermissionError("Only API users can process Payment API deposits.")

    config = get_service_fee_config()
    fee_percent = config.payment_api_deposit_percent
    fee_amount = round(amount * (fee_percent / Decimal('100.00')), 2)
    net_credit = amount - fee_amount

    with transaction.atomic():
        user_wallet = Wallet.objects.select_for_update().get(user=api_user)
        user_wallet.balance = (user_wallet.balance or Decimal('0.00')) + net_credit
        user_wallet.save(update_fields=['balance', 'updated_at'])

        # Distribute fee to Shareholders
        distribute_platform_fee(
            fee_amount=fee_amount,
            source=ShareholderRevenueLog.SOURCE_API_DEPOSIT,
            reference=reference or f"DEP-{timezone.now().strftime('%Y%m%d%H%M%S')}",
            notes=f"Payment API deposit fee ({fee_percent}%) on {amount} NPR from player {player_id}",
        )

        # Log in ApiPayinLog
        ApiPayinLog.objects.create(
            user=api_user,
            reference=reference,
            receiver=player_id or api_user.phone,
            amount=amount,
            status=ApiPayinLog.STATUS_SUCCESS,
        )

    return {
        'gross_amount': str(amount),
        'fee_amount': str(fee_amount),
        'fee_percent': str(fee_percent),
        'net_credited': str(net_credit),
        'new_balance': str(user_wallet.balance),
    }


def process_payment_api_withdraw(
    api_user,
    amount: Decimal,
    player_id: str = '',
    reference: str = '',
    payout_details: dict = None,
) -> dict:
    """
    Payment API: End-player withdrawal (Payout).
    - Platform takes Payment API withdraw fee % (credited to Shareholders).
    - Total (amount + fee) debited from api_user.wallet.balance.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Withdrawal amount must be positive.")

    if not getattr(api_user, 'is_api_user', False):
        raise PermissionError("Only API users can process Payment API withdrawals.")

    config = get_service_fee_config()
    fee_percent = config.payment_api_withdraw_percent
    fee_amount = round(amount * (fee_percent / Decimal('100.00')), 2)
    total_debit = amount + fee_amount

    with transaction.atomic():
        user_wallet = Wallet.objects.select_for_update().get(user=api_user)
        if user_wallet.balance < total_debit:
            raise ValueError(f"Insufficient funds in balance. Available: {user_wallet.balance}, required: {total_debit}")

        user_wallet.balance -= total_debit
        user_wallet.save(update_fields=['balance', 'updated_at'])

        # Distribute fee to Shareholders
        distribute_platform_fee(
            fee_amount=fee_amount,
            source=ShareholderRevenueLog.SOURCE_API_WITHDRAW,
            reference=reference or f"WTH-{timezone.now().strftime('%Y%m%d%H%M%S')}",
            notes=f"Payment API withdraw fee ({fee_percent}%) on {amount} NPR for player {player_id}",
        )

        # Log in ApiFundTransferLog
        ApiFundTransferLog.objects.create(
            user=api_user,
            reference=reference,
            receiver=player_id or 'Player',
            amount=amount,
            status=ApiFundTransferLog.STATUS_SUCCESS,
        )

    return {
        'gross_payout': str(amount),
        'fee_amount': str(fee_amount),
        'fee_percent': str(fee_percent),
        'total_debited': str(total_debit),
        'new_balance': str(user_wallet.balance),
    }


def execute_shareholder_withdrawal(
    shareholder,
    amount: Decimal,
    payout_method: str,
    account_name: str,
    account_number: str,
    bank_name: str = '',
) -> ShareholderWithdrawal:
    """
    Shareholder withdraws accumulated platform service revenue to Bank / eSewa / Khalti.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Withdrawal amount must be positive.")

    if shareholder.role != User.ROLE_SHAREHOLDER:
        raise PermissionError("Only shareholders can withdraw from service revenue.")

    with transaction.atomic():
        wallet = ShareholderWallet.objects.select_for_update().filter(shareholder=shareholder).first()
        if not wallet or wallet.balance < amount:
            avail = wallet.balance if wallet else Decimal('0.00')
            raise ValueError(f"Insufficient revenue balance. Available: NPR {avail}, requested: NPR {amount}")

        wallet.balance -= amount
        wallet.total_withdrawn = (wallet.total_withdrawn or Decimal('0.00')) + amount
        wallet.save(update_fields=['balance', 'total_withdrawn', 'updated_at'])

        withdrawal = ShareholderWithdrawal.objects.create(
            shareholder=shareholder,
            amount=amount,
            payout_method=payout_method,
            account_name=account_name,
            account_number=account_number,
            bank_name=bank_name,
            status=ShareholderWithdrawal.STATUS_COMPLETED,
        )

    return withdrawal
