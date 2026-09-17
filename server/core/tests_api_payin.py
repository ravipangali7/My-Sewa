"""Payin / Wallet Load API (PayBridgeNP) — mirrors Fund Transfer API patterns."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import ApiIdempotencyRecord, ApiPayinLog, Deposit, Wallet
from .services.api_keys import generate_unique_api_key

User = get_user_model()


def _sign(body: str, secret: str, ts: int | None = None) -> str:
    timestamp = str(ts if ts is not None else int(time.time()))
    digest = hmac.new(
        secret.encode('utf-8'),
        f'{timestamp}.{body}'.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return f't={timestamp},v1={digest}'


@override_settings(
    PAYBRIDGENP_API_KEY='sk_test_unit',
    PAYBRIDGENP_WEBHOOK_SECRET='whsec_unit_test',
    PAYBRIDGENP_BYPASS_API=True,
    PAYBRIDGENP_BASE_URL='https://api.paybridgenp.com',
)
class ApiPayinTests(TestCase):
    def setUp(self):
        self.partner = User.objects.create_user(phone='9800000101', password='pass12345')
        self.partner.is_api_user = True
        self.partner.can_api_payin = True
        self.partner.api_key = generate_unique_api_key()
        self.partner.save()
        Wallet.objects.get_or_create(user=self.partner, defaults={'balance': Decimal('5000.00')})

        self.receiver = User.objects.create_user(phone='9800000102', password='pass12345')
        Wallet.objects.get_or_create(user=self.receiver, defaults={'balance': Decimal('0.00')})

        self.client = APIClient()
        self.payin_url = reverse('api_v1_payin')
        self.status_url = reverse('api_v1_payin_status')
        self.fund_url = reverse('api_v1_fund_transfer')

    def _auth(self, key=None):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key or self.partner.api_key}')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {
            'deposits_enabled': True,
            'min_deposit': 10,
            'max_deposit': 100000,
        },
        'integrations': {},
    })
    def test_payin_creates_pending_deposit(self, _cfg):
        self._auth()
        res = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 500, 'reference': 'PAYIN-1'},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['status'], 'PENDING')
        self.assertEqual(body['reference'], 'PAYIN-1')
        self.assertTrue(body['transaction_id'].startswith('MS-PB-'))
        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertEqual(deposit.source, Deposit.SOURCE_API)
        self.assertEqual(deposit.client_reference, 'PAYIN-1')
        self.assertEqual(deposit.initiated_by_id, self.partner.pk)
        self.assertEqual(deposit.user_id, self.receiver.pk)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('0.00'))
        self.assertTrue(ApiPayinLog.objects.filter(user=self.partner, reference='PAYIN-1').exists())

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_payin_idempotent_replay(self, _cfg):
        self._auth()
        first = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 200, 'reference': 'PAYIN-DUP'},
            format='json',
        )
        self.assertEqual(first.status_code, 201, first.content)
        second = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 200, 'reference': 'PAYIN-DUP'},
            format='json',
        )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(Deposit.objects.filter(client_reference='PAYIN-DUP').count(), 1)
        self.assertEqual(first.json()['transaction_id'], second.json()['transaction_id'])

    def test_invalid_api_key(self):
        self._auth('msw_invalid_key_value_xxxxxxxxxxxx')
        res = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'X'},
            format='json',
        )
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json().get('code'), 'invalid_api_key')

    def test_payin_permission_required(self):
        self.partner.can_api_payin = False
        self.partner.save(update_fields=['can_api_payin'])
        self._auth()
        res = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'NO-PERM'},
            format='json',
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get('code'), 'unauthorized_transaction')

    def test_invalid_amount(self):
        self._auth()
        res = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': -5, 'reference': 'BAD-AMT'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get('code'), 'invalid_amount')

    def test_receiver_not_found(self):
        self._auth()
        res = self.client.post(
            self.payin_url,
            {'receiver': '9800999999', 'amount': 100, 'reference': 'NO-USER'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json().get('code'), 'receiver_not_found')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_status_endpoint(self, _cfg):
        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 150, 'reference': 'STAT-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        status_res = self.client.get(self.status_url, {'reference': 'STAT-1'})
        self.assertEqual(status_res.status_code, 200, status_res.content)
        self.assertEqual(status_res.json()['reference'], 'STAT-1')
        self.assertIn(status_res.json()['status'], ('PENDING', 'SUCCESS', 'FAILED'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
        'transactions': {'min_transfer': 10, 'max_transfer': 100000},
    })
    def test_payout_fund_transfer_still_works(self, _cfg):
        """Existing Fund Transfer API must remain unchanged for API users without payin."""
        self.partner.can_api_payin = False
        self.partner.can_wallet_adjust = True
        self.partner.save(update_fields=['can_api_payin', 'can_wallet_adjust'])
        wallet, _ = Wallet.objects.get_or_create(user=self.partner)
        wallet.balance = Decimal('5000.00')
        wallet.save(update_fields=['balance'])
        self._auth()
        res = self.client.post(
            self.fund_url,
            {'receiver': self.receiver.phone, 'amount': 50, 'reference': 'FT-OK-1'},
            format='json',
        )
        self.assertIn(res.status_code, (200, 201), res.content)
        self.assertTrue(res.json().get('success'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_webhook_credits_once(self, _cfg):
        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 300, 'reference': 'WH-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        order_id = deposit.purchase_order_identifier
        payment = {
            'id': 'pay_unit_test_1',
            'status': 'success',
            'amount': 30000,
            'currency': 'NPR',
            'metadata': {'orderId': order_id, 'depositId': str(deposit.pk)},
        }
        event = {
            'type': 'payment.succeeded',
            'data': payment,
        }
        body = json.dumps(event)
        sig = _sign(body, 'whsec_unit_test')
        webhook = reverse('webhooks_paybridgenp')
        r1 = self.client.post(
            webhook,
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(r1.status_code, 200, r1.content)
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)
        bal = Wallet.objects.get(user=self.receiver).balance
        self.assertEqual(bal, Decimal('300.00'))

        # Duplicate webhook must not double-credit.
        r2 = self.client.post(
            webhook,
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('300.00'))

    def test_docs_include_payin(self):
        from .services.api_docs import documentation_payload

        doc = documentation_payload()
        ids = {s['id'] for s in doc.get('api_sections') or []}
        self.assertIn('payin', ids)
        self.assertIn('payin-status', ids)
        self.assertEqual(doc['docs_version'], '1.3')
