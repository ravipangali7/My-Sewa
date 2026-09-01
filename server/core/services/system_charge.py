"""
Super Admin System Charge settlement.

Leftover service charge (after dealer commission and customer cashback) is
credited to the Super Admin wallet as a System Charge row that records which
user's transaction generated it. Reversing the source transaction reverses
the credit.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction

from .hierarchy import canonical_support_admin
from .txn_charges import TXN_TYPE_LABELS, get_transaction_charge, money, txn_type_for
from .wallet_guard import WalletFrozenError, assert_wallet_not_frozen

logger = logging.getLogger(__name__)

_ZERO = Decimal('0.00')


def _system_charge_ref(txn_type: str, txn_id, *, reverse: bool = False) -> str:
    prefix = 'SCREV' if reverse else 'SC'
    return f'{prefix}:{txn_type}:{txn_id}'[:100]


def _txn_user(txn):
    user = getattr(txn, 'user', None)
    if user is not None:
        return user
    return getattr(txn, 'sender', None)


def _system_charge_amount(txn) -> Decimal:
    snapshot = get_transaction_charge(txn)
    if snapshot is not None:
        return money(snapshot.system_charge)
    return money(getattr(txn, 'platform_charge', 0) or 0)


def _get_or_create_wallet(user):
    from ..models import Wallet
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=_ZERO)


def _source_label(source_user) -> str:
    if source_user is None:
        return 'a user'
    phone = getattr(source_user, 'phone', None) or 'customer'
    name = ' '.join(filter(None, [
        getattr(source_user, 'first_name', '') or '',
        getattr(source_user, 'last_name', '') or '',
    ])).strip()
    return f'{name} ({phone})' if name else phone


def record_system_charge(txn) -> Optional[object]:
    """
    Credit leftover service charge to the Super Admin wallet.
    Idempotent on (txn_type, txn_id). Hidden from the source user.
    """
    from ..models import Wallet, WalletAdjustment

    txn_type = txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    amount = _system_charge_amount(txn)
    if not txn_type or not txn_id or amount <= 0:
        return None

    admin_user = canonical_support_admin()
    if admin_user is None:
        logger.warning('Skipped system charge credit; no Super Admin user exists')
        return None

    ref = _system_charge_ref(txn_type, txn_id)
    source_user = _txn_user(txn)
    try:
        with transaction.atomic():
            existing = WalletAdjustment.objects.filter(reference=ref).first()
            if existing is not None:
                return existing
            wallet = _get_or_create_wallet(admin_user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            try:
                assert_wallet_not_frozen(wallet)
            except WalletFrozenError:
                logger.warning(
                    'Skipped system charge credit; Super Admin wallet frozen for %s',
                    admin_user.pk,
                )
                return None
            before = money(wallet.balance)
            expected = money(before + amount)
            wallet.balance = expected
            wallet.save(update_fields=['balance', 'updated_at'])
            service = TXN_TYPE_LABELS.get(txn_type, txn_type.replace('_', ' '))
            return WalletAdjustment.objects.create(
                wallet=wallet,
                user=admin_user,
                amount=amount,
                adjustment_type='credit',
                kind=WalletAdjustment.KIND_SYSTEM_CHARGE,
                source_txn_type=txn_type,
                source_txn_id=txn_id,
                balance_before=before,
                balance_after=expected,
                reason=f'System Charge from {_source_label(source_user)} · {service}',
                reference=ref,
            )
    except Exception:
        logger.exception('Failed to record system charge for %s #%s', txn_type, txn_id)
        return None


def reverse_system_charge(txn) -> None:
    """Undo a posted Super Admin system-charge credit when the source txn leaves success."""
    from ..models import Wallet, WalletAdjustment

    txn_type = txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return
    ref = _system_charge_ref(txn_type, txn_id)
    reverse_ref = _system_charge_ref(txn_type, txn_id, reverse=True)
    try:
        with transaction.atomic():
            adj = WalletAdjustment.objects.select_related('wallet', 'user').filter(
                reference=ref, kind=WalletAdjustment.KIND_SYSTEM_CHARGE,
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
                    'Skipped system charge reversal; wallet frozen for %s', adj.user_id,
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
                kind=WalletAdjustment.KIND_SYSTEM_CHARGE,
                source_txn_type=txn_type,
                source_txn_id=txn_id,
                balance_before=before,
                balance_after=expected,
                reason='System Charge reversed',
                reference=reverse_ref,
            )
    except Exception:
        logger.exception('Failed to reverse system charge for %s #%s', txn_type, txn_id)
