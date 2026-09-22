"""
PayBridgeNP wallet deposit settlement.

Flow:
  1. Create Deposit(provider=paybridgenp, status=pending) with internal order ID.
  2. App: prefer POST /v1/qr/fonepay (Direct-QR); fall back to POST /v1/checkout.
     API Payin: always POST /v1/checkout (hosted) so games get a PayBridgeNP URL.
     Never uses HimalPay checkout.
  3. User pays via in-app QR (app) or PayBridgeNP hosted page (API / hosted fallback).
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
    customer = payload.get('customer') if isinstance(payload.get('customer'), dict) else {}
    if customer:
        cleaned_customer = {
            key: str(customer.get(key) or '').strip()
            for key in ('name', 'email', 'phone')
            if str(customer.get(key) or '').strip()
        }
        if cleaned_customer:
            out['customer'] = cleaned_customer
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


def _customer_for(user, overrides: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """
    Build PayBridgeNP customer object from the receiver user.

    Optional overrides (name/email/phone) let API Payin partners control the
    checkout display without changing the wallet credit target.

    Fallbacks (MySewa-prefixed name / synthesized email) run only after
    overrides are applied, so a partner-supplied phone/name is not mixed with
    stale receiver-derived placeholders.
    """
    name = ' '.join(
        part for part in (
            getattr(user, 'first_name', '') or '',
            getattr(user, 'last_name', '') or '',
        ) if part
    ).strip()
    phone = (getattr(user, 'phone', None) or '').strip()
    email = (getattr(user, 'email', None) or '').strip()

    if overrides and isinstance(overrides, dict):
        for key in ('name', 'email', 'phone'):
            value = str(overrides.get(key) or '').strip()
            if not value:
                continue
            if key == 'name':
                name = value[:100]
            elif key == 'email':
                email = value[:120]
            else:
                phone = value[:30]

    if not name:
        name = f'MySewa {phone}' if phone else 'MySewa User'
    if not email:
        # Direct-QR requires email; synthesize a stable receipt address from the
        # final phone (override when present, otherwise receiver).
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
        payment_url = (deposit.payment_url or '').strip()
        is_direct = mode == MODE_DIRECT_QR or (
            has_qr_payload
            and (
                not payment_url
                or '/api/deposit/paybridge/qr/' in payment_url
            )
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


def _store_qr_payload(
    session: Dict[str, Any],
    qr: Dict[str, str],
    *,
    customer: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Persist QR metadata without the large base64 image (returned to client only)."""
    data: Dict[str, Any] = {
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
    }
    if customer:
        cleaned = {
            key: str(customer.get(key) or '').strip()[:120]
            for key in ('name', 'email', 'phone')
            if str(customer.get(key) or '').strip()
        }
        if cleaned:
            data['customer'] = cleaned
    return sanitize_provider_payload(data)


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


def _is_himalpay_url(url: str) -> bool:
    text = (url or '').strip().lower()
    return 'himalpay' in text or 'ncash' in text


def _assert_paybridge_checkout_url(url: str) -> str:
    """Ensure API/app never returns a HimalPay checkout URL from PayBridge flow."""
    checkout_url = (url or '').strip()
    if not checkout_url:
        raise PayBridgeError(
            'PayBridgeNP did not return a checkout URL.',
            status_code=502,
        )
    if _is_himalpay_url(checkout_url):
        raise PayBridgeError(
            'Refusing HimalPay checkout URL — Payin must use PayBridgeNP only.',
            status_code=502,
        )
    return checkout_url


def _create_hosted_checkout_session(
    client: PayBridgeNPAPI,
    *,
    deposit: Deposit,
    paisa: int,
    order_id: str,
    metadata: Dict[str, Any],
    customer: Dict[str, str],
    provider: str = '',
    flow: str = 'hosted',
) -> Dict[str, Any]:
    """
    Create hosted/redirect checkout.

    Defaults to flow=hosted (PayBridge method picker). Pass flow=redirect with
    a provider (e.g. fonepay) to skip the picker and open that provider.
    """
    return_base = (client.configured_return_url or '').strip() or default_backend_return_url()
    return_url = append_query(return_base, order=order_id)
    cancel_url = append_query(return_base, order=order_id, status='cancelled')
    return client.create_checkout(
        amount_paisa=paisa,
        return_url=return_url,
        cancel_url=cancel_url,
        metadata=metadata,
        description=f'MySewa Wallet Deposit #{deposit.pk}',
        customer=customer,
        idempotency_key=f'checkout-{order_id}',
        provider=provider,
        flow=flow,
    )


