"""
Unified transaction charges: User service charge, network fee, HimalPay.

Outgoing (debit):
  wallet = amount + user_charge + network_fee + himalpay + user_cashback
  User cashback is held in the debit and credited back as a separate wallet row after success.

Incoming (credit):
  wallet = amount − user_charge − network_fee − himalpay
  User cashback is still credited as a separate row after success.

User charges come from Commission Setup (per-user, per-service).
Network fee comes from Commission Setup (per-dealer per-service, else the dealer default).
It is folded into "applicable charges" on the user side and posted as dealer commission.
HimalPay uses the leftover ServiceChargeConfig amount when a row exists so live provider
fees are not added on top of Commission cashback.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.db import transaction

from .app_config import get_app_config
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


CHARGE_FLAT = 'flat'
CHARGE_PERCENT = 'percent'


def _component(amount: Decimal, flat, percent) -> Decimal:
    total = money(flat)
    pct = _rate(percent)
    if amount > 0 and pct > 0:
        total += (amount * pct / Decimal('100')).quantize(_Q, rounding=ROUND_HALF_UP)
    return money(total)


def _typed_charge(amount: Decimal, charge_type, flat, percent) -> Decimal:
    if (charge_type or CHARGE_FLAT) == CHARGE_PERCENT:
        return _component(amount, 0, percent)
    return money(flat)


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


def service_catalog() -> list[dict[str, str]]:
    """Txn types the admin can configure independently (Commission Setup)."""
    return [
        {'txn_type': txn_type, 'label': TXN_TYPE_LABELS.get(txn_type, txn_type)}
        for txn_type in SERVICE_CHARGE_TXN_TYPES
    ]


def empty_quote(amount=0, *, direction='debit') -> dict:
    value = money(amount)
    return {
        'amount': value,
        'system_charge': _ZERO,
        'dealer_commission': _ZERO,
        'himalpay_charge': _ZERO,
        'total_charges': _ZERO,
        'cashback': _ZERO,
        'provider_cashback': _ZERO,
        'direction': direction,
        'wallet_amount': value,
        'dealer': None,
        'dealer_id': None,
        'txn_type': None,
        'visible_charge': _ZERO,
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


def _user_service_charge_flat(user, txn_type: str) -> Decimal:
    """Commission Setup per-user, per-service charge. 0 when unset."""
    if user is None or not txn_type:
        return _ZERO
    try:
        from ..models import UserServiceCharge
        row = UserServiceCharge.objects.filter(
            user_id=getattr(user, 'pk', None), txn_type=txn_type,
        ).first()
        if row is not None:
            return money(row.charge_flat)
    except Exception:
        logger.exception(
            'Could not load user service charge for %s / %s',
            getattr(user, 'pk', None), txn_type,
        )
    return _ZERO


def _dealer_override_flat(dealer, txn_type: str) -> Optional[Decimal]:
    """Per-service dealer flat Rs from ServiceCommissionRule. None means use the dealer default."""
    if dealer is None or not txn_type:
        return None
    try:
        from ..models import ServiceCommissionRule
        rule = ServiceCommissionRule.objects.filter(
            dealer_id=dealer.pk, txn_type=txn_type,
        ).first()
        if rule is not None:
            return money(rule.dealer_rate)
    except Exception:
        logger.exception('Could not load dealer service rule')
    return None


def _related_or_none(instance, name: str):
    """Forward/reverse OneToOne without treating a missing row as a hard failure.

    ``getattr(obj, 'related', None)`` still raises for a reverse OneToOne miss,
    which previously swallowed Commission Setup cashback as Rs 0.
    """
    if instance is None:
        return None
    try:
        return getattr(instance, name)
    except Exception:
        return None


def _dealer_commission_flat(dealer) -> Decimal:
    """Commission Setup default flat amount for this dealer. 0 means no default network fee."""
    if dealer is None:
        return _ZERO
    try:
        config = _related_or_none(dealer, 'dealer_commission_config')
        if config is None:
            from ..models import DealerCommissionConfig
            config = DealerCommissionConfig.objects.filter(user_id=dealer.pk).first()
        if config is not None:
            return money(config.commission_rate)
    except Exception:
        logger.exception('Could not load dealer commission config')
    return _ZERO


def _user_cashback_flat(user) -> Decimal:
    if user is None:
        return _ZERO
    try:
        fee = _related_or_none(user, 'fee_config')
        if fee is None:
            from ..models import UserFeeConfig
            fee = UserFeeConfig.objects.filter(user_id=user.pk).first()
        if fee is not None:
            return money(getattr(fee, 'cashback_flat', 0) or 0)
    except Exception:
        logger.exception('Could not load user cashback for %s', getattr(user, 'pk', None))
    return _ZERO


def _resolve_network_fee(amount: Decimal, txn_type: str, dealer, service_network_fee: Decimal) -> Decimal:
    """
    Extra amount charged to a dealer-network customer and earned by the dealer.

    Precedence: per-service Commission Setup amount (including explicit 0) →
    dealer default commission. Charge Setup is not used.
    """
    override = _dealer_override_flat(dealer, txn_type)
    if override is not None:
        return override
    setup_flat = _dealer_commission_flat(dealer)
    if setup_flat > 0:
        return setup_flat
    return money(service_network_fee)


def visible_user_extra(quote: dict) -> Decimal:
    """Amount shown to the user as applicable charges (total movement minus principal)."""
    principal = money(quote.get('amount', 0))
    wallet = money(quote.get('wallet_amount', 0))
    if quote.get('direction') == 'credit':
        extra = principal - wallet
        return extra if extra > 0 else _ZERO
    extra = wallet - principal
    return extra if extra > 0 else _ZERO


def visible_fee_extra(quote: dict) -> Decimal:
    """Applicable charges excluding the user-cashback hold, for receipts and previews."""
    extra = visible_user_extra(quote)
    if quote.get('direction') == 'credit':
        return extra
    held = money(quote.get('cashback', 0))
    if extra > held:
        return money(extra - held)
    return extra


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
    Calculate User service charge + network fee + HimalPay for a principal amount.

    User charge and network fee come from Commission Setup. ``cashback`` from the
    provider is unused when a ServiceChargeConfig row exists; Commission Setup
    cashback is the rebate held in debit and credited after success.

    direction:
      debit  — user pays amount + charges + cashback hold (transfer, bills, top-up)
      credit — user receives amount − charges (remittance receive)
    """
    principal = money(amount)
    direction = 'credit' if direction == 'credit' else 'debit'
    provider_cashback = money(cashback)
    provider = money(provider_charge)
    actor_is_dealer = user is not None and getattr(user, 'role', None) == ROLE_DEALER
    dealer = None if actor_is_dealer else resolve_assigned_dealer(user)
    if dealer is not None and getattr(dealer, 'role', None) != ROLE_DEALER:
        dealer = None

    user_fee = _user_service_charge_flat(user, txn_type)
    row = _load_service_config(txn_type)
    if row is not None:
        configured_himalpay = _component(
            principal, row.himalpay_charge_flat, row.himalpay_charge_percent,
        )
        # Keep leftover HimalPay config so live provider fees are not added on
        # top of Commission cashback (e.g. Rs 50 vs a provider Rs 5).
        himalpay = configured_himalpay
        provider_cashback = _ZERO
    else:
        himalpay = provider

    if actor_is_dealer:
        system = user_fee
        dealer_commission = _ZERO
        user_cashback = _ZERO
        dealer = None
    else:
        system = user_fee
        dealer_commission = _ZERO
        if dealer is not None:
            dealer_commission = _resolve_network_fee(
                principal, txn_type, dealer, _ZERO,
            )
        user_cashback = _user_cashback_flat(user)

    total_charges = money(system + dealer_commission + himalpay)
    if direction == 'debit':
        wallet_amount = money(principal + total_charges + user_cashback)
        if wallet_amount < 0:
            wallet_amount = _ZERO
    else:
        wallet_amount = money(principal - total_charges)
        if wallet_amount < 0:
            wallet_amount = _ZERO

    quote = {
        'amount': principal,
        'system_charge': system,
        'dealer_commission': dealer_commission,
        'himalpay_charge': himalpay,
        'total_charges': total_charges,
        'cashback': user_cashback,
        'provider_cashback': provider_cashback,
        'direction': direction,
        'wallet_amount': wallet_amount,
        'dealer': dealer,
        'dealer_id': getattr(dealer, 'pk', None),
        'txn_type': txn_type,
    }
    quote['visible_charge'] = visible_user_extra(quote)
    return quote


