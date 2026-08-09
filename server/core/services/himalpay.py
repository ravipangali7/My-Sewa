"""
HimalPay Reseller API client.

Handles X-API-Key auth, paisa conversion, payments, service details,
cashback/charge calculation, and transaction status checks.
"""
import json
import logging
import re
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Cached outbound public IP (value, monotonic expiry).
_OUTBOUND_IP_CACHE: Tuple[Optional[str], float] = (None, 0.0)
_OUTBOUND_IP_TTL_SEC = 300


def get_outbound_public_ip(force: bool = False) -> Optional[str]:
    """
    Public IPv4 that HimalPay sees for requests from this server.
    Must be added to the HimalPay dashboard IP Allowlist (not the API key UUID).
    """
    global _OUTBOUND_IP_CACHE
    cached, expires = _OUTBOUND_IP_CACHE
    if not force and cached and time.monotonic() < expires:
        return cached

    ip: Optional[str] = None
    for url in (
        'https://api.ipify.org',
        'https://ifconfig.me/ip',
        'https://icanhazip.com',
    ):
        try:
            resp = requests.get(url, timeout=5)
            if resp.ok:
                candidate = (resp.text or '').strip()
                if candidate and ' ' not in candidate and len(candidate) < 64:
                    ip = candidate
                    break
        except requests.RequestException:
            continue

    _OUTBOUND_IP_CACHE = (ip, time.monotonic() + _OUTBOUND_IP_TTL_SEC)
    return ip


def is_ip_not_allowed_error(
    message: str = '',
    error_code: Optional[int] = None,
    error_type: Optional[str] = None,
) -> bool:
    text = (message or '').lower()
    etype = (error_type or '').lower()
    return (
        error_code == 9001
        or 'ipnotallowed' in etype
        or 'ip not allowed' in text
        or 'ip not allow' in text
    )


def is_insufficient_balance_error(message: str = '') -> bool:
    text = (message or '').lower()
    return (
        'insufficient balance' in text
        or 'insufficient fund' in text
        or 'not enough balance' in text
        or 'low balance' in text
    )


def is_route_not_found_error(
    message: str = '',
    status_code: Optional[int] = None,
    error_type: Optional[str] = None,
) -> bool:
    """True when HimalPay returns a Go-style missing route (common on LIVE)."""
    text = (message or '').strip().lower()
    etype = (error_type or '').strip().lower()
    return (
        status_code == 404
        or etype in {'resellerendpointnotfound', 'endpointnotfound'}
        or text == '404 page not found'
        or '404 page not found' in text
    )


RESELLER_LEDGER_UNAVAILABLE_MSG = (
    'HimalPay LIVE does not expose reseller statement/balance yet '
    '(/statement/reseller-statement, /wallet/reseller-balance — UAT only). '
    'Add HimalPay portal login under Admin → Settings → HimalPay to use '
    '/users/statement and /users/me/wallet on LIVE, or ask HimalPay to deploy '
    'the reseller ledger endpoints.'
)


# User-facing copy for known HimalPay error_code values (see himalpay-api.md).
_HIMALPAY_CODE_MESSAGES: Dict[int, str] = {
    1000: 'Payment service authentication failed. Please try again later or contact MySewa support.',
    1001: 'Payment service authentication failed. Please try again later or contact MySewa support.',
    1002: 'Payment service authentication failed. Please try again later or contact MySewa support.',
    1009: 'This payment service account is inactive. Please contact MySewa support.',
    1010: 'Too many attempts. Please wait a moment and try again.',
    1011: 'Transactions are temporarily on hold. Please try again later or contact MySewa support.',
    2000: 'Some payment details look invalid. Please check and try again.',
    2001: 'Some payment details look invalid. Please check and try again.',
    3000: 'Could not verify the transaction limit. Please try again.',
    3001: 'This transaction exceeds the allowed limit. Try a smaller amount.',
    6000: 'Some payment details look invalid. Please check and try again.',
    6001: 'Required payment details are missing. Please check and try again.',
    6002: 'Some payment details look invalid. Please check and try again.',
    6003: 'This request was already submitted. Please wait a moment or check your history.',
    6004: 'Some payment details look invalid. Please check and try again.',
    7000: 'This payment service is not available for your account right now.',
    7001: 'This payment service is temporarily disabled. Please try again later.',
    7002: 'This payment service is not available right now. Please try again later.',
    7003: 'This payment service is not available right now. Please try again later.',
    7004: 'The payment could not be completed. Please try again or contact MySewa support.',
    8000: 'Something went wrong with the payment service. Please try again later.',
    9000: 'Payment service is temporarily unavailable. Please try again later or contact MySewa support.',
    9001: 'Payment service is temporarily unavailable. Please try again later or contact MySewa support.',
    9002: 'Payment service is temporarily unavailable. Please try again later.',
    9003: 'Too many requests. Please wait a moment and try again.',
}

_TECHNICAL_MESSAGE_PATTERNS = (
    'servicelevel.',
    'systemlevel.',
    'jsonschema.',
    'requestvalidation.',
    'auth.',
    'limit.',
    'ip allowlist',
    'ip whitelist',
    'x-api-key',
    'api key',
    'api_key',
    'merchant_transaction_id',
    'wallet_service_name',
    'traceback',
    'exception',
    'status code',
    'http ',
)

# Short HimalPay catalog strings — replace with clearer MySewa copy.
_PROVIDER_CATALOG_JARGON = frozenset(
    {
        'wallet service is not allowed for this user',
        'wallet service is currently disabled',
        'wallet service not found',
        'wallet service is invalid or misconfigured',
        'transaction failed to process',
        'an unknown error occurred',
        'access from this ip address has been blocked',
        'access from this ip address is not allowed',
        'the service is currently unavailable',
        'rate limit exceeded, please try again later',
        'himalpay request failed',
        'request failed',
    }
)


_ENUM_TOKEN_RE = re.compile(r'\b[A-Za-z]+(?:Level)?\.[A-Za-z]+\b')


def is_technical_provider_message(message: str = '') -> bool:
    """True when a provider string is not suitable to show end users as-is."""
    text = (message or '').strip()
    if not text:
        return True
    lowered = text.lower()
    if lowered in _PROVIDER_CATALOG_JARGON:
        return True
    if any(p in lowered for p in _TECHNICAL_MESSAGE_PATTERNS):
        return True
    # Enum-like tokens: ServiceLevel.TransactionFailed, Auth.MissingAuthHeader
    return bool(_ENUM_TOKEN_RE.search(text))


def admin_himalpay_ip_hint() -> str:
    """Admin-only instruction for HimalPay IP allowlisting."""
    outbound = get_outbound_public_ip()
    ip_hint = outbound or "this server's public IP"
    return (
        f'Add {ip_hint} to the HimalPay dashboard IP Allowlist. '
        f'Do not add the API key UUID — only the server public IP address is allowed.'
    )