def create_paybridge_deposit(
    user,
    amount,
    *,
    source: str = Deposit.SOURCE_APP,
    client_reference: str = '',
    initiated_by=None,
    allow_reuse: bool = True,
    metadata_extra: Optional[Dict[str, Any]] = None,
    prefer_hosted: bool = False,
    partner_return_url: str = '',
    customer_override: Optional[Dict[str, str]] = None,
    checkout_provider: str = '',
    checkout_flow: str = 'hosted',
) -> Tuple[Deposit, Dict[str, Any]]:
    """
    Create pending Deposit and PayBridgeNP payment session.

    API Payin defaults to hosted checkout (prefer_hosted=True): returns
    PayBridge checkout_url with the method picker. Pass prefer_hosted=False for
    in-app Direct-QR (qr_image). Optional customer_override controls PayBridge
    display fields only; wallet credit still goes to ``user``.

    Does not credit wallet. Never uses HimalPay checkout.
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

    # Hosted when requested. API callers that want Direct-QR pass prefer_hosted=False.
    use_hosted = bool(prefer_hosted)

    if allow_reuse and source != Deposit.SOURCE_API and not use_hosted:
        existing = _reusable_pending(user, amount)
        if existing:
            try:
                return existing, refresh_paybridge_qr(existing)
            except Exception:
                logger.exception(
                    'Could not refresh reusable PayBridgeNP QR deposit=%s; creating a new session',
                    existing.pk,
                )
                try:
                    existing.status = Deposit.STATUS_EXPIRED
                    existing.failure_reason = 'Superseded by a new PayBridgeNP QR session'
                    existing.save(update_fields=['status', 'failure_reason', 'updated_at'])
                except Exception:
                    pass

    order_id = new_order_id()
    client = PayBridgeNPAPI()
    customer = _customer_for(user, customer_override)
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
    mode = MODE_HOSTED if use_hosted else MODE_DIRECT_QR

    if use_hosted:
        try:
            session = _create_hosted_checkout_session(
                client,
                deposit=deposit,
                paisa=paisa,
                order_id=order_id,
                metadata=metadata,
                customer=customer,
                provider=checkout_provider,
                flow=checkout_flow,
            )
        except Exception:
            deposit.status = Deposit.STATUS_FAILED
            deposit.failure_reason = 'PayBridgeNP checkout could not be created'
            deposit.save(update_fields=['status', 'failure_reason', 'updated_at'])
            raise
    else:
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
            try:
                session = _create_hosted_checkout_session(
                    client,
                    deposit=deposit,
                    paisa=paisa,
                    order_id=order_id,
                    metadata=metadata,
                    customer=customer,
                    provider=checkout_provider,
                    flow=checkout_flow,
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
        # In-app Direct-QR: no hosted checkout URL (games renders qr_image).
        deposit.payment_url = ''
        qr_payload = _store_qr_payload(session, qr, customer=customer)
        partner = (partner_return_url or '').strip()
        if partner:
            qr_payload['partner_return_url'] = partner[:500]
        deposit.provider_payload = qr_payload
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

    checkout_url = _assert_paybridge_checkout_url(str(session.get('checkout_url') or ''))
    deposit.payment_url = checkout_url
    hosted_payload: Dict[str, Any] = {
        'mode': MODE_HOSTED,
        'checkout': session,
        'checkout_provider': str(session.get('provider') or checkout_provider or '').strip(),
        'checkout_flow': str(session.get('flow') or checkout_flow or '').strip(),
        'customer': {
            key: str(customer.get(key) or '').strip()[:120]
            for key in ('name', 'email', 'phone')
            if str(customer.get(key) or '').strip()
        },
    }
    partner = (partner_return_url or '').strip()
    if partner:
        hosted_payload['partner_return_url'] = partner[:500]
    deposit.provider_payload = sanitize_provider_payload(hosted_payload)

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
    existing_customer = payload.get('customer') if isinstance(payload.get('customer'), dict) else None
    deposit.provider_payload = _store_qr_payload(session, qr, customer=existing_customer)
    # Preserve partner return URL across QR refresh.
    if str(payload.get('partner_return_url') or '').strip():
        merged = dict(deposit.provider_payload or {})
        merged['partner_return_url'] = str(payload.get('partner_return_url')).strip()[:500]
        deposit.provider_payload = merged
    deposit.save(update_fields=['expires_at', 'provider_payload', 'updated_at'])
    return _public_with_live_qr(deposit, qr)


def _money(amount) -> Decimal:
    return HimalPayAPI.normalize_rupees(amount)


def _mark_approved(deposit: Deposit, verified: Decimal, payload: Dict) -> Deposit:
    deposit.status = Deposit.STATUS_APPROVED
    deposit.verification_status = VERIFY_VERIFIED
    deposit.verified_amount = verified
    deposit.provider_payload = _merge_partner_return_url(deposit, payload)
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


def verify_deposit(
    deposit: Deposit,
    *,
    payment_id: str = '',
    session_id: str = '',
) -> Tuple[str, Deposit]:
    """
    Fetch session/payment from PayBridgeNP and settle. Idempotent.

    Optional payment_id / session_id overrides come from the customer return_url
    query string (PayBridgeNP appends them). Prefer those over stale deposit fields
    so return-path settle works before the signed webhook arrives.
    """
    if deposit.provider != PROVIDER:
        raise PayBridgeError('Not a PayBridgeNP deposit', status_code=400)

    client = PayBridgeNPAPI()
    override_payment = (payment_id or '').strip()
    override_session = (session_id or '').strip()
    stored_payment = (deposit.transaction_id or '').strip()
    stored_session = (deposit.process_id or '').strip()

    # Prefer return-URL payment id, then stored pay_*, then session lookup.
    resolved_payment = ''
    if override_payment.startswith('pay_'):
        resolved_payment = override_payment
    elif stored_payment.startswith('pay_'):
        resolved_payment = stored_payment

    resolved_session = override_session or stored_session
    payment: Dict[str, Any] = {}

    if resolved_payment.startswith('pay_'):
        payment = client.get_payment(resolved_payment)
    elif resolved_session:
        session = client.get_session(resolved_session)
        session_status = str(session.get('status') or '').strip().lower()
        resolved_payment = str(session.get('paymentId') or session.get('payment_id') or '').strip()
        if resolved_payment:
            payment = client.get_payment(resolved_payment)
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
            # Already credited (e.g. webhook beat return) — still surface for notify/redirect.
            if deposit.status == Deposit.STATUS_APPROVED:
                from .api_payin_webhook import notify_developer_after_settle
                notify_developer_after_settle(ALREADY_PROCESSED, deposit)
                return ALREADY_PROCESSED, deposit
            return PENDING_PAYMENT, deposit
    else:
        raise PayBridgeError('Deposit has no PayBridgeNP session id', status_code=400)

    try:
        with transaction.atomic():
            locked = Deposit.objects.select_for_update().select_related(
                'user', 'initiated_by',
            ).get(pk=deposit.pk)
            outcome, locked = settle_from_payment(locked, payment)
        from .api_payin_webhook import notify_developer_after_settle
        notify_developer_after_settle(outcome, locked)
        return outcome, locked
    except WalletFrozenError as exc:
        raise PayBridgeError(exc.message or WALLET_FROZEN_MESSAGE, status_code=403) from exc


def developer_payin_browser_return_url(deposit: Deposit) -> str:
    """
    Optional player browser redirect after verified API Payin.

    Never uses api_webhook_url (that is server-to-server POST only). Prefer:
      1. partner_return_url stored on the deposit (from payin request return_url)
      2. API user's api_return_url (game/app page configured in Admin)
    """
    if deposit is None or deposit.source != Deposit.SOURCE_API:
        return ''
    if deposit.status != Deposit.STATUS_APPROVED:
        return ''

    payload = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
    base = str(payload.get('partner_return_url') or '').strip()

    if not base:
        developer = getattr(deposit, 'initiated_by', None)
        if developer is None and getattr(deposit, 'initiated_by_id', None):
            try:
                deposit = (
                    Deposit.objects.select_related('initiated_by', 'user')
                    .filter(pk=deposit.pk)
                    .first()
                ) or deposit
                developer = getattr(deposit, 'initiated_by', None)
            except Exception:
                developer = None
        if developer is not None:
            base = str(getattr(developer, 'api_return_url', '') or '').strip()

    if not base:
        return ''

    # Never send the browser to the webhook API endpoint.
    webhook = ''
    developer = getattr(deposit, 'initiated_by', None)
    if developer is not None:
        webhook = str(getattr(developer, 'api_webhook_url', '') or '').strip()
    if webhook and base.rstrip('/') == webhook.rstrip('/'):
        return ''

    payment_id = (
        (deposit.transaction_id or '')
        if str(deposit.transaction_id or '').startswith('pay_')
        else ''
    )
    amount = deposit.amount
    amount_out = (
        int(amount) if isinstance(amount, Decimal) and amount == amount.to_integral_value()
        else str(amount or '')
    )
    return append_query(
        base,
        event='payin.succeeded',
        success='true',
        status='SUCCESS',
        transaction_id=deposit.purchase_order_identifier or str(deposit.pk),
        order_id=deposit.purchase_order_identifier or '',
        reference=deposit.client_reference or '',
        deposit_id=str(deposit.pk),
        payment_id=payment_id,
        session_id=deposit.process_id or '',
        amount=str(amount_out),
        currency=deposit.currency or 'NPR',
    )


def _merge_partner_return_url(deposit: Deposit, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Keep partner_return_url and customer snapshot across provider_payload rewrites on settle."""
    cleaned = sanitize_provider_payload(payload)
    if not isinstance(cleaned, dict):
        cleaned = {}
    existing = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
    partner = str(
        existing.get('partner_return_url') or cleaned.get('partner_return_url') or ''
    ).strip()
    if partner:
        cleaned['partner_return_url'] = partner[:500]
    existing_customer = existing.get('customer') if isinstance(existing.get('customer'), dict) else {}
    if existing_customer and 'customer' not in cleaned:
        cleaned['customer'] = {
            key: str(existing_customer.get(key) or '').strip()[:120]
            for key in ('name', 'email', 'phone')
            if str(existing_customer.get(key) or '').strip()
        }
    return cleaned


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
                locked = Deposit.objects.select_for_update().select_related(
                    'user', 'initiated_by',
                ).get(pk=deposit.pk)
                outcome, locked = settle_from_payment(locked, payment)
            from .api_payin_webhook import notify_developer_after_settle
            notify_developer_after_settle(outcome, locked)
            return outcome, locked
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


