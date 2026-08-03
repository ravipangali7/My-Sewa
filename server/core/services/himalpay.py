"""
HimalPay Reseller API client.

Handles X-API-Key auth, paisa conversion, payments, service details,
cashback/charge calculation, and transaction status checks.
"""
import logging
import time
from decimal import Decimal, ROUND_HALF_UP
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


def format_himalpay_error_message(
    message: str,
    error_code: Optional[int] = None,
    error_type: Optional[str] = None,
) -> str:
    """Human-readable HimalPay error; IP blocks include the outbound IP to allowlist."""
    base = (message or 'HimalPay request failed').strip()

    # Provider/reseller float or destination-side insufficient funds (often code 7004).
    if is_insufficient_balance_error(base):
        return (
            'Transaction failed due to insufficient balance at the payment provider. '
            'Please try again later or contact MySewa support if this continues.'
        )

    if not is_ip_not_allowed_error(base, error_code, error_type):
        return base

    outbound = get_outbound_public_ip()
    ip_hint = outbound or "this server's public IP"
    return (
        f'{base.rstrip(".")}. '
        f'Add {ip_hint} to the HimalPay dashboard IP Allowlist. '
        f'Do not add the API key UUID - only the server public IP address is allowed.'
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
        message = format_himalpay_error_message(message, error_code, error_type)
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.error_type = error_type
        self.response_data = response_data or {}
        self.is_ip_blocked = is_ip_not_allowed_error(message, error_code, error_type)


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
        self.bypass_api = getattr(settings, 'HIMALPAY_BYPASS_API', False)
        self.timeout = getattr(settings, 'HIMALPAY_TIMEOUT', 60)

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
                'HimalPay API key is not configured. '
                'Set it under Super Admin → Settings → Deposit account.',
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
    ) -> Any:
        url = f'{self.base_url}{endpoint}'
        logger.info('HimalPay %s %s payload=%s', method, endpoint, payload)

        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._headers(),
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout as exc:
            raise HimalPayError('HimalPay request timed out', status_code=504) from exc
        except requests.RequestException as exc:
            raise HimalPayError(f'HimalPay network error: {exc}', status_code=502) from exc

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

            raise HimalPayError(
                message=str(message),
                status_code=response.status_code,
                error_code=error_code if isinstance(error_code, int) else None,
                error_type=str(error_type) if error_type else None,
                response_data=response_data if isinstance(response_data, dict) else {'raw': response_data},
            )

        return data

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
    ) -> Dict:
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        logger.info(
            'HimalPay charge calc %s: Rs. %s → %s paisa',
            wallet_service_name,
            rupees,
            amount_paisa,
        )
        if self.bypass_api:
            charge = 500 if wallet_service_name == self.SERVICE_BANK_TRANSFER else 0
            cashback = 0
            return {
                'wallet_service_name': wallet_service_name,
                'amount': amount_paisa,
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
        return self.fetch_service_details(
            self.SERVICE_BANK_TRANSFER_VERIFICATION,
            data={
                'bank_code': bank_code,
                'account_name': account_name,
                'account_number': account_number,
                'merchant_txn_id': merchant_txn_id,
                'is_mobile': is_mobile,
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
        rupees = self.normalize_rupees(amount_rupees)
        amount_paisa = self.to_paisa(rupees)
        # Top-level amount + data.amount both in paisa (HimalPay bank-transfer contract).
        data = {
            'amount': amount_paisa,
            'destination_bank': destination_bank,
            'destination_acc_no': destination_acc_no,
            'destination_acc_name': destination_acc_name,
            'is_destination_mobile': is_destination_mobile,
            'transaction_remarks': transaction_remarks,
        }
        if transaction_remarks_2:
            data['transaction_remarks_2'] = transaction_remarks_2
        if transaction_remarks_3:
            data['transaction_remarks_3'] = transaction_remarks_3

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
    def parse_remittance_lookup(response: Any) -> Dict[str, Any]:
        """
        Normalize SAMSARA_GET response into flat fields for UI / payout.
        payout_amt from the vendor is in rupees; samsara_link_id is core_transaction_uuid.
        """
        root = response if isinstance(response, dict) else {}
        outer = root.get('data') if isinstance(root.get('data'), dict) else root
        inner = outer.get('data') if isinstance(outer.get('data'), dict) else {}

        link_id = (
            outer.get('core_transaction_uuid')
            or outer.get('core_transaction_id')
            or root.get('core_transaction_uuid')
            or ''
        )
        payout_raw = (
            inner.get('payout_amt')
            or outer.get('payout_amt')
            or root.get('payout_amt')
            or '0'
        )
        try:
            payout_amt = Decimal(str(payout_raw)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        except Exception:
            payout_amt = Decimal('0.00')

        ref_no = (
            inner.get('ref_no')
            or outer.get('reference_id')
            or root.get('reference_id')
            or ''
        )

        return {
            'samsara_link_id': str(link_id or ''),
            'ref_no': str(ref_no or ''),
            'payout_amt': payout_amt,
            'payout_currency': str(inner.get('payout_currency') or 'NPR'),
            'sender_name': str(inner.get('sender_name') or ''),
            'sender_address': str(inner.get('sender_address') or ''),
            'sender_city': str(inner.get('sender_city') or ''),
            'sender_country': str(inner.get('sender_country') or ''),
            'sender_mobile': str(inner.get('sender_mobile') or ''),
            'receiver_name': str(inner.get('receiver_name') or ''),
            'receiver_phone': str(inner.get('receiver_phone') or ''),
            'receiver_address': str(inner.get('receiver_address') or ''),
            'receiver_city': str(inner.get('receiver_city') or ''),
            'receiver_country': str(inner.get('receiver_country') or ''),
            'payment_type': str(inner.get('payment_type') or ''),
            'send_agent': str(inner.get('send_agent') or ''),
            'txn_date': str(inner.get('txn_date') or ''),
            'status': str(
                outer.get('status')
                or root.get('status')
                or outer.get('ms_status')
                or ''
            ),
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
    def extract_failure_details(response: Any) -> Dict[str, Any]:
        """
        Pull the best provider failure message + codes from a HimalPay payload.

        Prefer specific ``error`` / nested reasons over a bare status label.
        """
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

        provider_message = _text(
            root.get('error'),
            nested.get('error'),
            deeper.get('error'),
            root.get('message'),
            nested.get('message'),
            deeper.get('message'),
            root.get('detail'),
            nested.get('detail'),
            root.get('reason'),
            nested.get('reason'),
            deeper.get('reason'),
            root.get('status_message'),
            nested.get('status_message'),
        ) or 'Transaction failed'

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
    def extract_verified_account_name(response: Any, fallback: str = '') -> str:
        """
        Pull the bank-verified / original account holder name from a
        BANK_TRANSFER_VERIFICATION response. Falls back to the provided name.
        """
        if not isinstance(response, dict):
            return (fallback or '').strip()

        candidates = [
            response.get('account_name'),
            response.get('AccountName'),
            response.get('account_holder_name'),
            response.get('AccountHolderName'),
            response.get('destination_acc_name'),
            response.get('name'),
        ]
        nested = response.get('data') or response.get('Data') or {}
        if isinstance(nested, dict):
            candidates.extend([
                nested.get('account_name'),
                nested.get('AccountName'),
                nested.get('account_holder_name'),
                nested.get('AccountHolderName'),
                nested.get('destination_acc_name'),
                nested.get('name'),
            ])
            deeper = nested.get('data') or nested.get('Data') or {}
            if isinstance(deeper, dict):
                candidates.extend([
                    deeper.get('account_name'),
                    deeper.get('AccountName'),
                    deeper.get('account_holder_name'),
                    deeper.get('name'),
                ])

        for value in candidates:
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return (fallback or '').strip()

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