def quote_to_public(quote: dict) -> dict:
    """JSON-safe breakdown for calculate-charge / create responses.

    Dealer/network fee stays inside ``charge`` so the user never sees a
    separate dealer-commission line. ``charge`` excludes the cashback hold so
    the UI can show amount + HimalPay + other charges + cashback = total.
    HimalPay and the cashback hold are returned with their real amounts.
    ``cashback_credit`` is the same cashback amount, returned after success.
    """
    fee_extra = visible_fee_extra(quote)
    himalpay = money(quote.get('himalpay_charge', 0))
    user_cb = money(quote.get('cashback', 0))
    return {
        'amount': str(quote.get('amount', _ZERO)),
        'system_charge': str(fee_extra),
        'dealer_commission': '0.00',
        'himalpay_charge': str(himalpay),
        'charge': str(fee_extra),
        'total_charges': str(fee_extra),
        'cashback': str(user_cb),
        'cashback_credit': str(user_cb),
        'total_debited': str(quote['wallet_amount']) if quote.get('direction') != 'credit' else None,
        'total_credited': str(quote['wallet_amount']) if quote.get('direction') == 'credit' else None,
        'wallet_amount': str(quote.get('wallet_amount', _ZERO)),
        'direction': quote.get('direction') or 'debit',
        'dealer_id': None,
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
    txn.charge = visible_fee_extra(quote)
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
    txn.charge = visible_user_extra(quote)
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
    dealer_flat = money(commission.get('default_commission_rate', 0))

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
            'user_charge_type': CHARGE_PERCENT if system_percent > 0 and system_flat == 0 else CHARGE_FLAT,
            'system_charge_flat': str(system_flat),
            'system_charge_percent': str(system_percent),
            'dealer_charge_type': CHARGE_FLAT,
            'dealer_commission_flat': str(dealer_flat),
            'dealer_commission_percent': '0.0000',
            'himalpay_charge_flat': '0.00',
            'himalpay_charge_percent': '0.0000',
        })
    return rows
