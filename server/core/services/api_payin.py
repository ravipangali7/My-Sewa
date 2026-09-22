"""API-key Payin / Wallet Load using existing PayBridgeNP deposit flow."""
from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response

from ..models import (
    ApiIdempotencyRecord,
    ApiPayinLog,
    Deposit,
    _ensure_api_fund_transfer,
)
from .api_fund_transfer import api_error
from .app_config import (
    get_app_config,
    require_account_approved,
    require_feature_enabled,
    require_user_feature,
    require_wallet_not_frozen,
    validate_amount_bounds,
)
from .paybridge_deposit import create_paybridge_deposit, public_deposit_dict, verify_deposit
from .paybridgenp import PayBridgeError, is_paybridgenp_configured
from .security import client_ip, client_user_agent
from .wallet_guard import WalletFrozenError
from .wallet_transfer import lookup_active_user

logger = logging.getLogger(__name__)

_REFERENCE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
PAYIN_IDEMPOTENCY_PREFIX = 'payin:'

_STATUS_MAP = {
    Deposit.STATUS_PENDING: 'PENDING',
    Deposit.STATUS_PROCESSING: 'PENDING',
    Deposit.STATUS_APPROVED: 'SUCCESS',
    Deposit.STATUS_REJECTED: 'FAILED',
    Deposit.STATUS_FAILED: 'FAILED',
    Deposit.STATUS_CANCELLED: 'CANCELLED',
    Deposit.STATUS_EXPIRED: 'EXPIRED',
    Deposit.STATUS_REFUNDED: 'REFUNDED',
}


def _api_status(deposit: Deposit) -> str:
    return _STATUS_MAP.get(deposit.status, str(deposit.status or '').upper() or 'PENDING')


def _amount_out(amount) -> int | str:
    if isinstance(amount, Decimal):
        return int(amount) if amount == amount.to_integral_value() else str(amount)
    return amount


def _success_payload(deposit: Deposit, reference: str, public: dict | None = None) -> dict:
    pub = public if isinstance(public, dict) else public_deposit_dict(deposit, include_qr=True)
    checkout_url = str(pub.get('checkout_url') or pub.get('payment_url') or deposit.payment_url or '').strip()
    # Never leak a HimalPay / N-Cash URL to API clients (games openers).
    if 'himalpay' in checkout_url.lower() or 'ncash' in checkout_url.lower():
        logger.error(
            'Payin payload refused HimalPay URL deposit=%s url=%s',
            deposit.pk,
            checkout_url[:120],
        )
        checkout_url = ''
    qr_image = str(pub.get('qr_image') or '').strip()
    mode = str(pub.get('mode') or '').strip() or (
        'hosted' if checkout_url else ('direct_qr' if qr_image else '')
    )
    payload = {
        'success': True,
        'message': 'Payin checkout ready' if _api_status(deposit) == 'PENDING' else 'Payin status',
        'transaction_id': deposit.purchase_order_identifier or str(deposit.pk),
        'deposit_id': deposit.pk,
        'order_id': deposit.purchase_order_identifier or '',
        'reference': reference,
        'receiver': getattr(deposit.user, 'phone', '') or '',
        'amount': _amount_out(deposit.amount),
        'currency': deposit.currency or 'NPR',
        'status': _api_status(deposit),
        # Games must always see PayBridgeNP — never HimalPay checkout.
        'provider': Deposit.PROVIDER_PAYBRIDGENP,
        'mode': mode,
        'checkout_url': checkout_url,
        'payment_url': checkout_url,
        'session_id': deposit.process_id or '',
        'payment_id': (
            (deposit.transaction_id or '')
            if str(deposit.transaction_id or '').startswith('pay_')
            else ''
        ),
        'expires_at': deposit.expires_at.isoformat() if deposit.expires_at else None,
        'failure_reason': deposit.failure_reason or '',
        'verification_status': deposit.verification_status,
    }
    if qr_image:
        payload['qr_image'] = qr_image
    events_url = str(pub.get('events_url') or '').strip()
    if events_url:
        payload['events_url'] = events_url
    qr_message = str(pub.get('qr_message') or '').strip()
    if qr_message:
        payload['qr_message'] = qr_message
    customer = pub.get('customer') if isinstance(pub.get('customer'), dict) else None
    if customer:
        cleaned = {
            key: str(customer.get(key) or '').strip()
            for key in ('name', 'email', 'phone')
            if str(customer.get(key) or '').strip()
        }
        if cleaned:
            payload['customer'] = cleaned
    return payload


