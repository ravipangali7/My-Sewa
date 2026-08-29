"""
Dealer commission ledger + wallet credit.

Gross dealer commission is the quoted dealer charge for the transaction
(configured flat Rs amount, 0 when the User has no assigned Dealer).
TDS is deducted from dealer gross; net is credited to the Dealer wallet.
Records are not rewritten: reversing a source txn marks the row reversed
and reverses the wallet credit.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.db import transaction

from .app_config import get_app_config
from .hierarchy import ROLE_DEALER, resolve_assigned_dealer
from .txn_charges import (
    get_transaction_charge,
    money,
    quote_charges,
    txn_type_for,
)

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
    'WalletTransfer': 'wallet_transfer',
}


def _rate(value, default='0') -> Decimal:
    try:
        return Decimal(str(value)).quantize(_RATE_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal(default).quantize(_RATE_Q, rounding=ROUND_HALF_UP)


def _txn_type_for(txn) -> Optional[str]:
    return txn_type_for(txn) or TXN_TYPE_BY_MODEL.get(txn.__class__.__name__)


def _txn_user(txn):
    user = getattr(txn, 'user', None)
    if user is not None:
        return user
    return getattr(txn, 'sender', None)


def _txn_amount(txn) -> Decimal:
    for field in ('amount', 'total_debited', 'total_credited'):
        value = getattr(txn, field, None)
        if value is not None:
            amount = money(value)
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
    """Global default dealer commission as a flat Rs amount."""
    cfg = get_app_config().get('commission') or {}
    return money(cfg.get('default_commission_rate', 0))


def default_sub_agent_rate() -> Decimal:
    return _ZERO.quantize(_RATE_Q)


def default_super_admin_rate() -> Decimal:
    return _ZERO.quantize(_RATE_Q)


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


def get_dealer_rates(dealer, txn_type: Optional[str] = None) -> tuple[Decimal, Decimal]:
    """Return (commission_flat_rs, tds_rate_percent) for a Dealer."""
    commission = default_commission_rate()
    tds = default_tds_rate()
    config = _load_dealer_config(dealer)
    if config is not None:
        commission = money(config.commission_rate)
        if config.tds_rate is not None:
            tds = _rate(config.tds_rate)
    try:
        from ..models import ServiceCommissionRule
        rule = ServiceCommissionRule.objects.filter(
            dealer_id=getattr(dealer, 'pk', None), txn_type=txn_type,
        ).first() if dealer is not None and txn_type else None
        if rule is not None and money(rule.dealer_rate) > 0:
            commission = money(rule.dealer_rate)
    except Exception:
        logger.exception('Could not load service commission rule')
    return commission, tds


def get_hierarchy_rates(dealer, sub_agent=None, txn_type: Optional[str] = None) -> dict:
    dealer_rate, tds = get_dealer_rates(dealer, txn_type)
    return {
        'dealer_rate': dealer_rate,
        'tds_rate': tds,
        'sub_agent_rate': _ZERO.quantize(_RATE_Q),
        'super_admin_rate': _ZERO.quantize(_RATE_Q),
    }


def calculate_commission(txn_amount, commission_rate, tds_rate) -> dict:
    """Gross commission is the flat Rs amount; TDS remains a percent of gross."""
    amount = money(txn_amount)
    flat = money(commission_rate)
    tds_pct = _rate(tds_rate)
    if amount <= 0 or flat <= 0:
        return {
            'txn_amount': amount,
            'commission_rate': flat,
            'gross_commission': _ZERO,
            'tds_rate': tds_pct,
            'tds_amount': _ZERO,
            'net_commission': _ZERO,
        }
    gross = flat
    tds_amount = (gross * tds_pct / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
    if tds_amount > gross:
        tds_amount = gross
    net = (gross - tds_amount).quantize(_Q, rounding=ROUND_HALF_UP)
    return {
        'txn_amount': amount,
        'commission_rate': flat,
        'gross_commission': gross,
        'tds_rate': tds_pct,
        'tds_amount': tds_amount,
        'net_commission': net,
    }


def calculate_hierarchy_commission(txn_amount, rates: dict) -> dict:
    dealer_figures = calculate_commission(txn_amount, rates['dealer_rate'], rates['tds_rate'])
    return {
        **dealer_figures,
        'sub_agent_commission_rate': _ZERO.quantize(_RATE_Q),
        'sub_agent_commission': _ZERO,
        'super_admin_rate': _ZERO.quantize(_RATE_Q),
        'super_admin_profit': _ZERO,
    }


def _figures_from_quoted_gross(principal, gross, tds_rate, commission_rate) -> dict:
    amount = money(principal)
    gross = money(gross)
    tds_pct = _rate(tds_rate)
    tds_amount = (gross * tds_pct / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP) if gross > 0 else _ZERO
    if tds_amount > gross:
        tds_amount = gross
    net = (gross - tds_amount).quantize(_Q, rounding=ROUND_HALF_UP)
    return {
        'txn_amount': amount,
        'commission_rate': money(commission_rate),
        'gross_commission': gross,
        'tds_rate': tds_pct,
        'tds_amount': tds_amount,
        'net_commission': net,
        'sub_agent_commission_rate': _ZERO.quantize(_RATE_Q),
        'sub_agent_commission': _ZERO,
        'super_admin_rate': _ZERO.quantize(_RATE_Q),
        'super_admin_profit': _ZERO,
    }


def _quote_for_txn(txn) -> dict:
    snapshot = get_transaction_charge(txn)
    user = _txn_user(txn)
    txn_type = _txn_type_for(txn)
    principal = money(getattr(txn, 'amount', None) or _txn_amount(txn))
    if snapshot is not None:
        return {
            'amount': money(snapshot.amount) or principal,
            'dealer_commission': money(snapshot.dealer_commission),
            'dealer': getattr(snapshot, 'dealer', None) or resolve_assigned_dealer(user),
            'txn_type': txn_type,
        }
    quote = quote_charges(principal, txn_type or 'topup', user)
    return quote


def _get_or_create_wallet(user):
    from ..models import Wallet
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=_ZERO)


def _credit_dealer_wallet(dealer, amount: Decimal, *, txn=None, source_user=None) -> bool:
    from .wallet_guard import assert_wallet_not_frozen, WalletFrozenError
    from ..models import WalletAdjustment

    amount = money(amount)
    if amount <= 0 or dealer is None:
        return False
    wallet = _get_or_create_wallet(dealer)
    try:
        assert_wallet_not_frozen(wallet)
    except WalletFrozenError:
        logger.warning('Skipped dealer wallet credit; wallet frozen for %s', getattr(dealer, 'pk', None))
        return False
    before = money(wallet.balance)
    expected = money(before + amount)
    wallet.balance = expected
    wallet.save(update_fields=['balance', 'updated_at'])

    txn_type = _txn_type_for(txn) if txn is not None else None
    txn_id = getattr(txn, 'pk', None) if txn is not None else None
    if txn_type and txn_id:
        source_phone = getattr(source_user, 'phone', None) or 'customer'
        source_name = ' '.join(filter(None, [
            getattr(source_user, 'first_name', '') or '',
            getattr(source_user, 'last_name', '') or '',
        ])).strip()
        who = f'{source_name} ({source_phone})' if source_name else source_phone
        ref = f'DC:{txn_type}:{txn_id}'[:100]
        WalletAdjustment.objects.get_or_create(
            reference=ref,
            defaults={
                'wallet': wallet,
                'user': dealer,
                'amount': amount,
                'adjustment_type': 'credit',
                'kind': WalletAdjustment.KIND_DEALER_COMMISSION,
                'source_txn_type': txn_type,
                'source_txn_id': txn_id,
                'balance_before': before,
                'balance_after': expected,
                'reason': f'Dealer commission from {who}',
            },
        )
    return True


def _debit_dealer_wallet(dealer, amount: Decimal, *, txn=None) -> bool:
    from .wallet_guard import assert_wallet_not_frozen, WalletFrozenError
    from ..models import WalletAdjustment

    amount = money(amount)
    if amount <= 0 or dealer is None:
        return False
    wallet = _get_or_create_wallet(dealer)
    try:
        assert_wallet_not_frozen(wallet)
    except WalletFrozenError:
        logger.warning('Skipped dealer wallet reversal; wallet frozen for %s', getattr(dealer, 'pk', None))
        return False
    before = money(wallet.balance)
    expected = money(before - amount)
    if expected < 0:
        expected = _ZERO
    wallet.balance = expected
    wallet.save(update_fields=['balance', 'updated_at'])

    txn_type = _txn_type_for(txn) if txn is not None else None
    txn_id = getattr(txn, 'pk', None) if txn is not None else None
    if txn_type and txn_id:
        ref = f'DCREV:{txn_type}:{txn_id}'[:100]
        WalletAdjustment.objects.get_or_create(
            reference=ref,
            defaults={
                'wallet': wallet,
                'user': dealer,
                'amount': -amount,
                'adjustment_type': 'debit',
                'kind': WalletAdjustment.KIND_DEALER_COMMISSION,
                'source_txn_type': txn_type,
                'source_txn_id': txn_id,
                'balance_before': before,
                'balance_after': expected,
                'reason': 'Dealer commission reversal',
            },
        )
    return True


def record_dealer_commission(txn) -> Optional[object]:
    """
    Create a posted DealerCommission and credit the Dealer wallet.
    No-op when there is no assigned Dealer or quoted dealer commission is 0.
    """
    from ..models import DealerCommission

    txn_type = _txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return None
    user = _txn_user(txn)
    quote = _quote_for_txn(txn)
    dealer = quote.get('dealer') or resolve_assigned_dealer(user)
    if dealer is None or getattr(dealer, 'role', None) != ROLE_DEALER:
        return None

    rates = get_hierarchy_rates(dealer, None, txn_type)
    gross = money(quote.get('dealer_commission', 0))
    if gross <= 0:
        return None
    figures = _figures_from_quoted_gross(
        quote.get('amount') or _txn_amount(txn),
        gross,
        rates['tds_rate'],
        gross,
    )

    defaults = {
        'dealer': dealer,
        'source_user': user,
        'sub_agent': None,
        'reference': _txn_reference(txn),
        'status': DealerCommission.STATUS_POSTED,
        'wallet_credited': False,
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
                obj.status = DealerCommission.STATUS_POSTED
                obj.save(update_fields=['status', 'updated_at'])
            should_credit = created or (
                obj.status == DealerCommission.STATUS_POSTED and not obj.wallet_credited
            )
            if should_credit and figures['net_commission'] > 0:
                credited = _credit_dealer_wallet(
                    dealer, figures['net_commission'], txn=txn, source_user=user,
                )
                if credited and not obj.wallet_credited:
                    obj.wallet_credited = True
                    obj.save(update_fields=['wallet_credited', 'updated_at'])
            return obj
    except Exception:
        logger.exception(
            'Failed to record dealer commission for %s #%s', txn_type, txn_id,
        )
        return None


def reverse_dealer_commission(txn) -> None:
    """Mark an existing commission row reversed and undo the wallet credit."""
    from ..models import DealerCommission

    txn_type = _txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return
    try:
        with transaction.atomic():
            obj = DealerCommission.objects.select_related('dealer').filter(
                txn_type=txn_type,
                txn_id=txn_id,
                status=DealerCommission.STATUS_POSTED,
            ).first()
            if obj is None:
                return
            if obj.wallet_credited and obj.net_commission:
                _debit_dealer_wallet(obj.dealer, obj.net_commission, txn=txn)
                obj.wallet_credited = False
            obj.status = DealerCommission.STATUS_REVERSED
            obj.save(update_fields=['status', 'wallet_credited', 'updated_at'])
            logger.info('Reversed dealer commission for %s #%s', txn_type, txn_id)
    except Exception:
        logger.exception(
            'Failed to reverse dealer commission for %s #%s', txn_type, txn_id,
        )
