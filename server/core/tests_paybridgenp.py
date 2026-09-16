"""
PayBridgeNP deposit: checkout create, signed webhook, idempotent credit.
"""
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

from .models import Deposit, Wallet
from .services.paybridge_deposit import (
    ALREADY_PROCESSED,
    SETTLED,
    create_paybridge_deposit,
    handle_webhook_event,
)
from .services.paybridgenp import verify_webhook_signature

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
class PayBridgeDepositTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone='9800000099', password='pass12345')
        Wallet.objects.get_or_create(user=self.user, defaults={'balance': Decimal('0.00')})
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_initiate_creates_pending_deposit(self, _cfg):
        deposit, url = create_paybridge_deposit(self.user, 500)
        self.assertEqual(deposit.provider, Deposit.PROVIDER_PAYBRIDGENP)
        self.assertIn(deposit.status, (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING))
        self.assertTrue(deposit.purchase_order_identifier.startswith('MS-PB-'))
        self.assertTrue(deposit.process_id)
        self.assertTrue(url)
        wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(wallet.balance, Decimal('0.00'))

    def test_webhook_signature_valid(self):
        body = json.dumps({'type': 'payment.succeeded', 'data': {'id': 'pay_x'}})
        header = _sign(body, 'whsec_unit_test')
        event = verify_webhook_signature(body, header, 'whsec_unit_test')
        self.assertEqual(event['type'], 'payment.succeeded')

    def test_webhook_signature_invalid(self):
        body = json.dumps({'type': 'payment.succeeded', 'data': {}})
        with self.assertRaises(Exception):
            verify_webhook_signature(body, 't=1,v1=deadbeef', 'whsec_unit_test')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_webhook_credits_once(self, _cfg):
        deposit, _ = create_paybridge_deposit(self.user, 500)
        order = deposit.purchase_order_identifier
        payment = {
            'id': 'pay_test_once',
            'status': 'success',
            'amount': 50000,
            'currency': 'NPR',
            'session_id': deposit.process_id,
            'metadata': {
                'orderId': order,
                'userId': str(self.user.pk),
                'depositId': str(deposit.pk),
                'type': 'wallet_deposit',
            },
        }
        event = {'type': 'payment.succeeded', 'data': payment}
        outcome, settled = handle_webhook_event(event)
        self.assertEqual(outcome, SETTLED)
        self.assertEqual(settled.status, Deposit.STATUS_APPROVED)
        wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(wallet.balance, Decimal('500.00'))

        outcome2, settled2 = handle_webhook_event(event)
        self.assertEqual(outcome2, ALREADY_PROCESSED)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('500.00'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_webhook_endpoint_http(self, _cfg):
        deposit, _ = create_paybridge_deposit(self.user, 100)
        payment = {
            'id': 'pay_http_1',
            'amount': 10000,
            'currency': 'NPR',
            'session_id': deposit.process_id,
            'metadata': {'orderId': deposit.purchase_order_identifier, 'depositId': str(deposit.pk)},
        }
        body = json.dumps({'type': 'payment.succeeded', 'data': payment})
        sig = _sign(body, 'whsec_unit_test')
        resp = self.client.post(
            reverse('webhooks_paybridgenp'),
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(resp.status_code, 200)
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)
        self.assertEqual(Wallet.objects.get(user=self.user).balance, Decimal('100.00'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_status_is_owner_only(self, _cfg):
        deposit, _ = create_paybridge_deposit(self.user, 50)
        other = User.objects.create_user(phone='9800000088', password='pass12345')
        other_client = APIClient()
        other_client.force_authenticate(user=other)
        resp = other_client.get(reverse('deposit_paybridge_status', args=[deposit.pk]))
        self.assertEqual(resp.status_code, 404)

        own = self.client.get(reverse('deposit_paybridge_status', args=[deposit.pk]))
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.data['orderId'], deposit.purchase_order_identifier)

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_amount_mismatch_does_not_credit(self, _cfg):
        deposit, _ = create_paybridge_deposit(self.user, 500)
        payment = {
            'id': 'pay_mismatch',
            'status': 'success',
            'amount': 10000,
            'currency': 'NPR',
            'metadata': {'orderId': deposit.purchase_order_identifier, 'depositId': str(deposit.pk)},
        }
        outcome, settled = handle_webhook_event({'type': 'payment.succeeded', 'data': payment})
        self.assertNotEqual(outcome, SETTLED)
        self.assertNotEqual(settled.status, Deposit.STATUS_APPROVED)
        self.assertEqual(Wallet.objects.get(user=self.user).balance, Decimal('0.00'))