def api_payin_public_return_response(
    deposit: Optional[Deposit] = None,
    *,
    error: str = '',
    refresh_url: str = '',
):
    """
    Public HTML result for Payin API (e.g. Lucky777) return from PayBridgeNP.

    Does not require MySewa login. App deposits continue to use frontend_result_url.
    """
    from django.http import HttpResponse
    from django.utils.html import escape

    if deposit is not None:
        try:
            deposit.refresh_from_db()
        except Exception:
            pass

    status_value = ''
    amount = ''
    order_id = ''
    reference = ''
    if deposit is not None:
        status_value = str(deposit.status or '')
        amount = str(deposit.amount or '')
        order_id = str(deposit.purchase_order_identifier or '')
        reference = str(deposit.client_reference or '')

    if error == 'not_found' or deposit is None:
        headline = 'Payment not found'
        detail = 'This payment session could not be found. You can return to the game and check status there.'
        tone = '#b45309'
        auto_refresh = False
    elif status_value == Deposit.STATUS_APPROVED:
        headline = 'Payment Successful'
        detail = (
            'Your payment was verified and the MySewa wallet was credited. '
            'You can return to Lucky777 / your game — no MySewa login is required.'
        )
        tone = '#15803d'
        auto_refresh = False
    elif status_value in (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING):
        headline = 'Payment pending'
        detail = 'We are confirming your payment. This page will refresh automatically.'
        tone = '#a16207'
        auto_refresh = True
    elif status_value in (
        Deposit.STATUS_FAILED,
        Deposit.STATUS_CANCELLED,
        Deposit.STATUS_EXPIRED,
        Deposit.STATUS_REJECTED,
        Deposit.STATUS_REFUNDED,
    ):
        headline = 'Payment not completed'
        reason = str(getattr(deposit, 'failure_reason', '') or '').strip()
        detail = reason or 'The payment was not successful. You can return to the game and try again.'
        tone = '#b91c1c'
        auto_refresh = False
    else:
        headline = 'Payment status'
        detail = 'Return to the game to see the latest status.'
        tone = '#334155'
        auto_refresh = False

    refresh_meta = (
        f'<meta http-equiv="refresh" content="4;url={escape(refresh_url)}">'
        if auto_refresh and refresh_url
        else ''
    )
    rows = []
    if amount:
        rows.append(f'<p><span>Amount</span><strong>NPR {escape(amount)}</strong></p>')
    if order_id:
        rows.append(f'<p><span>Order</span><strong>{escape(order_id)}</strong></p>')
    if reference:
        rows.append(f'<p><span>Reference</span><strong>{escape(reference)}</strong></p>')
    if status_value:
        rows.append(f'<p><span>Status</span><strong>{escape(status_value)}</strong></p>')
    details_html = '\n'.join(rows)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{escape(headline)} — MySewa Payin</title>
  {refresh_meta}
  <style>
    body {{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background:#f8fafc; color:#0f172a; }}
    .wrap {{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }}
    .card {{ width:100%; max-width:420px; background:#fff; border:1px solid #e2e8f0;
      border-radius:16px; padding:28px 24px; box-shadow:0 8px 24px rgba(15,23,42,.06); }}
    h1 {{ margin:0 0 8px; font-size:1.35rem; color:{tone}; }}
    .lead {{ margin:0 0 18px; color:#475569; line-height:1.45; font-size:.95rem; }}
    .meta p {{ display:flex; justify-content:space-between; gap:12px; margin:0;
      padding:10px 0; border-top:1px solid #f1f5f9; font-size:.9rem; }}
    .meta span {{ color:#64748b; }}
    .meta strong {{ text-align:right; word-break:break-all; }}
    .hint {{ margin:18px 0 0; font-size:.8rem; color:#94a3b8; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>{escape(headline)}</h1>
      <p class="lead">{escape(detail)}</p>
      <div class="meta">{details_html}</div>
      <p class="hint">You can close this page and return to the game.</p>
    </div>
  </div>
</body>
</html>"""
    return HttpResponse(html, content_type='text/html; charset=utf-8')


def api_payin_qr_page_response(
    deposit: Optional[Deposit] = None,
    *,
    error: str = '',
    qr_image: str = '',
    qr_message: str = '',
    refresh_url: str = '',
):
    """
    Public HTML page that shows the live Fonepay Direct-QR immediately.

    Used as deposit.payment_url / checkout_url for API Payin so games never
    land on PayBridge's method-picker page.
    """
    from django.http import HttpResponse
    from django.utils.html import escape

    if deposit is not None:
        try:
            deposit.refresh_from_db()
        except Exception:
            pass

    status_value = str(deposit.status or '') if deposit is not None else ''
    amount = str(deposit.amount or '') if deposit is not None else ''
    order_id = str(deposit.purchase_order_identifier or '') if deposit is not None else ''
    reference = str(deposit.client_reference or '') if deposit is not None else ''

    if error == 'not_found' or deposit is None:
        headline = 'Payment not found'
        detail = 'This payment session could not be found.'
        tone = '#b45309'
        auto_refresh = False
        show_qr = False
    elif status_value == Deposit.STATUS_APPROVED:
        headline = 'Payment Successful'
        detail = 'Your payment was verified and the wallet was credited.'
        tone = '#15803d'
        auto_refresh = False
        show_qr = False
    elif status_value in (
        Deposit.STATUS_FAILED,
        Deposit.STATUS_CANCELLED,
        Deposit.STATUS_EXPIRED,
        Deposit.STATUS_REJECTED,
        Deposit.STATUS_REFUNDED,
    ):
        headline = 'Payment not completed'
        reason = str(getattr(deposit, 'failure_reason', '') or '').strip()
        detail = reason or 'The payment was not successful. You can try again from the game.'
        tone = '#b91c1c'
        auto_refresh = False
        show_qr = False
    else:
        headline = 'Scan to pay'
        detail = 'Scan this Fonepay QR with any supported banking app. The page refreshes automatically.'
        tone = '#0f172a'
        auto_refresh = True
        show_qr = True

    if show_qr and not (qr_image or qr_message):
        headline = 'Preparing QR…'
        detail = 'Generating your Fonepay QR. This page will refresh automatically.'
        tone = '#a16207'

    refresh_meta = (
        f'<meta http-equiv="refresh" content="4;url={escape(refresh_url)}">'
        if auto_refresh and refresh_url
        else ''
    )

    qr_block = ''
    if show_qr and qr_image:
        safe_src = escape(qr_image)
        qr_block = f'<div class="qr"><img src="{safe_src}" alt="Fonepay QR"/></div>'
    elif show_qr and qr_message:
        qr_block = f'<pre class="qr-msg">{escape(qr_message)}</pre>'

    rows = []
    if amount:
        rows.append(f'<p><span>Amount</span><strong>NPR {escape(amount)}</strong></p>')
    if order_id:
        rows.append(f'<p><span>Order</span><strong>{escape(order_id)}</strong></p>')
    if reference:
        rows.append(f'<p><span>Reference</span><strong>{escape(reference)}</strong></p>')
    if status_value:
        rows.append(f'<p><span>Status</span><strong>{escape(status_value)}</strong></p>')
    details_html = '\n'.join(rows)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{escape(headline)} — MySewa Payin</title>
  {refresh_meta}
  <style>
    body {{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background:#f8fafc; color:#0f172a; }}
    .wrap {{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }}
    .card {{ width:100%; max-width:420px; background:#fff; border:1px solid #e2e8f0;
      border-radius:16px; padding:28px 24px; box-shadow:0 8px 24px rgba(15,23,42,.06); }}
    h1 {{ margin:0 0 8px; font-size:1.35rem; color:{tone}; }}
    .lead {{ margin:0 0 18px; color:#475569; line-height:1.45; font-size:.95rem; }}
    .qr {{ display:flex; justify-content:center; margin:8px 0 18px; }}
    .qr img {{ width:min(280px,100%); height:auto; border-radius:12px; border:1px solid #e2e8f0; }}
    .qr-msg {{ white-space:pre-wrap; word-break:break-all; font-size:.75rem; background:#f1f5f9;
      padding:12px; border-radius:8px; overflow:auto; }}
    .meta p {{ display:flex; justify-content:space-between; gap:12px; margin:0;
      padding:10px 0; border-top:1px solid #f1f5f9; font-size:.9rem; }}
    .meta span {{ color:#64748b; }}
    .meta strong {{ text-align:right; word-break:break-all; }}
    .hint {{ margin:18px 0 0; font-size:.8rem; color:#94a3b8; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>{escape(headline)}</h1>
      <p class="lead">{escape(detail)}</p>
      {qr_block}
      <div class="meta">{details_html}</div>
      <p class="hint">Secured via PayBridgeNP Fonepay · MySewa</p>
    </div>
  </div>
</body>
</html>"""
    return HttpResponse(html, content_type='text/html; charset=utf-8')


def process_raw_webhook(raw_body: str, signature_header: str) -> Tuple[str, Optional[Deposit]]:
    creds = get_paybridgenp_credentials()
    event = verify_webhook_signature(raw_body, signature_header, creds.get('webhook_secret') or '')
    return handle_webhook_event(event)
