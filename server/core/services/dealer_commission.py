"""
Dealer commission + TDS ledger.

Gross dealer commission = transaction amount × dealer commission rate.
TDS is deducted from dealer gross; net is payable to the Dealer.
Sub-Agent commission and Super Admin profit are recorded separately.
Records are not rewritten: reversing a source txn marks the row reversed.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.db import transaction

from .app_config import get_app_config
from .hierarchy import ROLE_DEALER, resolve_assigned_dealer, resolve_assigned_sub_agent

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


def default_sub_agent_rate() -> Decimal:
    cfg = get_app_config().get('commission') or {}
    return _rate(cfg.get('default_sub_agent_rate', 0), '0')


def default_super_admin_rate() -> Decimal:
    cfg = get_app_config().get('commission') or {}
    return _rate(cfg.get('default_super_admin_rate', 0), '0')


def _load_dealer_config(dealer):
    try:
        config = getattr(dealer, 'dealer_commission_config', None)
        if config is None:
            from ..models import DealerCommissionConfig
            config = DealerCommissionConfig.objects.filter(user_id=dealer.pk).first()
        return config
    except Exception:
        logger.exception('Could not load dealer commission config for user %s', getattr(dealer, 'pk', None))
        return None


def _load_service_rule(dealer, txn_type: Optional[str]):
    if dealer is None or not txn_type:
        return None
    try:
        from ..models import ServiceCommissionRule
        return ServiceCommissionRule.objects.filter(dealer_id=dealer.pk, txn_type=txn_type).first()
    except Exception:
        logger.exception(
            'Could not load service commission rule for dealer %s type %s',
            getattr(dealer, 'pk', None), txn_type,
        )
        return None


def get_dealer_rates(dealer, txn_type: Optional[str] = None) -> tuple[Decimal, Decimal]:
    """Return (commission_rate_percent, tds_rate_percent) for a Dealer."""
    commission = default_commission_rate()
    tds = default_tds_rate()
    config = _load_dealer_config(dealer)
    if config is not None:
        commission = _rate(config.commission_rate)
        if config.tds_rate is not None:
            tds = _rate(config.tds_rate)
    rule = _load_service_rule(dealer, txn_type)
    if rule is not None:
        commission = _rate(rule.dealer_rate)
    return commission, tds


def get_hierarchy_rates(dealer, sub_agent=None, txn_type: Optional[str] = None) -> dict:
    """Return dealer / sub-agent / super-admin rates plus TDS for this chain + service."""
    dealer_rate, tds = get_dealer_rates(dealer, txn_type)
    sub_rate = default_sub_agent_rate()
    sa_rate = default_super_admin_rate()
    config = _load_dealer_config(dealer)
    if config is not None:
        sub_rate = _rate(getattr(config, 'sub_agent_commission_rate', 0) or 0)
        sa_rate = _rate(getattr(config, 'super_admin_rate', 0) or 0)
    rule = _load_service_rule(dealer, txn_type)
    if rule is not None:
        sub_rate = _rate(rule.sub_agent_rate)
        sa_rate = _rate(rule.super_admin_rate)
    if sub_agent is not None:
        sub_config = _load_dealer_config(sub_agent)
        if sub_config is not None and _rate(sub_config.commission_rate) > 0:
            sub_rate = _rate(sub_config.commission_rate)
    else:
        sub_rate = _ZERO.quantize(_RATE_Q)
    return {
        'dealer_rate': dealer_rate,
        'tds_rate': tds,
        'sub_agent_rate': sub_rate,
        'super_admin_rate': sa_rate,
    }


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


def calculate_hierarchy_commission(txn_amount, rates: dict) -> dict:
    amount = _money(txn_amount)
    dealer_figures = calculate_commission(amount, rates['dealer_rate'], rates['tds_rate'])
    sub_rate = _rate(rates.get('sub_agent_rate') or 0)
    sa_rate = _rate(rates.get('super_admin_rate') or 0)
    sub_commission = (
        (amount * sub_rate / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
        if amount > 0 and sub_rate > 0 else _ZERO
    )
    sa_profit = (
        (amount * sa_rate / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
        if amount > 0 and sa_rate > 0 else _ZERO
    )
    return {
        **dealer_figures,
        'sub_agent_commission_rate': sub_rate,
        'sub_agent_commission': sub_commission,
        'super_admin_rate': sa_rate,
        'super_admin_profit': sa_profit,
    }


def record_dealer_commission(txn) -> Optional[object]:
    """
    Create a posted DealerCommission for a successful source transaction.
    No-op when there is no assigned Dealer or a row already exists.
    Historical amounts are snapshotted and never rewritten on config changes.
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

    sub_agent = resolve_assigned_sub_agent(user)
    if sub_agent is not None and getattr(sub_agent, 'pk', None) == getattr(dealer, 'pk', None):
        sub_agent = None

    rates = get_hierarchy_rates(dealer, sub_agent, txn_type)
    figures = calculate_hierarchy_commission(_txn_amount(txn), rates)
    if (
        figures['gross_commission'] <= 0
        and figures['sub_agent_commission'] <= 0
        and figures['super_admin_profit'] <= 0
    ):
        return None

    defaults = {
        'dealer': dealer,
        'source_user': user,
        'sub_agent': sub_agent,
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
                # Re-post after a later success without rewriting original amounts.
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
