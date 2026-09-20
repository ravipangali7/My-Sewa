"""
Deliver Payin (PayBridgeNP) results to a developer's saved webhook URL.

Security model:
  - Webhook URL is stored on the API user (CustomUser.api_webhook_url).
  - Deposit.initiated_by identifies which developer started the Payin.
  - Delivery never trusts a client-supplied redirect/callback URL from the game request.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import requests
from django.db import transaction
from django.utils import timezone

from ..models import ApiPayinWebhookLog, Deposit

logger = logging.getLogger(__name__)

DELIVERY_TIMEOUT_SEC = 12
MAX_RESPONSE_STORE = 2000


def _amount_out(amount) -> int | str:
    if isinstance(amount, Decimal):
        return int(amount) if amount == amount.to_integral_value() else str(amount)
    return amount


def _api_status(deposit: Deposit) -> str:
    mapping = {
        Deposit.STATUS_PENDING: 'PENDING',
        Deposit.STATUS_PROCESSING: 'PENDING',
        Deposit.STATUS_APPROVED: 'SUCCESS',
        Deposit.STATUS_REJECTED: 'FAILED',
        Deposit.STATUS_FAILED: 'FAILED',
        Deposit.STATUS_CANCELLED: 'CANCELLED',
        Deposit.STATUS_EXPIRED: 'EXPIRED',
        Deposit.STATUS_REFUNDED: 'REFUNDED',
    }
    return mapping.get(deposit.status, str(deposit.status or '').upper() or 'PENDING')


def validate_webhook_url(url: str) -> Tuple[bool, str]:
    """Return (ok, error_message). Empty is allowed (clears the webhook)."""
    text = (url or '').strip()
    if not text:
        return True, ''
    if len(text) > 500:
        return False, 'Webhook URL must be at most 500 characters.'
    parsed = urlparse(text)
    if parsed.scheme not in ('https', 'http'):
        return False, 'Webhook URL must start with https:// or http://.'
    if not parsed.netloc:
        return False, 'Webhook URL is missing a host.'
    if parsed.scheme == 'http':
        host = (parsed.hostname or '').lower()
        if host not in ('localhost', '127.0.0.1', '::1'):
            return False, 'Webhook URL must use https:// (http is only allowed for localhost).'
    return True, ''


def build_payin_webhook_payload(deposit: Deposit) -> Dict[str, Any]:
    status = _api_status(deposit)
    event = 'payin.succeeded' if status == 'SUCCESS' else f'payin.{status.lower()}'
    payment_id = (
        (deposit.transaction_id or '')
        if str(deposit.transaction_id or '').startswith('pay_')
        else ''
    )
    return {
        'event': event,
        'success': status == 'SUCCESS',
        'status': status,
        'transaction_id': deposit.purchase_order_identifier or str(deposit.pk),
        'deposit_id': deposit.pk,
        'order_id': deposit.purchase_order_identifier or '',
        'reference': deposit.client_reference or '',
        'payment_id': payment_id,
        'session_id': deposit.process_id or '',
        'receiver': getattr(deposit.user, 'phone', '') or '',
        'amount': _amount_out(deposit.amount),
        'currency': deposit.currency or 'NPR',
        'provider': deposit.provider or Deposit.PROVIDER_PAYBRIDGENP,
        'verification_status': deposit.verification_status or '',
        'failure_reason': deposit.failure_reason or '',
        'completed_at': deposit.completed_at.isoformat() if deposit.completed_at else None,
        'timestamp': timezone.now().isoformat(),
    }


def _write_log(
    *,
    deposit: Deposit,
    developer,
    url: str,
    status: str,
    payload: Dict[str, Any],
    http_status: Optional[int] = None,
    response_body: str = '',
    error_message: str = '',
):
    try:
        ApiPayinWebhookLog.objects.create(
            deposit=deposit,
            developer=developer,
            url=(url or '')[:500],
            status=status,
            http_status=http_status,
            request_payload=payload if isinstance(payload, dict) else {},
            response_body=(response_body or '')[:MAX_RESPONSE_STORE],
            error_message=(error_message or '')[:255],
        )
    except Exception:
        logger.exception(
            'Failed to persist API payin webhook log deposit=%s developer=%s',
            deposit.pk,
            getattr(developer, 'pk', None),
        )


def deliver_developer_payin_webhook(
    deposit: Deposit,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """
    POST the Payin result to deposit.initiated_by's saved api_webhook_url.

    Idempotent: successful delivery sets developer_webhook_delivered_at and is
    skipped on later PayBridgeNP duplicate webhooks unless force=True.
    """
    deposit = (
        Deposit.objects.select_related('user', 'initiated_by')
        .filter(pk=deposit.pk)
        .first()
    )
    if deposit is None:
        return {'delivered': False, 'reason': 'deposit_not_found'}

    if deposit.source != Deposit.SOURCE_API:
        return {'delivered': False, 'reason': 'not_api_payin'}

    if deposit.status != Deposit.STATUS_APPROVED:
        return {'delivered': False, 'reason': 'not_approved'}

    if deposit.developer_webhook_delivered_at and not force:
        return {
            'delivered': False,
            'reason': 'already_delivered',
            'delivered_at': deposit.developer_webhook_delivered_at.isoformat(),
        }

    developer = deposit.initiated_by
    if developer is None:
        logger.warning(
            'API payin deposit=%s has no initiated_by; skipping developer webhook',
            deposit.pk,
        )
        return {'delivered': False, 'reason': 'no_initiated_by'}

    url = str(getattr(developer, 'api_webhook_url', '') or '').strip()
    payload = build_payin_webhook_payload(deposit)

    if not url:
        logger.info(
            'API payin deposit=%s developer=%s has empty webhook URL; skipping',
            deposit.pk,
            developer.pk,
        )
        _write_log(
            deposit=deposit,
            developer=developer,
            url='',
            status=ApiPayinWebhookLog.STATUS_SKIPPED,
            payload=payload,
            error_message='Developer webhook URL is not configured',
        )
        return {'delivered': False, 'reason': 'webhook_url_empty'}

    ok, err = validate_webhook_url(url)
    if not ok:
        logger.warning(
            'API payin deposit=%s developer=%s invalid webhook URL: %s',
            deposit.pk,
            developer.pk,
            err,
        )
        with transaction.atomic():
            locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
            locked.developer_webhook_attempts = int(locked.developer_webhook_attempts or 0) + 1
            locked.developer_webhook_last_error = (err or 'invalid webhook url')[:255]
            locked.save(update_fields=[
                'developer_webhook_attempts', 'developer_webhook_last_error', 'updated_at',
            ])
        _write_log(
            deposit=deposit,
            developer=developer,
            url=url,
            status=ApiPayinWebhookLog.STATUS_FAILED,
            payload=payload,
            error_message=err,
        )
        return {'delivered': False, 'reason': 'invalid_webhook_url', 'error': err}

    http_status = None
    response_text = ''
    error_message = ''
    success = False
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'MySewa-PayinWebhook/1.0',
                'X-MySewa-Event': str(payload.get('event') or 'payin.succeeded'),
                'X-MySewa-Deposit-Id': str(deposit.pk),
                'X-MySewa-Reference': str(payload.get('reference') or ''),
            },
            timeout=DELIVERY_TIMEOUT_SEC,
        )
        http_status = int(resp.status_code)
        response_text = (resp.text or '')[:MAX_RESPONSE_STORE]
        success = 200 <= http_status < 300
        if not success:
            error_message = f'Developer webhook returned HTTP {http_status}'
    except requests.RequestException as exc:
        error_message = f'Developer webhook delivery failed: {exc.__class__.__name__}'
        logger.warning(
            'API payin webhook POST failed deposit=%s developer=%s url=%s err=%s',
            deposit.pk,
            developer.pk,
            url[:120],
            exc,
        )

    with transaction.atomic():
        locked = Deposit.objects.select_for_update().get(pk=deposit.pk)
        if locked.developer_webhook_delivered_at and not force:
            return {
                'delivered': False,
                'reason': 'already_delivered',
                'delivered_at': locked.developer_webhook_delivered_at.isoformat(),
            }
        locked.developer_webhook_attempts = int(locked.developer_webhook_attempts or 0) + 1
        if success:
            locked.developer_webhook_delivered_at = timezone.now()
            locked.developer_webhook_last_error = ''
            locked.save(update_fields=[
                'developer_webhook_attempts',
                'developer_webhook_delivered_at',
                'developer_webhook_last_error',
                'updated_at',
            ])
        else:
            locked.developer_webhook_last_error = (error_message or 'delivery failed')[:255]
            locked.save(update_fields=[
                'developer_webhook_attempts',
                'developer_webhook_last_error',
                'updated_at',
            ])

    _write_log(
        deposit=deposit,
        developer=developer,
        url=url,
        status=(
            ApiPayinWebhookLog.STATUS_SUCCESS
            if success
            else ApiPayinWebhookLog.STATUS_FAILED
        ),
        payload=payload,
        http_status=http_status,
        response_body=response_text,
        error_message=error_message,
    )

    if success:
        logger.info(
            'API payin webhook delivered deposit=%s developer=%s http=%s',
            deposit.pk,
            developer.pk,
            http_status,
        )
    else:
        logger.warning(
            'API payin webhook not accepted deposit=%s developer=%s http=%s err=%s',
            deposit.pk,
            developer.pk,
            http_status,
            error_message,
        )

    return {
        'delivered': success,
        'http_status': http_status,
        'error': error_message or None,
        'url': url,
    }


def notify_developer_after_settle(outcome: str, deposit: Optional[Deposit]) -> None:
    """
    After PayBridgeNP settle (or idempotent already_processed), notify the developer.

    Safe to call for any outcome; only APPROVED API payins are delivered.
    """
    if deposit is None:
        return
    # Import locally to avoid circular imports with paybridge_deposit constants.
    from .paybridge_deposit import ALREADY_PROCESSED, SETTLED

    if outcome not in (SETTLED, ALREADY_PROCESSED):
        return
    try:
        deliver_developer_payin_webhook(deposit)
    except Exception:
        logger.exception(
            'Developer payin webhook notify failed deposit=%s outcome=%s',
            getattr(deposit, 'pk', None),
            outcome,
        )
