"""
Dealer commission + TDS ledger.

Gross commission = transaction amount × dealer commission rate.
TDS is deducted from gross; net is payable to the Dealer.
Records are not rewritten: reversing a source txn marks the row reversed.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.db import transaction

from .app_config import get_app_config
from .hierarchy import ROLE_DEALER, resolve_assigned_dealer

logger = logging.getLogger(__name__)

_ZERO = Decimal('0.00')
_Q = Decimal('0.01')
_RATE_Q = Decimal('0.0001')

TXN_TYPE_BY_MODEL = {
    'TopupTransaction': 'topup',
    'DataPackTransaction': 'data_pack',
    'InternetBillTransaction': 'internet',
    'WaterBillTransaction': 'water',
    'ElectricityBillTransaction': 'electricity',
    'CommunityElectricityTransaction': 'community_electricity',
    'BankTransferTransaction': 'bank_transfer',
    'RemittanceTransaction': 'remittance',
}


def _money(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return _ZERO


def _rate(value, default='0') -> Decimal:
    try:
        return Decimal(str(value)).quantize(_RATE_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal(default).quantize(_RATE_Q, rounding=ROUND_HALF_UP)


def _txn_type_for(txn) -> Optional[str]:
    name = txn.__class__.__name__
    return TXN_TYPE_BY_MODEL.get(name)


def _txn_amount(txn) -> Decimal:
    for field in ('total_debited', 'total_credited', 'amount'):
        value = getattr(txn, field, None)
        if value is not None:
            amount = _money(value)
            if amount > 0:
                return amount
    return _ZERO


def _txn_reference(txn) -> str:
    for field in ('merchant_txn_id', 'reference', 'reference_id', 'ref_no'):
        value = str(getattr(txn, field, '') or '').strip()
        if value:
            return value[:100]
    return f'{txn.__class__.__name__}-{getattr(txn, "pk", "")}'[:100]


def default_tds_rate() -> Decimal:
    cfg = get_app_config().get('commission') or {}
    return _rate(cfg.get('default_tds_rate', 15), '15')


def default_commission_rate() -> Decimal:
    cfg = get_app_config().get('commission') or {}
    return _rate(cfg.get('default_commission_rate', 0), '0')


def get_dealer_rates(dealer) -> tuple[Decimal, Decimal]:
    """Return (commission_rate_percent, tds_rate_percent) for a Dealer."""
    commission = default_commission_rate()
    tds = default_tds_rate()
    try:
        config = getattr(dealer, 'dealer_commission_config', None)
        if config is None:
            from ..models import DealerCommissionConfig
            config = DealerCommissionConfig.objects.filter(user_id=dealer.pk).first()
        if config is not None:
            commission = _rate(config.commission_rate)
            if config.tds_rate is not None:
                tds = _rate(config.tds_rate)
    except Exception:
        logger.exception('Could not load dealer commission config for user %s', getattr(dealer, 'pk', None))
    return commission, tds


def calculate_commission(txn_amount, commission_rate, tds_rate) -> dict:
    amount = _money(txn_amount)
    rate = _rate(commission_rate)
    tds_pct = _rate(tds_rate)
    if amount <= 0 or rate <= 0:
        return {
            'txn_amount': amount,
            'commission_rate': rate,
            'gross_commission': _ZERO,
            'tds_rate': tds_pct,
            'tds_amount': _ZERO,
            'net_commission': _ZERO,
        }
    gross = (amount * rate / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
    tds_amount = (gross * tds_pct / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
    if tds_amount > gross:
        tds_amount = gross
    net = (gross - tds_amount).quantize(_Q, rounding=ROUND_HALF_UP)
    return {
        'txn_amount': amount,
        'commission_rate': rate,
        'gross_commission': gross,
        'tds_rate': tds_pct,
        'tds_amount': tds_amount,
        'net_commission': net,
    }


def record_dealer_commission(txn) -> Optional[object]:
    """
    Create a posted DealerCommission for a successful source transaction.
    No-op when there is no assigned Dealer, rate is zero, or a row already exists.
    """
    from ..models import DealerCommission

    txn_type = _txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return None
    user = getattr(txn, 'user', None)
    dealer = resolve_assigned_dealer(user)
    if dealer is None or getattr(dealer, 'role', None) != ROLE_DEALER:
        return None

    figures = calculate_commission(_txn_amount(txn), *get_dealer_rates(dealer))
    if figures['gross_commission'] <= 0:
        return None

    defaults = {
        'dealer': dealer,
        'source_user': user,
        'reference': _txn_reference(txn),
        'status': DealerCommission.STATUS_POSTED,
        **figures,
    }
    try:
        with transaction.atomic():
            obj, created = DealerCommission.objects.get_or_create(
                txn_type=txn_type,
                txn_id=txn_id,
                defaults=defaults,
            )
            if not created and obj.status == DealerCommission.STATUS_REVERSED:
                # Re-post after a later success without rewriting original amounts
                # if the row already captured figures; restore posted status only.
                obj.status = DealerCommission.STATUS_POSTED
                obj.save(update_fields=['status', 'updated_at'])
            return obj
    except Exception:
        logger.exception(
            'Failed to record dealer commission for %s #%s', txn_type, txn_id,
        )
        return None


def reverse_dealer_commission(txn) -> None:
    """Mark an existing commission row reversed. Does not change stored amounts."""
    from ..models import DealerCommission

    txn_type = _txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return
    try:
        updated = DealerCommission.objects.filter(
            txn_type=txn_type,
            txn_id=txn_id,
            status=DealerCommission.STATUS_POSTED,
        ).update(status=DealerCommission.STATUS_REVERSED)
        if updated:
            logger.info('Reversed dealer commission for %s #%s', txn_type, txn_id)
    except Exception:
        logger.exception(
            'Failed to reverse dealer commission for %s #%s', txn_type, txn_id,
        )
