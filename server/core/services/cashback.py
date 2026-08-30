"""
User cashback settlement.

User cashback is held inside the original wallet debit, then credited back as a
separate WalletAdjustment after the source transaction succeeds. Reversing the
source transaction reverses the cashback credit.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction

from .txn_charges import TXN_TYPE_LABELS, get_transaction_charge, money, txn_type_for
from .wallet_guard import WalletFrozenError, assert_wallet_not_frozen

logger = logging.getLogger(__name__)

_ZERO = Decimal('0.00')


def _cashback_ref(txn_type: str, txn_id, *, reverse: bool = False) -> str:
    prefix = 'CBREV' if reverse else 'CB'
    return f'{prefix}:{txn_type}:{txn_id}'[:100]


def _txn_user(txn):
    user = getattr(txn, 'user', None)
    if user is not None:
        return user
    return getattr(txn, 'sender', None)


def _cashback_amount(txn) -> Decimal:
    snapshot = get_transaction_charge(txn)
    if snapshot is not None:
        return money(snapshot.cashback)
    return money(getattr(txn, 'cashback', 0))


def _get_or_create_wallet(user):
    from ..models import Wallet
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=_ZERO)


def record_user_cashback(txn, wallet=None) -> Optional[object]:
    """
    Credit configured user cashback as a separate successful deposit-style row.
    Idempotent on (txn_type, txn_id).
    """
    from ..models import TransactionCharge, Wallet, WalletAdjustment

    txn_type = txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    user = _txn_user(txn)
    amount = _cashback_amount(txn)
    if not txn_type or not txn_id or user is None or amount <= 0:
        return None

    ref = _cashback_ref(txn_type, txn_id)
    try:
        with transaction.atomic():
            existing = WalletAdjustment.objects.filter(reference=ref).first()
            if existing is not None:
                return existing
            if wallet is None:
                wallet = _get_or_create_wallet(user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            try:
                assert_wallet_not_frozen(wallet)
            except WalletFrozenError:
                logger.warning('Skipped cashback credit; wallet frozen for %s', user.pk)
                return None
            before = money(wallet.balance)
            expected = money(before + amount)
            wallet.balance = expected
            wallet.save(update_fields=['balance', 'updated_at'])
            service = TXN_TYPE_LABELS.get(txn_type, txn_type.replace('_', ' '))
            adj = WalletAdjustment.objects.create(
                wallet=wallet,
                user=user,
                amount=amount,
                adjustment_type='credit',
                kind=WalletAdjustment.KIND_CASHBACK,
                source_txn_type=txn_type,
                source_txn_id=txn_id,
                balance_before=before,
                balance_after=expected,
                reason=f'Cashback · {service}',
                reference=ref,
            )
            TransactionCharge.objects.filter(txn_type=txn_type, txn_id=txn_id).update(
                cashback_credited=True,
            )
            return adj
    except Exception:
        logger.exception('Failed to record user cashback for %s #%s', txn_type, txn_id)
        return None


def reverse_user_cashback(txn) -> None:
    """Undo a posted cashback credit when the source transaction leaves success."""
    from ..models import TransactionCharge, Wallet, WalletAdjustment

    txn_type = txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return
    ref = _cashback_ref(txn_type, txn_id)
    reverse_ref = _cashback_ref(txn_type, txn_id, reverse=True)
    try:
        with transaction.atomic():
            adj = WalletAdjustment.objects.select_related('wallet', 'user').filter(
                reference=ref, kind=WalletAdjustment.KIND_CASHBACK,
            ).first()
            if adj is None:
                return
            if WalletAdjustment.objects.filter(reference=reverse_ref).exists():
                return
            amount = money(abs(adj.amount))
            if amount <= 0:
                return
            wallet = Wallet.objects.select_for_update().get(pk=adj.wallet_id)
            try:
                assert_wallet_not_frozen(wallet)
            except WalletFrozenError:
                logger.warning(
                    'Skipped cashback reversal; wallet frozen for %s', adj.user_id,
                )
                return
            before = money(wallet.balance)
            expected = money(before - amount)
            if expected < 0:
                expected = _ZERO
            wallet.balance = expected
            wallet.save(update_fields=['balance', 'updated_at'])
            WalletAdjustment.objects.create(
                wallet=wallet,
                user=adj.user,
                amount=-amount,
                adjustment_type='debit',
                kind=WalletAdjustment.KIND_CASHBACK,
                source_txn_type=txn_type,
                source_txn_id=txn_id,
                balance_before=before,
                balance_after=expected,
                reason='Cashback reversal',
                reference=reverse_ref,
            )
            TransactionCharge.objects.filter(txn_type=txn_type, txn_id=txn_id).update(
                cashback_credited=False,
            )
    except Exception:
        logger.exception('Failed to reverse user cashback for %s #%s', txn_type, txn_id)
