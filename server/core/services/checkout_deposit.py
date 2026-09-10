"""
Himal Pay Checkout wallet deposit (payin) settlement.

Flow (from official Checkout docs):
  1. Backend calls checkout-initiate and stores a CheckoutSession (QR only).
     No Deposit / wallet transaction is created at this step.
  2. User pays this Checkout session in Himal Pay / N-Cash (payment_url).
     Himal Pay returns a web checkout URL, not a NepalPay/Fonepay merchant QR,
     so Fonepay / NepalPay / SmartQR bank scanners cannot complete it.
  3. Backend polls checkout-status (or return/webhook).
  4. Wallet Deposit is created and credited only when
     payment.status == "completed" AND amount / order id match.

Wallet credit reuses Deposit.status='approved' so the existing deposit
signal + credit_wallet_for_txn ledger path is unchanged.

Idempotency: select_for_update on the session (then deposit) row.
A second completed status check returns already_processed without a second credit.

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

from django.db import IntegrityError, transaction
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ..models import CheckoutSession, Deposit, Wallet
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

SESSION_AWAITING = CheckoutSession.STATUS_AWAITING
SESSION_SETTLED = CheckoutSession.STATUS_SETTLED
SESSION_FAILED = CheckoutSession.STATUS_FAILED
SESSION_CANCELLED = CheckoutSession.STATUS_CANCELLED
SESSION_EXPIRED = CheckoutSession.STATUS_EXPIRED

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

_SESSION_TERMINAL = {
    PAYMENT_STATUS_FAILED: SESSION_FAILED,
    PAYMENT_STATUS_CANCELLED: SESSION_CANCELLED,
    PAYMENT_STATUS_EXPIRED: SESSION_EXPIRED,
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


def public_checkout_details(record) -> Dict[str, str]:
    """Safe Himal Pay fields for the Deposit tab (no secrets or raw payload)."""
    payload = getattr(record, 'provider_payload', None)
    if not isinstance(payload, dict):
        payload = {}
    initialization = (
        payload.get('initialization') if isinstance(payload.get('initialization'), dict) else {}
    )
    payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
    inner = payload.get('payload') if isinstance(payload.get('payload'), dict) else {}
    merchant: Dict[str, Any] = {}
    for source in (payment, initialization, inner, payload):
        candidate = source.get('merchant') if isinstance(source, dict) else None
        if isinstance(candidate, dict) and (
            candidate.get('name') or candidate.get('mobile_no') or candidate.get('phone')
        ):
            merchant = candidate
            break
    product = ''
    for source in (initialization, inner, payload):
        if isinstance(source, dict):
            product = str(source.get('product_name') or '').strip()
            if product:
                break
    return {
        'provider': 'Himal Pay',
        'channel': 'Himal Pay / N-Cash',
        'product_name': product or PRODUCT_NAME,
        'merchant_name': str(merchant.get('name') or '').strip(),
        'merchant_phone': str(
            merchant.get('mobile_no') or merchant.get('phone') or ''
        ).strip(),
        'account_holder': str(merchant.get('name') or '').strip(),
        'ncash_id': str(
            merchant.get('mobile_no') or merchant.get('phone') or ''
        ).strip(),
        'currency': str(getattr(record, 'currency', None) or 'NPR'),
        # Checkout initiate returns payment_url only — never a NepalPay/EMV payload.
        'merchant_qr_available': False,
        'qr_kind': '',
        'payin_mode': 'ncash_wallet_checkout',
    }


def checkout_session_public_dict(session: CheckoutSession) -> Dict[str, Any]:
    """API shape for an unpaid Checkout QR session (not a wallet transaction)."""
    expires = session.expires_at
    return {
        'id': session.pk,
        'session_id': session.pk,
        'deposit_id': session.deposit_id,
        'amount': str(session.amount),
        'currency': session.currency or 'NPR',
        'status': session.status,
        'status_display': session.get_status_display(),
        'provider': PROVIDER_HIMALPAY_CHECKOUT,
        'purchase_order_identifier': session.purchase_order_identifier,
        'process_id': session.process_id,
        'payment_url': session.payment_url,
        'qr_payload': None,
        'merchant_qr_available': False,
        'expires_at': expires.isoformat() if expires else None,
        'checkout_details': public_checkout_details(session),
        'transaction_id': session.process_id or '',
        'failure_reason': session.failure_reason or '',
    }


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


def _parse_expires_at(expires_at):
    if not expires_at:
        return None
    try:
        if hasattr(expires_at, 'isoformat') and not isinstance(expires_at, (str, bytes)):
            parsed = expires_at
        else:
            parsed = parse_datetime(str(expires_at))
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            return timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed
    except Exception:
        return None


def _reusable_checkout_session(user, amount) -> Optional[CheckoutSession]:
    """Return an unexpired unpaid Checkout QR session for this user and amount."""
    now = timezone.now()
    qs = (
        CheckoutSession.objects.filter(
            user=user,
            amount=amount,
            status=SESSION_AWAITING,
            deposit__isnull=True,
        )
        .exclude(payment_url='')
        .order_by('-created_at')
    )
    for session in qs[:8]:
        if not (session.payment_url or '').strip():
            continue
        if session.expires_at and session.expires_at <= now:
            continue
        return session
    return None


def create_checkout_session(user, amount) -> Tuple[CheckoutSession, str]:
    """
    Call Himal Pay checkout-initiate and store a QR session.

    Does not create a Deposit or credit the wallet.
    Returns (session, payment_url).
    """
    from ..models import _ensure_checkout_session_table
    from .app_config import get_app_config, validate_amount_bounds

    _ensure_checkout_session_table()

    if not is_checkout_configured():
        raise HimalPayError(
            'Himal Pay Checkout is not configured. Add the Web Checkout API key '
            'from the N-Cash merchant portal (API Keys → Web Checkout) under '
            'Admin → Settings. Do not replace the existing HimalPay reseller key.',
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

    try:
        existing = _reusable_checkout_session(user, amount)
    except (OperationalError, ProgrammingError):
        _ensure_checkout_session_table()
        try:
            existing = _reusable_checkout_session(user, amount)
        except (OperationalError, ProgrammingError):
            existing = None
    if existing:
        if not public_checkout_details(existing).get('ncash_id'):
            existing = _enrich_session_from_status(existing, HimalPayCheckoutAPI())
        return existing, existing.payment_url

    order_id = new_purchase_order_identifier()
    return_url = build_return_url(order_id)
    client = HimalPayCheckoutAPI()
    raw = client.initiate_checkout(
        amount_rupees=amount,
        purchase_order_identifier=order_id,
        return_url=return_url,
        product_name=PRODUCT_NAME,
        customer_details=customer_details_for(user),
    )

    payload = raw.get('payload') if isinstance(raw.get('payload'), dict) else {}
    process_id = str(payload.get('process_id') or '').strip()
    payment_url = str(payload.get('payment_url') or '').strip()
    if not process_id or not payment_url:
        raise HimalPayError(
            'Himal Pay Checkout did not return a payment QR.',
            status_code=502,
            response_data=sanitize_provider_payload(raw),
        )

    try:
        session = CheckoutSession.objects.create(
            user=user,
            amount=amount,
            currency='NPR',
            status=SESSION_AWAITING,
            purchase_order_identifier=order_id,
            process_id=process_id,
            payment_url=payment_url,
            expires_at=_parse_expires_at(payload.get('expires_at')),
            provider_payload=sanitize_provider_payload(raw),
        )
    except IntegrityError:
        existing = (
            CheckoutSession.objects.filter(process_id=process_id).first()
            or CheckoutSession.objects.filter(purchase_order_identifier=order_id).first()
        )
        if existing and (existing.payment_url or '').strip():
            return existing, existing.payment_url
        raise HimalPayError('Could not save checkout session.', status_code=502)
    except (OperationalError, ProgrammingError) as exc:
        logger.exception('Checkout session table missing on save')
        _ensure_checkout_session_table()
        try:
            session = CheckoutSession.objects.create(
                user=user,
                amount=amount,
                currency='NPR',
                status=SESSION_AWAITING,
                purchase_order_identifier=order_id,
                process_id=process_id,
                payment_url=payment_url,
                expires_at=_parse_expires_at(payload.get('expires_at')),
                provider_payload=sanitize_provider_payload(raw),
            )
        except Exception as inner:
            raise HimalPayError(
                'Checkout is temporarily unavailable. Please try again.',
                status_code=503,
            ) from inner
    return _enrich_session_from_status(session, client), payment_url


def _enrich_session_from_status(session: CheckoutSession, client: HimalPayCheckoutAPI) -> CheckoutSession:
    """Attach checkout-status merchant/account fields so the Deposit tab can show them."""
    process_id = (session.process_id or '').strip()
    if not process_id:
        return session
    try:
        status_payload = client.checkout_status(process_id)
    except Exception as exc:
        logger.info('Checkout status after initiate skipped: %s', exc)
        return session
    merged = dict(session.provider_payload or {})
    merged.update(sanitize_provider_payload(status_payload))
    session.provider_payload = merged
    session.save(update_fields=['provider_payload', 'updated_at'])
    return session


def create_checkout_deposit(user, amount) -> Tuple[CheckoutSession, str]:
    """Backward-compatible alias: initiate a QR session, not a Deposit row."""
    return create_checkout_session(user, amount)


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


def _materialize_deposit(session: CheckoutSession) -> Deposit:
    """Create the wallet Deposit row for a verified Checkout payment."""
    if session.deposit_id:
        return session.deposit
    try:
        deposit = Deposit.objects.create(
            user=session.user,
            amount=session.amount,
            status=STATUS_PROCESSING,
            provider=PROVIDER_HIMALPAY_CHECKOUT,
            purchase_order_identifier=session.purchase_order_identifier,
            process_id=session.process_id or None,
            payment_url=session.payment_url,
            expires_at=session.expires_at,
            bank_name='Himal Pay',
            note='Himal Pay Checkout wallet deposit',
            verification_status=VERIFY_UNVERIFIED,
            currency=session.currency or 'NPR',
            transaction_id=session.process_id or '',
            provider_payload=session.provider_payload or {},
        )
    except IntegrityError:
        deposit = (
            Deposit.objects.filter(process_id=session.process_id).first()
            or Deposit.objects.filter(
                purchase_order_identifier=session.purchase_order_identifier,
            ).first()
        )
        if deposit is None:
            raise
    session.deposit = deposit
    session.save(update_fields=['deposit', 'updated_at'])
    return deposit


def _sync_session_from_deposit(session: CheckoutSession, deposit: Deposit) -> None:
    if deposit.status == STATUS_APPROVED:
        session.status = SESSION_SETTLED
    elif deposit.status == STATUS_CANCELLED:
        session.status = SESSION_CANCELLED
    elif deposit.status == STATUS_EXPIRED:
        session.status = SESSION_EXPIRED
    elif deposit.status in (STATUS_FAILED, STATUS_REJECTED, STATUS_REFUNDED):
        session.status = SESSION_FAILED
    session.deposit = deposit
    session.provider_payload = deposit.provider_payload or session.provider_payload
    session.failure_reason = (deposit.failure_reason or '')[:500]
    session.save(update_fields=[
        'status', 'deposit', 'provider_payload', 'failure_reason', 'updated_at',
    ])


def verify_checkout_session(
    session: CheckoutSession,
) -> Tuple[str, CheckoutSession, Optional[Deposit]]:
    """
    Call checkout-status for a QR session.

    Creates a Deposit and credits the wallet only after payment is completed
    and amount/order match. Failed or still-pending payments leave no Deposit.
    """
    process_id = (session.process_id or '').strip()
    if not process_id:
        raise HimalPayError('Checkout session has no process_id', status_code=400)

    if session.deposit_id:
        outcome, deposit = verify_deposit(session.deposit)
        _sync_session_from_deposit(session, deposit)
        session.refresh_from_db()
        return outcome, session, deposit

    client = HimalPayCheckoutAPI()
    payload = client.checkout_status(process_id)

    try:
        with transaction.atomic():
            locked = (
                CheckoutSession.objects.select_for_update()
                .select_related('user', 'deposit')
                .get(pk=session.pk)
            )
            if locked.deposit_id:
                dep = Deposit.objects.select_for_update().select_related('user').get(
                    pk=locked.deposit_id,
                )
                outcome, dep = settle_from_checkout_status(dep, payload)
                _sync_session_from_deposit(locked, dep)
                return outcome, locked, dep

            payment_status = payment_status_from_payload(payload)
            expected_order = (locked.purchase_order_identifier or '').strip()
            reported_order = order_id_from_payload(payload)
            locked.provider_payload = sanitize_provider_payload(payload)

            if reported_order and expected_order and reported_order != expected_order:
                locked.failure_reason = 'purchase_order_identifier mismatch'
                locked.save(update_fields=['provider_payload', 'failure_reason', 'updated_at'])
                return ORDER_MISMATCH, locked, None

            if payment_status == PAYMENT_STATUS_COMPLETED:
                expected_paisa = HimalPayAPI.to_paisa(locked.amount)
                reported_paisa = paisa_from_status_payload(payload)
                if reported_paisa is None or reported_paisa != expected_paisa:
                    locked.status = SESSION_FAILED
                    locked.failure_reason = (
                        f'Amount mismatch: expected {expected_paisa} paisa, '
                        f'provider reported {reported_paisa}'
                    )[:500]
                    locked.save(update_fields=[
                        'status', 'provider_payload', 'failure_reason', 'updated_at',
                    ])
                    return AMOUNT_MISMATCH, locked, None

                deposit = _materialize_deposit(locked)
                dep = Deposit.objects.select_for_update().select_related('user').get(pk=deposit.pk)
                outcome, dep = settle_from_checkout_status(dep, payload)
                _sync_session_from_deposit(locked, dep)
                return outcome, locked, dep

            if payment_status in _SESSION_TERMINAL:
                payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
                locked.status = _SESSION_TERMINAL[payment_status]
                locked.failure_reason = str(payment.get('message') or payment_status)[:500]
                locked.save(update_fields=[
                    'status', 'provider_payload', 'failure_reason', 'updated_at',
                ])
                return FAILED_PAYMENT, locked, None

            locked.failure_reason = ''
            locked.save(update_fields=['provider_payload', 'failure_reason', 'updated_at'])
            return PENDING_PAYMENT, locked, None
    except WalletFrozenError as exc:
        raise HimalPayError(exc.message or WALLET_FROZEN_MESSAGE, status_code=403) from exc


def lookup_checkout_session(
    *,
    process_id: str = '',
    purchase_order_identifier: str = '',
    session_id: Optional[int] = None,
    user=None,
) -> Optional[CheckoutSession]:
    qs = CheckoutSession.objects.select_related('user', 'deposit')
    if user is not None:
        qs = qs.filter(user=user)
    if session_id:
        found = qs.filter(pk=session_id).first()
        if found:
            return found
    process_id = (process_id or '').strip()
    purchase_order_identifier = (purchase_order_identifier or '').strip()
    if process_id:
        found = qs.filter(process_id=process_id).first()
        if found:
            return found
    if purchase_order_identifier:
        return qs.filter(purchase_order_identifier=purchase_order_identifier).first()
    return None


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


def _coerce_pk(value) -> Optional[int]:
    try:
        if value in (None, '', 0, '0'):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def resolve_checkout_intent(
    *,
    process_id: str = '',
    purchase_order_identifier: str = '',
    session_id=None,
    deposit_id=None,
    generic_id=None,
    user=None,
) -> Tuple[Optional[CheckoutSession], Optional[Deposit]]:
    """Find the QR session first, then a legacy Checkout Deposit row."""
    from ..models import _ensure_checkout_session_table

    _ensure_checkout_session_table()
    sid = _coerce_pk(session_id)
    did = _coerce_pk(deposit_id)
    gid = _coerce_pk(generic_id)

    session = lookup_checkout_session(
        process_id=process_id,
        purchase_order_identifier=purchase_order_identifier,
        session_id=sid,
        user=user,
    )
    if session is None and gid and sid is None:
        session = lookup_checkout_session(session_id=gid, user=user)

    if session is not None:
        return session, session.deposit

    deposit = lookup_checkout_deposit(
        process_id=process_id,
        purchase_order_identifier=purchase_order_identifier,
        deposit_id=did if did is not None else gid,
        user=user,
    )
    return None, deposit


def verify_checkout_intent(
    *,
    process_id: str = '',
    purchase_order_identifier: str = '',
    session_id=None,
    deposit_id=None,
    generic_id=None,
    user=None,
) -> Tuple[str, Optional[CheckoutSession], Optional[Deposit]]:
    session, deposit = resolve_checkout_intent(
        process_id=process_id,
        purchase_order_identifier=purchase_order_identifier,
        session_id=session_id,
        deposit_id=deposit_id,
        generic_id=generic_id,
        user=user,
    )
    if session is not None:
        outcome, session, deposit = verify_checkout_session(session)
        return outcome, session, deposit
    if deposit is not None:
        outcome, deposit = verify_deposit(deposit)
        return outcome, None, deposit
    raise LookupError('Checkout session not found')


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


def frontend_result_url(record, deposit: Optional[Deposit] = None) -> str:
    base = default_frontend_return_url()
    order = getattr(record, 'purchase_order_identifier', None) or ''
    params = {'order': order}
    session_id = getattr(record, 'pk', None)
    if isinstance(record, CheckoutSession) and session_id:
        params['session'] = str(session_id)
    deposit = deposit or (record if isinstance(record, Deposit) else getattr(record, 'deposit', None))
    if deposit is not None and getattr(deposit, 'pk', None):
        params['deposit'] = str(deposit.pk)
    return append_query(base, **params)