def _write_audit(
    *,
    user,
    request,
    reference,
    receiver,
    amount,
    status_value,
    error_code='',
    error_message='',
    deposit=None,
):
    try:
        ApiPayinLog.objects.create(
            user=user,
            reference=(reference or '')[:64],
            receiver=(receiver or '')[:80],
            amount=amount,
            status=status_value,
            error_code=(error_code or '')[:64],
            error_message=(error_message or '')[:255],
            deposit=deposit,
            transaction_id=(
                (getattr(deposit, 'purchase_order_identifier', None) or '')
                if deposit is not None
                else ''
            )[:120],
            order_id=(
                (getattr(deposit, 'purchase_order_identifier', None) or '')
                if deposit is not None
                else ''
            )[:120],
            ip_address=client_ip(request),
            user_agent=client_user_agent(request),
        )
    except Exception:
        logger.exception('Failed to persist API payin audit log')


def _map_paybridge_error(exc: PayBridgeError) -> Response:
    code = int(getattr(exc, 'status_code', 0) or 0)
    message = str(getattr(exc, 'message', '') or exc or 'PayBridgeNP request failed')
    if code == 503 or 'not configured' in message.lower():
        return api_error(
            'PayBridgeNP unavailable',
            message,
            'provider_unavailable',
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if code in (502, 504):
        return api_error(
            'PayBridgeNP unavailable',
            message,
            'provider_unavailable',
            status.HTTP_502_BAD_GATEWAY,
        )
    if code == 400:
        return api_error('Invalid amount', message, 'invalid_amount', status.HTTP_400_BAD_REQUEST)
    return api_error(
        'PayBridgeNP API error',
        message,
        'provider_error',
        status.HTTP_400_BAD_REQUEST if code and code < 500 else status.HTTP_502_BAD_GATEWAY,
    )


def execute_api_payin(request) -> Response:
    """Create a PayBridgeNP payin for a MySewa receiver wallet."""
    _ensure_api_fund_transfer()
    partner = request.user
    raw = request.data if isinstance(request.data, dict) else {}
    receiver_raw = str(
        raw.get('receiver') or raw.get('phone') or raw.get('mobile') or ''
    ).strip()
    reference = str(
        raw.get('reference')
        or request.headers.get('Idempotency-Key')
        or request.META.get('HTTP_IDEMPOTENCY_KEY')
        or ''
    ).strip()
    amount_raw = raw.get('amount')
    idem_key = f'{PAYIN_IDEMPOTENCY_PREFIX}{reference}' if reference else ''
    partner_return_url = str(
        raw.get('return_url') or raw.get('success_url') or raw.get('redirect_url') or ''
    ).strip()

    # Optional checkout display overrides (do not change wallet credit target).
    customer_override: dict = {}
    nested = raw.get('customer') if isinstance(raw.get('customer'), dict) else {}
    name_override = str(
        raw.get('customer_name') or nested.get('name') or ''
    ).strip()
    email_override = str(
        raw.get('customer_email') or nested.get('email') or ''
    ).strip()
    phone_override = str(
        raw.get('customer_phone') or nested.get('phone') or ''
    ).strip()
    if name_override:
        customer_override['name'] = name_override
    if email_override:
        customer_override['email'] = email_override
    if phone_override:
        customer_override['phone'] = phone_override

    # Default hosted (backward compatible). Opt-in Direct-QR: mode=direct_qr.
    mode_raw = str(raw.get('mode') or raw.get('flow') or 'hosted').strip().lower() or 'hosted'
    prefer_direct_qr = mode_raw in (
        'direct_qr', 'direct-qr', 'qr', 'fonepay_qr', 'fonepay-qr',
    )
    prefer_hosted = not prefer_direct_qr
    _valid_modes = {
        'hosted', 'checkout', 'direct_qr', 'direct-qr', 'qr', 'fonepay_qr', 'fonepay-qr',
    }

    # Hosted checkout defaults: skip PayBridge method picker → open Fonepay QR.
    checkout_provider = str(raw.get('provider') or 'fonepay').strip().lower() or 'fonepay'
    checkout_flow_raw = str(raw.get('checkout_flow') or '').strip().lower()
    if prefer_hosted:
        checkout_flow = checkout_flow_raw or 'redirect'
    else:
        checkout_flow = 'hosted'  # unused for Direct-QR

    def fail(error, message, code, http_status, extra=None):
        _write_audit(
            user=partner,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=None,
            status_value=ApiPayinLog.STATUS_FAILED,
            error_code=code,
            error_message=message,
        )
        return api_error(error, message, code, http_status, extra)

    if not getattr(partner, 'is_api_user', False):
        return fail(
            'API access disabled',
            'API access is disabled for this account.',
            'api_access_disabled',
            status.HTTP_403_FORBIDDEN,
        )
    if not partner.is_active:
        return fail(
            'User inactive',
            'This account is inactive and cannot use the API.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )

    pending = require_account_approved(partner)
    if pending:
        return fail(
            'User inactive',
            'This account is not active for transactions.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )

    blocked = require_user_feature(partner, 'api_payin')
    if blocked:
        return fail(
            'Unauthorized transaction',
            'Payin API access is disabled for this account.',
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )

    feature = require_feature_enabled('deposits')
    if feature:
        data = feature.data if isinstance(feature.data, dict) else {}
        return fail(
            'Unauthorized transaction',
            str(data.get('message') or 'Deposits are currently disabled.'),
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )

    if not is_paybridgenp_configured():
        return fail(
            'PayBridgeNP unavailable',
            'PayBridgeNP is not configured on the server.',
            'provider_unavailable',
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    if not receiver_raw:
        return fail(
            'Invalid receiver',
            'Receiver phone is required.',
            'invalid_receiver',
            status.HTTP_400_BAD_REQUEST,
        )
    if not reference:
        return fail(
            'Duplicate reference',
            'A unique reference is required for each API payin.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )
    if not _REFERENCE_RE.match(reference):
        return fail(
            'Duplicate reference',
            'Reference must be 1–64 characters using letters, digits, hyphen, underscore, or period.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(amount_raw)).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError, ValueError):
        return fail(
            'Invalid amount',
            'Amount must be a valid number greater than zero.',
            'invalid_amount',
            status.HTTP_400_BAD_REQUEST,
        )
    if amount <= 0:
        return fail(
            'Invalid amount',
            'Amount must be greater than zero.',
            'invalid_amount',
            status.HTTP_400_BAD_REQUEST,
        )

    if mode_raw not in _valid_modes:
        return fail(
            'Invalid mode',
            'mode must be "hosted" (default) or "direct_qr".',
            'invalid_mode',
            status.HTTP_400_BAD_REQUEST,
        )

    if prefer_hosted:
        if checkout_provider not in ('esewa', 'khalti', 'fonepay'):
            return fail(
                'Invalid provider',
                'provider must be fonepay, esewa, or khalti.',
                'invalid_provider',
                status.HTTP_400_BAD_REQUEST,
            )
        if checkout_flow not in ('hosted', 'redirect'):
            return fail(
                'Invalid checkout_flow',
                'checkout_flow must be "redirect" (default, opens provider QR/page) or "hosted" (method picker).',
                'invalid_checkout_flow',
                status.HTTP_400_BAD_REQUEST,
            )
        if checkout_flow == 'redirect' and not checkout_provider:
            return fail(
                'Invalid provider',
                'provider is required when checkout_flow is redirect.',
                'invalid_provider',
                status.HTTP_400_BAD_REQUEST,
            )

    if partner_return_url:
        from .api_payin_webhook import validate_webhook_url
        ok, err = validate_webhook_url(partner_return_url)
        if not ok:
            return fail(
                'Invalid return_url',
                err or 'return_url must be a valid https URL (game page, not required).',
                'invalid_return_url',
                status.HTTP_400_BAD_REQUEST,
            )
        # Never accept the webhook API endpoint as a browser return target.
        saved_webhook = str(getattr(partner, 'api_webhook_url', '') or '').strip().rstrip('/')
        if saved_webhook and partner_return_url.rstrip('/') == saved_webhook:
            return fail(
                'Invalid return_url',
                'return_url must be a player-facing game page, not the webhook URL.',
                'invalid_return_url',
                status.HTTP_400_BAD_REQUEST,
            )

    payment = get_app_config().get('payment') or {}
    bounds_err = validate_amount_bounds(
        amount,
        min_amount=payment.get('min_deposit', 100),
        max_amount=payment.get('max_deposit', 100000),
        label='Deposit',
    )
    if bounds_err:
        return fail('Invalid amount', bounds_err, 'invalid_amount', status.HTTP_400_BAD_REQUEST)

    recipient = lookup_active_user(receiver_raw)
    if recipient is None:
        return fail(
            'Receiver not found',
            'No MySewa user was found for that receiver.',
            'receiver_not_found',
            status.HTTP_404_NOT_FOUND,
        )
    if not recipient.is_active or not getattr(recipient, 'is_account_approved', True):
        return fail(
            'Invalid receiver',
            'The receiver account cannot receive wallet loads.',
            'invalid_receiver',
            status.HTTP_400_BAD_REQUEST,
        )

    frozen = require_wallet_not_frozen(recipient)
    if frozen:
        data = frozen.data if isinstance(frozen.data, dict) else {}
        return fail(
            'Unauthorized transaction',
            str(data.get('message') or 'Receiver wallet is frozen.'),
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )

    try:
        with transaction.atomic():
            try:
                with transaction.atomic():
                    record = ApiIdempotencyRecord.objects.create(
                        user=partner,
                        reference=idem_key,
                        status=ApiIdempotencyRecord.STATUS_PROCESSING,
                    )
            except IntegrityError:
                existing = (
                    ApiIdempotencyRecord.objects.select_for_update()
                    .filter(user=partner, reference=idem_key)
                    .first()
                )
                if existing and existing.status == ApiIdempotencyRecord.STATUS_COMPLETED:
                    payload = existing.response_payload or {}
                    if existing.deposit_id and not payload:
                        payload = _success_payload(existing.deposit, reference)
                    elif existing.deposit_id and payload:
                        # Refresh live status fields while keeping checkout details.
                        live = _success_payload(existing.deposit, reference)
                        for key in (
                            'status',
                            'payment_id',
                            'failure_reason',
                            'verification_status',
                            'expires_at',
                        ):
                            if key in live:
                                payload[key] = live[key]
                    _write_audit(
                        user=partner,
                        request=request,
                        reference=reference,
                        receiver=receiver_raw,
                        amount=amount,
                        status_value=(
                            ApiPayinLog.STATUS_SUCCESS
                            if payload.get('status') == 'SUCCESS'
                            else ApiPayinLog.STATUS_PENDING
                        ),
                        deposit=existing.deposit,
                    )
                    return Response(payload, status=status.HTTP_200_OK)
                return fail(
                    'Duplicate reference',
                    'This reference is already being processed.',
                    'duplicate_reference',
                    status.HTTP_409_CONFLICT,
                )

            try:
                deposit, public = create_paybridge_deposit(
                    recipient,
                    amount,
                    source=Deposit.SOURCE_API,
                    client_reference=reference,
                    initiated_by=partner,
                    allow_reuse=False,
                    prefer_hosted=prefer_hosted,
                    partner_return_url=partner_return_url,
                    customer_override=customer_override or None,
                    checkout_provider=checkout_provider,
                    checkout_flow=checkout_flow if prefer_hosted else 'redirect',
                )
                checkout_url = str(
                    public.get('checkout_url')
                    or public.get('payment_url')
                    or deposit.payment_url
                    or ''
                ).strip()
                qr_image = str(public.get('qr_image') or '').strip()
                qr_message = str(public.get('qr_message') or '').strip()
                if prefer_hosted:
                    if not checkout_url:
                        raise PayBridgeError(
                            'PayBridgeNP did not return a checkout URL for API payin.',
                            status_code=502,
                        )
                    if 'himalpay' in checkout_url.lower() or 'ncash' in checkout_url.lower():
                        raise PayBridgeError(
                            'Refusing HimalPay checkout URL — Payin uses PayBridgeNP only.',
                            status_code=502,
                        )
                else:
                    # Direct-QR: require scannable QR payload (may fall back to hosted).
                    if not qr_image and not qr_message and not checkout_url:
                        raise PayBridgeError(
                            'PayBridgeNP did not return a Fonepay QR for API payin.',
                            status_code=502,
                        )
                    if checkout_url and (
                        'himalpay' in checkout_url.lower() or 'ncash' in checkout_url.lower()
                    ):
                        raise PayBridgeError(
                            'Refusing HimalPay checkout URL — Payin uses PayBridgeNP only.',
                            status_code=502,
                        )
            except WalletFrozenError:
                raise
            except PayBridgeError as exc:
                raise _PayinFailed(_map_paybridge_error(exc)) from exc

            payload = _success_payload(deposit, reference, public)
            record.status = ApiIdempotencyRecord.STATUS_COMPLETED
            record.deposit = deposit
            record.response_payload = payload
            record.save(update_fields=['status', 'deposit', 'response_payload', 'updated_at'])
    except WalletFrozenError:
        return fail(
            'Unauthorized transaction',
            'Receiver wallet is frozen.',
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )
    except _PayinFailed as exc:
        data = exc.response.data if isinstance(exc.response.data, dict) else {}
        _write_audit(
            user=partner,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=amount,
            status_value=ApiPayinLog.STATUS_FAILED,
            error_code=str(data.get('code') or ''),
            error_message=str(data.get('message') or ''),
        )
        return exc.response
    except Exception:
        logger.exception('API payin failed user_id=%s reference=%s', partner.pk, reference)
        _write_audit(
            user=partner,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=amount,
            status_value=ApiPayinLog.STATUS_FAILED,
            error_code='server_error',
            error_message='The payin could not be started.',
        )
        return api_error(
            'Server/internal error',
            'The payin could not be started. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    _write_audit(
        user=partner,
        request=request,
        reference=reference,
        receiver=receiver_raw,
        amount=amount,
        status_value=ApiPayinLog.STATUS_PENDING,
        deposit=deposit,
    )
    logger.info(
        'API payin ok partner_id=%s deposit=%s order=%s reference=%s amount=%s',
        partner.pk,
        deposit.pk,
        deposit.purchase_order_identifier,
        reference,
        amount,
    )
    return Response(payload, status=status.HTTP_201_CREATED)


def execute_api_payin_status(request) -> Response:
    """Return live payin status for a reference / order / deposit owned by this API user."""
    _ensure_api_fund_transfer()
    partner = request.user
    if not getattr(partner, 'is_api_user', False):
        return api_error(
            'API access disabled',
            'API access is disabled for this account.',
            'api_access_disabled',
            status.HTTP_403_FORBIDDEN,
        )
    blocked = require_user_feature(partner, 'api_payin')
    if blocked:
        return api_error(
            'Unauthorized transaction',
            'Payin API access is disabled for this account.',
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )

    raw = request.query_params if hasattr(request, 'query_params') else {}
    body = request.data if isinstance(getattr(request, 'data', None), dict) else {}
    reference = str(
        raw.get('reference') or body.get('reference') or ''
    ).strip()
    order_id = str(raw.get('order_id') or body.get('order_id') or raw.get('transaction_id') or body.get('transaction_id') or '').strip()
    deposit_id = raw.get('deposit_id') or body.get('deposit_id') or ''

    deposit = None
    if deposit_id:
        try:
            deposit = Deposit.objects.select_related('user').get(
                pk=int(deposit_id),
                source=Deposit.SOURCE_API,
                initiated_by=partner,
                provider=Deposit.PROVIDER_PAYBRIDGENP,
            )
        except (Deposit.DoesNotExist, TypeError, ValueError):
            deposit = None
    if deposit is None and order_id:
        deposit = (
            Deposit.objects.select_related('user')
            .filter(
                purchase_order_identifier=order_id,
                source=Deposit.SOURCE_API,
                initiated_by=partner,
                provider=Deposit.PROVIDER_PAYBRIDGENP,
            )
            .first()
        )
    if deposit is None and reference:
        deposit = (
            Deposit.objects.select_related('user')
            .filter(
                client_reference=reference,
                source=Deposit.SOURCE_API,
                initiated_by=partner,
                provider=Deposit.PROVIDER_PAYBRIDGENP,
            )
            .order_by('-created_at')
            .first()
        )
        if deposit is None:
            record = (
                ApiIdempotencyRecord.objects.select_related('deposit', 'deposit__user')
                .filter(user=partner, reference=f'{PAYIN_IDEMPOTENCY_PREFIX}{reference}')
                .first()
            )
            if record and record.deposit_id:
                deposit = record.deposit

    if deposit is None:
        return api_error(
            'Payin not found',
            'No payin was found for the given reference, order_id, or deposit_id.',
            'payin_not_found',
            status.HTTP_404_NOT_FOUND,
        )

    if deposit.status in (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING):
        public = None
        payload = deposit.provider_payload if isinstance(deposit.provider_payload, dict) else {}
        mode = str(payload.get('mode') or '').strip()
        is_direct_qr = mode == 'direct_qr' or (
            isinstance(payload.get('qr'), dict) and not (deposit.payment_url or '').strip()
        )
        if is_direct_qr:
            try:
                from .paybridge_deposit import refresh_paybridge_qr
                public = refresh_paybridge_qr(deposit)
                deposit.refresh_from_db()
            except Exception:
                logger.exception(
                    'API payin status QR refresh failed deposit=%s', deposit.pk,
                )
        try:
            verify_deposit(deposit)
            deposit.refresh_from_db()
        except Exception:
            logger.exception('API payin status soft-verify failed deposit=%s', deposit.pk)

        # After settle, omit stale QR; while pending, prefer refreshed QR payload.
        if deposit.status in (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING):
            return Response(
                _success_payload(
                    deposit,
                    deposit.client_reference or reference,
                    public,
                ),
                status=status.HTTP_200_OK,
            )

    return Response(
        _success_payload(deposit, deposit.client_reference or reference),
        status=status.HTTP_200_OK,
    )


class _PayinFailed(Exception):
    def __init__(self, response: Response):
        self.response = response
        super().__init__('payin failed')