def format_himalpay_error_message(
    message: str,
    error_code: Optional[int] = None,
    error_type: Optional[str] = None,
) -> str:
    """
    User-friendly HimalPay error for app toasts / API ``message`` fields.

    Keeps actionable, plain-language provider issues (e.g. refunds, mismatches).
    Maps known codes and strips technical enums / allowlist instructions
    (admins get IP hints separately).
    """
    base = (message or '').strip()

    # Provider/reseller float or destination-side insufficient funds (often code 7004).
    if is_insufficient_balance_error(base):
        return (
            'Transaction failed due to insufficient balance at the payment provider. '
            'Please try again later or contact MySewa support if this continues.'
        )

    if is_ip_not_allowed_error(base, error_code, error_type) or error_code in (9000, 9001):
        return (
            'Payment service is temporarily unavailable. '
            'Please try again later or contact MySewa support.'
        )

    # Keep specific, readable provider sentences (refunds, invalid account, etc.).
    if base and not is_technical_provider_message(base):
        cleaned = base
        if error_type and error_type in cleaned:
            cleaned = cleaned.replace(error_type, '').strip(' .-:')
        if cleaned and not is_technical_provider_message(cleaned):
            # Capitalize first letter for toast polish.
            return cleaned[0].upper() + cleaned[1:] if cleaned else cleaned

    if error_code in _HIMALPAY_CODE_MESSAGES:
        return _HIMALPAY_CODE_MESSAGES[error_code]

    return (
        'The payment could not be completed. '
        'Please try again or contact MySewa support if this continues.'
    )


