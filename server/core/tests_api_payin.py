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
        self.assertEqual(body['provider'], 'paybridgenp')
        self.assertEqual(body['mode'], 'hosted')
        payment_url = body.get('payment_url') or body.get('checkout_url') or ''
        self.assertTrue(payment_url, 'API Payin must return an openable PayBridgeNP payment URL')
        self.assertNotIn('/api/deposit/paybridge/qr/', payment_url)
        self.assertNotIn('himalpay', payment_url.lower())
        self.assertNotIn('ncash', payment_url.lower())
        self.assertTrue(body['transaction_id'].startswith('MS-PB-'))
        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertEqual(deposit.provider, Deposit.PROVIDER_PAYBRIDGENP)
        self.assertEqual(deposit.source, Deposit.SOURCE_API)
        self.assertEqual(deposit.client_reference, 'PAYIN-1')
        self.assertEqual(deposit.initiated_by_id, self.partner.pk)
        self.assertEqual(deposit.user_id, self.receiver.pk)
        self.assertTrue((deposit.payment_url or '').strip())
        self.assertNotIn('/api/deposit/paybridge/qr/', deposit.payment_url or '')
        self.assertNotIn('himalpay', (deposit.payment_url or '').lower())
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('0.00'))
        self.assertTrue(ApiPayinLog.objects.filter(user=self.partner, reference='PAYIN-1').exists())

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_checkout')
    def test_payin_customer_overrides_passed_to_paybridge(self, mock_checkout, _cfg):
        mock_checkout.return_value = {
            'id': 'cs_customer_override',
            'checkout_url': 'https://checkout.paybridgenp.com/checkout/cs_customer_override',
            'flow': 'hosted',
            'expires_at': None,
        }
        self._auth()
        res = self.client.post(
            self.payin_url,
            {
                'receiver': self.receiver.phone,
                'amount': 100,
                'reference': 'PAYIN-CUST-1',
                'customer_name': 'Lucky 777 Player',
                'customer_email': 'player@lucky777.test',
                'customer_phone': '9800112233',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['mode'], 'hosted')
        mock_checkout.assert_called_once()
        kwargs = mock_checkout.call_args.kwargs
        self.assertEqual(kwargs['customer']['name'], 'Lucky 777 Player')
        self.assertEqual(kwargs['customer']['email'], 'player@lucky777.test')
        self.assertEqual(kwargs['customer']['phone'], '9800112233')
        # Default hosted Payin shows the PayBridge method picker.
        self.assertEqual(kwargs.get('flow'), 'hosted')
        self.assertFalse(kwargs.get('provider'))
        # Wallet credit target unchanged.
        deposit = Deposit.objects.get(pk=res.json()['deposit_id'])
        self.assertEqual(deposit.user_id, self.receiver.pk)
        self.assertEqual(res.json()['customer']['name'], 'Lucky 777 Player')
        self.assertEqual(res.json()['customer']['email'], 'player@lucky777.test')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_fonepay_qr')
    def test_payin_direct_qr_mode_returns_qr_image(self, mock_qr, _cfg):
        mock_qr.return_value = {
            'id': 'cs_direct_qr_1',
            'amount': 10000,
            'currency': 'NPR',
            'provider': 'fonepay',
            'status': 'initiated',
            'qr_message': 'REAL-QR-MSG',
            'qr_image': 'data:image/png;base64,abc',
            'events_url': 'https://api.paybridgenp.com/v1/qr/cs_direct_qr_1/events',
            'expires_at': None,
        }
        self._auth()
        res = self.client.post(
            self.payin_url,
            {
                'receiver': self.receiver.phone,
                'amount': 100,
                'reference': 'PAYIN-QR-1',
                'mode': 'direct_qr',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body['mode'], 'direct_qr')
        self.assertEqual(body['qr_image'], 'data:image/png;base64,abc')
        self.assertEqual(body['qr_message'], 'REAL-QR-MSG')
        self.assertTrue(body.get('events_url'))
        # Hosted URL not required for Direct-QR.
        self.assertFalse(body.get('checkout_url') or body.get('payment_url'))
        mock_qr.assert_called_once()
        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertEqual(deposit.source, Deposit.SOURCE_API)
        self.assertFalse((deposit.payment_url or '').strip())
        self.assertNotIn('/api/deposit/paybridge/qr/', deposit.payment_url or '')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_payin_invalid_mode_rejected(self, _cfg):
        self._auth()
        res = self.client.post(
            self.payin_url,
            {
                'receiver': self.receiver.phone,
                'amount': 100,
                'reference': 'PAYIN-BAD-MODE',
                'mode': 'himalpay',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get('code'), 'invalid_mode')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_fonepay_qr')
    @patch('core.services.api_payin_webhook.requests.post')
    def test_direct_qr_customer_and_webhook_credits_receiver(self, mock_post, mock_qr, _cfg):
        """Full flow: customer overrides + Direct-QR + webhook credits receiver wallet."""
        mock_resp = mock_post.return_value
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'
        mock_qr.return_value = {
            'id': 'cs_flow_qr_1',
            'amount': 10000,
            'currency': 'NPR',
            'provider': 'fonepay',
            'status': 'initiated',
            'qr_message': 'FLOW-QR',
            'qr_image': 'data:image/png;base64,flow',
            'events_url': 'https://api.paybridgenp.com/v1/qr/cs_flow_qr_1/events',
            'expires_at': None,
        }

        self.partner.api_webhook_url = 'https://lucky777.example/hooks/payin'
        self.partner.save(update_fields=['api_webhook_url'])

        self._auth()
        created = self.client.post(
            self.payin_url,
            {
                'receiver': self.receiver.phone,
                'amount': 100,
                'reference': 'PAYIN-FLOW-1',
                'mode': 'direct_qr',
                'customer_name': 'Lucky777 Player',
                'customer_email': 'p@lucky777.test',
                'customer_phone': '9811111111',
            },
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        body = created.json()
        self.assertEqual(body['mode'], 'direct_qr')
        self.assertEqual(body['qr_image'], 'data:image/png;base64,flow')
        self.assertEqual(body['customer']['name'], 'Lucky777 Player')
        self.assertEqual(body['customer']['email'], 'p@lucky777.test')
        self.assertEqual(body['customer']['phone'], '9811111111')
        self.assertEqual(body['receiver'], self.receiver.phone)

        qr_kwargs = mock_qr.call_args.kwargs
        self.assertEqual(qr_kwargs['customer']['name'], 'Lucky777 Player')
        self.assertEqual(qr_kwargs['customer']['phone'], '9811111111')

        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertEqual(deposit.user_id, self.receiver.pk)
        self.assertEqual(deposit.initiated_by_id, self.partner.pk)
        partner_bal_before = Wallet.objects.get(user=self.partner).balance

        payment = {
            'id': 'pay_flow_qr_1',
            'status': 'success',
            'amount': 10000,
            'currency': 'NPR',
            'metadata': {
                'orderId': deposit.purchase_order_identifier,
                'depositId': str(deposit.pk),
            },
        }
        event = {'type': 'payment.succeeded', 'data': payment}
        event_body = json.dumps(event)
        sig = _sign(event_body, 'whsec_unit_test')
        wh = self.client.post(
            reverse('webhooks_paybridgenp'),
            data=event_body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(wh.status_code, 200, wh.content)
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('100.00'))
        # API partner is not credited — only receiver wallet.
        self.assertEqual(Wallet.objects.get(user=self.partner).balance, partner_bal_before)
        self.assertTrue(mock_post.called)
        self.assertEqual(mock_post.call_args[0][0], 'https://lucky777.example/hooks/payin')
        self.assertEqual(mock_post.call_args.kwargs['json']['status'], 'SUCCESS')
        self.assertEqual(mock_post.call_args.kwargs['json']['reference'], 'PAYIN-FLOW-1')

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

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {
            'deposits_enabled': True,
            'min_deposit': 10,
            'max_deposit': 100000,
        },
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_checkout')
    def test_payin_never_calls_himalpay_checkout(self, mock_checkout, _cfg):
        """Game Payin must mint PayBridgeNP hosted checkout — not HimalPay."""
        mock_checkout.return_value = {
            'id': 'cs_paybridge_game_1',
            'checkout_url': 'https://checkout.paybridgenp.com/checkout/cs_paybridge_game_1',
            'flow': 'hosted',
            'expires_at': None,
        }
        self._auth()
        with patch('core.services.checkout_deposit.create_checkout_session') as mock_hp:
            res = self.client.post(
                self.payin_url,
                {
                    'receiver': self.receiver.phone,
                    'amount': 250,
                    'reference': 'PAYIN-PB-ONLY',
                },
                format='json',
            )
            self.assertEqual(res.status_code, 201, res.content)
            mock_hp.assert_not_called()
        body = res.json()
        self.assertEqual(body['provider'], 'paybridgenp')
        self.assertEqual(body['mode'], 'hosted')
        self.assertEqual(body['payment_url'], 'https://checkout.paybridgenp.com/checkout/cs_paybridge_game_1')
        self.assertEqual(body['checkout_url'], body['payment_url'])
        self.assertNotIn('/api/deposit/paybridge/qr/', body['payment_url'])
        self.assertNotIn('himalpay', body['payment_url'].lower())
        mock_checkout.assert_called_once()
        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertEqual(deposit.provider, Deposit.PROVIDER_PAYBRIDGENP)
        self.assertEqual(deposit.payment_url, body['payment_url'])
        kwargs = mock_checkout.call_args.kwargs
        self.assertEqual(kwargs.get('flow'), 'hosted')
        self.assertFalse(kwargs.get('provider'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_checkout')
    def test_payin_hosted_picker_opt_in_still_works(self, mock_checkout, _cfg):
        """checkout_flow=hosted keeps the PayBridge method picker (manual click)."""
        mock_checkout.return_value = {
            'id': 'cs_picker_1',
            'checkout_url': 'https://checkout.paybridgenp.com/checkout/cs_picker_1',
            'flow': 'hosted',
            'provider': 'fonepay',
            'expires_at': None,
        }
        self._auth()
        res = self.client.post(
            self.payin_url,
            {
                'receiver': self.receiver.phone,
                'amount': 100,
                'reference': 'PAYIN-PICKER-1',
                'checkout_flow': 'hosted',
                'provider': 'fonepay',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        kwargs = mock_checkout.call_args.kwargs
        self.assertEqual(kwargs.get('flow'), 'hosted')
        self.assertEqual(kwargs.get('provider'), 'fonepay')
        payment_url = res.json().get('payment_url') or ''
        self.assertNotIn('/api/deposit/paybridge/qr/', payment_url)

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.api_payin_webhook.requests.post')
    def test_developer_webhook_delivered_once(self, mock_post, _cfg):
        """PayBridge success → credit wallet → POST developer webhook once (idempotent)."""
        mock_resp = mock_post.return_value
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'

        self.partner.api_webhook_url = 'https://game.example/webhooks/mysewa-payin'
        self.partner.save(update_fields=['api_webhook_url'])

        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 400, 'reference': 'WH-DEV-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        self.assertEqual(deposit.initiated_by_id, self.partner.pk)

        payment = {
            'id': 'pay_dev_webhook_1',
            'status': 'success',
            'amount': 40000,
            'currency': 'NPR',
            'metadata': {
                'orderId': deposit.purchase_order_identifier,
                'depositId': str(deposit.pk),
                'apiUserId': str(self.partner.pk),
            },
        }
        event = {'type': 'payment.succeeded', 'data': payment}
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
        self.assertIsNotNone(deposit.developer_webhook_delivered_at)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('400.00'))
        self.assertEqual(mock_post.call_count, 1)
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], 'https://game.example/webhooks/mysewa-payin')
        payload = kwargs['json']
        self.assertEqual(payload['status'], 'SUCCESS')
        self.assertEqual(payload['reference'], 'WH-DEV-1')
        self.assertEqual(payload['amount'], 400)
        self.assertEqual(payload['transaction_id'], deposit.purchase_order_identifier)
        self.assertTrue(payload['success'])

        from .models import ApiPayinWebhookLog
        self.assertEqual(
            ApiPayinWebhookLog.objects.filter(
                deposit=deposit, status=ApiPayinWebhookLog.STATUS_SUCCESS,
            ).count(),
            1,
        )

        # Duplicate PayBridge webhook: no double credit, no second developer callback.
        r2 = self.client.post(
            webhook,
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('400.00'))
        self.assertEqual(mock_post.call_count, 1)

    def test_admin_can_save_webhook_url(self):
        admin = User.objects.create_user(phone='9800000199', password='pass12345')
        admin.is_staff = True
        admin.is_superuser = True
        admin.save()
        client = APIClient()
        client.force_authenticate(user=admin)
        url = reverse('admin_api_user_detail', kwargs={'user_id': self.partner.pk})
        res = client.patch(
            url,
            {'api_webhook_url': 'https://lucky777.example/hooks/payin'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.api_webhook_url, 'https://lucky777.example/hooks/payin')
        self.assertEqual(res.json()['data']['api_webhook_url'], self.partner.api_webhook_url)

        bad = client.patch(url, {'api_webhook_url': 'not-a-url'}, format='json')
        self.assertEqual(bad.status_code, 400)

    def test_docs_include_payin(self):
        from .services.api_docs import documentation_payload

        doc = documentation_payload()
        ids = {s['id'] for s in doc.get('api_sections') or []}
        self.assertIn('payin', ids)
        self.assertIn('payin-status', ids)
        self.assertEqual(doc['docs_version'], '1.6')
        payin = next(s for s in doc['api_sections'] if s['id'] == 'payin')
        self.assertEqual(payin['success_response']['provider'], 'paybridgenp')
        self.assertEqual(payin['success_response']['mode'], 'hosted')
        self.assertIn('paybridgenp.com', payin['success_response']['checkout_url'])
        self.assertNotIn('/api/deposit/paybridge/qr/', payin['success_response']['checkout_url'])
        self.assertNotIn('himalpay', payin['success_response']['checkout_url'].lower())

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_api_payin_return_shows_success_without_login_redirect(self, _cfg):
        """
        Lucky777 / API Payin: after QR success + settle, return_url must show
        Payment Successful as public HTML when no partner webhook URL is set —
        never redirect to /app/paybridge-return (UserShell would bounce
        unauthenticated payers to MySewa login).
        """
        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 350, 'reference': 'LUCKY-RET-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        order_id = deposit.purchase_order_identifier

        payment = {
            'id': 'pay_lucky_return_1',
            'status': 'success',
            'amount': 35000,
            'currency': 'NPR',
            'metadata': {'orderId': order_id, 'depositId': str(deposit.pk)},
        }
        event = {'type': 'payment.succeeded', 'data': payment}
        body = json.dumps(event)
        sig = _sign(body, 'whsec_unit_test')
        wh = self.client.post(
            reverse('webhooks_paybridgenp'),
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(wh.status_code, 200, wh.content)
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)

        # Unauthenticated browser return (game player has no MySewa session).
        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {'order': order_id},
        )
        self.assertEqual(ret.status_code, 200, ret.content)
        self.assertNotIn(ret.status_code, (301, 302, 303, 307, 308))
        html = ret.content.decode('utf-8')
        self.assertIn('Payment Successful', html)
        self.assertIn(order_id, html)
        self.assertNotIn('/app/paybridge-return', html)
        location = ret.get('Location') or ''
        self.assertNotIn('/app/paybridge-return', location)
        self.assertNotIn('login', location.lower())

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.api_payin_webhook.requests.post')
    def test_api_payin_return_posts_webhook_without_browser_to_webhook(self, mock_post, _cfg):
        """
        After PayBridge success, MySewa POSTs to Lucky777's webhook URL but must
        NOT open that API endpoint in the player browser (it only returns JSON).
        """
        mock_resp = mock_post.return_value
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'

        self.partner.api_webhook_url = 'https://lucky777.example/hooks/mysewa-payin'
        self.partner.save(update_fields=['api_webhook_url'])

        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'LUCKY-REDIR-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        order_id = deposit.purchase_order_identifier

        payment = {
            'id': 'pay_lucky_redir_1',
            'status': 'success',
            'amount': 10000,
            'currency': 'NPR',
            'metadata': {'orderId': order_id, 'depositId': str(deposit.pk)},
        }
        event = {'type': 'payment.succeeded', 'data': payment}
        body = json.dumps(event)
        sig = _sign(body, 'whsec_unit_test')
        wh = self.client.post(
            reverse('webhooks_paybridgenp'),
            data=body,
            content_type='application/json',
            HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
        )
        self.assertEqual(wh.status_code, 200, wh.content)
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)
        self.assertIsNotNone(deposit.developer_webhook_delivered_at)
        webhook_posts_after_settle = mock_post.call_count
        self.assertGreaterEqual(webhook_posts_after_settle, 1)

        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {
                'order': order_id,
                'session_id': deposit.process_id or 'cs_test',
                'status': 'success',
                'payment_id': 'pay_lucky_redir_1',
            },
        )
        # Webhook-only: show Payment Successful HTML — never redirect browser to webhook API.
        self.assertEqual(ret.status_code, 200, ret.content)
        html = ret.content.decode('utf-8')
        self.assertIn('Payment Successful', html)
        location = ret.get('Location') or ''
        self.assertNotIn('lucky777.example/hooks', location)
        self.assertNotIn('/app/paybridge-return', location)
        self.assertGreaterEqual(mock_post.call_count, webhook_posts_after_settle)

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.api_payin_webhook.requests.post')
    def test_api_payin_return_redirects_to_return_url_not_webhook(self, mock_post, _cfg):
        """Browser redirects only to api_return_url (game page), never webhook."""
        mock_resp = mock_post.return_value
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'

        self.partner.api_webhook_url = 'https://apilucky777.example/api/payments/mysewa/webhook/'
        self.partner.api_return_url = 'https://lucky777.example/deposit/done'
        self.partner.save(update_fields=['api_webhook_url', 'api_return_url'])

        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'LUCKY-RETURL-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        order_id = deposit.purchase_order_identifier

        payment = {
            'id': 'pay_lucky_returl_1',
            'status': 'success',
            'amount': 10000,
            'currency': 'NPR',
            'metadata': {'orderId': order_id, 'depositId': str(deposit.pk)},
        }
        event = {'type': 'payment.succeeded', 'data': payment}
        body = json.dumps(event)
        sig = _sign(body, 'whsec_unit_test')
        self.assertEqual(
            self.client.post(
                reverse('webhooks_paybridgenp'),
                data=body,
                content_type='application/json',
                HTTP_X_PAYBRIDGENP_SIGNATURE=sig,
            ).status_code,
            200,
        )

        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {'order': order_id, 'payment_id': 'pay_lucky_returl_1', 'status': 'success'},
        )
        self.assertIn(ret.status_code, (301, 302, 303, 307, 308), ret.content)
        location = ret['Location']
        self.assertTrue(location.startswith('https://lucky777.example/deposit/done'), location)
        self.assertIn('status=SUCCESS', location)
        self.assertNotIn('/api/payments/mysewa/webhook', location)
        self.assertTrue(mock_post.called)
        self.assertEqual(
            mock_post.call_args[0][0],
            'https://apilucky777.example/api/payments/mysewa/webhook/',
        )

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.api_payin_webhook.requests.post')
    @patch('core.services.paybridgenp.PayBridgeNPAPI.get_payment')
    def test_return_uses_payment_id_query_to_settle_and_notify(self, mock_get_payment, mock_post, _cfg):
        """Return URL payment_id must settle + webhook even before PayBridge webhook arrives."""
        mock_resp = mock_post.return_value
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'

        self.partner.api_webhook_url = 'https://lucky777.example/callback'
        self.partner.save(update_fields=['api_webhook_url'])

        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'LUCKY-PAYID-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])
        order_id = deposit.purchase_order_identifier
        # Simulate hosted checkout: session stored, payment id only on return URL.
        deposit.transaction_id = deposit.process_id or 'cs_pending'
        deposit.save(update_fields=['transaction_id'])

        mock_get_payment.return_value = {
            'id': 'pay_from_return_url',
            'status': 'success',
            'amount': 10000,
            'currency': 'NPR',
            'metadata': {'orderId': order_id, 'depositId': str(deposit.pk)},
        }

        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {
                'order': order_id,
                'session_id': deposit.process_id or '',
                'status': 'success',
                'payment_id': 'pay_from_return_url',
            },
        )
        deposit.refresh_from_db()
        self.assertEqual(deposit.status, Deposit.STATUS_APPROVED)
        self.assertEqual(deposit.transaction_id, 'pay_from_return_url')
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, Decimal('100.00'))
        self.assertTrue(mock_get_payment.called)
        self.assertTrue(mock_post.called)
        self.assertEqual(mock_post.call_args[0][0], 'https://lucky777.example/callback')
        # Webhook is POST-only — browser stays on Payment Successful HTML.
        self.assertEqual(ret.status_code, 200, ret.content)
        self.assertIn('Payment Successful', ret.content.decode('utf-8'))

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_api_payin_return_pending_stays_public(self, _cfg):
        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 150, 'reference': 'LUCKY-RET-PEND'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        deposit = Deposit.objects.get(pk=created.json()['deposit_id'])

        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {'order': deposit.purchase_order_identifier},
        )
        self.assertEqual(ret.status_code, 200, ret.content)
        html = ret.content.decode('utf-8')
        self.assertIn('Payment pending', html)
        self.assertNotIn('/app/paybridge-return', html)

    @override_settings(FRONTEND_URL='https://app.mysewa.test')
    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_app_deposit_return_still_redirects_to_frontend(self, _cfg):
        """In-app MySewa deposits keep the existing /app/paybridge-return URL."""
        from .services.paybridge_deposit import create_paybridge_deposit

        deposit, _ = create_paybridge_deposit(
            self.receiver,
            Decimal('100.00'),
            source=Deposit.SOURCE_APP,
            prefer_hosted=True,
            allow_reuse=False,
        )
        self.assertEqual(deposit.source, Deposit.SOURCE_APP)

        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {'order': deposit.purchase_order_identifier},
        )
        self.assertIn(ret.status_code, (301, 302, 303, 307, 308))
        location = ret['Location']
        self.assertIn('/app/paybridge-return', location)
        self.assertIn(deposit.purchase_order_identifier, location)

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_checkout')
    @patch('core.services.paybridgenp.PayBridgeNPAPI.create_fonepay_qr')
    def test_default_payin_uses_hosted_checkout_not_direct_qr(self, mock_qr, mock_checkout, _cfg):
        """Default Payin must mint PayBridge hosted checkout (method picker), not Direct-QR."""
        mock_checkout.return_value = {
            'id': 'cs_default_hosted_1',
            'checkout_url': 'https://checkout.paybridgenp.com/checkout/cs_default_hosted_1',
            'flow': 'hosted',
            'expires_at': None,
        }
        self._auth()
        res = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'PAYIN-DEFAULT-HOSTED'},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body['mode'], 'hosted')
        mock_checkout.assert_called_once()
        mock_qr.assert_not_called()
        kwargs = mock_checkout.call_args.kwargs
        self.assertEqual(kwargs.get('flow'), 'hosted')
        self.assertFalse(kwargs.get('provider'))
        payment_url = body.get('payment_url') or ''
        self.assertEqual(
            payment_url,
            'https://checkout.paybridgenp.com/checkout/cs_default_hosted_1',
        )
        self.assertNotIn('/api/deposit/paybridge/qr/', payment_url)

    def test_return_not_found_is_public_html(self):
        bare = APIClient()
        ret = bare.get(
            reverse('deposit_paybridge_return'),
            {'order': 'MS-PB-DOES-NOT-EXIST'},
        )
        self.assertEqual(ret.status_code, 200)
        self.assertIn('Payment not found', ret.content.decode('utf-8'))
        self.assertNotIn('/app/paybridge-return', ret.get('Location') or '')

    @patch('core.services.app_config.get_app_config', return_value={
        'payment': {'deposits_enabled': True, 'min_deposit': 10, 'max_deposit': 100000},
        'integrations': {},
    })
    def test_default_payin_opens_hosted_checkout_url(self, _cfg):
        """Default Payin payment_url is PayBridge hosted checkout, not MySewa QR page."""
        self._auth()
        created = self.client.post(
            self.payin_url,
            {'receiver': self.receiver.phone, 'amount': 100, 'reference': 'PAYIN-HOSTED-PAGE-1'},
            format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        body = created.json()
        self.assertEqual(body['mode'], 'hosted')
        payment_url = body.get('payment_url') or ''
        self.assertTrue(payment_url)
        self.assertNotIn('/api/deposit/paybridge/qr/', payment_url)
        deposit = Deposit.objects.get(pk=body['deposit_id'])
        self.assertNotIn('/api/deposit/paybridge/qr/', deposit.payment_url or '')
        # Bypass checkout_url is derived from return_url, not the QR page.
        self.assertIn('session_id=', payment_url)

    def test_qr_page_not_found_is_public_html(self):
        bare = APIClient()
        page = bare.get(
            reverse('deposit_paybridge_qr'),
            {'order': 'MS-PB-DOES-NOT-EXIST'},
        )
        self.assertEqual(page.status_code, 200)
        self.assertIn('Payment not found', page.content.decode('utf-8'))
