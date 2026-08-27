"""
Shared helpers for outbound transaction status (top-up / bank transfer)
and wallet debit / refund when status changes.
"""
from decimal import Decimal
from typing import Optional, Tuple

from django.db import transaction

from ..models import Wallet
from .wallet_guard import (
    InsufficientWalletBalanceError,
    WalletBalanceMismatchError,
    WalletFrozenError,
    WALLET_FROZEN_MESSAGE,
    assert_wallet_not_frozen,
)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def _get_or_create_wallet(user) -> Wallet:
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def debit_amount_for(txn) -> Decimal:
    return Decimal(str(txn.total_debited or txn.amount or 0))


def snapshot_wallet_balances(txn, balance_before: Decimal, balance_after: Decimal) -> None:
    """Record wallet balances around a debit/credit on the transaction."""
    txn.balance_before = balance_before
    txn.balance_after = balance_after


def debit_wallet_for_txn(wallet: Wallet, txn, amount: Decimal) -> None:
    """
    Debit wallet and snapshot balances onto txn.
    Caller must hold select_for_update on wallet.
    Verifies sufficient funds before deducting and the stored balance afterwards.
    """
    assert_wallet_not_frozen(wallet)
    amount = _money(amount)
    before = _money(wallet.balance)
    if before < amount:
        raise InsufficientWalletBalanceError(amount, before)
    expected = before - amount
    wallet.balance = expected
    wallet.save(update_fields=['balance', 'updated_at'])
    wallet.refresh_from_db(fields=['balance'])
    actual = _money(wallet.balance)
    if actual != expected:
        raise WalletBalanceMismatchError(expected, actual)
    snapshot_wallet_balances(txn, before, actual)
    try:
        from .dealer_commission import record_dealer_commission
        record_dealer_commission(txn)
    except Exception:
        pass


def credit_wallet_for_txn(wallet: Wallet, txn, amount: Decimal) -> None:
    """Credit wallet and snapshot balances onto txn. Caller must hold select_for_update."""
    assert_wallet_not_frozen(wallet)
    amount = _money(amount)
    before = _money(wallet.balance)
    expected = before + amount
    wallet.balance = expected
    wallet.save(update_fields=['balance', 'updated_at'])
    wallet.refresh_from_db(fields=['balance'])
    actual = _money(wallet.balance)
    if actual != expected:
        raise WalletBalanceMismatchError(expected, actual)
    snapshot_wallet_balances(txn, before, actual)
    try:
        from .dealer_commission import record_dealer_commission
        record_dealer_commission(txn)
    except Exception:
        pass


def apply_outbound_status_change(txn, new_status: str) -> Tuple[bool, Optional[str]]:
    """
    Update top-up / bank-transfer status and sync wallet balance.

    - Transition into success: debit wallet
    - Transition out of success: refund wallet
    Returns (ok, error_message).
    """
    if new_status not in ('pending', 'success', 'failed'):
        return False, f'Invalid status: {new_status}'

    old_status = txn.status
    if old_status == new_status:
        return True, None

    debit = debit_amount_for(txn)

    try:
        with transaction.atomic():
            wallet = _get_or_create_wallet(txn.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

            update_fields = ['status', 'updated_at']

            if old_status != 'success' and new_status == 'success':
                debit_wallet_for_txn(wallet, txn, debit)
                update_fields.extend(['balance_before', 'balance_after'])
            elif old_status == 'success' and new_status != 'success':
                assert_wallet_not_frozen(wallet)
                before = _money(wallet.balance)
                expected = before + _money(debit)
                wallet.balance = expected
                wallet.save(update_fields=['balance', 'updated_at'])
                wallet.refresh_from_db(fields=['balance'])
                if _money(wallet.balance) != expected:
                    raise WalletBalanceMismatchError(expected, wallet.balance)

            txn.status = new_status
            txn.save(update_fields=update_fields)
    except WalletFrozenError as exc:
        return False, exc.message or WALLET_FROZEN_MESSAGE
    except InsufficientWalletBalanceError as exc:
        return False, str(exc)
    except WalletBalanceMismatchError as exc:
        return False, str(exc)

    if old_status != 'success' and new_status == 'success':
        try:
            from .dealer_commission import record_dealer_commission
            record_dealer_commission(txn)
        except Exception:
            pass
    elif old_status == 'success' and new_status != 'success':
        try:
            from .dealer_commission import reverse_dealer_commission
            reverse_dealer_commission(txn)
        except Exception:
            pass

    return True, None


def credit_amount_for(txn) -> Decimal:
    return Decimal(str(getattr(txn, 'total_credited', None) or txn.amount or 0))


def apply_inbound_status_change(txn, new_status: str) -> Tuple[bool, Optional[str]]:
    """
    Update remittance (inbound credit) status and sync wallet balance.

    - Transition into success: credit wallet (once)
    - Transition out of success: reverse the credit
    """
    if new_status not in ('pending', 'success', 'failed'):
        return False, f'Invalid status: {new_status}'

    old_status = txn.status
    if old_status == new_status:
        return True, None

    credit = credit_amount_for(txn)

    try:
        with transaction.atomic():
            wallet = _get_or_create_wallet(txn.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

            update_fields = ['status', 'updated_at']

            if old_status != 'success' and new_status == 'success':
                credit_wallet_for_txn(wallet, txn, credit)
                txn.wallet_credited = True
                update_fields.extend(['balance_before', 'balance_after', 'wallet_credited'])
            elif old_status == 'success' and new_status != 'success':
                assert_wallet_not_frozen(wallet)
                refund = _money(credit)
                before = _money(wallet.balance)
                if before < refund:
                    return False, 'Insufficient wallet balance to reverse remittance credit'
                expected = before - refund
                wallet.balance = expected
                wallet.save(update_fields=['balance', 'updated_at'])
                wallet.refresh_from_db(fields=['balance'])
                if _money(wallet.balance) != expected:
                    raise WalletBalanceMismatchError(expected, wallet.balance)
                txn.wallet_credited = False
                update_fields.append('wallet_credited')

            txn.status = new_status
            txn.save(update_fields=update_fields)
    except WalletFrozenError as exc:
        return False, exc.message or WALLET_FROZEN_MESSAGE
    except WalletBalanceMismatchError as exc:
        return False, str(exc)

    if old_status != 'success' and new_status == 'success':
        try:
            from .dealer_commission import record_dealer_commission
            record_dealer_commission(txn)
        except Exception:
            pass
    elif old_status == 'success' and new_status != 'success':
        try:
            from .dealer_commission import reverse_dealer_commission
            reverse_dealer_commission(txn)
        except Exception:
            pass

    return True, None


def resolve_provider_outcome(provider_status: str, auto_verified: bool) -> str:
    """
    Map HimalPay-normalized status to local status under Super Admin policy.

    When auto_status_verified is off, success/pending from the provider stay
    pending until an admin sets success (wallet debit happens then).
    When on, success and pending both finalize as success immediately.
    Failed always stays failed.
    """
    if provider_status == 'failed':
        return 'failed'
    if auto_verified:
        return 'success'
    return 'pending'
