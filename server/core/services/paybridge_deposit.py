"""
PayBridgeNP wallet deposit settlement.

Flow:
  1. Create Deposit(provider=paybridgenp, status=pending) with internal order ID.
  2. Prefer POST /v1/qr/fonepay (Direct-QR) so the Fonepay QR renders in-app.
     Fall back to POST /v1/checkout (hosted) when Direct-QR is unavailable.
  3. User pays via in-app QR (or hosted page fallback).
  4. Webhook payment.succeeded (signed) OR return/verify via GET session + GET payment.
  5. On success: status=approved → existing deposit signal credits wallet once.

Never credit from return-URL query params alone.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ..models import Deposit, Wallet
from .himalpay import HimalPayAPI
from .paybridgenp import (
    MIN_PAISA,
    PayBridgeError,
    PayBridgeNPAPI,
    append_query,
    default_backend_return_url,
    default_frontend_return_url,
    get_paybridgenp_credentials,
    is_paybridgenp_configured,
    verify_webhook_signature,
)
from .txn_status import debit_wallet_for_txn
from .wallet_guard import WalletFrozenError, WALLET_FROZEN_MESSAGE, assert_wallet_not_frozen

logger = logging.getLogger(__name__)

PROVIDER = Deposit.PROVIDER_PAYBRIDGENP

SETTLED = 'settled'
ALREADY_PROCESSED = 'already_processed'
PENDING_PAYMENT = 'pending_payment'
FAILED_PAYMENT = 'failed_payment'
AMOUNT_MISMATCH = 'amount_mismatch'
ORDER_MISMATCH = 'order_mismatch'

VERIFY_UNVERIFIED = Deposit.VERIFY_UNVERIFIED
VERIFY_VERIFIED = Deposit.VERIFY_VERIFIED
VERIFY_MISMATCH = Deposit.VERIFY_MISMATCH

MODE_DIRECT_QR = 'direct_qr'
MODE_HOSTED = 'hosted'


def new_order_id() -> str:
    return f'MS-PB-{uuid.uuid4().hex}'


def sanitize_provider_payload(payload) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    def _clean(value, depth=0):
        if depth > 6:
            return None
        if isinstance(value, dict):
            out = {}
            for key, item in value.items():
                lk = str(key).lower()
                if any(s in lk for s in ('secret', 'api_key', 'authorization', 'password', 'token')):
                    continue
                cleaned = _clean(item, depth + 1)
                if cleaned is not None:
                    out[str(key)] = cleaned
            return out
        if isinstance(value, list):
            return [_clean(item, depth + 1) for item in value[:50]]
        if isinstance(value, (str, int, float, bool)) or value is None:
            if isinstance(value, str) and len(value) > 2000:
                return value[:2000]
            return value
        return str(value)[:500]

    return _clean(payload) or {}


def public_deposit_dict(deposit: Deposit, *, include_qr: bool = False) -> Dict[str, Any]:
    payload = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
    qr = payload.get('qr') if isinstance(payload.get('qr'), dict) else {}
    mode = str(payload.get('mode') or '').strip()
    if not mode:
        mode = MODE_DIRECT_QR if qr else (MODE_HOSTED if deposit.payment_url else '')

    out: Dict[str, Any] = {
        'id': deposit.pk,
        'order_id': deposit.purchase_order_identifier or '',
        'orderId': deposit.purchase_order_identifier or '',
        'amount': str(deposit.amount),
        'currency': deposit.currency or 'NPR',
        'status': deposit.status,
        'status_display': deposit.get_status_display(),
        'provider': deposit.provider,
        'session_id': deposit.process_id or '',
        'payment_id': (deposit.transaction_id or '') if str(deposit.transaction_id or '').startswith('pay_') else '',
        'checkout_url': deposit.payment_url or '',
        'payment_url': deposit.payment_url or '',
        'mode': mode,
        'events_url': str(qr.get('events_url') or qr.get('eventsUrl') or '').strip(),
        'expires_at': deposit.expires_at.isoformat() if deposit.expires_at else None,
        'failure_reason': deposit.failure_reason or '',
        'verification_status': deposit.verification_status,
    }
    if include_qr:
        out['qr_image'] = str(qr.get('qr_image') or qr.get('qrImage') or '').strip()
        out['qr_message'] = str(qr.get('qr_message') or qr.get('qrMessage') or '').strip()
    return out


def _parse_expires_at(value):
    if not value:
        return None
    try:
        if hasattr(value, 'isoformat') and not isinstance(value, (str, bytes)):
            parsed = value
        else:
            parsed = parse_datetime(str(value))
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            return timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed
    except Exception:
        return None


def _customer_for(user) -> Dict[str, str]:
    name = ' '.join(
        part for part in (
            getattr(user, 'first_name', '') or '',
            getattr(user, 'last_name', '') or '',
        ) if part
    ).strip()
    phone = (getattr(user, 'phone', None) or '').strip()
    email = (getattr(user, 'email', None) or '').strip()
    if not name:
        name = f'MySewa {phone}' if phone else 'MySewa User'
    if not email:
        # Direct-QR requires email; synthesize a stable receipt address from phone.
        local = ''.join(ch for ch in phone if ch.isalnum()) or f'user{getattr(user, "pk", 0)}'
        email = f'{local}@users.mysewa.local'
    details: Dict[str, str] = {
        'name': name[:100],
        'email': email[:120],
    }
    if phone:
        details['phone'] = phone[:30]
    return details


def _reusable_pending(user, amount) -> Optional[Deposit]:
    """Reuse only unexpired Direct-QR sessions (never hosted — hosted cannot render in-app)."""
    now = timezone.now()
    qs = (
        Deposit.objects.filter(
            user=user,
            amount=amount,
            provider=PROVIDER,
            status__in=(Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING),
        )
        .order_by('-created_at')
    )
    for deposit in qs[:8]:
        if deposit.expires_at and deposit.expires_at <= now:
            continue
        payload = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
        mode = str(payload.get('mode') or '').strip()
        qr = payload.get('qr') if isinstance(payload.get('qr'), dict) else {}
        has_qr_payload = bool(
            qr.get('qr_message') or qr.get('qrMessage') or qr.get('has_image')
        )
        is_direct = mode == MODE_DIRECT_QR or (
            has_qr_payload and not (deposit.payment_url or '').strip()
        )
        if is_direct and (has_qr_payload or deposit.process_id):
            return deposit
    return None


def _qr_fields(session: Dict[str, Any]) -> Dict[str, str]:
    events_url = str(session.get('events_url') or session.get('eventsUrl') or '').strip()
    session_id = str(session.get('id') or '').strip()
    if not events_url and session_id:
        base = get_paybridgenp_credentials().get('base_url') or 'https://api.paybridgenp.com'
        events_url = f'{base.rstrip("/")}/v1/qr/{session_id}/events'
    return {
        'qr_image': str(session.get('qr_image') or session.get('qrImage') or '').strip(),
        'qr_message': str(session.get('qr_message') or session.get('qrMessage') or '').strip(),
        'events_url': events_url,
    }


def _store_qr_payload(session: Dict[str, Any], qr: Dict[str, str]) -> Dict[str, Any]:
    """Persist QR metadata without the large base64 image (returned to client only)."""
    return sanitize_provider_payload({
        'mode': MODE_DIRECT_QR,
        'qr': {
            'qr_message': qr.get('qr_message') or '',
            'events_url': qr.get('events_url') or '',
            'provider': 'fonepay',
            'has_image': bool(qr.get('qr_image')),
            'session': {
                key: session.get(key)
                for key in ('id', 'amount', 'currency', 'provider', 'status', 'expires_at', 'livemode')
                if key in session
            },
        },
    })


def _public_with_live_qr(deposit: Deposit, qr: Dict[str, str]) -> Dict[str, Any]:
    out = public_deposit_dict(deposit, include_qr=False)
    out['qr_image'] = qr.get('qr_image') or ''
    out['qr_message'] = qr.get('qr_message') or ''
    out['events_url'] = qr.get('events_url') or out.get('events_url') or ''
    out['mode'] = MODE_DIRECT_QR
    return out


def _is_direct_qr_unavailable(exc: PayBridgeError) -> bool:
    """True only when merchant plan/permission clearly blocks Direct-QR."""
    err_obj = ''
    if isinstance(exc.response_data, dict):
        nested = exc.response_data.get('error')
        if isinstance(nested, dict):
            err_obj = ' '.join(
                str(nested.get(k) or '') for k in ('message', 'code', 'type')
            )
        else:
            err_obj = str(nested or '')
    text = ' '.join(
        str(part or '')
        for part in (
            getattr(exc, 'message', ''),
            getattr(exc, 'provider_message', ''),
            getattr(exc, 'error_type', ''),
            err_obj,
        )
    ).lower()
    markers = (
        'pro plan',
        'upgrade',
        'direct-qr',
        'direct qr',
        'not available on your plan',
        'not included in your plan',
        'plan does not',
        'requires pro',
        'growth or higher',
        'insufficient_scope',
    )
    if any(m in text for m in markers):
        return True
    # Only treat 403 as plan-block when the body mentions plan/scope/QR.
    status = int(getattr(exc, 'status_code', 0) or 0)
    if status == 403 and any(m in text for m in ('plan', 'scope', 'qr', 'forbidden')):
        return True
    return False


def create_paybridge_deposit(
    user,
    amount,
    *,
    source: str = Deposit.SOURCE_APP,
    client_reference: str = '',
    initiated_by=None,
    allow_reuse: bool = True,
    metadata_extra: Optional[Dict[str, Any]] = None,
) -> Tuple[Deposit, Dict[str, Any]]:
    """
    Create pending Deposit and PayBridgeNP payment session.

    Prefers Direct-QR (in-app Fonepay QR). Falls back to hosted checkout URL
    when Direct-QR is unavailable for the merchant.

    Returns (deposit, public_payload) where public_payload includes qr_image /
    events_url for Direct-QR, or checkout_url for hosted fallback.
    Does not credit wallet.

    For API payin, pass source=Deposit.SOURCE_API, client_reference, initiated_by,
    and allow_reuse=False (idempotency is handled by the Payin API layer).
    """
    from .app_config import get_app_config, validate_amount_bounds

    if not is_paybridgenp_configured():
        raise PayBridgeError(
            'PayBridgeNP is not configured. Add the live API key under '
            'Admin → Settings → PayBridgeNP (or PAYBRIDGENP_API_KEY env).',
            status_code=503,
        )

    assert_wallet_not_frozen(user)

    amount = HimalPayAPI.normalize_rupees(amount)
    paisa = HimalPayAPI.to_paisa(amount)
    if paisa < MIN_PAISA:
        raise PayBridgeError('Minimum PayBridgeNP deposit is Rs. 10.00.', status_code=400)

    payment = get_app_config().get('payment') or {}
    err = validate_amount_bounds(
        amount,
        min_amount=payment.get('min_deposit', 100),
        max_amount=payment.get('max_deposit', 100000),
        label='Deposit',
    )
    if err:
        raise PayBridgeError(err, status_code=400)

    if allow_reuse and source != Deposit.SOURCE_API:
        existing = _reusable_pending(user, amount)
        if existing:
            try:
                return existing, refresh_paybridge_qr(existing)
            except Exception:
                logger.exception(
                    'Could not refresh reusable PayBridgeNP QR deposit=%s; creating a new session',
                    existing.pk,
                )
                # Mark the stale session expired so we do not keep reusing a QR-less hosted row.
                try:
                    existing.status = Deposit.STATUS_EXPIRED
                    existing.failure_reason = 'Superseded by a new PayBridgeNP QR session'
                    existing.save(update_fields=['status', 'failure_reason', 'updated_at'])
                except Exception:
                    pass

    order_id = new_order_id()
    client = PayBridgeNPAPI()
    customer = _customer_for(user)
    metadata = {
        'orderId': order_id,
        'userId': str(user.pk),
        'type': 'wallet_deposit',
        'source': source or Deposit.SOURCE_APP,
    }
    if client_reference:
        metadata['clientReference'] = str(client_reference)[:64]
    if initiated_by is not None and getattr(initiated_by, 'pk', None):
        metadata['apiUserId'] = str(initiated_by.pk)
    if metadata_extra:
        for key, value in metadata_extra.items():
            if value is None:
                continue
            metadata[str(key)] = str(value)[:120]

    note = 'PayBridgeNP Wallet Deposit'
    if source == Deposit.SOURCE_API and client_reference:
        note = f'API Payin:{client_reference}'[:255]

    deposit = Deposit.objects.create(
        user=user,
        amount=amount,
        currency='NPR',
        status=Deposit.STATUS_PENDING,
        provider=PROVIDER,
        purchase_order_identifier=order_id,
        bank_name='PayBridgeNP',
        note=note,
        verification_status=VERIFY_UNVERIFIED,
        deposit_date=timezone.localdate(),
        source=source or Deposit.SOURCE_APP,
        client_reference=(client_reference or '')[:64],
        initiated_by=initiated_by if getattr(initiated_by, 'pk', None) else None,
    )
    metadata['depositId'] = str(deposit.pk)

    session: Dict[str, Any]
    mode = MODE_DIRECT_QR
    try:
        session = client.create_fonepay_qr(
            amount_paisa=paisa,
            customer=customer,
            metadata=metadata,
            idempotency_key=f'qr-{order_id}',
        )
    except PayBridgeError as qr_exc:
        if not _is_direct_qr_unavailable(qr_exc):
            deposit.status = Deposit.STATUS_FAILED
            deposit.failure_reason = 'PayBridgeNP QR could not be created'
            deposit.save(update_fields=['status', 'failure_reason', 'updated_at'])
            raise
        logger.warning(
            'PayBridgeNP Direct-QR unavailable (%s); falling back to hosted checkout',
            getattr(qr_exc, 'message', qr_exc),
        )
        mode = MODE_HOSTED
        return_base = (client.configured_return_url or '').strip() or default_backend_return_url()
        return_url = append_query(return_base, order=order_id)
        cancel_url = append_query(return_base, order=order_id, status='cancelled')
        try:
            session = client.create_checkout(
                amount_paisa=paisa,
                return_url=return_url,
                cancel_url=cancel_url,
                metadata=metadata,
                description=f'MySewa Wallet Deposit #{deposit.pk}',
                customer=customer,
                idempotency_key=f'checkout-{order_id}',
            )
        except Exception:
            deposit.status = Deposit.STATUS_FAILED
            deposit.failure_reason = 'PayBridgeNP checkout could not be created'
            deposit.save(update_fields=['status', 'failure_reason', 'updated_at'])
            raise
    except Exception:
        deposit.status = Deposit.STATUS_FAILED
        deposit.failure_reason = 'PayBridgeNP QR could not be created'
        deposit.save(update_fields=['status', 'failure_reason', 'updated_at'])
        raise

    session_id = str(session.get('id') or '').strip()
    deposit.process_id = session_id or None
    deposit.expires_at = _parse_expires_at(session.get('expires_at') or session.get('expiresAt'))
    deposit.status = Deposit.STATUS_PROCESSING

    if mode == MODE_DIRECT_QR:
        qr = _qr_fields(session)
        deposit.payment_url = ''
        deposit.provider_payload = _store_qr_payload(session, qr)
        try:
            deposit.save(update_fields=[
                'process_id', 'payment_url', 'expires_at', 'status',
                'provider_payload', 'updated_at',
            ])
        except IntegrityError:
            other = Deposit.objects.filter(process_id=session_id).first()
            if other:
                return other, public_deposit_dict(other, include_qr=True)
            raise PayBridgeError('Could not save PayBridgeNP deposit.', status_code=502)
        return deposit, _public_with_live_qr(deposit, qr)

    checkout_url = str(session.get('checkout_url') or '').strip()
    deposit.payment_url = checkout_url
    deposit.provider_payload = sanitize_provider_payload({
        'mode': MODE_HOSTED,
        'checkout': session,
    })

    try:
        deposit.save(update_fields=[
            'process_id', 'payment_url', 'expires_at', 'status',
            'provider_payload', 'updated_at',
        ])
    except IntegrityError:
        other = Deposit.objects.filter(process_id=session_id).first()
        if other:
            return other, public_deposit_dict(other, include_qr=True)
        raise PayBridgeError('Could not save PayBridgeNP deposit.', status_code=502)

    return deposit, public_deposit_dict(deposit, include_qr=True)


def refresh_paybridge_qr(deposit: Deposit) -> Dict[str, Any]:
    """Refresh the Fonepay QR display window for an in-app Direct-QR deposit."""
    if deposit.provider != PROVIDER:
        raise PayBridgeError('Not a PayBridgeNP deposit', status_code=400)
    if deposit.status not in (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING):
        raise PayBridgeError('Deposit is no longer awaiting payment', status_code=400)

    payload = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
    mode = str(payload.get('mode') or '').strip()
    session_id = (deposit.process_id or '').strip()
    if mode == MODE_HOSTED or not session_id:
        raise PayBridgeError('This deposit has no refreshable in-app QR', status_code=400)

    client = PayBridgeNPAPI()
    session = client.refresh_fonepay_qr(session_id)
    qr = _qr_fields(session)
    deposit.expires_at = _parse_expires_at(session.get('expires_at') or session.get('expiresAt'))
    deposit.provider_payload = _store_qr_payload(session, qr)
    deposit.save(update_fields=['expires_at', 'provider_payload', 'updated_at'])
    return _public_with_live_qr(deposit, qr)


def _money(amount) -> Decimal:
    return HimalPayAPI.normalize_rupees(amount)


def _mark_approved(deposit: Deposit, verified: Decimal, payload: Dict) -> Deposit:
    deposit.status = Deposit.STATUS_APPROVED
    deposit.verification_status = VERIFY_VERIFIED
    deposit.verified_amount = verified
    deposit.provider_payload = sanitize_provider_payload(payload)
    deposit.failure_reason = ''
    deposit.completed_at = timezone.now()
    payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
    payment_id = str(
        payment.get('id')
        or payload.get('payment_id')
        or payload.get('paymentId')
        or ''
    ).strip()
    if payment_id:
        deposit.transaction_id = payment_id[:120]
    deposit.save(update_fields=[
        'status', 'verification_status', 'verified_amount', 'provider_payload',
        'failure_reason', 'completed_at', 'transaction_id', 'updated_at',
    ])
    return deposit


def _apply_failure(deposit: Deposit, status_value: str, reason: str, payload: Dict) -> Deposit:
    if deposit.status == Deposit.STATUS_APPROVED:
        return deposit
    deposit.status = status_value
    deposit.verification_status = VERIFY_UNVERIFIED
    deposit.failure_reason = (reason or '')[:500]
    deposit.provider_payload = sanitize_provider_payload(payload)
    deposit.completed_at = timezone.now()
    deposit.save(update_fields=[
        'status', 'verification_status', 'failure_reason',
        'provider_payload', 'completed_at', 'updated_at',
    ])
    return deposit


def settle_from_payment(deposit: Deposit, payment: Dict[str, Any]) -> Tuple[str, Deposit]:
    """
    Apply a PayBridgeNP payment object. Caller should hold select_for_update.
    Credits only via status=approved → deposit signal.
    """
    if deposit.provider != PROVIDER:
        return ORDER_MISMATCH, deposit

    if deposit.status == Deposit.STATUS_APPROVED:
        return ALREADY_PROCESSED, deposit

    if deposit.status == Deposit.STATUS_REFUNDED:
        return ALREADY_PROCESSED, deposit

    payment_status = str(payment.get('status') or '').strip().lower()
    payment_id = str(payment.get('id') or '').strip()
    currency = str(payment.get('currency') or 'NPR').strip().upper() or 'NPR'
    reported_paisa = payment.get('amount')
    try:
        reported_paisa = int(reported_paisa) if reported_paisa is not None else None
    except (TypeError, ValueError):
        reported_paisa = None

    meta = payment.get('metadata') if isinstance(payment.get('metadata'), dict) else {}
    reported_order = str(
        meta.get('orderId') or meta.get('order_id') or ''
    ).strip()
    expected_order = (deposit.purchase_order_identifier or '').strip()
    if reported_order and expected_order and reported_order != expected_order:
        deposit.verification_status = VERIFY_MISMATCH
        deposit.failure_reason = 'orderId mismatch'
        deposit.provider_payload = sanitize_provider_payload({'payment': payment})
        deposit.save(update_fields=[
            'verification_status', 'failure_reason', 'provider_payload', 'updated_at',
        ])
        return ORDER_MISMATCH, deposit

    if currency != 'NPR':
        deposit.verification_status = VERIFY_MISMATCH
        deposit.failure_reason = f'currency mismatch: {currency}'
        deposit.provider_payload = sanitize_provider_payload({'payment': payment})
        deposit.save(update_fields=[
            'verification_status', 'failure_reason', 'provider_payload', 'updated_at',
        ])
        return AMOUNT_MISMATCH, deposit

    expected_paisa = HimalPayAPI.to_paisa(deposit.amount)
    payload = {'payment': payment}

    if payment_status == 'success':
        if reported_paisa is None or reported_paisa != expected_paisa:
            deposit.status = Deposit.STATUS_FAILED
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

        if payment_id:
            # Idempotency: another deposit already credited with this payment id
            clash = (
                Deposit.objects.filter(provider=PROVIDER, transaction_id=payment_id)
                .exclude(pk=deposit.pk)
                .filter(status=Deposit.STATUS_APPROVED)
                .first()
            )
            if clash:
                return ALREADY_PROCESSED, deposit

        verified = HimalPayAPI.to_rupees(reported_paisa)
        _mark_approved(deposit, verified, payload)
        return SETTLED, deposit

    if payment_status == 'refunded':
        if deposit.status == Deposit.STATUS_APPROVED or deposit.balance_after is not None:
            amount = deposit.verified_amount or deposit.amount
            deposit.provider_payload = sanitize_provider_payload(payload)
            try:
                with transaction.atomic():
                    wallet = Wallet.objects.select_for_update().get(user=deposit.user)
                    debit_wallet_for_txn(wallet, deposit, _money(amount))
            except Exception:
                logger.exception('PayBridgeNP refund reverse failed deposit=%s', deposit.pk)
            deposit.status = Deposit.STATUS_REFUNDED
            deposit.failure_reason = 'PayBridgeNP reported payment refunded'
            deposit.completed_at = timezone.now()
            deposit.save(update_fields=[
                'status', 'failure_reason', 'provider_payload', 'completed_at', 'updated_at',
            ])
            return SETTLED, deposit
        _apply_failure(deposit, Deposit.STATUS_REFUNDED, 'refunded', payload)
        return FAILED_PAYMENT, deposit

    if payment_status in ('failed', 'cancelled'):
        status_map = {
            'failed': Deposit.STATUS_FAILED,
            'cancelled': Deposit.STATUS_CANCELLED,
        }
        reason = str(payment.get('failureReason') or payment.get('failure_reason') or payment_status)
        _apply_failure(deposit, status_map[payment_status], reason, payload)
        return FAILED_PAYMENT, deposit

    # pending / processing
    deposit.provider_payload = sanitize_provider_payload(payload)
    if payment_id and not (deposit.transaction_id or '').startswith('pay_'):
        deposit.transaction_id = payment_id[:120]
        deposit.save(update_fields=['provider_payload', 'transaction_id', 'status', 'updated_at'])
    else:
        deposit.status = Deposit.STATUS_PROCESSING
        deposit.save(update_fields=['provider_payload', 'status', 'updated_at'])
    return PENDING_PAYMENT, deposit


def verify_deposit(deposit: Deposit) -> Tuple[str, Deposit]:
    """Fetch session/payment from PayBridgeNP and settle. Idempotent."""
    if deposit.provider != PROVIDER:
        raise PayBridgeError('Not a PayBridgeNP deposit', status_code=400)

    client = PayBridgeNPAPI()
    session_id = (deposit.process_id or '').strip()
    payment_id = (deposit.transaction_id or '').strip()
    payment: Dict[str, Any] = {}

    if payment_id.startswith('pay_'):
        payment = client.get_payment(payment_id)
    elif session_id:
        session = client.get_session(session_id)
        session_status = str(session.get('status') or '').strip().lower()
        payment_id = str(session.get('paymentId') or session.get('payment_id') or '').strip()
        if payment_id:
            payment = client.get_payment(payment_id)
        else:
            # Map session-only terminal states
            if session_status == 'expired':
                with transaction.atomic():
                    locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
                    _apply_failure(locked, Deposit.STATUS_EXPIRED, 'expired', {'session': session})
                    return FAILED_PAYMENT, locked
            if session_status == 'cancelled':
                with transaction.atomic():
                    locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
                    # Keep open for retry per PayBridgeNP docs unless we want to mark cancelled
                    locked.provider_payload = sanitize_provider_payload({'session': session})
                    locked.save(update_fields=['provider_payload', 'updated_at'])
                    return PENDING_PAYMENT, locked
            if session_status == 'failed':
                with transaction.atomic():
                    locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
                    _apply_failure(locked, Deposit.STATUS_FAILED, 'failed', {'session': session})
                    return FAILED_PAYMENT, locked
            return PENDING_PAYMENT, deposit
    else:
        raise PayBridgeError('Deposit has no PayBridgeNP session id', status_code=400)

    try:
        with transaction.atomic():
            locked = Deposit.objects.select_for_update().select_related('user').get(pk=deposit.pk)
            outcome, locked = settle_from_payment(locked, payment)
            return outcome, locked
    except WalletFrozenError as exc:
        raise PayBridgeError(exc.message or WALLET_FROZEN_MESSAGE, status_code=403) from exc


def lookup_paybridge_deposit(
    *,
    order_id: str = '',
    session_id: str = '',
    payment_id: str = '',
    deposit_id: Optional[int] = None,
    user=None,
) -> Optional[Deposit]:
    qs = Deposit.objects.filter(provider=PROVIDER)
    if user is not None:
        qs = qs.filter(user=user)
    if deposit_id:
        found = qs.filter(pk=deposit_id).first()
        if found:
            return found
    payment_id = (payment_id or '').strip()
    if payment_id:
        found = qs.filter(transaction_id=payment_id).first()
        if found:
            return found
    session_id = (session_id or '').strip()
    if session_id:
        found = qs.filter(process_id=session_id).first()
        if found:
            return found
    order_id = (order_id or '').strip()
    if order_id:
        return qs.filter(purchase_order_identifier=order_id).first()
    return None


def handle_webhook_event(event: Dict[str, Any]) -> Tuple[str, Optional[Deposit]]:
    """
    Process a verified webhook event payload.
    Returns (outcome, deposit|None).
    """
    event_type = str(event.get('type') or '').strip()
    data = event.get('data') if isinstance(event.get('data'), dict) else {}

    if event_type == 'payment.succeeded':
        # Event type is the source of truth; payload may omit status.
        payment = dict(data)
        payment.setdefault('status', 'success')
        meta = payment.get('metadata') if isinstance(payment.get('metadata'), dict) else {}
        deposit = lookup_paybridge_deposit(
            order_id=str(meta.get('orderId') or meta.get('order_id') or ''),
            session_id=str(payment.get('session_id') or payment.get('checkoutSessionId') or ''),
            payment_id=str(payment.get('id') or ''),
            deposit_id=int(meta['depositId']) if str(meta.get('depositId') or '').isdigit() else None,
        )
        if deposit is None:
            logger.warning('PayBridgeNP webhook: deposit not found for %s', payment.get('id'))
            return ORDER_MISMATCH, None
        try:
            with transaction.atomic():
                locked = Deposit.objects.select_for_update().select_related('user').get(pk=deposit.pk)
                return settle_from_payment(locked, payment)
        except WalletFrozenError as exc:
            raise PayBridgeError(exc.message or WALLET_FROZEN_MESSAGE, status_code=403) from exc

    if event_type in ('payment.failed', 'payment.cancelled', 'payment.refunded'):
        meta = data.get('metadata') if isinstance(data.get('metadata'), dict) else {}
        deposit = lookup_paybridge_deposit(
            order_id=str(meta.get('orderId') or meta.get('order_id') or ''),
            session_id=str(data.get('session_id') or ''),
            payment_id=str(data.get('id') or ''),
            deposit_id=int(meta['depositId']) if str(meta.get('depositId') or '').isdigit() else None,
        )
        if deposit is None:
            return ORDER_MISMATCH, None

        # cancelled may fire without payment id — keep pending for retry
        if event_type == 'payment.cancelled' and not str(data.get('id') or '').startswith('pay_'):
            with transaction.atomic():
                locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
                if locked.status == Deposit.STATUS_APPROVED:
                    return ALREADY_PROCESSED, locked
                locked.provider_payload = sanitize_provider_payload({'event': event})
                locked.save(update_fields=['provider_payload', 'updated_at'])
                return PENDING_PAYMENT, locked

        if event_type == 'payment.failed':
            payment = dict(data)
            payment.setdefault('status', 'failed')
        elif event_type == 'payment.refunded':
            payment = dict(data)
            payment.setdefault('status', 'refunded')
        else:
            payment = dict(data)
            payment.setdefault('status', 'cancelled')

        with transaction.atomic():
            locked = Deposit.objects.select_for_update().select_related('user').get(pk=deposit.pk)
            return settle_from_payment(locked, payment)

    # Ignore other event types
    return PENDING_PAYMENT, None


def frontend_result_url(*, order: str = '', deposit_id: int = 0, error: str = '') -> str:
    base = default_frontend_return_url()
    params = {}
    if order:
        params['order'] = order
    if deposit_id:
        params['deposit'] = deposit_id
    if error:
        params['error'] = error
    return append_query(base, **params) if params else base


def process_raw_webhook(raw_body: str, signature_header: str) -> Tuple[str, Optional[Deposit]]:
    creds = get_paybridgenp_credentials()
    event = verify_webhook_signature(raw_body, signature_header, creds.get('webhook_secret') or '')
    return handle_webhook_event(event)
