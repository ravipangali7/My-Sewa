"""
HimalPay Reseller API client.

Handles X-API-Key auth, paisa conversion, payments, service details,
cashback/charge calculation, and transaction status checks.
"""
import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


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
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.error_type = error_type
        self.response_data = response_data or {}


class HimalPayAPI:
    """HimalPay Reseller API client for wallet services."""

    SERVICE_NTC = 'NTC'
    SERVICE_NCELL = 'NCELL'
    SERVICE_BANK_TRANSFER = 'BANK_TRANSFER'
    SERVICE_BANK_TRANSFER_LIST = 'BANK_TRANSFER_LIST'
    SERVICE_BANK_TRANSFER_VERIFICATION = 'BANK_TRANSFER_VERIFICATION'

    def __init__(self):
        self.base_url = getattr(
            settings,
            'HIMALPAY_BASE_URL',
            'https://uatapi.himalpay.com.np/api/v1',
        ).rstrip('/')
        self.api_key = getattr(settings, 'HIMALPAY_API_KEY', '')
        self.bypass_api = getattr(settings, 'HIMALPAY_BYPASS_API', False)
        self.timeout = getattr(settings, 'HIMALPAY_TIMEOUT', 60)

    # ------------------------------------------------------------------
    # Amount helpers (rupees <-> paisa)
    # ------------------------------------------------------------------

    @staticmethod
    def to_paisa(amount_rupees) -> int:
        """Convert rupees (Decimal/float/str) to integer paisa."""
        value = Decimal(str(amount_rupees)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return int(value * 100)

    @staticmethod
    def to_rupees(amount_paisa) -> Decimal:
        """Convert integer paisa to Decimal rupees."""
        return (Decimal(int(amount_paisa)) / Decimal('100')).quantize(Decimal('0.01'))

    # ------------------------------------------------------------------
    # HTTP layer
    # ------------------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        if not self.api_key and not self.bypass_api:
            raise HimalPayError(
                'HimalPay API key is not configured. Set HIMALPAY_API_KEY in settings.',
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
            message = (
                data.get('error')
                or data.get('message')
                or data.get('detail')
                or f'HimalPay request failed ({response.status_code})'
            )
            raise HimalPayError(
                message=message,
                status_code=response.status_code,
                error_code=data.get('error_code'),
                error_type=data.get('error_type'),
                response_data=data if isinstance(data, dict) else {'raw': data},
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
        amount_paisa = self.to_paisa(amount_rupees)
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
        amount_paisa = self.to_paisa(amount_rupees)
        payload: Dict[str, Any] = {
            'wallet_service_name': wallet_service_name,
            'amount': amount_paisa,
            'merchant_transaction_id': merchant_transaction_id,
            'data': data,
        }
        if meta_data is not None:
            payload['meta_data'] = meta_data

        if self.bypass_api:
            return self._bypass_payment(
                wallet_service_name=wallet_service_name,
                amount_paisa=amount_paisa,
                merchant_transaction_id=merchant_transaction_id,
                data=data,
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
        data = {
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
            amount_rupees=amount_rupees,
            merchant_transaction_id=merchant_transaction_id,
            data=data,
        )

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

        return {'message': f'Bypass detail for {wallet_service_name}', 'data': data}

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
