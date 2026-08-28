"""
Unified transaction charges: System, Dealer commission, HimalPay.

Outgoing (debit):  wallet = amount + system + dealer + himalpay − cashback
Incoming (credit): wallet = amount − system − dealer − himalpay + cashback

Dealer commission is applied only when the user has an assigned Dealer.
HimalPay: configured charge if set, otherwise the live provider charge.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.db import transaction

from .app_config import get_app_config, resolve_tx_cfg_for_user
from .hierarchy import ROLE_DEALER, resolve_assigned_dealer

logger = logging.getLogger(__name__)

_ZERO = Decimal('0.00')
_Q = Decimal('0.01')
_RATE_Q = Decimal('0.0001')

TXN_TOPUP = 'topup'
TXN_DATA_PACK = 'data_pack'
TXN_INTERNET = 'internet'
TXN_WATER = 'water'
TXN_ELECTRICITY = 'electricity'
TXN_COMMUNITY_ELECTRICITY = 'community_electricity'
TXN_BANK_TRANSFER = 'bank_transfer'
TXN_REMITTANCE = 'remittance'
TXN_WALLET_TRANSFER = 'wallet_transfer'

SERVICE_CHARGE_TXN_TYPES = (
    TXN_TOPUP,
    TXN_DATA_PACK,
    TXN_INTERNET,
    TXN_WATER,
    TXN_ELECTRICITY,
    TXN_COMMUNITY_ELECTRICITY,
    TXN_BANK_TRANSFER,
    TXN_REMITTANCE,
    TXN_WALLET_TRANSFER,
)

TXN_TYPE_LABELS = {
    TXN_TOPUP: 'Mobile top-up',
    TXN_DATA_PACK: 'Data pack',
    TXN_INTERNET: 'Internet / WiFi',
    TXN_WATER: 'Water',
    TXN_ELECTRICITY: 'Electricity',
    TXN_COMMUNITY_ELECTRICITY: 'Community electricity',
    TXN_BANK_TRANSFER: 'Bank / fund transfer',
    TXN_REMITTANCE: 'Remittance',
    TXN_WALLET_TRANSFER: 'Wallet transfer',
}

TXN_TYPE_BY_MODEL = {
    'TopupTransaction': TXN_TOPUP,
    'DataPackTransaction': TXN_DATA_PACK,
    'InternetBillTransaction': TXN_INTERNET,
    'WaterBillTransaction': TXN_WATER,
    'ElectricityBillTransaction': TXN_ELECTRICITY,
    'CommunityElectricityTransaction': TXN_COMMUNITY_ELECTRICITY,
    'BankTransferTransaction': TXN_BANK_TRANSFER,
    'RemittanceTransaction': TXN_REMITTANCE,
    'WalletTransfer': TXN_WALLET_TRANSFER,
}


def money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return _ZERO


def _rate(value, default='0') -> Decimal:
    try:
        return Decimal(str(value if value is not None else default)).quantize(
            _RATE_Q, rounding=ROUND_HALF_UP,
        )
    except Exception:
        return Decimal(default).quantize(_RATE_Q, rounding=ROUND_HALF_UP)


def _component(amount: Decimal, flat, percent) -> Decimal:
    total = money(flat)
    pct = _rate(percent)
    if amount > 0 and pct > 0:
        total += (amount * pct / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
    return money(total)


def txn_type_for(txn) -> Optional[str]:
    if txn is None:
        return None
    return TXN_TYPE_BY_MODEL.get(txn.__class__.__name__)


def txn_type_from_service_name(service_name: str) -> str:
    key = (service_name or '').strip().upper()
    if key in ('NTC', 'NCELL'):
        return TXN_TOPUP
    if 'DATA_PACK' in key:
        return TXN_DATA_PACK
    if key == 'BANK_TRANSFER':
        return TXN_BANK_TRANSFER
    if key in ('KUKL_PAY', 'KUKL_GET') or 'WATER' in key:
        return TXN_WATER
    if key in ('NEA_PAY', 'NEA_GET'):
        return TXN_ELECTRICITY
    if 'COMMUNITY' in key:
        return TXN_COMMUNITY_ELECTRICITY
    if key.endswith('_PAY') or key.endswith('_GET') or 'INTERNET' in key or 'WIFI' in key:
        return TXN_INTERNET
    if 'REMIT' in key:
        return TXN_REMITTANCE
    if 'WALLET' in key:
        return TXN_WALLET_TRANSFER
    return TXN_TOPUP


def empty_quote(amount=0, *, direction='debit') -> dict:
    value = money(amount)
    return {
        'amount': value,
        'system_charge': _ZERO,
        'dealer_commission': _ZERO,
        'himalpay_charge': _ZERO,
        'total_charges': _ZERO,
        'cashback': _ZERO,
        'direction': direction,
        'wallet_amount': value,
        'dealer': None,
        'dealer_id': None,
        'txn_type': None,
    }


def _load_service_config(txn_type: str):
    if not txn_type:
        return None
    try:
        from ..models import ServiceChargeConfig
        return ServiceChargeConfig.objects.filter(txn_type=txn_type).first()
    except Exception:
        logger.debug('Could not load service charge config for %s', txn_type, exc_info=True)
        return None


def _legacy_system_charge(amount: Decimal, txn_type: str, user) -> Decimal:
    """Fall back to the older transfer/top-up settings when no service row exists."""
    cfg = resolve_tx_cfg_for_user(user)
    if txn_type in (TXN_TOPUP, TXN_DATA_PACK):
        return _component(amount, 0, cfg.get('topup_charge_percent', 0))
    if txn_type in (TXN_BANK_TRANSFER, TXN_WALLET_TRANSFER):
        if not bool(cfg.get('transfer_charge_enabled', True)):
            return _ZERO
        return _component(
            amount,
            cfg.get('transfer_charge_flat', 0),
            cfg.get('transfer_charge_percent', 0),
        )
    return _ZERO


def _dealer_override_percent(dealer, txn_type: str) -> Optional[Decimal]:
    """Per-service dealer % from ServiceCommissionRule only (does not replace configured flats)."""
    if dealer is None:
        return None
    try:
        from ..models import ServiceCommissionRule
        rule = ServiceCommissionRule.objects.filter(
            dealer_id=dealer.pk, txn_type=txn_type,
        ).first()
        if rule is not None and _rate(rule.dealer_rate) > 0:
            return _rate(rule.dealer_rate)
    except Exception:
        logger.exception('Could not load dealer service rule')
    return None


def quote_charges(
    amount,
    txn_type: str,
    user=None,
    *,
    provider_charge=0,
    cashback=0,
    direction: str = 'debit',
) -> dict:
    """
    Calculate System + Dealer + HimalPay charges for a principal amount.

    direction:
      debit  — user pays amount + charges (transfer, bills, top-up)
      credit — user receives amount − charges (remittance receive)
    """
    principal = money(amount)
    direction = 'credit' if direction == 'credit' else 'debit'
    cashback_amt = money(cashback)
    provider = money(provider_charge)
    dealer = resolve_assigned_dealer(user)
    if dealer is not None and getattr(dealer, 'role', None) != ROLE_DEALER:
        dealer = None
    if user is not None and getattr(user, 'role', None) == ROLE_DEALER:
        dealer = None

    row = _load_service_config(txn_type)
    if row is not None:
        system = _component(principal, row.system_charge_flat, row.system_charge_percent)
        configured_himalpay = _component(
            principal, row.himalpay_charge_flat, row.himalpay_charge_percent,
        )
        dealer_from_config = _component(
            principal, row.dealer_commission_flat, row.dealer_commission_percent,
        )
    else:
        system = _legacy_system_charge(principal, txn_type, user)
        configured_himalpay = _ZERO
        dealer_from_config = _ZERO
        default_rate = _rate((get_app_config().get('commission') or {}).get('default_commission_rate', 0))
        if default_rate > 0:
            dealer_from_config = _component(principal, 0, default_rate)

    himalpay = configured_himalpay if configured_himalpay > 0 else provider

    dealer_commission = _ZERO
    if dealer is not None:
        override_pct = _dealer_override_percent(dealer, txn_type)
        if override_pct is not None:
            dealer_commission = _component(principal, 0, override_pct)
        elif dealer_from_config > 0:
            dealer_commission = dealer_from_config
        else:
            fallback_pct = None
            try:
                config = getattr(dealer, 'dealer_commission_config', None)
                if config is None:
                    from ..models import DealerCommissionConfig
                    config = DealerCommissionConfig.objects.filter(user_id=dealer.pk).first()
                if config is not None:
                    fallback_pct = _rate(config.commission_rate)
            except Exception:
                logger.exception('Could not load dealer commission fallback')
            if fallback_pct:
                dealer_commission = _component(principal, 0, fallback_pct)

    total_charges = money(system + dealer_commission + himalpay)
    if direction == 'debit':
        wallet_amount = money(principal + total_charges - cashback_amt)
        if wallet_amount < 0:
            wallet_amount = _ZERO
    else:
        wallet_amount = money(principal - total_charges + cashback_amt)
        if wallet_amount < 0:
            wallet_amount = _ZERO

    return {
        'amount': principal,
        'system_charge': system,
        'dealer_commission': dealer_commission,
        'himalpay_charge': himalpay,
        'total_charges': total_charges,
        'cashback': cashback_amt,
        'direction': direction,
        'wallet_amount': wallet_amount,
        'dealer': dealer,
        'dealer_id': getattr(dealer, 'pk', None),
        'txn_type': txn_type,
    }


def quote_to_public(quote: dict) -> dict:
    """JSON-safe breakdown for calculate-charge / create responses."""
    return {
        'amount': str(quote.get('amount', _ZERO)),
        'system_charge': str(quote.get('system_charge', _ZERO)),
        'dealer_commission': str(quote.get('dealer_commission', _ZERO)),
        'himalpay_charge': str(quote.get('himalpay_charge', _ZERO)),
        'charge': str(quote.get('total_charges', _ZERO)),
        'total_charges': str(quote.get('total_charges', _ZERO)),
        'cashback': str(quote.get('cashback', _ZERO)),
        'total_debited': str(quote['wallet_amount']) if quote.get('direction') != 'credit' else None,
        'total_credited': str(quote['wallet_amount']) if quote.get('direction') == 'credit' else None,
        'wallet_amount': str(quote.get('wallet_amount', _ZERO)),
        'direction': quote.get('direction') or 'debit',
        'dealer_id': quote.get('dealer_id'),
        'txn_type': quote.get('txn_type'),
    }


def persist_transaction_charge(txn, quote: dict) -> Optional[object]:
    """Snapshot the applied breakdown for this transaction."""
    from ..models import TransactionCharge

    txn_type = quote.get('txn_type') or txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return None
    defaults = {
        'amount': quote.get('amount', _ZERO),
        'system_charge': quote.get('system_charge', _ZERO),
        'dealer_commission': quote.get('dealer_commission', _ZERO),
        'himalpay_charge': quote.get('himalpay_charge', _ZERO),
        'total_charges': quote.get('total_charges', _ZERO),
        'cashback': quote.get('cashback', _ZERO),
        'wallet_amount': quote.get('wallet_amount', _ZERO),
        'direction': quote.get('direction') or 'debit',
        'dealer_id': quote.get('dealer_id'),
    }
    try:
        with transaction.atomic():
            obj, created = TransactionCharge.objects.update_or_create(
                txn_type=txn_type,
                txn_id=txn_id,
                defaults=defaults,
            )
            return obj
    except Exception:
        logger.exception('Failed to persist transaction charge for %s #%s', txn_type, txn_id)
        return None


def get_transaction_charge(txn) -> Optional[object]:
    from ..models import TransactionCharge

    txn_type = txn_type_for(txn)
    txn_id = getattr(txn, 'pk', None)
    if not txn_type or not txn_id:
        return None
    try:
        return TransactionCharge.objects.filter(txn_type=txn_type, txn_id=txn_id).first()
    except Exception:
        return None


def apply_debit_quote_to_txn(txn, quote: dict) -> None:
    """Write combined charge / total_debited onto an outbound transaction."""
    txn.charge = quote['total_charges']
    if hasattr(txn, 'cashback'):
        txn.cashback = quote.get('cashback', _ZERO)
    if hasattr(txn, 'total_debited'):
        txn.total_debited = quote['wallet_amount']
    if hasattr(txn, 'platform_charge'):
        txn.platform_charge = quote['system_charge']
    if hasattr(txn, 'provider_charge'):
        txn.provider_charge = quote['himalpay_charge']


def overlay_himalpay_debit(txn, himalpay, response: dict, amount, txn_type: str, user=None) -> dict:
    """Apply configured debit charges on top of a HimalPay fee response."""
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    provider_charge = himalpay.to_rupees(charge_paisa)
    cashback = himalpay.to_rupees(cashback_paisa)
    quote = quote_charges(
        amount, txn_type, user or getattr(txn, 'user', None),
        provider_charge=provider_charge, cashback=cashback, direction='debit',
    )
    apply_debit_quote_to_txn(txn, quote)
    txn_id = himalpay.extract_transaction_id(response)
    if hasattr(txn, 'service_hub_txn_id'):
        txn.service_hub_txn_id = txn_id
    if hasattr(txn, 'provider_txn_id'):
        txn.provider_txn_id = txn_id or getattr(txn, 'provider_txn_id', None)
    if hasattr(txn, 'reference_id'):
        txn.reference_id = himalpay.extract_reference_id(response)
    if hasattr(txn, 'provider_response'):
        txn.provider_response = response
    persist_transaction_charge(txn, quote)
    return quote


def apply_credit_quote_to_txn(txn, quote: dict) -> None:
    """Write combined charge / total_credited onto an inbound transaction."""
    txn.charge = quote['total_charges']
    if hasattr(txn, 'cashback'):
        txn.cashback = quote.get('cashback', _ZERO)
    if hasattr(txn, 'total_credited'):
        txn.total_credited = quote['wallet_amount']


def overlay_himalpay_credit(txn, himalpay, response: dict, amount, txn_type: str, user=None, persist: bool = True) -> dict:
    """Apply configured credit charges on top of a HimalPay inbound fee response."""
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    amount_raw = response.get('amount')
    if amount_raw is not None and str(amount_raw).strip() != '':
        gross = himalpay.to_rupees(amount_raw)
    else:
        gross = money(amount if amount is not None else getattr(txn, 'amount', 0))
    quote = quote_charges(
        gross, txn_type, user or getattr(txn, 'user', None),
        provider_charge=himalpay.to_rupees(charge_paisa),
        cashback=himalpay.to_rupees(cashback_paisa),
        direction='credit',
    )
    apply_credit_quote_to_txn(txn, quote)
    if hasattr(txn, 'provider_txn_id'):
        txn.provider_txn_id = himalpay.extract_transaction_id(response) or getattr(txn, 'provider_txn_id', None)
    if hasattr(txn, 'service_hub_txn_id'):
        txn.service_hub_txn_id = himalpay.extract_transaction_id(response)
    if hasattr(txn, 'reference_id'):
        txn.reference_id = himalpay.extract_reference_id(response) or getattr(txn, 'reference_id', None)
    if hasattr(txn, 'provider_response'):
        txn.provider_response = response
    if persist and getattr(txn, 'pk', None):
        persist_transaction_charge(txn, quote)
        txn.save()
    return quote


def default_service_charge_rows() -> list[dict[str, Any]]:
    cfg = get_app_config()
    tx = cfg.get('transactions') or {}
    commission = cfg.get('commission') or {}
    topup_pct = _rate(tx.get('topup_charge_percent', 0))
    transfer_flat = money(tx.get('transfer_charge_flat', 0))
    transfer_pct = _rate(tx.get('transfer_charge_percent', 0))
    dealer_pct = _rate(commission.get('default_commission_rate', 0))

    rows = []
    for txn_type in SERVICE_CHARGE_TXN_TYPES:
        system_flat = _ZERO
        system_percent = _ZERO
        if txn_type in (TXN_TOPUP, TXN_DATA_PACK):
            system_percent = topup_pct
        if txn_type in (TXN_BANK_TRANSFER, TXN_WALLET_TRANSFER):
            system_flat = transfer_flat
            system_percent = transfer_pct
        rows.append({
            'txn_type': txn_type,
            'label': TXN_TYPE_LABELS.get(txn_type, txn_type),
            'system_charge_flat': str(system_flat),
            'system_charge_percent': str(system_percent),
            'dealer_commission_flat': '0.00',
            'dealer_commission_percent': str(dealer_pct),
            'himalpay_charge_flat': '0.00',
            'himalpay_charge_percent': '0.0000',
        })
    return rows
