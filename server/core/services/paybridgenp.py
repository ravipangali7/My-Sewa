"""
PayBridgeNP API client (Direct-QR + hosted checkout + signed webhooks).

Docs: https://docs.paybridgenp.com/
Base: https://api.paybridgenp.com

Auth: Authorization: Bearer <sk_live_...|sk_test_...>
Amounts are integer paisa (10000 = NPR 100.00). Minimum 1000 paisa (Rs. 10).

Prefer Direct-QR (`POST /v1/qr/fonepay`) so the Fonepay QR can be rendered
inside MySewa without opening an external browser. Hosted checkout remains
available as a fallback when Direct-QR is unavailable for the merchant plan.

Never expose the secret key or webhook signing secret to clients.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from decimal import Decimal
from typing import Any, Dict, Optional
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import requests
from django.conf import settings

from .himalpay import HimalPayAPI, HimalPayError

logger = logging.getLogger(__name__)

PAYBRIDGE_BASE_URL = 'https://api.paybridgenp.com'
CHECKOUT_PATH = '/v1/checkout'
SESSION_PATH = '/v1/sessions/{id}'
PAYMENT_PATH = '/v1/payments/{id}'
QR_FONEPAY_PATH = '/v1/qr/fonepay'
QR_REFRESH_PATH = '/v1/qr/{id}/refresh'

# PayBridgeNP / provider minimum (paisa).
MIN_PAISA = 1000
MAX_PAISA = 100_000_000

# Reject webhook timestamps older than 5 minutes (docs).
WEBHOOK_TOLERANCE_SEC = 300


class PayBridgeError(HimalPayError):
    """Reuse HimalPayError shape for consistent deposit view error responses."""


def get_paybridgenp_credentials() -> Dict[str, str]:
    """Settings.config.integrations first, then env."""
    from django.conf import settings as django_settings
    from .app_config import get_app_config

    env_key = (getattr(django_settings, 'PAYBRIDGENP_API_KEY', '') or '').strip()
    env_secret = (getattr(django_settings, 'PAYBRIDGENP_WEBHOOK_SECRET', '') or '').strip()
    env_base = (getattr(django_settings, 'PAYBRIDGENP_BASE_URL', '') or '').strip()
    env_return = (getattr(django_settings, 'PAYBRIDGENP_RETURN_URL', '') or '').strip()

    integrations = (get_app_config().get('integrations') or {})
    db_key = str(integrations.get('paybridgenp_api_key') or '').strip()
    db_secret = str(integrations.get('paybridgenp_webhook_secret') or '').strip()
    db_base = str(integrations.get('paybridgenp_base_url') or '').strip()
    db_return = str(integrations.get('paybridgenp_return_url') or '').strip()

    return {
        'api_key': db_key or env_key,
        'webhook_secret': db_secret or env_secret,
        'base_url': (db_base or env_base or PAYBRIDGE_BASE_URL).rstrip('/'),
        'return_url': db_return or env_return,
    }


def is_paybridgenp_configured() -> bool:
    return bool(get_paybridgenp_credentials().get('api_key'))


def append_query(url: str, **params) -> str:
    parsed = urlparse(url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in params.items():
        if value is None or value == '':
            continue
        q[str(key)] = str(value)
    return urlunparse(parsed._replace(query=urlencode(q)))


def default_backend_return_url() -> str:
    origin = (getattr(settings, 'BACKEND_ORIGIN', '') or '').rstrip('/')
    if not origin:
        backend = (getattr(settings, 'BACKEND_URL', '') or '').rstrip('/')
        if backend.endswith('/database'):
            origin = backend[: -len('/database')]
        else:
            origin = backend
    return f'{origin}/api/deposit/paybridge/return/'


def default_frontend_return_url() -> str:
    front = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    return f'{front}/app/paybridge-return'


def verify_webhook_signature(raw_body: str, signature_header: str, secret: str) -> Dict[str, Any]:
    """
    Verify X-PayBridgeNP-Signature: t=<unix>,v1=<hmac_hex>

    HMAC-SHA256(secret, f"{timestamp}.{raw_body}")
    Rejects timestamps older than WEBHOOK_TOLERANCE_SEC.
    """
    if not secret:
        raise PayBridgeError('PayBridgeNP webhook secret is not configured.', status_code=503)
    if not signature_header:
        raise PayBridgeError('Missing X-PayBridgeNP-Signature header.', status_code=400)

    parts: Dict[str, str] = {}
    for piece in signature_header.split(','):
        piece = piece.strip()
        if '=' not in piece:
            continue
        key, value = piece.split('=', 1)
        parts[key.strip()] = value.strip()

    timestamp = parts.get('t')
    v1 = parts.get('v1')
    if not timestamp or not v1:
        raise PayBridgeError('Malformed PayBridgeNP signature header.', status_code=400)

    try:
        ts = int(timestamp)
    except (TypeError, ValueError) as exc:
        raise PayBridgeError('Invalid PayBridgeNP signature timestamp.', status_code=400) from exc

    if abs(time.time() - ts) > WEBHOOK_TOLERANCE_SEC:
        raise PayBridgeError('PayBridgeNP webhook timestamp too old.', status_code=400)

    expected = hmac.new(
        secret.encode('utf-8'),
        f'{timestamp}.{raw_body}'.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, v1):
        raise PayBridgeError('PayBridgeNP webhook signature mismatch.', status_code=400)

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise PayBridgeError('Invalid PayBridgeNP webhook JSON body.', status_code=400) from exc
    if not isinstance(payload, dict):
        raise PayBridgeError('PayBridgeNP webhook body must be a JSON object.', status_code=400)
    return payload


class PayBridgeNPAPI:
    def __init__(self):
        creds = get_paybridgenp_credentials()
        self.api_key = creds['api_key']
        self.base_url = creds['base_url'] or PAYBRIDGE_BASE_URL
        self.webhook_secret = creds['webhook_secret']
        self.configured_return_url = creds['return_url']
        self.timeout = int(getattr(settings, 'PAYBRIDGENP_TIMEOUT', 60) or 60)
        self.bypass_api = bool(getattr(settings, 'PAYBRIDGENP_BYPASS_API', False))

    def _headers(self, idempotency_key: str = '') -> Dict[str, str]:
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key[:200]
        return headers

    def _raise_from_response(self, resp: requests.Response):
        try:
            data = resp.json()
        except Exception:
            data = {'error': {'message': (resp.text or '')[:400]}}
        err = data.get('error') if isinstance(data, dict) else None
        if isinstance(err, dict):
            message = str(err.get('message') or 'PayBridgeNP request failed')
            code = err.get('code')
            etype = err.get('type')
        else:
            message = str((data or {}).get('message') or 'PayBridgeNP request failed')
            code = None
            etype = None
        # HimalPayError expects optional int codes; PayBridgeNP uses strings.
        int_code = code if isinstance(code, int) else None
        raise PayBridgeError(
            message,
            status_code=resp.status_code if resp.status_code >= 400 else 502,
            response_data=data if isinstance(data, dict) else {'raw': data},
            error_code=int_code,
            error_type=str(code or etype or '') or None,
        )

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict] = None,
        *,
        idempotency_key: str = '',
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise PayBridgeError(
                'PayBridgeNP is not configured. Add PAYBRIDGENP_API_KEY under '
                'Admin → Settings or server environment.',
                status_code=503,
            )
        url = f'{self.base_url}{path}'
        try:
            resp = requests.request(
                method,
                url,
                headers=self._headers(idempotency_key),
                json=payload if payload is not None else None,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            logger.exception('PayBridgeNP network error %s %s', method, path)
            raise PayBridgeError(
                'Could not reach PayBridgeNP. Please try again.',
                status_code=502,
            ) from exc
        if resp.status_code >= 400:
            self._raise_from_response(resp)
        try:
            data = resp.json()
        except Exception as exc:
            raise PayBridgeError('Unexpected PayBridgeNP response.', status_code=502) from exc
        if not isinstance(data, dict):
            raise PayBridgeError('Unexpected PayBridgeNP response.', status_code=502)
        return data

    def create_checkout(
        self,
        *,
        amount_paisa: int,
        return_url: str,
        cancel_url: str = '',
        metadata: Optional[Dict[str, Any]] = None,
        description: str = '',
        customer: Optional[Dict[str, str]] = None,
        idempotency_key: str = '',
    ) -> Dict[str, Any]:
        if amount_paisa < MIN_PAISA:
            raise PayBridgeError('Minimum PayBridgeNP deposit is Rs. 10.00.', status_code=400)
        if amount_paisa > MAX_PAISA:
            raise PayBridgeError('Amount exceeds PayBridgeNP maximum.', status_code=400)

        if self.bypass_api:
            order = (metadata or {}).get('orderId') or 'bypass'
            return {
                'id': f'cs_bypass_{order}',
                'checkout_url': append_query(return_url, session_id=f'cs_bypass_{order}', status='success'),
                'flow': 'hosted',
                'provider': None,
                'expires_at': None,
                'livemode': False,
            }

        body: Dict[str, Any] = {
            'amount': int(amount_paisa),
            'currency': 'NPR',
            'returnUrl': return_url,
            'flow': 'hosted',
        }
        if cancel_url:
            body['cancelUrl'] = cancel_url
        if description:
            body['description'] = description[:200]
        if metadata:
            body['metadata'] = metadata
        if customer:
            cleaned = {
                key: str(value).strip()
                for key, value in customer.items()
                if key in ('name', 'email', 'phone') and str(value or '').strip()
            }
            if cleaned:
                body['customer'] = cleaned

        data = self._request(
            'POST',
            CHECKOUT_PATH,
            body,
            idempotency_key=idempotency_key or '',
        )
        session_id = str(data.get('id') or '').strip()
        checkout_url = str(data.get('checkout_url') or '').strip()
        if not session_id or not checkout_url:
            raise PayBridgeError(
                'PayBridgeNP did not return a checkout session.',
                status_code=502,
                response_data=data,
            )
        return data

    def create_fonepay_qr(
        self,
        *,
        amount_paisa: int,
        customer: Dict[str, str],
        metadata: Optional[Dict[str, Any]] = None,
        idempotency_key: str = '',
    ) -> Dict[str, Any]:
        """
        Mint a Fonepay Direct-QR for in-app display (no hosted redirect).

        Docs: POST /v1/qr/fonepay — returns qr_image (data URL), qr_message,
        events_url, and expires_at (~3 min display window).
        """
        if amount_paisa < MIN_PAISA:
            raise PayBridgeError('Minimum PayBridgeNP deposit is Rs. 10.00.', status_code=400)
        if amount_paisa > MAX_PAISA:
            raise PayBridgeError('Amount exceeds PayBridgeNP maximum.', status_code=400)

        name = str((customer or {}).get('name') or '').strip()
        email = str((customer or {}).get('email') or '').strip()
        if not name or not email:
            raise PayBridgeError(
                'Customer name and email are required for PayBridgeNP QR.',
                status_code=400,
            )

        if self.bypass_api:
            order = (metadata or {}).get('orderId') or 'bypass'
            session_id = f'cs_bypass_qr_{order}'
            return {
                'id': session_id,
                'amount': int(amount_paisa),
                'currency': 'NPR',
                'provider': 'fonepay',
                'status': 'initiated',
                'qr_message': f'BYPASS-QR-{order}',
                'qr_image': (
                    'data:image/svg+xml;utf8,'
                    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">'
                    '<rect width="100%" height="100%" fill="%23fff"/>'
                    '<text x="50%" y="50%" text-anchor="middle" fill="%23000">BYPASS QR</text>'
                    '</svg>'
                ),
                'events_url': f'{self.base_url}/v1/qr/{session_id}/events',
                'expires_at': None,
                'livemode': False,
            }

        body: Dict[str, Any] = {
            'amount': int(amount_paisa),
            'currency': 'NPR',
            'customer': {
                'name': name[:100],
                'email': email[:120],
            },
        }
        phone = str((customer or {}).get('phone') or '').strip()
        if phone:
            body['customer']['phone'] = phone[:30]
        if metadata:
            body['metadata'] = metadata

        data = self._request(
            'POST',
            QR_FONEPAY_PATH,
            body,
            idempotency_key=idempotency_key or '',
        )
        session_id = str(data.get('id') or '').strip()
        qr_image = str(data.get('qr_image') or data.get('qrImage') or '').strip()
        qr_message = str(data.get('qr_message') or data.get('qrMessage') or '').strip()
        if not session_id or (not qr_image and not qr_message):
            raise PayBridgeError(
                'PayBridgeNP did not return a Fonepay QR.',
                status_code=502,
                response_data=data,
            )
        return data

    def refresh_fonepay_qr(self, session_id: str) -> Dict[str, Any]:
        """Refresh the ~3-minute Fonepay QR display window for an existing session."""
        session_id = (session_id or '').strip()
        if not session_id:
            raise PayBridgeError('session_id is required', status_code=400)
        if self.bypass_api:
            return {
                'id': session_id,
                'amount': 0,
                'currency': 'NPR',
                'provider': 'fonepay',
                'status': 'initiated',
                'qr_message': f'BYPASS-QR-REFRESH-{session_id}',
                'qr_image': (
                    'data:image/svg+xml;utf8,'
                    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">'
                    '<rect width="100%" height="100%" fill="%23fff"/>'
                    '<text x="50%" y="50%" text-anchor="middle" fill="%23000">BYPASS QR</text>'
                    '</svg>'
                ),
                'events_url': f'{self.base_url}/v1/qr/{session_id}/events',
                'expires_at': None,
                'livemode': False,
            }
        data = self._request('POST', QR_REFRESH_PATH.format(id=session_id), {})
        if not isinstance(data, dict) or not str(data.get('id') or '').strip():
            raise PayBridgeError(
                'PayBridgeNP did not return a refreshed QR.',
                status_code=502,
                response_data=data if isinstance(data, dict) else {'raw': data},
            )
        return data

    def get_session(self, session_id: str) -> Dict[str, Any]:
        session_id = (session_id or '').strip()
        if not session_id:
            raise PayBridgeError('session_id is required', status_code=400)
        if self.bypass_api:
            return {
                'id': session_id,
                'status': 'pending',
                'paymentId': None,
                'amount': 0,
                'currency': 'NPR',
            }
        return self._request('GET', SESSION_PATH.format(id=session_id))

    def get_payment(self, payment_id: str) -> Dict[str, Any]:
        payment_id = (payment_id or '').strip()
        if not payment_id:
            raise PayBridgeError('payment_id is required', status_code=400)
        if self.bypass_api:
            return {
                'id': payment_id,
                'status': 'pending',
                'amount': 0,
                'currency': 'NPR',
            }
        return self._request('GET', PAYMENT_PATH.format(id=payment_id))


def to_paisa(amount) -> int:
    return HimalPayAPI.to_paisa(amount)


def to_rupees(paisa: int) -> Decimal:
    return HimalPayAPI.to_rupees(paisa)