class HimalPayError(Exception):
    """Raised when HimalPay returns an error response."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        error_code: Optional[int] = None,
        error_type: Optional[str] = None,
        response_data: Optional[Dict] = None,
    ):
        raw_message = (message or '').strip()
        message = format_himalpay_error_message(raw_message, error_code, error_type)
        super().__init__(message)
        self.message = message
        self.provider_message = raw_message
        self.status_code = status_code
        self.error_code = error_code
        self.error_type = error_type
        self.response_data = response_data or {}
        self.is_ip_blocked = is_ip_not_allowed_error(raw_message, error_code, error_type)


class HimalPayAPI:
    """HimalPay Reseller API client for wallet services."""

    SERVICE_NTC = 'NTC'
    SERVICE_NCELL = 'NCELL'
    SERVICE_BANK_TRANSFER = 'BANK_TRANSFER'
    SERVICE_BANK_TRANSFER_LIST = 'BANK_TRANSFER_LIST'
    SERVICE_BANK_TRANSFER_VERIFICATION = 'BANK_TRANSFER_VERIFICATION'
    SERVICE_SAMSARA_GET = 'SAMSARA_GET'
    SERVICE_SAMSARA_PAY = 'SAMSARA_PAY'

    def __init__(self):
        from .app_config import get_himalpay_credentials

        creds = get_himalpay_credentials()
        self.base_url = creds['base_url']
        self.api_key = creds['api_key']
        self.portal_phone = (creds.get('portal_phone') or '').strip()
        self.portal_email = (creds.get('portal_email') or '').strip()
        self.portal_password = (creds.get('portal_password') or '').strip()
        self.bypass_api = getattr(settings, 'HIMALPAY_BYPASS_API', False)
        self.timeout = getattr(settings, 'HIMALPAY_TIMEOUT', 60)
        self._portal_token: Optional[str] = None

    # ------------------------------------------------------------------
    # Amount helpers (rupees <-> paisa)
    # ------------------------------------------------------------------
    # MySewa stores and accepts amounts in NPR rupees (e.g. 100.00).
    # HimalPay payment / charge / load APIs require integer paisa
    # (e.g. Rs. 100.00 → 10000). Always convert at the HimalPay boundary.

    @staticmethod
    def normalize_rupees(amount_rupees) -> Decimal:
        """Normalize any rupee input to Decimal with exactly 2 decimal places."""
        if amount_rupees is None or amount_rupees == '':
            raise HimalPayError('Amount is required', status_code=400)
        try:
            value = Decimal(str(amount_rupees).strip() if isinstance(amount_rupees, str) else str(amount_rupees))
        except Exception as exc:
            raise HimalPayError(f'Invalid amount: {amount_rupees}', status_code=400) from exc
        if not value.is_finite():
            raise HimalPayError(f'Invalid amount: {amount_rupees}', status_code=400)
        return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def to_paisa(amount_rupees) -> int:
        """
        Convert MySewa rupees to HimalPay paisa.

        Example: Rs. 100.00 → 10000 paisa (100 × 100).
        """
        value = HimalPayAPI.normalize_rupees(amount_rupees)
        if value < 0:
            raise HimalPayError('Amount cannot be negative', status_code=400)
        paisa = int((value * Decimal('100')).to_integral_value(rounding=ROUND_HALF_UP))
        # Round-trip check: paisa / 100 must equal the normalized rupees.
        round_trip = (Decimal(paisa) / Decimal('100')).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
        if round_trip != value:
            raise HimalPayError(
                f'Amount conversion mismatch: Rs. {value} → {paisa} paisa',
                status_code=400,
            )
        return paisa

    @staticmethod
    def to_rupees(amount_paisa) -> Decimal:
        """Convert HimalPay integer paisa to MySewa Decimal rupees."""
        try:
            paisa = int(amount_paisa)
        except (TypeError, ValueError) as exc:
            raise HimalPayError(f'Invalid paisa amount: {amount_paisa}', status_code=400) from exc
        return (Decimal(paisa) / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    # ------------------------------------------------------------------
    # HTTP layer
    # ------------------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        if not self.api_key and not self.bypass_api:
            raise HimalPayError(
                'Payment service is not configured yet. Please contact MySewa support.',
                status_code=500,
            )
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Key': self.api_key or 'BYPASS',
        }

    def _request(
        self,
        method: str,
        endpoint: str,
        payload: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ) -> Any:
        url = f'{self.base_url}{endpoint}'
        logger.info(
            'HimalPay %s %s params=%s payload=%s',
            method,
            endpoint,
            params,
            payload,
        )

        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._headers(),
                json=payload,
                params=params,
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
            data = {'error': response.text or 'Invalid JSON response from HimalPay'}

        if response.status_code >= 400:
            if isinstance(data, dict):
                message = (
                    data.get('error')
                    or data.get('message')
                    or data.get('detail')
                    or f'HimalPay request failed ({response.status_code})'
                )
                error_code = data.get('error_code')
                error_type = data.get('error_type')
                response_data = data
            else:
                message = str(data) if data else f'HimalPay request failed ({response.status_code})'
                error_code = None
                error_type = None
                response_data = {'raw': data}

            # Plain Go mux 404 bodies often arrive as raw text, not JSON.
            if response.status_code == 404 and is_route_not_found_error(
                str(message), response.status_code, str(error_type) if error_type else None
            ):
                error_type = error_type or 'ResellerEndpointNotFound'

            raise HimalPayError(
                message=str(message),
                status_code=response.status_code,
                error_code=error_code if isinstance(error_code, int) else None,
                error_type=str(error_type) if error_type else None,
                response_data=response_data if isinstance(response_data, dict) else {'raw': response_data},
            )

        return data

    def _has_portal_login(self) -> bool:
        return bool(self.portal_password and (self.portal_phone or self.portal_email))

    def _portal_auth_headers(self, token: str) -> Dict[str, str]:
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': f'Bearer {token}',
        }

    def _login_portal(self) -> str:
        """Exchange portal phone/email + password for a Bearer JWT."""
        if self._portal_token:
            return self._portal_token
        if not self._has_portal_login():
            raise HimalPayError(
                'HimalPay portal login is not configured.',
                status_code=500,
                error_type='ResellerEndpointNotFound',
            )

        if self.portal_phone:
            endpoint = '/auth/login'
            payload = {
                'mobile_no': self.portal_phone,
                'password': self.portal_password,
            }
        else:
            endpoint = '/auth/login/email'
            payload = {
                'email': self.portal_email,
                'password': self.portal_password,
            }

        # Avoid recursive X-API-Key auth for the consumer auth routes.
        url = f'{self.base_url}{endpoint}'
        try:
            response = requests.request(
                method='POST',
                url=url,
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
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
            data = {}

        if response.status_code >= 400 or not isinstance(data, dict):
            message = (
                (data.get('error') if isinstance(data, dict) else None)
                or (data.get('message') if isinstance(data, dict) else None)
                or 'HimalPay portal login failed'
            )
            raise HimalPayError(
                str(message),
                status_code=response.status_code or 401,
                error_code=(data.get('error_code') if isinstance(data, dict) else None),
                error_type=(data.get('error_type') if isinstance(data, dict) else None),
                response_data=data if isinstance(data, dict) else {'raw': data},
            )

        token = str(data.get('token') or '').strip()
        if not token:
            raise HimalPayError(
                'HimalPay portal login succeeded but no token was returned.',
                status_code=502,
            )
        self._portal_token = token
        return token

    def _request_bearer(
        self,
        method: str,
        endpoint: str,
        payload: Optional[Dict] = None,
        params: Optional[Dict] = None,
        *,
        _retried: bool = False,
    ) -> Any:
        token = self._login_portal()
        url = f'{self.base_url}{endpoint}'
        logger.info('HimalPay bearer %s %s params=%s', method, endpoint, params)
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._portal_auth_headers(token),
                json=payload,
                params=params,
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
            data = {'error': response.text or 'Invalid JSON response from HimalPay'}

        if response.status_code >= 400:
            if isinstance(data, dict):
                message = (
                    data.get('error')
                    or data.get('message')
                    or data.get('detail')
                    or f'HimalPay request failed ({response.status_code})'
                )
                error_code = data.get('error_code')
                error_type = data.get('error_type')
                response_data = data
            else:
                message = str(data) if data else f'HimalPay request failed ({response.status_code})'
                error_code = None
                error_type = None
                response_data = {'raw': data}

            # One retry after clearing a stale token.
            if response.status_code in (401, 403) and not _retried:
                self._portal_token = None
                return self._request_bearer(
                    method,
                    endpoint,
                    payload=payload,
                    params=params,
                    _retried=True,
                )

            raise HimalPayError(
                message=str(message),
                status_code=response.status_code,
                error_code=error_code if isinstance(error_code, int) else None,
                error_type=str(error_type) if error_type else None,
                response_data=response_data if isinstance(response_data, dict) else {'raw': response_data},
            )

        return data

    def _raise_ledger_unavailable(self, cause: Optional[Exception] = None) -> None:
        raise HimalPayError(
            RESELLER_LEDGER_UNAVAILABLE_MSG,
            status_code=404,
            error_type='ResellerEndpointNotFound',
        ) from cause

    def _get_portal_statement(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        transaction_id: Optional[str] = None,
    ) -> List[Dict]:
        """LIVE fallback: paginated GET /users/statement (Bearer portal JWT)."""
        entries: List[Dict] = []
        page = 1
        max_pages = 50
        while page <= max_pages:
            params: Dict[str, Any] = {'page': page, 'limit': 100}
            if transaction_id:
                params['transaction_uuid'] = str(transaction_id).strip()
            if from_date:
                params['from_date'] = str(from_date).strip()
            if to_date:
                params['to_date'] = str(to_date).strip()
            data = self._request_bearer('GET', '/users/statement', params=params)
            if isinstance(data, list):
                batch = data
                pagination: Dict[str, Any] = {}
            elif isinstance(data, dict):
                batch = data.get('data') or []
                pagination = data.get('pagination') or {}
            else:
                batch = []
                pagination = {}
            if isinstance(batch, list):
                entries.extend([row for row in batch if isinstance(row, dict)])
            total_pages = int(pagination.get('total_pages') or page)
            if page >= total_pages or not batch:
                break
            page += 1
        return entries

    def _get_portal_wallet(self) -> Dict:
        """LIVE fallback: GET /users/me/wallet (Bearer portal JWT)."""
        data = self._request_bearer('GET', '/users/me/wallet')
        if isinstance(data, dict) and isinstance(data.get('wallet'), dict):
            return data['wallet']
        return data if isinstance(data, dict) else {'data': data}

    # ------------------------------------------------------------------
    # Core endpoints
    # ------------------------------------------------------------------

    def list_services(self) -> List[Dict]:
        if self.bypass_api:
            return [
                {'id': 1, 'name': self.SERVICE_NTC, 'logo_image_url': None},
                {'id': 2, 'name': self.SERVICE_NCELL, 'logo_image_url': None},
                {'id': 3, 'name': self.SERVICE_BANK_TRANSFER, 'logo_image_url': None},
            ]
        data = self._request('GET', '/details/my-reseller-services')
        return data if isinstance(data, list) else data.get('data', data)

    def fetch_service_details(
        self,
        wallet_service_name: str,
        data: Optional[Dict] = None,
    ) -> Any:
        payload: Dict[str, Any] = {'wallet_service_name': wallet_service_name}
        if data is not None:
            payload['data'] = data

        if self.bypass_api:
            return self._bypass_detail(wallet_service_name, data or {})

        return self._request('POST', '/details/wallet-service-reseller-detail', payload)

    def calculate_cashback_and_charge(
        self,
        wallet_service_name: str,
        amount_rupees,
        merchant_transaction_id: Optional[str] = None,
    ) -> Dict:
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        # HimalPay reseller API requires merchant_transaction_id on calculate.
        # Use a CALC-prefixed id so it is never reused for payment/verify calls.
        calc_txn_id = (merchant_transaction_id or '').strip() or (
            f"MYSEWA_CALC_{uuid.uuid4().hex[:14].upper()}"
        )
        logger.info(
            'HimalPay charge calc %s txn=%s: Rs. %s → %s paisa',
            wallet_service_name,
            calc_txn_id,
            rupees,
            amount_paisa,
        )
        if self.bypass_api:
            charge = 500 if wallet_service_name == self.SERVICE_BANK_TRANSFER else 0
            cashback = 0
            return {
                'wallet_service_name': wallet_service_name,
                'amount': amount_paisa,
                'merchant_transaction_id': calc_txn_id,
                'applied_cashback': cashback,
                'applied_charge': charge,
                'net_amount': amount_paisa + charge - cashback,
                'charge': charge,
                'cashback': cashback,
                'total_debited': amount_paisa + charge - cashback,
                'message': 'Rules calculated successfully (bypass)',
            }

        payload = {
            'wallet_service_name': wallet_service_name,
            'amount': amount_paisa,
            'merchant_transaction_id': calc_txn_id,
        }
        result = self._request(
            'POST',
            '/details/reseller-calculate-cashback-and-charge',
            payload,
        )
        # Normalize field names across possible response shapes
        charge = result.get('applied_charge', result.get('charge', 0)) or 0
        cashback = result.get('applied_cashback', result.get('cashback', 0)) or 0
        net = result.get('net_amount', result.get('total_debited', amount_paisa + charge - cashback))
        result['charge'] = charge
        result['cashback'] = cashback
        result['total_debited'] = net
        result.setdefault('merchant_transaction_id', calc_txn_id)
        return result

    def process_payment(
        self,
        wallet_service_name: str,
        amount_rupees,
        merchant_transaction_id: str,
        data: Dict,
        meta_data: Optional[List] = None,
    ) -> Dict:
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        # Keep nested data.amount in sync when present (paisa), never send rupees.
        payload_data = dict(data or {})
        if 'amount' in payload_data:
            payload_data['amount'] = amount_paisa

        logger.info(
            'HimalPay payment %s txn=%s: Rs. %s → amount=%s paisa',
            wallet_service_name,
            merchant_transaction_id,
            rupees,
            amount_paisa,
        )

        payload: Dict[str, Any] = {
            'wallet_service_name': wallet_service_name,
            'amount': amount_paisa,
            'merchant_transaction_id': merchant_transaction_id,
            'data': payload_data,
        }
        if meta_data is not None:
            payload['meta_data'] = meta_data

        if self.bypass_api:
            return self._bypass_payment(
                wallet_service_name=wallet_service_name,
                amount_paisa=amount_paisa,
                merchant_transaction_id=merchant_transaction_id,
                data=payload_data,
            )

        return self._request(
            'POST',
            '/payments/wallet-service-reseller-payment',
            payload,
        )

    def check_transaction_status(self, merchant_transaction_id: str) -> Dict:
        if self.bypass_api:
            return {
                'merchant_transaction_id': merchant_transaction_id,
                'transaction_id': f'BYPASS-{merchant_transaction_id[-8:]}',
                'status': 'SUCCESS',
                'amount': 10000,
                'charge': 0,
                'cashback': 0,
                'total_debited': 10000,
                'reference_id': 'BYPASS-REF',
                'created_at': '2026-07-30T00:00:00Z',
            }

        return self._request(
            'POST',
            '/transactions/wallet-service-reseller-status',
            {'merchant_transaction_id': merchant_transaction_id},
        )

    def get_reseller_statement(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        transaction_id: Optional[str] = None,
    ) -> List[Dict]:
        """
        Fetch reseller ledger statement entries.

        Preferred: GET /statement/reseller-statement (X-API-Key) — available on UAT.
        LIVE fallback: GET /users/statement (Bearer portal JWT) when reseller route 404s.
        """
        params: Dict[str, str] = {}
        if transaction_id:
            params['transaction_id'] = str(transaction_id).strip()
        if from_date:
            params['from_date'] = str(from_date).strip()
        if to_date:
            params['to_date'] = str(to_date).strip()

        if self.bypass_api:
            return self._bypass_reseller_statement(
                from_date=from_date,
                to_date=to_date,
                transaction_id=transaction_id,
            )

        try:
            data = self._request('GET', '/statement/reseller-statement', params=params or None)
        except HimalPayError as exc:
            if not is_route_not_found_error(exc.message, exc.status_code, exc.error_type):
                raise
            if not self._has_portal_login():
                self._raise_ledger_unavailable(exc)
            logger.warning(
                'Reseller statement route missing on %s; falling back to portal /users/statement',
                self.base_url,
            )
            try:
                return self._get_portal_statement(
                    from_date=from_date,
                    to_date=to_date,
                    transaction_id=transaction_id,
                )
            except HimalPayError as portal_exc:
                self._raise_ledger_unavailable(portal_exc)

        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            entries = data.get('data', [])
            return entries if isinstance(entries, list) else []
        return []

    def get_reseller_balance(self) -> Dict:
        """
        Current HimalPay reseller wallet balances.

        Preferred: GET /wallet/reseller-balance (X-API-Key) — available on UAT.
        LIVE fallback: GET /users/me/wallet (Bearer portal JWT) when reseller route 404s.
        """
        if self.bypass_api:
            return {
                'id': 1,
                'user_id': 1,
                'balance': 100_000_000,
                'bonus_balance': 0,
                'balance_in_rupees': 1_000_000.0,
                'bonus_balance_in_rupees': 0.0,
                'total_balance_in_rupees': 1_000_000.0,
                'created_at': '2026-01-01T00:00:00Z',
                'updated_at': '2026-08-09T00:00:00Z',
            }

        try:
            data = self._request('GET', '/wallet/reseller-balance')
        except HimalPayError as exc:
            if not is_route_not_found_error(exc.message, exc.status_code, exc.error_type):
                raise
            if not self._has_portal_login():
                self._raise_ledger_unavailable(exc)
            logger.warning(
                'Reseller balance route missing on %s; falling back to portal /users/me/wallet',
                self.base_url,
            )
            try:
                return self._get_portal_wallet()
            except HimalPayError as portal_exc:
                self._raise_ledger_unavailable(portal_exc)

        return data if isinstance(data, dict) else {'data': data}

    def _bypass_reseller_statement(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        transaction_id: Optional[str] = None,
    ) -> List[Dict]:
        txn_uuid = (transaction_id or '').strip() or 'BYPASS-STMT-001'
        return [
            {
                'direction': 'debit',
                'amount': 10000,
                'balance_before': 100_010_000,
                'balance_after': 100_000_000,
                'bonus_balance_before': 0,
                'bonus_balance_after': 0,
                'is_refund': False,
                'is_cashback': False,
                'is_charge': False,
                'reference_id': 'BYPASS-REF',
                'created_at': '2026-08-09T10:00:00Z',
                'transaction_uuid': txn_uuid,
                'status': 'SUCCESS',
                'wallet_service_name': self.SERVICE_NTC,
                'wallet_service_logo_url': None,
                'transaction_cashback': 0,
                'transaction_charge': 0,
            },
        ]

    # ------------------------------------------------------------------
    # Convenience methods
    # ------------------------------------------------------------------

    def topup_ntc(self, mobile_number: str, amount_rupees, merchant_transaction_id: str) -> Dict:
        return self.process_payment(
            wallet_service_name=self.SERVICE_NTC,
            amount_rupees=amount_rupees,
            merchant_transaction_id=merchant_transaction_id,
            data={'number': mobile_number},
        )

    def topup_ncell(self, mobile_number: str, amount_rupees, merchant_transaction_id: str) -> Dict:
        return self.process_payment(
            wallet_service_name=self.SERVICE_NCELL,
            amount_rupees=amount_rupees,
            merchant_transaction_id=merchant_transaction_id,
            data={'number': mobile_number},
        )

    def list_banks(self) -> Any:
        return self.fetch_service_details(self.SERVICE_BANK_TRANSFER_LIST)

    def verify_bank_account(
        self,
        bank_code: str,
        account_name: str,
        account_number: str,
        merchant_txn_id: str,
        is_mobile: str = 'n',
    ) -> Any:
        is_mobile_flag = 'y' if str(is_mobile).lower() in ('y', 'yes', 'true', '1') else 'n'
        return self.fetch_service_details(
            self.SERVICE_BANK_TRANSFER_VERIFICATION,
            data={
                'bank_code': bank_code,
                'account_name': account_name,
                'account_number': account_number,
                'merchant_txn_id': merchant_txn_id,
                'is_mobile': is_mobile_flag,
            },
        )

    def bank_transfer(
        self,
        amount_rupees,
        merchant_transaction_id: str,
        destination_bank: str,
        destination_acc_no: str,
        destination_acc_name: str,
        is_destination_mobile: str = 'n',
        transaction_remarks: str = 'Fund Transfer',
        transaction_remarks_2: str = '',
        transaction_remarks_3: str = '',
    ) -> Dict:
        """
        BANK_TRANSFER payment — matches HimalPay Reseller three-step flow.

        Top-level ``amount`` is paisa. Nested ``data`` follows the documented
        contract (amount + destination fields + remarks). Always send
        remarks_2/remarks_3 (empty string when unused), same as the UAT demo.
        """
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        is_mobile = 'y' if str(is_destination_mobile).lower() in ('y', 'yes', 'true', '1') else 'n'
        data = {
            'amount': amount_paisa,
            'destination_bank': destination_bank,
            'destination_acc_no': destination_acc_no,
            'destination_acc_name': destination_acc_name,
            'is_destination_mobile': is_mobile,
            'transaction_remarks': transaction_remarks or 'Fund Transfer',
            'transaction_remarks_2': transaction_remarks_2 or '',
            'transaction_remarks_3': transaction_remarks_3 or '',
        }

        return self.process_payment(
            wallet_service_name=self.SERVICE_BANK_TRANSFER,
            amount_rupees=rupees,
            merchant_transaction_id=merchant_transaction_id,
            data=data,
        )

    def process_load(
        self,
        wallet_service_name: str,
        amount_rupees,
        merchant_transaction_id: str,
        data: Dict,
        meta_data: Optional[List] = None,
    ) -> Dict:
        """Credit/load endpoint used by Samsara remittance payout."""
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        payload_data = dict(data or {})
        if 'amount' in payload_data:
            payload_data['amount'] = amount_paisa

        logger.info(
            'HimalPay load %s txn=%s: Rs. %s → amount=%s paisa',
            wallet_service_name,
            merchant_transaction_id,
            rupees,
            amount_paisa,
        )

        payload: Dict[str, Any] = {
            'wallet_service_name': wallet_service_name,
            'amount': amount_paisa,
            'merchant_transaction_id': merchant_transaction_id,
            'data': payload_data,
        }
        if meta_data is not None:
            payload['meta_data'] = meta_data

        if self.bypass_api:
            return self._bypass_load(
                wallet_service_name=wallet_service_name,
                amount_paisa=amount_paisa,
                merchant_transaction_id=merchant_transaction_id,
                data=payload_data,
            )

        return self._request(
            'POST',
            '/loads/wallet-service-reseller-load',
            payload,
        )

    def lookup_remittance(self, ref_no: str) -> Dict:
        """Step 1: SAMSARA_GET — look up remittance by reference number."""
        return self.fetch_service_details(
            self.SERVICE_SAMSARA_GET,
            data={'ref_no': (ref_no or '').strip()},
        )

    def receive_remittance(
        self,
        amount_rupees,
        merchant_transaction_id: str,
        data: Dict,
        meta_data: Optional[List] = None,
    ) -> Dict:
        """Step 2: SAMSARA_PAY — process remittance payout load."""
        return self.process_load(
            wallet_service_name=self.SERVICE_SAMSARA_PAY,
            amount_rupees=amount_rupees,
            merchant_transaction_id=merchant_transaction_id,
            data=data,
            meta_data=meta_data,
        )

    @staticmethod
    def _coerce_mapping(value: Any) -> Dict[str, Any]:
        """Normalize dict / JSON-string / single-item list payloads into a dict."""
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                parsed = json.loads(text)
            except (TypeError, ValueError):
                return {}
            return HimalPayAPI._coerce_mapping(parsed)
        if isinstance(value, list):
            for item in value:
                mapped = HimalPayAPI._coerce_mapping(item)
                if mapped:
                    return mapped
        return {}

    @staticmethod
    def _iter_nested_dicts(value: Any, depth: int = 0):
        """Yield nested dict layers (including JSON-string / list wrappers)."""
        if depth > 8:
            return
        mapping = HimalPayAPI._coerce_mapping(value)
        if not mapping:
            return
        yield mapping
        for key in ('data', 'details', 'result', 'payload', 'response'):
            nested = mapping.get(key)
            if nested is None or nested is mapping:
                continue
            yield from HimalPayAPI._iter_nested_dicts(nested, depth + 1)

    @staticmethod
    def _first_present(mapping: Dict[str, Any], keys: Tuple[str, ...]) -> Any:
        for key in keys:
            if key not in mapping:
                continue
            value = mapping.get(key)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
        return None

    @staticmethod
    def _parse_vendor_rupees(raw: Any) -> Decimal:
        """
        Parse vendor remittance amounts (rupees). Accepts '50.0000', '1,500.00', 'NPR 50'.
        """
        if raw is None or raw == '':
            return Decimal('0.00')
        if isinstance(raw, bool):
            return Decimal('0.00')
        if isinstance(raw, (int, float, Decimal)):
            try:
                return Decimal(str(raw)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            except (InvalidOperation, ValueError):
                return Decimal('0.00')

        text = str(raw).strip()
        if not text:
            return Decimal('0.00')
        text = text.replace(',', '')
        text = re.sub(r'(?i)\b(?:npr|inr|rs\.?|rupees?)\b', '', text).strip()
        match = re.search(r'-?\d+(?:\.\d+)?', text)
        if not match:
            return Decimal('0.00')
        try:
            return Decimal(match.group(0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        except (InvalidOperation, ValueError):
            return Decimal('0.00')

    @staticmethod
    def parse_remittance_lookup(response: Any) -> Dict[str, Any]:
        """
        Normalize SAMSARA_GET response into flat fields for UI / payout.
        payout_amt from the vendor is in rupees; samsara_link_id is core_transaction_uuid.

        Live HimalPay payloads sometimes nest or stringify `data`, so this walks nested
        layers instead of assuming a fixed two-level shape.
        """
        root = HimalPayAPI._coerce_mapping(response)
        layers = list(HimalPayAPI._iter_nested_dicts(root))
        if not layers:
            layers = [root] if root else [{}]

        link_keys = (
            'core_transaction_uuid',
            'core_transaction_id',
            'samsara_link_id',
            'transaction_uuid',
        )
        payout_keys = (
            'payout_amt',
            'payout_amount',
            'PayoutAmt',
            'PayoutAmount',
            'pay_amount',
            'payoutAmt',
        )
        detail_marker_keys = (
            'ref_no',
            'receiver_name',
            'sender_name',
            'payout_amt',
            'payout_amount',
            'receiver_phone',
        )

        link_id = ''
        for layer in layers:
            found = HimalPayAPI._first_present(layer, link_keys)
            if found is not None:
                link_id = str(found).strip()
                break

        payout_raw = None
        for layer in layers:
            found = HimalPayAPI._first_present(layer, payout_keys)
            if found is not None:
                payout_raw = found
                break
        # Only accept generic `amount` from the vendor detail blob (has remittance fields).
        if payout_raw is None:
            for layer in layers:
                if not any(k in layer for k in detail_marker_keys):
                    continue
                found = HimalPayAPI._first_present(layer, ('amount', 'Amount'))
                if found is not None:
                    payout_raw = found
                    break

        payout_amt = HimalPayAPI._parse_vendor_rupees(payout_raw)

        detail: Dict[str, Any] = {}
        for layer in reversed(layers):
            if any(k in layer for k in detail_marker_keys):
                detail = layer
                break
        if not detail:
            detail = layers[-1] if layers else {}

        outer = layers[1] if len(layers) > 1 else layers[0]
        ref_no = (
            HimalPayAPI._first_present(detail, ('ref_no', 'reference_id', 'reference_no'))
            or HimalPayAPI._first_present(outer, ('reference_id', 'ref_no'))
            or HimalPayAPI._first_present(root, ('reference_id', 'ref_no'))
            or ''
        )

        status = (
            HimalPayAPI._first_present(outer, ('status', 'ms_status'))
            or HimalPayAPI._first_present(root, ('status', 'ms_status'))
            or HimalPayAPI._first_present(detail, ('status', 'ms_status'))
            or ''
        )

        if not link_id or payout_amt <= 0:
            logger.warning(
                'SAMSARA_GET parse incomplete link_id=%s payout_raw=%r payout_amt=%s keys=%s',
                link_id or '(none)',
                payout_raw,
                payout_amt,
                [sorted(layer.keys()) for layer in layers[:4]],
            )

        return {
            'samsara_link_id': str(link_id or ''),
            'ref_no': str(ref_no or ''),
            'payout_amt': payout_amt,
            'payout_currency': str(
                HimalPayAPI._first_present(detail, ('payout_currency', 'currency')) or 'NPR'
            ),
            'sender_name': str(detail.get('sender_name') or ''),
            'sender_address': str(detail.get('sender_address') or ''),
            'sender_city': str(detail.get('sender_city') or ''),
            'sender_country': str(detail.get('sender_country') or ''),
            'sender_mobile': str(detail.get('sender_mobile') or ''),
            'receiver_name': str(detail.get('receiver_name') or ''),
            'receiver_phone': str(detail.get('receiver_phone') or ''),
            'receiver_address': str(detail.get('receiver_address') or ''),
            'receiver_city': str(detail.get('receiver_city') or ''),
            'receiver_country': str(detail.get('receiver_country') or ''),
            'payment_type': str(detail.get('payment_type') or ''),
            'send_agent': str(detail.get('send_agent') or ''),
            'txn_date': str(detail.get('txn_date') or ''),
            'status': str(status or ''),
            'raw': root,
        }

    @staticmethod
    def normalize_status(response: Dict) -> str:
        """Normalize HimalPay status to lowercase success/failed/pending."""
        raw = (
            response.get('status')
            or response.get('Status')
            or response.get('transaction_status')
            or ''
        )
        status = str(raw).upper()
        if status in ('SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'OK'):
            return 'success'
        if status in ('FAILED', 'FAILURE', 'ERROR', 'DECLINED'):
            return 'failed'
        if status in ('UNKNOWN', 'PENDING', 'PROCESSING', 'IN_PROGRESS', ''):
            return 'pending'
        return 'pending'

    @staticmethod
    def is_remittance_already_received(
        message: str = '',
        response: Any = None,
    ) -> bool:
        """
        True when HimalPay/Samsara indicates the remittance was already paid out.

        SAMSARA_GET often still returns HTTP/outer SUCCESS with empty/zero
        ``payout_amt`` and the real reason in ``vendor_state`` (e.g. already
        received / already paid). Treat that as already-received, not as a
        missing-amount parse failure.
        """
        candidates = [message or '']
        if response is not None:
            candidates.append(HimalPayAPI.extract_provider_message(response))
            for layer in HimalPayAPI._iter_nested_dicts(response):
                for key in (
                    'vendor_state',
                    'message',
                    'error',
                    'detail',
                    'reason',
                    'status_message',
                    'ms_status',
                    'status',
                ):
                    value = layer.get(key)
                    if value is not None:
                        candidates.append(str(value))

        blob = ' '.join(c for c in candidates if c).casefold()
        if not blob:
            return False

        patterns = (
            'already received',
            'already paid',
            'already processed',
            'already cashed',
            'already collected',
            'already paid out',
            'already payout',
            'remittance already',
            'transaction already paid',
            'txn already paid',
            'paid already',
            'received already',
            'duplicate payout',
            'payment already made',
            'payout already',
        )
        return any(p in blob for p in patterns)

    @staticmethod
    def extract_provider_message(response: Any) -> str:
        """
        Raw HimalPay / vendor message without MySewa rewriting.

        Walks nested SAMSARA_GET payloads and prefers explicit error text, then
        vendor_state (e.g. "amount is locked" / "already received"), then other
        provider hints.
        """
        root = response if isinstance(response, dict) else {}
        nested = root.get('data') if isinstance(root.get('data'), dict) else {}
        nested_data = nested.get('data')
        deeper = nested_data if isinstance(nested_data, dict) else {}
        deepest = deeper.get('data') if isinstance(deeper.get('data'), dict) else {}
        nested_data_text = nested_data.strip() if isinstance(nested_data, str) else ''

        def _text(*values) -> str:
            for value in values:
                if value is None:
                    continue
                text = str(value).strip()
                if text:
                    return text
            return ''

        vendor_status = _text(
            nested.get('vendor_status'),
            deeper.get('vendor_status'),
            root.get('vendor_status'),
        )
        vendor_state = _text(
            nested.get('vendor_state'),
            deeper.get('vendor_state'),
            root.get('vendor_state'),
        )

        # Prefer vendor_state when it carries the actionable Samsara reason
        # (already received / amount locked) even if outer status is SUCCESS.
        return _text(
            vendor_state,
            nested_data_text,
            root.get('error'),
            nested.get('error'),
            deeper.get('error'),
            deepest.get('error'),
            root.get('message'),
            nested.get('message'),
            deeper.get('message'),
            deepest.get('message'),
            root.get('detail'),
            nested.get('detail'),
            deeper.get('detail'),
            root.get('reason'),
            nested.get('reason'),
            deeper.get('reason'),
            root.get('status_message'),
            nested.get('status_message'),
            deeper.get('status_message'),
            vendor_status if vendor_status not in ('0', '00', 'SUCCESS', 'OK') else '',
        )

    @staticmethod
    def extract_failure_details(response: Any) -> Dict[str, Any]:
        """
        Pull the best provider failure message + codes from a HimalPay payload.

        Prefer specific ``error`` / nested reasons over a bare status label.
        """
        provider_message = HimalPayAPI.extract_provider_message(response) or 'Transaction failed'
        root = response if isinstance(response, dict) else {}
        nested = root.get('data') if isinstance(root.get('data'), dict) else {}
        deeper = nested.get('data') if isinstance(nested.get('data'), dict) else {}

        def _text(*values) -> str:
            for value in values:
                if value is None:
                    continue
                text = str(value).strip()
                if text:
                    return text
            return ''

        # Keep a secondary status line when it adds refund/outcome context
        status_line = _text(
            root.get('message'),
            nested.get('message'),
            deeper.get('message'),
        )
        if (
            status_line
            and status_line.lower() != provider_message.lower()
            and (
                'refund' in status_line.lower()
                or 'payment failed' in status_line.lower()
            )
        ):
            provider_message = f'{provider_message}. {status_line}'

        error_code = (
            root.get('error_code')
            or nested.get('error_code')
            or deeper.get('error_code')
        )
        error_type = _text(
            root.get('error_type'),
            nested.get('error_type'),
            deeper.get('error_type'),
        ) or None

        if isinstance(error_code, str) and error_code.isdigit():
            error_code = int(error_code)
        if not isinstance(error_code, int):
            error_code = None

        message = format_himalpay_error_message(
            provider_message, error_code, error_type
        )
        lowered = f'{message} {status_line} {provider_message}'.lower()
        if 'amount refunded' in lowered or 'payment failed' in lowered:
            # HimalPay refunded the reseller float — MySewa never debited the user.
            message = (
                f'{message.rstrip(".")}. '
                'The payment provider could not complete this payment, '
                'so the amount was returned on the provider side. '
                'Your MySewa wallet was not charged.'
            )

        # Keep error_code / error_type in the structured response for clients/logs.
        # Do not append technical enums (e.g. ServiceLevel.TransactionFailed) into the
        # user-facing message — that made failures look cryptic in the app UI.

        return {
            'message': message,
            'provider_message': provider_message,
            'error_code': error_code,
            'error_type': error_type,
        }

    @staticmethod
    def extract_transaction_id(response: Dict) -> str:
        return str(
            response.get('transaction_id')
            or response.get('TransactionId')
            or (response.get('data') or {}).get('transaction_id')
            or (response.get('Data') or {}).get('TransactionId')
            or ''
        )

    @staticmethod
    def extract_reference_id(response: Dict) -> str:
        return str(
            response.get('reference_id')
            or response.get('ReferenceId')
            or (response.get('data') or {}).get('reference_id')
            or ''
        )

    @staticmethod
    def _first_nonempty(*candidates: Any) -> str:
        for value in candidates:
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return ''

    @staticmethod
    def _nested_dicts(response: Any) -> list:
        if not isinstance(response, dict):
            return []
        layers = [response]
        nested = response.get('data') or response.get('Data') or {}
        if isinstance(nested, dict):
            layers.append(nested)
            deeper = nested.get('data') or nested.get('Data') or {}
            if isinstance(deeper, dict):
                layers.append(deeper)
        return layers

    @staticmethod
    def normalize_account_name(name: str) -> str:
        return ' '.join(str(name or '').casefold().split())

    @staticmethod
    def normalize_account_number(number: str) -> str:
        return ''.join(ch for ch in str(number or '') if ch.isalnum()).upper()

    @staticmethod
    def normalize_bank_code(code: str) -> str:
        return str(code or '').strip().upper()

    @classmethod
    def names_match(cls, left: str, right: str) -> bool:
        a = cls.normalize_account_name(left)
        b = cls.normalize_account_name(right)
        return bool(a) and a == b

    @classmethod
    def extract_verified_account_name(cls, response: Any, fallback: str = '') -> str:
        """
        Pull the bank-verified / original account holder name from a
        BANK_TRANSFER_VERIFICATION response. Falls back to the provided name.
        """
        keys = (
            'account_name',
            'AccountName',
            'account_holder_name',
            'AccountHolderName',
            'destination_acc_name',
            'name',
        )
        candidates = []
        for layer in cls._nested_dicts(response):
            candidates.extend(layer.get(k) for k in keys)
        return cls._first_nonempty(*candidates) or (fallback or '').strip()

    @classmethod
    def extract_verified_account_number(cls, response: Any, fallback: str = '') -> str:
        keys = (
            'account_number',
            'AccountNumber',
            'destination_acc_no',
            'account_no',
            'AccountNo',
        )
        candidates = []
        for layer in cls._nested_dicts(response):
            candidates.extend(layer.get(k) for k in keys)
        return cls._first_nonempty(*candidates) or (fallback or '').strip()

    @classmethod
    def extract_verified_bank_code(cls, response: Any, fallback: str = '') -> str:
        keys = (
            'bank_code',
            'BankCode',
            'destination_bank',
            'bank',
        )
        candidates = []
        for layer in cls._nested_dicts(response):
            candidates.extend(layer.get(k) for k in keys)
        return cls._first_nonempty(*candidates) or (fallback or '').strip()

    @classmethod
    def verification_details_match(
        cls,
        response: Any,
        *,
        bank_code: str,
        account_number: str,
        account_name: str = '',
        require_name: bool = True,
    ) -> Dict[str, Any]:
        """
        Ensure provider-verified bank, account number, and (when required)
        account holder name all match the values the user entered.
        """
        verified_name = cls.extract_verified_account_name(response, fallback=account_name)
        verified_number = cls.extract_verified_account_number(
            response, fallback=account_number
        )
        verified_bank = cls.extract_verified_bank_code(response, fallback=bank_code)

        bank_ok = cls.normalize_bank_code(verified_bank) == cls.normalize_bank_code(bank_code)
        number_ok = cls.normalize_account_number(verified_number) == cls.normalize_account_number(
            account_number
        )
        if require_name:
            name_ok = cls.names_match(verified_name, account_name)
        else:
            # Phone transfers: accept any registered name returned by the provider
            name_ok = bool(cls.normalize_account_name(verified_name))

        matched = bool(bank_ok and number_ok and name_ok)
        return {
            'matched': matched,
            'bank_ok': bank_ok,
            'number_ok': number_ok,
            'name_ok': name_ok,
            'account_name': verified_name,
            'account_number': verified_number or account_number,
            'bank_code': verified_bank or bank_code,
        }

    @staticmethod
    def is_verification_success(response: Any) -> bool:
        """Return True when a verify response indicates a successful match."""
        if not isinstance(response, dict):
            return False
        if response.get('verified') is False:
            return False
        if response.get('verified') is True:
            return True

        status = str(
            response.get('status')
            or response.get('Status')
            or (response.get('data') or {}).get('status')
            or ''
        ).upper()
        if status in ('FAILED', 'FAILURE', 'ERROR', 'DECLINED', 'UNVERIFIED', 'MISMATCH'):
            return False
        if status in ('SUCCESS', 'SUCCESSFUL', 'OK', 'VERIFIED', 'MATCHED'):
            return True
        if response.get('error') or response.get('error_code'):
            return False
        # Successful HTTP detail responses often omit an explicit status flag
        return True

    # ------------------------------------------------------------------
    # Bypass / mock helpers (local development)
    # ------------------------------------------------------------------

    def _bypass_detail(self, wallet_service_name: str, data: Dict) -> Any:
        if wallet_service_name == self.SERVICE_BANK_TRANSFER_LIST:
            return {
                'banks': [
                    {'bank_code': 'LXBLNPKA', 'bank_name': 'Laxmi Sunrise Bank'},
                    {'bank_code': 'NARBNPKA', 'bank_name': 'Nabil Bank'},
                    {'bank_code': 'SCBLNPKA', 'bank_name': 'Standard Chartered Bank'},
                    {'bank_code': 'NICENPKA', 'bank_name': 'NIC Asia Bank'},
                    {'bank_code': 'HIMANPKA', 'bank_name': 'Himalayan Bank'},
                    {'bank_code': 'CTZNNPKA', 'bank_name': 'Citizens Bank International'},
                ],
                'message': 'Bypass bank list',
            }

        if wallet_service_name == self.SERVICE_BANK_TRANSFER_VERIFICATION:
            return {
                'verified': True,
                'account_name': data.get('account_name'),
                'account_number': data.get('account_number'),
                'bank_code': data.get('bank_code'),
                'message': 'Account verified successfully (bypass)',
            }

        if wallet_service_name == self.SERVICE_SAMSARA_GET:
            ref = (data.get('ref_no') or 'S1001227917').strip() or 'S1001227917'
            link_id = f'bypass{ref[-12:]}'.ljust(32, '0')[:32]
            return {
                'status': 'SUCCESS',
                'data': {
                    'core_transaction_id': link_id,
                    'core_transaction_uuid': link_id,
                    'data': {
                        'agent_session_id': '9779800000000',
                        'bank_name': '',
                        'pay_token_id': '279606',
                        'payment_type': 'Cash Pay',
                        'payout_amt': '1500.0000',
                        'payout_currency': 'NPR',
                        'process_id': '',
                        'receiver_address': 'Kathmandu',
                        'receiver_city': 'Kathmandu',
                        'receiver_country': 'NEPAL',
                        'receiver_name': 'TEST RECEIVER',
                        'receiver_phone': '9779800000000',
                        'ref_no': ref,
                        'send_agent': 'BYPASS AGENT',
                        'sender_address': 'testaddress',
                        'sender_city': 'testcity',
                        'sender_country': 'NEPAL',
                        'sender_id_exp_date': '',
                        'sender_id_no': '',
                        'sender_id_type': '',
                        'sender_mobile': '',
                        'sender_name': 'TEST SENDER',
                        'tran_no': '',
                        'trans_mode': '',
                        'txn_date': '8/2/2026 9:00:00 AM',
                    },
                    'microservice_transaction_id': '2',
                    'ms_status': 'SUCCESS',
                    'reference_id': ref,
                    'status': 'SUCCESS',
                    'vendor_state': '',
                    'vendor_status': '0',
                },
            }

        if wallet_service_name in ('WLINK_GET', 'VIANET_GET', 'SUBISU_GET', 'DISHHOME_GET'):
            username = data.get('username') or data.get('customer_id') or 'demo_user'
            return {
                'status': 'SUCCESS',
                'data': {
                    'session_id': 50001,
                    'name': 'Demo Customer',
                    'customer_name': 'Demo Customer',
                    'packages': [
                        {
                            'package_id': 800011,
                            'package': '25 Mbps Unlimited - 1 Month',
                            'amount': 120000,
                            'duration': '1 month',
                        },
                        {
                            'package_id': 800012,
                            'package': '50 Mbps Unlimited - 3 Months',
                            'amount': 320000,
                            'duration': '3 months',
                        },
                    ],
                    'username': username,
                },
            }

        if wallet_service_name in ('NTC_DATA_PACK_GET', 'NCELL_DATA_PACK_GET'):
            return {
                'status': 'SUCCESS',
                'data': {
                    'packages': [
                        {
                            'package_id': 20,
                            'product_code': 20,
                            'name': '1 GB - 7 Days',
                            'amount': 9900,
                            'validity': '7 days',
                            'volume': '1 GB',
                        },
                        {
                            'package_id': 21,
                            'product_code': 21,
                            'name': '5 GB - 28 Days',
                            'amount': 29900,
                            'validity': '28 days',
                            'volume': '5 GB',
                        },
                        {
                            'package_id': 22,
                            'product_code': '1_day_10min_India',
                            'name': 'Daily Pack - 1 Day',
                            'amount': 5500,
                            'validity': '1 day',
                            'volume': 'Unlimited',
                        },
                    ],
                },
            }

        return {'message': f'Bypass detail for {wallet_service_name}', 'data': data}

    def _bypass_load(
        self,
        wallet_service_name: str,
        amount_paisa: int,
        merchant_transaction_id: str,
        data: Dict,
    ) -> Dict:
        ref = str(data.get('samsara_link_id') or merchant_transaction_id)[-12:]
        return {
            'transaction_id': f'BYPASS-LOAD-{merchant_transaction_id[-10:]}',
            'status': 'SUCCESS',
            'amount': amount_paisa,
            'charge': 0,
            'cashback': 0,
            'total_credited': amount_paisa,
            'reference_id': f'S{ref}',
            'message': f'{wallet_service_name} load successful (bypass)',
            'created_at': '2026-08-02T00:00:00+05:45',
            'merchant_transaction_id': merchant_transaction_id,
            'data': data,
        }

    def _bypass_payment(
        self,
        wallet_service_name: str,
        amount_paisa: int,
        merchant_transaction_id: str,
        data: Dict,
    ) -> Dict:
        charge = 500 if wallet_service_name == self.SERVICE_BANK_TRANSFER else 0
        return {
            'status': 'SUCCESS',
            'wallet_service_name': wallet_service_name,
            'amount': amount_paisa,
            'charge': charge,
            'cashback': 0,
            'total_debited': amount_paisa + charge,
            'merchant_transaction_id': merchant_transaction_id,
            'transaction_id': f'BYPASS-{merchant_transaction_id[-10:]}',
            'reference_id': f'REF-{merchant_transaction_id[-8:]}',
            'data': data,
            'message': f'{wallet_service_name} payment successful (bypass)',
        }
