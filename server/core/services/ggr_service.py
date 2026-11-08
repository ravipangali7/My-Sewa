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

import uuid
from ..models import (
    Wallet,
    GgrWallet,
    GgrTransaction,
    MonthlyGgrSettlement,
    PlatformServiceFeeConfig,
    ShareholderWallet,
    ShareholderRevenueLog,
    ShareholderWithdrawal,
    ShareholderPayoutAccount,
    BankTransferTransaction,
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

    if hasattr(api_user, 'get_api_deposit_percent'):
        fee_percent = api_user.get_api_deposit_percent()
    else:
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
    Payment API: End-player / Merchant withdrawal (Payout).
    - Checks balance and executes HimalPay BANK_TRANSFER when bank details are provided.
    - Platform takes Payment API withdraw fee % (credited to Shareholders).
    - Total (amount + fee) debited from api_user.wallet.balance ONLY when transfer succeeds.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Withdrawal amount must be positive.")

    if not (getattr(api_user, 'is_api_user', False) or getattr(api_user, 'is_superuser', False)):
        raise PermissionError("Only API users can process Payment API withdrawals.")

    if hasattr(api_user, 'get_api_withdraw_percent'):
        fee_percent = api_user.get_api_withdraw_percent()
    else:
        config = get_service_fee_config()
        fee_percent = config.payment_api_withdraw_percent
    fee_amount = round(amount * (fee_percent / Decimal('100.00')), 2)
    total_debit = amount + fee_amount

    # Parse payout_details
    if isinstance(payout_details, str):
        try:
            import json
            payout_details = json.loads(payout_details)
        except Exception:
            payout_details = {}
    elif not isinstance(payout_details, dict):
        payout_details = {}

    bank_code = str(payout_details.get('bank_code') or payout_details.get('destination_bank') or '').strip()
    bank_name = str(payout_details.get('bank_name') or payout_details.get('destination_bank_name') or '').strip()
    account_number = str(payout_details.get('account_number') or payout_details.get('destination_acc_no') or payout_details.get('bank_account_number') or '').strip()
    account_name = str(payout_details.get('account_name') or payout_details.get('destination_acc_name') or payout_details.get('account_holder_name') or '').strip()

    # Pre-check merchant wallet balance
    user_wallet = Wallet.objects.get(user=api_user)
    if user_wallet.balance < total_debit:
        raise ValueError(f"Insufficient funds in balance. Available: NPR {user_wallet.balance}, required: NPR {total_debit}")

    resolved_bank = ''
    verified_name = account_name or 'Account Holder'
    merchant_txn_id = reference or f"MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}"
    provider_response = {}
    txn_status = 'success'

    # If bank details are provided, execute real bank transfer via HimalPay!
    if account_number and (bank_code or bank_name):
        from .himalpay import HimalPayAPI, HimalPayError
        from ..views.bank_transfer_views import _resolve_destination_bank

        himalpay = HimalPayAPI()
        resolved_bank = _resolve_destination_bank(himalpay, bank_code or bank_name, bank_name)
        if not resolved_bank:
            raise ValueError(f"Destination bank '{bank_name or bank_code}' is not supported by payment provider.")

        bt_merchant_txn_id = f"MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}"
        while BankTransferTransaction.objects.filter(merchant_txn_id=bt_merchant_txn_id).exists():
            bt_merchant_txn_id = f"MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}"
        verify_merchant_txn_id = f"MYSEWA_VF_{uuid.uuid4().hex[:14].upper()}"

        # 1. Run account verification if available
        try:
            verify_result = himalpay.verify_bank_account(
                bank_code=resolved_bank,
                account_name=account_name or '',
                account_number=account_number,
                merchant_txn_id=verify_merchant_txn_id,
                is_mobile='n',
            )
            if himalpay.is_verification_success(verify_result):
                matched_name = himalpay.extract_verified_account_name(verify_result, fallback='')
                if matched_name:
                    verified_name = matched_name
            elif not himalpay.bypass_api:
                failure = himalpay.extract_failure_details(verify_result)
                err_msg = failure.get('message') or failure.get('provider_message') or "Bank account verification failed. Please check account details."
                raise ValueError(err_msg)
        except HimalPayError as exc:
            if not himalpay.bypass_api:
                raise ValueError(f"Bank verification provider error: {exc.message}")

        # 2. Call HimalPay BANK_TRANSFER
        try:
            response = himalpay.bank_transfer(
                amount_rupees=amount,
                merchant_transaction_id=bt_merchant_txn_id,
                destination_bank=resolved_bank,
                destination_acc_no=account_number,
                destination_acc_name=verified_name,
                is_destination_mobile='n',
                transaction_remarks=f"Merchant Payout: {reference or bt_merchant_txn_id}"[:255],
            )
        except HimalPayError as exc:
            raise ValueError(f"Bank transfer failed with payment provider: {exc.message}")

        provider_response = response if isinstance(response, dict) else {}
        txn_status = himalpay.normalize_status(response)
        if txn_status == 'failed':
            failure = himalpay.extract_failure_details(response)
            err_msg = failure.get('message') or failure.get('provider_message') or "Bank transfer failed with payment provider."
            raise ValueError(err_msg)

        merchant_txn_id = bt_merchant_txn_id

    # 3. Only when provider succeeded -> atomically debit user's wallet!
    with transaction.atomic():
        user_wallet = Wallet.objects.select_for_update().get(user=api_user)
        if user_wallet.balance < total_debit:
            raise ValueError(f"Insufficient funds in balance. Available: {user_wallet.balance}, required: {total_debit}")

        balance_before = user_wallet.balance
        user_wallet.balance -= total_debit
        user_wallet.save(update_fields=['balance', 'updated_at'])

        # Distribute fee to Shareholders
        distribute_platform_fee(
            fee_amount=fee_amount,
            source=ShareholderRevenueLog.SOURCE_API_WITHDRAW,
            reference=reference or merchant_txn_id,
            notes=f"Payment API withdraw fee ({fee_percent}%) on {amount} NPR for player {player_id}",
        )

        if resolved_bank and account_number:
            from .himalpay import HimalPayAPI
            himalpay = HimalPayAPI()
            BankTransferTransaction.objects.create(
                user=api_user,
                amount=amount,
                destination_bank=resolved_bank,
                destination_bank_name=bank_name or resolved_bank,
                destination_acc_no=account_number,
                destination_acc_name=verified_name,
                is_destination_mobile=False,
                transaction_remarks=f"Payment API Payout: {reference or merchant_txn_id}"[:255],
                status='success' if txn_status == 'success' else 'pending',
                merchant_txn_id=merchant_txn_id,
                provider_txn_id=himalpay.extract_transaction_id(provider_response) or (provider_response.get('data') or {}).get('provider_txn_id'),
                reference_id=himalpay.extract_reference_id(provider_response) or provider_response.get('reference_id'),
                charge=fee_amount,
                total_debited=total_debit,
                platform_charge=fee_amount,
                balance_before=balance_before,
                balance_after=user_wallet.balance,
                verified=True,
                source=BankTransferTransaction.SOURCE_API,
                client_reference=reference or merchant_txn_id,
                provider_response=provider_response,
            )

        # Log in ApiFundTransferLog
        ApiFundTransferLog.objects.create(
            user=api_user,
            reference=reference or merchant_txn_id,
            receiver=player_id or verified_name or 'Bank Transfer',
            amount=amount,
            status=ApiFundTransferLog.STATUS_SUCCESS,
        )

    provider_txn = ''
    if provider_response:
        from .himalpay import HimalPayAPI
        himalpay = HimalPayAPI()
        provider_txn = himalpay.extract_transaction_id(provider_response) or (provider_response.get('data') or {}).get('provider_txn_id') or ''

    return {
        'gross_payout': str(amount),
        'fee_amount': str(fee_amount),
        'fee_percent': str(fee_percent),
        'total_debited': str(total_debit),
        'new_balance': str(user_wallet.balance),
        'transaction_id': merchant_txn_id,
        'provider_reference': provider_txn,
        'status': 'SUCCESS' if txn_status == 'success' else 'PENDING',
    }


def execute_shareholder_withdrawal(
    shareholder,
    amount: Decimal,
    payout_method: str = '',
    account_name: str = '',
    account_number: str = '',
    bank_name: str = '',
    bank_code: str = '',
    payout_account_id: int | None = None,
) -> ShareholderWithdrawal:
    """
    Shareholder withdraws accumulated platform service revenue to Bank / eSewa / Khalti.
    Can use a saved ShareholderPayoutAccount or explicit account fields.
    When payout_method is 'bank', executes instant transfer via HimalPay before cutting balance.
    """
    amount = Decimal(str(amount))
    if amount <= Decimal('0.00'):
        raise ValueError("Withdrawal amount must be positive.")

    if shareholder.role != User.ROLE_SHAREHOLDER and not getattr(shareholder, 'is_superuser', False):
        raise PermissionError("Only shareholders can withdraw from service revenue.")

    payout_account = None
    if payout_account_id:
        payout_account = ShareholderPayoutAccount.objects.filter(pk=payout_account_id, shareholder=shareholder).first()
        if payout_account:
            payout_method = payout_account.method
            account_name = payout_account.account_name
            account_number = payout_account.account_number
            bank_name = payout_account.bank_name or bank_name
            bank_code = bank_code or getattr(payout_account, 'branch', '') or ''

    if not payout_method:
        payout_method = ShareholderWithdrawal.METHOD_BANK

    # Pre-check revenue balance before calling provider
    wallet = ensure_shareholder_wallet(shareholder)
    wallet = ShareholderWallet.objects.get(pk=wallet.pk)
    if wallet.balance < amount:
        avail = wallet.balance
        raise ValueError(f"Insufficient revenue balance. Available: NPR {avail}, requested: NPR {amount}")

    resolved_bank = ''
    verified_name = account_name or 'Shareholder'
    merchant_txn_id = ''
    provider_response = {}
    txn_status = 'success'

    # If payout method is bank transfer, execute real transfer via HimalPay!
    if payout_method in (ShareholderWithdrawal.METHOD_BANK, 'bank'):
        from .himalpay import HimalPayAPI, HimalPayError
        from ..views.bank_transfer_views import _resolve_destination_bank

        himalpay = HimalPayAPI()
        resolved_bank = _resolve_destination_bank(himalpay, bank_code or bank_name, bank_name)
        if not resolved_bank:
            raise ValueError(f"Destination bank '{bank_name or bank_code}' is not supported by payment provider.")

        merchant_txn_id = f"MYSEWA_SH_{uuid.uuid4().hex[:14].upper()}"
        while BankTransferTransaction.objects.filter(merchant_txn_id=merchant_txn_id).exists():
            merchant_txn_id = f"MYSEWA_SH_{uuid.uuid4().hex[:14].upper()}"
        verify_merchant_txn_id = f"MYSEWA_VF_{uuid.uuid4().hex[:14].upper()}"

        # 1. Run account verification if available
        try:
            verify_result = himalpay.verify_bank_account(
                bank_code=resolved_bank,
                account_name=account_name or '',
                account_number=account_number,
                merchant_txn_id=verify_merchant_txn_id,
                is_mobile='n',
            )
            if himalpay.is_verification_success(verify_result):
                matched_name = himalpay.extract_verified_account_name(verify_result, fallback='')
                if matched_name:
                    verified_name = matched_name
            elif not himalpay.bypass_api:
                failure = himalpay.extract_failure_details(verify_result)
                err_msg = failure.get('message') or failure.get('provider_message') or "Bank account verification failed. Please check account details."
                raise ValueError(err_msg)
        except HimalPayError as exc:
            if not himalpay.bypass_api:
                raise ValueError(f"Bank verification provider error: {exc.message}")

        # 2. Call HimalPay BANK_TRANSFER
        try:
            response = himalpay.bank_transfer(
                amount_rupees=amount,
                merchant_transaction_id=merchant_txn_id,
                destination_bank=resolved_bank,
                destination_acc_no=account_number,
                destination_acc_name=verified_name,
                is_destination_mobile='n',
                transaction_remarks=f"Shareholder Payout: {shareholder.phone}"[:255],
            )
        except HimalPayError as exc:
            raise ValueError(f"Bank transfer failed with payment provider: {exc.message}")

        provider_response = response if isinstance(response, dict) else {}
        txn_status = himalpay.normalize_status(response)
        if txn_status == 'failed':
            failure = himalpay.extract_failure_details(response)
            err_msg = failure.get('message') or failure.get('provider_message') or "Bank transfer failed with payment provider."
            raise ValueError(err_msg)

    # 3. Provider accepted / processed -> debit shareholder wallet atomically
    with transaction.atomic():
        wallet = ShareholderWallet.objects.select_for_update().get(pk=wallet.pk)
        if wallet.balance < amount:
            avail = wallet.balance
            raise ValueError(f"Insufficient revenue balance. Available: NPR {avail}, requested: NPR {amount}")

        wallet.balance -= amount
        wallet.total_withdrawn = (wallet.total_withdrawn or Decimal('0.00')) + amount
        wallet.save(update_fields=['balance', 'total_withdrawn', 'updated_at'])

        withdrawal = ShareholderWithdrawal.objects.create(
            shareholder=shareholder,
            payout_account=payout_account,
            amount=amount,
            payout_method=payout_method,
            account_name=verified_name,
            account_number=account_number,
            bank_name=bank_name or resolved_bank,
            status=ShareholderWithdrawal.STATUS_COMPLETED,
        )

        if resolved_bank and merchant_txn_id:
            from .himalpay import HimalPayAPI
            himalpay = HimalPayAPI()
            BankTransferTransaction.objects.create(
                user=shareholder,
                amount=amount,
                destination_bank=resolved_bank,
                destination_bank_name=bank_name or resolved_bank,
                destination_acc_no=account_number,
                destination_acc_name=verified_name,
                is_destination_mobile=False,
                transaction_remarks=f"Shareholder Profit Payout (WTH-{withdrawal.id})",
                status='success' if txn_status == 'success' else 'pending',
                merchant_txn_id=merchant_txn_id,
                provider_txn_id=himalpay.extract_transaction_id(provider_response) or (provider_response.get('data') or {}).get('provider_txn_id'),
                reference_id=himalpay.extract_reference_id(provider_response) or provider_response.get('reference_id'),
                charge=Decimal('0.00'),
                cashback=Decimal('0.00'),
                total_debited=amount,
                verified=True,
                source=BankTransferTransaction.SOURCE_APP,
                client_reference=f"SH-WTH-{withdrawal.id}",
                provider_response=provider_response,
            )

    return withdrawal


def record_shareholder_transaction_fee(txn) -> list[ShareholderRevenueLog]:
    """
    Called when an outbound transaction succeeds (e.g. BankTransferTransaction).
    Extracts platform withdraw fee and distributes to shareholders.
    """
    model_name = txn.__class__.__name__
    if model_name != 'BankTransferTransaction':
        return []

    if getattr(txn, 'status', None) != 'success':
        return []

    ref = f"BT-{txn.pk}"
    if ShareholderRevenueLog.objects.filter(reference=ref).exists():
        return []
    if getattr(txn, 'client_reference', None) and ShareholderRevenueLog.objects.filter(reference=txn.client_reference).exists():
        return []
    if getattr(txn, 'merchant_txn_id', None) and ShareholderRevenueLog.objects.filter(reference=txn.merchant_txn_id).exists():
        return []

    config = get_service_fee_config()
    fee_percent = Decimal(str(config.payment_api_withdraw_percent or 0))
    amount = Decimal(str(txn.amount or 0))
    if fee_percent > Decimal('0.00'):
        fee_amount = round(amount * (fee_percent / Decimal('100.00')), 2)
    else:
        fee_amount = Decimal(str(getattr(txn, 'platform_charge', 0) or 0))

    if fee_amount <= Decimal('0.00'):
        return []

    user = getattr(txn, 'user', None)
    phone = user.phone if user else 'user'
    return distribute_platform_fee(
        fee_amount=fee_amount,
        source=ShareholderRevenueLog.SOURCE_API_WITHDRAW,
        reference=ref,
        notes=f"Bank withdrawal fee on NPR {amount} for {phone}",
    )


def sync_historical_revenue_to_shareholders() -> dict:
    """
    Backfill/sync shareholder earnings from all approved Deposits, successful BankTransfers,
    and ApiFundTransfers that have not been credited to ShareholderRevenueLog yet.
    """
    from ..models import Deposit, BankTransferTransaction, ApiFundTransferLog

    config = get_service_fee_config()
    dep_percent = Decimal(str(config.payment_api_deposit_percent or 0))
    wth_percent = Decimal(str(config.payment_api_withdraw_percent or 0))

    synced_deposits = 0
    synced_withdraws = 0
    total_deposit_fees = Decimal('0.00')
    total_withdraw_fees = Decimal('0.00')

    # 1. Sync Deposits
    if dep_percent > Decimal('0.00'):
        approved_deposits = Deposit.objects.filter(status='approved').order_by('id')
        for dep in approved_deposits:
            ref = f"DEP-{dep.pk}"
            if not ShareholderRevenueLog.objects.filter(reference=ref).exists():
                fee_amount = round(dep.amount * (dep_percent / Decimal('100.00')), 2)
                if fee_amount > Decimal('0.00'):
                    distribute_platform_fee(
                        fee_amount=fee_amount,
                        source=ShareholderRevenueLog.SOURCE_API_DEPOSIT,
                        reference=ref,
                        notes=f"Backfill deposit fee ({dep_percent}%) on NPR {dep.amount} from {dep.user.phone}",
                    )
                    dep.platform_fee = fee_amount
                    dep.save(update_fields=['platform_fee'])
                    synced_deposits += 1
                    total_deposit_fees += fee_amount

    # 2. Sync Bank Transfers
    if wth_percent > Decimal('0.00'):
        successful_bt = BankTransferTransaction.objects.filter(status='success').order_by('id')
        for bt in successful_bt:
            ref = f"BT-{bt.pk}"
            if not ShareholderRevenueLog.objects.filter(reference=ref).exists():
                fee_amount = round(bt.amount * (wth_percent / Decimal('100.00')), 2)
                if fee_amount > Decimal('0.00'):
                    distribute_platform_fee(
                        fee_amount=fee_amount,
                        source=ShareholderRevenueLog.SOURCE_API_WITHDRAW,
                        reference=ref,
                        notes=f"Backfill bank withdrawal fee ({wth_percent}%) on NPR {bt.amount} from {bt.user.phone}",
                    )
                    synced_withdraws += 1
                    total_withdraw_fees += fee_amount

        # 3. Sync API Fund Transfers
        api_transfers = ApiFundTransferLog.objects.filter(status=ApiFundTransferLog.STATUS_SUCCESS, wallet_transfer__isnull=False).order_by('id')
        for aft in api_transfers:
            ref = f"API-WTH-{aft.wallet_transfer_id}"
            if not ShareholderRevenueLog.objects.filter(reference=ref).exists():
                fee_amount = round(aft.amount * (wth_percent / Decimal('100.00')), 2)
                if fee_amount > Decimal('0.00'):
                    distribute_platform_fee(
                        fee_amount=fee_amount,
                        source=ShareholderRevenueLog.SOURCE_API_WITHDRAW,
                        reference=ref,
                        notes=f"Backfill API payout fee ({wth_percent}%) on NPR {aft.amount} from {aft.user.phone}",
                    )
                    synced_withdraws += 1
                    total_withdraw_fees += fee_amount

    return {
        'synced_deposits_count': synced_deposits,
        'synced_withdraws_count': synced_withdraws,
        'total_deposit_fees': str(total_deposit_fees),
        'total_withdraw_fees': str(total_withdraw_fees),
        'total_fees_synced': str(total_deposit_fees + total_withdraw_fees),
    }
