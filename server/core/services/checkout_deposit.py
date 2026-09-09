"""
Himal Pay Checkout wallet deposit (payin) settlement.

Flow (from official Checkout docs):
  1. Backend creates a pending Deposit and calls checkout-initiate.
  2. User is redirected to payment_url (N-Cash payment page).
  3. User returns to return_url.
  4. Backend calls checkout-status and credits the wallet only when
     payment.status == "completed" AND amount / order id match.

Wallet credit reuses Deposit.status='approved' so the existing deposit
signal + credit_wallet_for_txn ledger path is unchanged.

Idempotency: select_for_update on the deposit row. A second completed
status check returns already_processed without a second credit.

The Checkout docs do not define a webhook body or signature. Optional
POST /api/deposit/checkout/webhook/ only extracts documented identifiers
(process_id, purchase_order_identifier) and then calls checkout-status.
Unsigned status/amount fields in any inbound body are ignored.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from django.db import transaction
from django.utils import timezone

from ..models import Deposit, Wallet
from .himalpay import HimalPayAPI, HimalPayError
from .himalpay_checkout import (
    CHECKOUT_MIN_PAISA,
    HimalPayCheckoutAPI,
    PAYMENT_STATUS_CANCELLED,
    PAYMENT_STATUS_COMPLETED,
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_REFUNDED,
    PAYMENT_STATUS_STARTED,
    PAYMENT_STATUS_UNKNOWN,
    append_query,
    default_frontend_return_url,
    default_merchant_return_url,
    is_checkout_configured,
    order_id_from_payload,
    paisa_from_status_payload,
    payment_status_from_payload,
)
from .txn_status import debit_wallet_for_txn
from .wallet_guard import WalletFrozenError, WALLET_FROZEN_MESSAGE, assert_wallet_not_frozen

logger = logging.getLogger(__name__)

PROVIDER_HIMALPAY_CHECKOUT = 'himalpay_checkout'
PRODUCT_NAME = 'MySewa Wallet Deposit'

# Internal Deposit.status values. SUCCESS maps to existing 'approved'
# so wallet credit still goes through the deposit approval signal path
# when we set approved; settlement here credits explicitly when needed.
STATUS_PENDING = 'pending'
STATUS_PROCESSING = 'processing'
STATUS_APPROVED = 'approved'
STATUS_REJECTED = 'rejected'
STATUS_FAILED = 'failed'
STATUS_CANCELLED = 'cancelled'
STATUS_EXPIRED = 'expired'
STATUS_REFUNDED = 'refunded'

VERIFY_UNVERIFIED = 'unverified'
VERIFY_VERIFIED = 'verified'
VERIFY_MISMATCH = 'mismatch'
VERIFY_FAILED = 'failed'

ALREADY_PROCESSED = 'already_processed'
SETTLED = 'settled'
PENDING_PAYMENT = 'pending_payment'
FAILED_PAYMENT = 'failed_payment'
AMOUNT_MISMATCH = 'amount_mismatch'
ORDER_MISMATCH = 'order_mismatch'

# Documented payment.status → internal Deposit.status (completed is handled separately).
_TERMINAL_FAILURE = {
    PAYMENT_STATUS_FAILED: STATUS_FAILED,
    PAYMENT_STATUS_CANCELLED: STATUS_CANCELLED,
    PAYMENT_STATUS_EXPIRED: STATUS_EXPIRED,
}

_SECRET_KEY_HINTS = (
    'api_key', 'secret', 'password', 'token', 'authorization', 'signature',
)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def sanitize_provider_payload(payload: Optional[Dict]) -> Dict[str, Any]:
    """Store checkout-status JSON without secret-looking keys."""
    if not isinstance(payload, dict):
        return {}

    def _clean(value):
        if isinstance(value, dict):
            out = {}
            for key, inner in value.items():
                lowered = str(key).lower()
                if any(hint in lowered for hint in _SECRET_KEY_HINTS):
                    continue
                out[key] = _clean(inner)
            return out
        if isinstance(value, list):
            return [_clean(item) for item in value]
        return value

    return _clean(payload)


def new_purchase_order_identifier() -> str:
    return f'MS-CHK-{uuid.uuid4().hex}'


def customer_details_for(user) -> Dict[str, str]:
    name = ' '.join(
        part for part in (
            getattr(user, 'first_name', '') or '',
            getattr(user, 'last_name', '') or '',
        ) if part
    ).strip()
    details: Dict[str, str] = {}
    if name:
        details['name'] = name[:120]
    email = (getattr(user, 'email', None) or '').strip()
    if email:
        details['email'] = email[:120]
    phone = (getattr(user, 'phone', None) or '').strip()
    if phone:
        details['phone'] = phone[:50]
    return details


def build_return_url(purchase_order_identifier: str) -> str:
    """return_url sent to HimalPay. Defaults to the backend verify-then-redirect view."""
    client = HimalPayCheckoutAPI()
    base = (client.configured_return_url or '').strip() or default_merchant_return_url()
    return append_query(base, order=purchase_order_identifier)


def _get_or_create_wallet(user) -> Wallet:
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def create_checkout_deposit(user, amount) -> Tuple[Deposit, str]:
    """
    Create a pending checkout deposit and initialize Himal Pay Checkout.

    Returns (deposit, payment_url).
    """
    from .app_config import get_app_config, validate_amount_bounds

    if not is_checkout_configured():
        raise HimalPayError(
            'Himal Pay Checkout is not configured. Add a Checkout API Key in Admin settings.',
            status_code=503,
        )

    amount = HimalPayAPI.normalize_rupees(amount)
    if HimalPayAPI.to_paisa(amount) < CHECKOUT_MIN_PAISA:
        raise HimalPayError('Minimum Himal Pay Checkout amount is Rs. 10.00.', status_code=400)

    payment = get_app_config().get('payment') or {}
    err = validate_amount_bounds(
        amount,
        min_amount=payment.get('min_deposit', 100),
        max_amount=payment.get('max_deposit', 100000),
        label='Deposit',
    )
    if err:
        raise HimalPayError(err, status_code=400)

    order_id = new_purchase_order_identifier()
    return_url = build_return_url(order_id)

    deposit = Deposit.objects.create(
        user=user,
        amount=amount,
        status=STATUS_PENDING,
        provider=PROVIDER_HIMALPAY_CHECKOUT,
        purchase_order_identifier=order_id,
        bank_name='Himal Pay',
        note='Himal Pay Checkout wallet deposit',
        verification_status=VERIFY_UNVERIFIED,
        currency='NPR',
    )

    client = HimalPayCheckoutAPI()
    try:
        raw = client.initiate_checkout(
            amount_rupees=amount,
            purchase_order_identifier=order_id,
            return_url=return_url,
            product_name=PRODUCT_NAME,
            customer_details=customer_details_for(user),
        )
    except HimalPayError as exc:
        deposit.status = STATUS_FAILED
        deposit.verification_status = VERIFY_FAILED
        deposit.failure_reason = str(exc.message or exc)[:500]
        deposit.provider_payload = sanitize_provider_payload(getattr(exc, 'response_data', None))
        deposit.save(update_fields=[
            'status', 'verification_status', 'failure_reason', 'provider_payload', 'updated_at',
        ])
        raise

    payload = raw.get('payload') if isinstance(raw.get('payload'), dict) else {}
    process_id = str(payload.get('process_id') or '').strip()
    payment_url = str(payload.get('payment_url') or '').strip()
    expires_at = payload.get('expires_at') or None

    deposit.process_id = process_id or None
    deposit.payment_url = payment_url
    deposit.transaction_id = process_id
    deposit.provider_payload = sanitize_provider_payload(raw)
    deposit.status = STATUS_PROCESSING
    if expires_at:
        from django.utils.dateparse import parse_datetime
        parsed = parse_datetime(str(expires_at)) if not hasattr(expires_at, 'isoformat') else expires_at
        deposit.expires_at = parsed
    deposit.save(update_fields=[
        'process_id', 'payment_url', 'transaction_id', 'provider_payload',
        'status', 'expires_at', 'updated_at',
    ])
    return deposit, payment_url


def _apply_failure(deposit: Deposit, status_value: str, reason: str, payload: Dict) -> Deposit:
    deposit.status = status_value
    deposit.verification_status = VERIFY_VERIFIED
    deposit.failure_reason = (reason or '')[:500]
    deposit.provider_payload = sanitize_provider_payload(payload)
    deposit.completed_at = timezone.now()
    deposit.save(update_fields=[
        'status', 'verification_status', 'failure_reason', 'provider_payload',
        'completed_at', 'updated_at',
    ])
    return deposit


def _mark_approved(deposit: Deposit, amount: Decimal, payload: Dict) -> None:
    """Flip to approved. Wallet credit happens in the existing Deposit signal."""
    if deposit.status == STATUS_APPROVED:
        return
    deposit.provider_payload = sanitize_provider_payload(payload)
    deposit.verified_amount = amount
    deposit.verification_status = VERIFY_VERIFIED
    deposit.completed_at = timezone.now()
    deposit.failure_reason = ''
    deposit.status = STATUS_APPROVED
    deposit.save()


def _reverse_credit(deposit: Deposit, amount: Decimal, payload: Dict) -> Deposit:
    wallet = _get_or_create_wallet(deposit.user)
    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
    assert_wallet_not_frozen(wallet)
    debit_wallet_for_txn(wallet, deposit, amount)
    deposit.status = STATUS_REFUNDED
    deposit.verification_status = VERIFY_VERIFIED
    deposit.failure_reason = 'Himal Pay reported payment.status=refunded'
    deposit.provider_payload = sanitize_provider_payload(payload)
    deposit.completed_at = timezone.now()
    deposit.save(update_fields=[
        'status', 'verification_status', 'failure_reason', 'provider_payload',
        'completed_at', 'balance_before', 'balance_after', 'updated_at',
    ])
    return deposit


def settle_from_checkout_status(deposit: Deposit, payload: Dict[str, Any]) -> Tuple[str, Deposit]:
    """
    Apply a checkout-status payload to a locked deposit.

    Caller must hold select_for_update on the deposit.
    """
    if deposit.provider != PROVIDER_HIMALPAY_CHECKOUT:
        return ORDER_MISMATCH, deposit

    if deposit.status == STATUS_APPROVED:
        payment_status = payment_status_from_payload(payload)
        if payment_status == PAYMENT_STATUS_REFUNDED:
            amount = deposit.verified_amount or deposit.amount
            deposit.provider_payload = sanitize_provider_payload(payload)
            _reverse_credit(deposit, _money(amount), payload)
            return SETTLED, deposit
        return ALREADY_PROCESSED, deposit

    if deposit.status in (STATUS_REFUNDED,):
        return ALREADY_PROCESSED, deposit

    payment_status = payment_status_from_payload(payload)
    expected_order = (deposit.purchase_order_identifier or '').strip()
    reported_order = order_id_from_payload(payload)
    if reported_order and expected_order and reported_order != expected_order:
        logger.warning(
            'Checkout order mismatch deposit=%s expected=%s reported=%s',
            deposit.pk, expected_order, reported_order,
        )
        deposit.verification_status = VERIFY_MISMATCH
        deposit.failure_reason = 'purchase_order_identifier mismatch'
        deposit.provider_payload = sanitize_provider_payload(payload)
        deposit.save(update_fields=[
            'verification_status', 'failure_reason', 'provider_payload', 'updated_at',
        ])
        return ORDER_MISMATCH, deposit

    expected_paisa = HimalPayAPI.to_paisa(deposit.amount)
    reported_paisa = paisa_from_status_payload(payload)

    if payment_status == PAYMENT_STATUS_COMPLETED:
        if reported_paisa is None or reported_paisa != expected_paisa:
            logger.warning(
                'Checkout amount mismatch deposit=%s expected_paisa=%s reported_paisa=%s',
                deposit.pk, expected_paisa, reported_paisa,
            )
            deposit.status = STATUS_FAILED
            deposit.verification_status = VERIFY_MISMATCH
            deposit.failure_reason = (
                f'Amount mismatch: expected {expected_paisa} paisa, '
                f'provider reported {reported_paisa}'
            )
            deposit.provider_payload = sanitize_provider_payload(payload)
            deposit.completed_at = timezone.now()
            deposit.save(update_fields=[
                'status', 'verification_status', 'failure_reason',
                'provider_payload', 'completed_at', 'updated_at',
            ])
            return AMOUNT_MISMATCH, deposit

        verified = HimalPayAPI.to_rupees(reported_paisa)
        _mark_approved(deposit, verified, payload)
        return SETTLED, deposit

    if payment_status in _TERMINAL_FAILURE:
        reason = ''
        payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
        reason = str(payment.get('message') or payment_status)
        _apply_failure(deposit, _TERMINAL_FAILURE[payment_status], reason, payload)
        return FAILED_PAYMENT, deposit

    # started / unknown / empty: keep pending, do not credit.
    deposit.provider_payload = sanitize_provider_payload(payload)
    update_fields = ['provider_payload', 'status', 'verification_status', 'updated_at']
    if payment_status == PAYMENT_STATUS_STARTED:
        deposit.status = STATUS_PROCESSING
    elif payment_status == PAYMENT_STATUS_UNKNOWN:
        payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
        deposit.failure_reason = str(payment.get('message') or 'payment status unknown')[:500]
        update_fields.append('failure_reason')
    deposit.verification_status = VERIFY_UNVERIFIED
    deposit.save(update_fields=update_fields)
    return PENDING_PAYMENT, deposit


def verify_deposit(deposit: Deposit) -> Tuple[str, Deposit]:
    """Call checkout-status and settle. Idempotent."""
    if deposit.provider != PROVIDER_HIMALPAY_CHECKOUT:
        raise HimalPayError('Not a Himal Pay Checkout deposit', status_code=400)
    process_id = (deposit.process_id or '').strip()
    if not process_id:
        raise HimalPayError('Checkout session has no process_id', status_code=400)

    client = HimalPayCheckoutAPI()
    payload = client.checkout_status(process_id)

    try:
        with transaction.atomic():
            locked = Deposit.objects.select_for_update().select_related('user').get(pk=deposit.pk)
            outcome, locked = settle_from_checkout_status(locked, payload)
            return outcome, locked
    except WalletFrozenError as exc:
        raise HimalPayError(exc.message or WALLET_FROZEN_MESSAGE, status_code=403) from exc


def lookup_checkout_deposit(
    *,
    process_id: str = '',
    purchase_order_identifier: str = '',
    deposit_id: Optional[int] = None,
    user=None,
) -> Optional[Deposit]:
    qs = Deposit.objects.filter(provider=PROVIDER_HIMALPAY_CHECKOUT)
    if user is not None:
        qs = qs.filter(user=user)
    if deposit_id:
        return qs.filter(pk=deposit_id).first()
    process_id = (process_id or '').strip()
    purchase_order_identifier = (purchase_order_identifier or '').strip()
    if process_id:
        found = qs.filter(process_id=process_id).first()
        if found:
            return found
    if purchase_order_identifier:
        return qs.filter(purchase_order_identifier=purchase_order_identifier).first()
    return None


def extract_documented_identifiers(body: Any) -> Dict[str, str]:
    """
    Pull only documented Checkout field names from an inbound body.

    Does not treat status, amount, or any other field as proof of payment.
    """
    found: Dict[str, str] = {}

    def _walk(value):
        if isinstance(value, dict):
            for key, inner in value.items():
                if key in ('process_id', 'purchase_order_identifier') and inner:
                    text = str(inner).strip()
                    if text and key not in found:
                        found[key] = text
                _walk(inner)
        elif isinstance(value, list):
            for item in value:
                _walk(item)

    if isinstance(body, dict):
        _walk(body)
    return found


def frontend_result_url(deposit: Deposit) -> str:
    base = default_frontend_return_url()
    order = deposit.purchase_order_identifier or ''
    return append_query(base, order=order, deposit=str(deposit.pk))
