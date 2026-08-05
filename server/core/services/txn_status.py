"""
Shared helpers for outbound transaction status (top-up / bank transfer)
and wallet debit / refund when status changes.
"""
from decimal import Decimal
from typing import Optional, Tuple

from django.db import transaction

from ..models import Wallet


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
    Caller must hold select_for_update on wallet and have already validated funds.
    """
    before = wallet.balance
    wallet.balance = before - amount
    wallet.save(update_fields=['balance', 'updated_at'])
    snapshot_wallet_balances(txn, before, wallet.balance)


def credit_wallet_for_txn(wallet: Wallet, txn, amount: Decimal) -> None:
    """Credit wallet and snapshot balances onto txn. Caller must hold select_for_update."""
    before = wallet.balance
    wallet.balance = before + amount
    wallet.save(update_fields=['balance', 'updated_at'])
    snapshot_wallet_balances(txn, before, wallet.balance)


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

    with transaction.atomic():
        wallet = _get_or_create_wallet(txn.user)
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

        update_fields = ['status', 'updated_at']

        if old_status != 'success' and new_status == 'success':
            if wallet.balance < debit:
                return False, 'Insufficient wallet balance to mark as success'
            debit_wallet_for_txn(wallet, txn, debit)
            update_fields.extend(['balance_before', 'balance_after'])
        elif old_status == 'success' and new_status != 'success':
            wallet.balance += debit
            wallet.save(update_fields=['balance', 'updated_at'])

        txn.status = new_status
        txn.save(update_fields=update_fields)

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

    with transaction.atomic():
        wallet = _get_or_create_wallet(txn.user)
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)

        update_fields = ['status', 'updated_at']

        if old_status != 'success' and new_status == 'success':
            credit_wallet_for_txn(wallet, txn, credit)
            txn.wallet_credited = True
            update_fields.extend(['balance_before', 'balance_after', 'wallet_credited'])
        elif old_status == 'success' and new_status != 'success':
            if wallet.balance < credit:
                return False, 'Insufficient wallet balance to reverse remittance credit'
            wallet.balance -= credit
            wallet.save(update_fields=['balance', 'updated_at'])
            txn.wallet_credited = False
            update_fields.append('wallet_credited')

        txn.status = new_status
        txn.save(update_fields=update_fields)

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
