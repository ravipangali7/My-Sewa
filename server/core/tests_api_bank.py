from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import ApiIdempotencyRecord, BankTransferTransaction, Wallet
from .services.api_keys import enable_api_access
from .services.himalpay import HimalPayAPI, HimalPayError
from .services.himalpay_banks import BANK_LIST_CACHE_KEY

User = get_user_model()

BANKS = [
    {'bank_code': 'NABILNPKA', 'bank_name': 'Nabil Bank Limited'},
    {'bank_code': 'NICENPKA', 'bank_name': 'NIC Asia Bank Limited'},
]


def _wallet(user, balance):
    wallet, _ = Wallet.objects.get_or_create(user=user, defaults={'balance': Decimal('0.00')})
    wallet.balance = Decimal(balance)
    wallet.save(update_fields=['balance'])
    return wallet


class FakeHimalPay:
    SERVICE_BANK_TRANSFER = HimalPayAPI.SERVICE_BANK_TRANSFER
    normalize_bank_code = staticmethod(HimalPayAPI.normalize_bank_code)
    normalize_account_number = staticmethod(HimalPayAPI.normalize_account_number)
    normalize_account_name = staticmethod(HimalPayAPI.normalize_account_name)
    to_rupees = staticmethod(HimalPayAPI.to_rupees)
    names_match = staticmethod(HimalPayAPI.names_match)
    is_verification_success = staticmethod(HimalPayAPI.is_verification_success)

    def __init__(self):
        self.list_calls = 0
        self.verify_calls = 0
        self.pay_calls = 0
        self.verify_result = {
            'verified': True,
            'account_name': 'John Doe',
            'account_number': '1234567890123',
            'bank_code': 'NABILNPKA',
        }
        self.verify_exc = None
        self.pay_exc = None
        self.pay_response = {'status': 'SUCCESS', 'transaction_id': 'HP123', 'charge': 0, 'cashback': 0}
        self.pay_status = 'success'
        self.list_exc = None
        self.list_payload = {'banks': BANKS}

    def list_banks(self):
        self.list_calls += 1
        if self.list_exc:
            raise self.list_exc
        return self.list_payload

    def verify_bank_account(self, **kwargs):
        self.verify_calls += 1
        if self.verify_exc:
            raise self.verify_exc
        return dict(self.verify_result)

    def calculate_cashback_and_charge(self, *args, **kwargs):
        return {'charge': 0, 'cashback': 0}

    def bank_transfer(self, **kwargs):
        self.pay_calls += 1
        if self.pay_exc:
            raise self.pay_exc
        return dict(self.pay_response)

    def normalize_status(self, response):
        return self.pay_status

    def extract_failure_details(self, response):
        return {'message': 'Bank transfer failed.'}

    def extract_transaction_id(self, response):
        return (response or {}).get('transaction_id') or 'HP123'

    def extract_reference_id(self, response):
        return (response or {}).get('reference_id') or ''

    def verification_details_match(self, response, **kwargs):
        return HimalPayAPI.verification_details_match(response, **kwargs)


class ApiBankTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone='9800000501',
            password='testpass123',
            email='api-bank@example.com',
            first_name='Api',
            last_name='Bank',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.other = User.objects.create_user(
            phone='9800000502',
            password='testpass123',
            email='normal@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        _wallet(self.user, '5000.00')
        enable_api_access(self.user)
        self.user.refresh_from_db()
        self.api_key = self.user.api_key
        self.client = APIClient()
        self.hp = FakeHimalPay()
        cache.set(BANK_LIST_CACHE_KEY, BANKS, 3600)

    def _auth(self, key=None):
        self.client.credentials()
        self.client.force_authenticate(user=None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key or self.api_key}')

    def _get(self, name, **kwargs):
        self._auth(kwargs.pop('key', None))
        return self.client.get(reverse(name), **kwargs)

    def _post(self, name, payload, key=None):
        self._auth(key)
        return self.client.post(reverse(name), payload, format='json')

    def test_banklist_requires_api_key(self):
        resp = self.client.get(reverse('api_v1_banklist'))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(resp.json().get('code'), 'invalid_api_key')

    def test_banklist_rejects_invalid_key(self):
        resp = self._get('api_v1_banklist', key='not-a-real-key')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(resp.json().get('code'), 'invalid_api_key')

    def test_banklist_rejects_non_api_user(self):
        enable_api_access(self.other)
        self.other.is_api_user = False
        self.other.save(update_fields=['is_api_user'])
        resp = self._get('api_v1_banklist', key=self.other.api_key)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_banklist_returns_cached_himalpay_banks(self):
        with patch('core.services.himalpay_banks.HimalPayAPI', return_value=self.hp):
            resp = self._get('api_v1_banklist')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('source'), 'cache')
        self.assertEqual(data['data'][0]['bank_code'], 'NABILNPKA')
        self.assertEqual(self.hp.list_calls, 0)

    def test_banklist_refresh_calls_himalpay(self):
        cache.delete(BANK_LIST_CACHE_KEY)
        with patch('core.services.himalpay_banks.HimalPayAPI', return_value=self.hp):
            resp = self._get('api_v1_banklist')
            self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
            self.assertEqual(resp.json().get('source'), 'himalpay')
            self.assertEqual(self.hp.list_calls, 1)
            resp2 = self._get('api_v1_banklist')
            self.assertEqual(resp2.json().get('source'), 'cache')
            self.assertEqual(self.hp.list_calls, 1)

    def test_banklist_provider_failure(self):
        cache.delete(BANK_LIST_CACHE_KEY)
        self.hp.list_exc = HimalPayError('down', status_code=502)
        with patch('core.services.himalpay_banks.HimalPayAPI', return_value=self.hp):
            resp = self._get('api_v1_banklist')
        self.assertEqual(resp.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(resp.json().get('code'), 'provider_unavailable')

    @patch('core.services.api_bank.HimalPayAPI')
    def test_verifiedbank_success(self, mock_hp):
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        resp = self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()
        self.assertTrue(data.get('verified'))
        self.assertIn('0123', data['data']['account_number'])
        self.assertNotIn('1234567890123', data['data']['account_number'])
        self.assertEqual(self.hp.verify_calls, 1)

    @patch('core.services.api_bank.HimalPayAPI')
    def test_verifiedbank_name_mismatch(self, mock_hp):
        self.hp.verify_result = {
            'verified': True,
            'account_name': 'Someone Else',
            'account_number': '1234567890123',
            'bank_code': 'NABILNPKA',
        }
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        resp = self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        data = resp.json()
        self.assertFalse(data.get('verified'))
        self.assertEqual(data.get('code'), 'verification_failed')

    @patch('core.services.api_bank.HimalPayAPI')
    def test_verifiedbank_unsupported_bank(self, mock_hp):
        mock_hp.return_value = self.hp
        resp = self._post('api_v1_verifiedbank', {
            'bank_code': 'ZZZZNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'bank_not_supported')
        self.assertEqual(self.hp.verify_calls, 0)

    def test_verifiedbank_invalid_account_number(self):
        resp = self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '12',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'invalid_account_number')

    @patch('core.services.api_bank.HimalPayAPI')
    def test_verifiedbank_timeout(self, mock_hp):
        self.hp.verify_exc = HimalPayError('timeout', status_code=504)
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        resp = self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(resp.status_code, status.HTTP_504_GATEWAY_TIMEOUT)
        self.assertEqual(resp.json().get('code'), 'provider_timeout')

    def test_banktransfer_requires_verification(self):
        resp = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-1',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'verification_required')

    @patch('core.services.api_bank.is_auto_status_verified', return_value=True)
    @patch('core.services.api_bank.HimalPayAPI')
    def test_banktransfer_success_debits_wallet(self, mock_hp, _auto):
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        verify = self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        self.assertEqual(verify.status_code, status.HTTP_200_OK, verify.content)
        before = Wallet.objects.get(user=self.user).balance
        resp = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-OK',
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json()
        self.assertEqual(data.get('status'), 'SUCCESS')
        self.assertTrue(str(data.get('transaction_id', '')).startswith('MYSEWA_BT_'))
        self.user.wallet.refresh_from_db()
        self.assertLess(self.user.wallet.balance, before)
        after = self.user.wallet.balance
        txn = BankTransferTransaction.objects.get(merchant_txn_id=data['transaction_id'])
        self.assertEqual(txn.source, BankTransferTransaction.SOURCE_API)
        self.assertEqual(txn.client_reference, 'ORDER-BANK-OK')
        self.assertEqual(txn.status, 'success')

        replay = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-OK',
        })
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(replay.json().get('transaction_id'), data['transaction_id'])
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, after)

        history = self.client.get(reverse('api_developer_transfers'))
        # history uses session/token, not API key
        self.client.credentials()
        self.client.force_authenticate(user=self.user)
        history = self.client.get(reverse('api_developer_transfers'))
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        items = history.json().get('items') or []
        self.assertTrue(any(row.get('method') == 'API Bank Transfer' for row in items))

    @patch('core.services.api_bank.HimalPayAPI')
    def test_banktransfer_insufficient_balance(self, mock_hp):
        _wallet(self.user, '1.00')
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        resp = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-LOW',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'insufficient_balance')
        self.assertEqual(self.hp.pay_calls, 0)
        self.assertFalse(
            ApiIdempotencyRecord.objects.filter(user=self.user, reference='bank:ORDER-BANK-LOW').exists()
        )

    @patch('core.services.api_bank.is_auto_status_verified', return_value=True)
    @patch('core.services.api_bank.HimalPayAPI')
    def test_banktransfer_provider_failure_no_debit(self, mock_hp, _auto):
        self.hp.pay_status = 'failed'
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        before = Wallet.objects.get(user=self.user).balance
        resp = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-FAIL',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'transfer_failed')
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, before)
        self.assertFalse(
            ApiIdempotencyRecord.objects.filter(user=self.user, reference='bank:ORDER-BANK-FAIL').exists()
        )

    @patch('core.services.api_bank.is_auto_status_verified', return_value=False)
    @patch('core.services.api_bank.HimalPayAPI')
    def test_banktransfer_pending_does_not_debit(self, mock_hp, _auto):
        self.hp.pay_status = 'pending'
        mock_hp.return_value = self.hp
        mock_hp.normalize_bank_code = HimalPayAPI.normalize_bank_code
        mock_hp.normalize_account_number = HimalPayAPI.normalize_account_number
        mock_hp.normalize_account_name = HimalPayAPI.normalize_account_name
        self._post('api_v1_verifiedbank', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
        })
        before = Wallet.objects.get(user=self.user).balance
        resp = self._post('api_v1_banktransfer', {
            'bank_code': 'NABILNPKA',
            'bank_account_number': '1234567890123',
            'account_holder_name': 'John Doe',
            'amount': 1000,
            'reference': 'ORDER-BANK-PEND',
        })
        self.assertEqual(resp.status_code, status.HTTP_202_ACCEPTED, resp.content)
        self.assertEqual(resp.json().get('status'), 'PENDING')
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, before)

    def test_docs_include_bank_apis(self):
        self.client.force_authenticate(user=self.user)
        docs = self.client.get(reverse('api_developer_docs'))
        self.assertEqual(docs.status_code, status.HTTP_200_OK)
        body = docs.json()
        paths = [item['path'] for item in body.get('api_sections') or []]
        self.assertIn('/api/v1/banklist/', paths)
        self.assertIn('/api/v1/verifiedbank/', paths)
        self.assertIn('/api/v1/banktransfer/', paths)
        md = self.client.get(reverse('api_developer_docs_download'), {'doc_format': 'markdown'})
        self.assertIn(b'GET /api/v1/banklist/', md.content)
        html = self.client.get(reverse('api_developer_docs_download'), {'doc_format': 'html'})
        self.assertIn(b'Bank List API', html.content)
        self.assertIn(b'data-copy', html.content)
        pdf = self.client.get(reverse('api_developer_docs_download'), {'doc_format': 'pdf'})
        self.assertTrue(pdf.content.startswith(b'%PDF'))
        self.assertIn(b'Bank List API', pdf.content)
        self.assertIn(b'verifiedbank', pdf.content)
