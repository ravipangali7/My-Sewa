"""
N-Cash Merchant Checkout API client (Himal Pay).

Source of truth: https://uat.himalpay.com.np/docs/checkout
(Version 1.0, last updated March 2026)

Documented merchant-to-server endpoints:
  POST /checkout/checkout-initiate
  POST /checkout/checkout-status

Authentication: header ``X-Checkout-API-Key`` (not reseller ``X-API-Key``).

Amounts are integer paisa (1000 = NPR 10.00). Minimum amount is 1000 paisa.

The UAT docs list base URL https://uatapi.himalpay.com.np/api/v1 and do not
publish a separate production host. MySewa uses HIMALPAY_CHECKOUT_BASE_URL,
falling back to the existing production reseller host
https://api.himalpay.com.np/api/v1.

The Checkout documentation does not define:
  - a webhook/callback payload
  - HMAC / signature / checksum
  - merchant id / client id / signature key fields
  - a payout endpoint

Never treat a browser redirect as payment proof. Always call checkout-status.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Dict, Optional
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import requests
from django.conf import settings

from .himalpay import HimalPayAPI, HimalPayError

logger = logging.getLogger(__name__)

# Documented Checkout minimum (Paisa). 1000 = NPR 10.00.
CHECKOUT_MIN_PAISA = 1000

INITIATE_PATH = '/checkout/checkout-initiate'
STATUS_PATH = '/checkout/checkout-status'

# Checkout/Payin hosts. Reseller payouts keep using HIMALPAY_BASE_URL separately.
CHECKOUT_LIVE_BASE = 'https://api.himalpay.com.np/api/v1'
CHECKOUT_UAT_BASE = 'https://uatapi.himalpay.com.np/api/v1'

INITIATE_PATH = '/checkout/checkout-initiate'
STATUS_PATH = '/checkout/checkout-status'

PAYMENT_STATUS_STARTED = 'started'
PAYMENT_STATUS_COMPLETED = 'completed'
PAYMENT_STATUS_EXPIRED = 'expired'
PAYMENT_STATUS_FAILED = 'failed'
PAYMENT_STATUS_UNKNOWN = 'unknown'
PAYMENT_STATUS_REFUNDED = 'refunded'
PAYMENT_STATUS_CANCELLED = 'cancelled'

INIT_STATUS_COMPLETED = 'completed'
INIT_STATUS_FAILED = 'failed'


def get_himalpay_checkout_credentials() -> Dict[str, str]:
    """
    Resolve Checkout credentials: Settings.config.integrations first, then env.

    Checkout prefers a dedicated Web Checkout key. If that is empty, reuse the
    existing HimalPay reseller API key so checkout-initiate is still called
    and the HimalPay body can be returned to the client.
    """
    from django.conf import settings as django_settings
    from .app_config import get_app_config, get_himalpay_credentials

    env_key = (getattr(django_settings, 'HIMALPAY_CHECKOUT_API_KEY', '') or '').strip()
    env_base = (getattr(django_settings, 'HIMALPAY_CHECKOUT_BASE_URL', '') or '').strip()
    env_reseller_base = (
        getattr(django_settings, 'HIMALPAY_BASE_URL', '')
        or 'https://api.himalpay.com.np/api/v1'
    ).strip()
    env_return = (getattr(django_settings, 'HIMALPAY_CHECKOUT_RETURN_URL', '') or '').strip()

    try:
        integrations = get_app_config().get('integrations') or {}
    except Exception:
        integrations = {}

    db_key = str(integrations.get('himalpay_checkout_api_key') or '').strip()
    db_base = str(integrations.get('himalpay_checkout_base_url') or '').strip()
    db_reseller_base = str(integrations.get('himalpay_base_url') or '').strip()
    db_return = str(integrations.get('himalpay_checkout_return_url') or '').strip()

    dedicated_key = bool(db_key or env_key)
    api_key = db_key or env_key
    if not api_key:
        try:
            api_key = str(get_himalpay_credentials().get('api_key') or '').strip()
        except Exception:
            api_key = ''

    if dedicated_key:
        base = (db_base or env_base or CHECKOUT_LIVE_BASE).rstrip('/')
    else:
        base = (db_base or env_base or db_reseller_base or env_reseller_base).rstrip('/')
    return {
        'api_key': api_key,
        'base_url': base,
        'return_url': db_return or env_return,
        'dedicated_key': dedicated_key,
    }


def is_checkout_configured() -> bool:
    creds = get_himalpay_checkout_credentials()
    return bool(creds.get('api_key'))


def checkout_host_candidates(primary: str) -> list:
    """LIVE first (or the configured host), then the other Checkout environment."""
    primary = (primary or CHECKOUT_LIVE_BASE).rstrip('/')
    hosts = [primary]
    for extra in (CHECKOUT_LIVE_BASE, CHECKOUT_UAT_BASE):
        if extra not in hosts:
            hosts.append(extra)
    return hosts


def is_checkout_auth_error(exc: HimalPayError) -> bool:
    message = str(getattr(exc, 'message', '') or exc).lower()
    error_type = str(getattr(exc, 'error_type', '') or '').lower()
    if getattr(exc, 'status_code', None) not in (401, 403):
        return False
    return (
        'checkout api key' in message
        or 'checkout-api-key' in message
        or 'invalid auth' in message
        or 'invalidauth' in error_type.replace(' ', '')
        or 'missingauth' in error_type.replace(' ', '')
    )


def append_query(url: str, **params: str) -> str:
    """Attach query params to a return URL without dropping existing ones."""
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in params.items():
        if value:
            query[key] = value
    return urlunparse(parsed._replace(query=urlencode(query)))


def default_frontend_return_url() -> str:
    frontend = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    if frontend:
        return f'{frontend}/app/checkout-return'
    return '/app/checkout-return'


def default_merchant_return_url() -> str:
    """
    HimalPay return_url should hit our backend first so checkout-status
    runs even if the customer is not logged into the SPA.

    BACKEND_URL may include /database (admin). Use BACKEND_ORIGIN for the API.
    """
    origin = (getattr(settings, 'BACKEND_ORIGIN', '') or '').rstrip('/')
    if origin:
        return f'{origin}/api/deposit/checkout/return/'
    backend = (getattr(settings, 'BACKEND_URL', '') or '').rstrip('/')
    if backend.endswith('/database'):
        backend = backend[: -len('/database')]
    if backend:
        return f'{backend}/api/deposit/checkout/return/'
    return '/api/deposit/checkout/return/'


class HimalPayCheckoutAPI:
    """Server-side N-Cash Merchant Checkout client."""

    def __init__(self):
        creds = get_himalpay_checkout_credentials()
        self.base_url = creds['base_url']
        self.api_key = creds['api_key']
        self.configured_return_url = creds['return_url']
        self.timeout = getattr(settings, 'HIMALPAY_TIMEOUT', 60)
        self.bypass_api = getattr(settings, 'HIMALPAY_BYPASS_API', False)

    def _request_with_host_failover(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Any:
        """
        Call Checkout on the configured host, then the other environment.

        UAT Payin keys are rejected on LIVE (`invalid checkout api key`). Retrying
        UAT generates the QR without changing the reseller payout host/key.
        """
        last_error: Optional[HimalPayError] = None
        for host in checkout_host_candidates(self.base_url):
            self.base_url = host
            try:
                data = self._request(method, endpoint, payload)
                logger.info('HimalPay Checkout %s %s succeeded on %s', method, endpoint, host)
                return data
            except HimalPayError as exc:
                retry_status = endpoint == STATUS_PATH and exc.status_code in (404, 400)
                if is_checkout_auth_error(exc) or retry_status:
                    logger.warning(
                        'HimalPay Checkout %s failed on %s (%s); trying next Payin host',
                        endpoint,
                        host,
                        exc.status_code,
                    )
                    last_error = exc
                    continue
                raise
        if last_error:
            raise last_error
        raise HimalPayError('Himal Pay Checkout request failed', status_code=502)

    def _headers(self) -> Dict[str, str]:
        if not self.api_key and not self.bypass_api:
            raise HimalPayError(
                'Himal Pay Checkout is not configured. Add the Web Checkout API key '
                'from the N-Cash merchant portal under Admin → Settings. '
                'Do not replace the existing HimalPay reseller key.',
                status_code=503,
            )
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Checkout-API-Key': self.api_key or 'BYPASS',
        }

    def _request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Any:
        url = f'{self.base_url}{endpoint}'
        safe_payload = dict(payload or {})
        logger.info('HimalPay Checkout %s %s keys=%s', method, endpoint, sorted(safe_payload.keys()))

        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._headers(),
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout as exc:
            raise HimalPayError(
                'The payment service took too long to respond. Please try again.',
                status_code=504,
            ) from exc
        except requests.RequestException as exc:
            raise HimalPayError(
                'Could not reach the payment service. Check your connection and try again.',
                status_code=502,
            ) from exc

        try:
            data = response.json() if response.content else {}
        except ValueError:
            data = {'error': response.text or 'Invalid JSON response from HimalPay Checkout'}

        if response.status_code >= 400:
            if isinstance(data, dict):
                message = (
                    data.get('error')
                    or data.get('message')
                    or data.get('detail')
                    or f'HimalPay Checkout request failed ({response.status_code})'
                )
                error_code = data.get('error_code')
                error_type = data.get('error_type')
                response_data = data
            else:
                message = str(data) if data else f'HimalPay Checkout request failed ({response.status_code})'
                error_code = None
                error_type = None
                response_data = {'raw': data}

            raise HimalPayError(
                message=str(message),
                status_code=response.status_code,
                error_code=error_code if isinstance(error_code, int) else None,
                error_type=str(error_type) if error_type else None,
                response_data=response_data if isinstance(response_data, dict) else {'raw': response_data},
            )

        return data

    def initiate_checkout(
        self,
        *,
        amount_rupees,
        purchase_order_identifier: str,
        return_url: str,
        product_name: str,
        customer_details: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        POST /checkout/checkout-initiate

        Documented request fields: return_url, amount (paisa), purchase_order_identifier,
        product_name, optional customer_details {name, email, phone}.
        """
        paisa = HimalPayAPI.to_paisa(amount_rupees)
        if paisa < CHECKOUT_MIN_PAISA:
            raise HimalPayError(
                'Minimum Himal Pay Checkout amount is Rs. 10.00.',
                status_code=400,
            )
        payload: Dict[str, Any] = {
            'return_url': return_url,
            'amount': paisa,
            'purchase_order_identifier': purchase_order_identifier,
            'product_name': product_name,
        }
        if customer_details:
            cleaned = {
                key: str(value).strip()
                for key, value in customer_details.items()
                if key in ('name', 'email', 'phone') and str(value or '').strip()
            }
            if cleaned:
                payload['customer_details'] = cleaned

        if self.bypass_api:
            logger.warning(
                'HimalPay Checkout bypass is on; initiate will not call the live API.'
            )
            return {
                'status': INIT_STATUS_COMPLETED,
                'message': 'Checkout initialization bypassed',
                'payload': {
                    'process_id': f'bypass-{purchase_order_identifier}',
                    'payment_url': append_query(return_url, order=purchase_order_identifier),
                    'expires_at': None,
                    'expires_in': 900,
                },
            }

        data = self._request_with_host_failover('POST', INITIATE_PATH, payload)
        if not isinstance(data, dict):
            raise HimalPayError('Unexpected Checkout initiate response', status_code=502)
        init_status = str(data.get('status') or '').strip().lower()
        if init_status and init_status != INIT_STATUS_COMPLETED:
            raise HimalPayError(
                str(data.get('message') or 'Checkout initialization failed'),
                status_code=400,
                response_data=data,
            )
        inner = data.get('payload') if isinstance(data.get('payload'), dict) else {}
        process_id = str(inner.get('process_id') or '').strip()
        payment_url = str(inner.get('payment_url') or '').strip()
        if not process_id or not payment_url:
            raise HimalPayError(
                'Checkout did not return a process_id and payment_url.',
                status_code=502,
                response_data=data if isinstance(data, dict) else {'raw': data},
            )
        return data

    def checkout_status(self, process_id: str) -> Dict[str, Any]:
        """
        POST /checkout/checkout-status

        Documented request field: process_id.
        """
        process_id = (process_id or '').strip()
        if not process_id:
            raise HimalPayError('process_id is required', status_code=400)

        if self.bypass_api:
            logger.warning(
                'HimalPay Checkout bypass is on; status will not report a completed payment.'
            )
            return {
                'initialization': {
                    'process_id': process_id,
                    'status': INIT_STATUS_COMPLETED,
                    'amount': None,
                    'purchase_order_identifier': '',
                },
                'payment': {
                    'process_id': process_id,
                    'status': PAYMENT_STATUS_STARTED,
                    'message': 'payment not completed yet',
                    'amount': None,
                },
            }

        data = self._request_with_host_failover('POST', STATUS_PATH, {'process_id': process_id})
        if not isinstance(data, dict):
            raise HimalPayError('Unexpected Checkout status response', status_code=502)
        return data


def paisa_from_status_payload(payload: Dict[str, Any]) -> Optional[int]:
    """Read documented amount fields (integer paisa) from a checkout-status body."""
    payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
    initialization = (
        payload.get('initialization') if isinstance(payload.get('initialization'), dict) else {}
    )
    for source in (payment, initialization):
        raw = source.get('amount')
        if raw is None or raw == '':
            continue
        try:
            return int(raw)
        except (TypeError, ValueError):
            continue
    return None


def payment_status_from_payload(payload: Dict[str, Any]) -> str:
    payment = payload.get('payment') if isinstance(payload.get('payment'), dict) else {}
    return str(payment.get('status') or '').strip().lower()


def order_id_from_payload(payload: Dict[str, Any]) -> str:
    initialization = (
        payload.get('initialization') if isinstance(payload.get('initialization'), dict) else {}
    )
    return str(initialization.get('purchase_order_identifier') or '').strip()
