"""Himal Pay Checkout wallet deposit (payin) tests.

Official API: POST /checkout/checkout-initiate and POST /checkout/checkout-status
with header X-Checkout-API-Key. There is no documented webhook signature or
Checkout payout endpoint.
"""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from .models import Deposit, Wallet
from .services.checkout_deposit import (
    ALREADY_PROCESSED,
    AMOUNT_MISMATCH,
    FAILED_PAYMENT,
    PENDING_PAYMENT,
    SETTLED,
    create_checkout_deposit,
    extract_documented_identifiers,
    public_checkout_details,
    settle_from_checkout_status,
    verify_deposit,
)
from .services.himalpay import HimalPayError
from .services.himalpay_checkout import HimalPayCheckoutAPI

User = get_user_model()

PROCESS_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
ORDER_ID = 'ORDER-2026-00123'


def _status_payload(
    *,
    payment_status='completed',
    amount_paisa=100000,
    order_id=ORDER_ID,
    process_id=PROCESS_ID,
):
    return {
        'initialization': {
            'process_id': process_id,
            'merchant': {'name': 'Sita Store', 'mobile_no': '9800000000'},
            'return_url': 'https://example.com/callback',
            'amount': amount_paisa,
            'purchase_order_identifier': order_id,
            'product_name': 'MySewa Wallet Deposit',
            'status': 'completed',
            'message': 'checkout initialization completed',
        },
        'payment': {
            'process_id': process_id,
            'merchant': {'name': 'Sita Store', 'mobile_no': '9800000000'},
            'wallet_customer': {'name': 'Ram Bahadur', 'mobile_no': '9841000000'},
            'amount': amount_paisa,
            'status': payment_status,
            'message': 'transaction already completed' if payment_status == 'completed' else payment_status,
        },
    }


def _initiate_payload(order_id, process_id=PROCESS_ID):
    return {
        'status': 'completed',
        'message': 'Checkout initialization successful',
        'payload': {
            'process_id': process_id,
            'payment_url': f'https://pay.example/?process_id={process_id}',
            'expires_at': '2026-03-25T11:15:00+05:45',
            'expires_in': 900,
        },
    }


@override_settings(
    HIMALPAY_CHECKOUT_API_KEY='mck_test_key',
    HIMALPAY_CHECKOUT_BASE_URL='https://api.himalpay.com.np/api/v1',
    HIMALPAY_BYPASS_API=False,
    FRONTEND_URL='https://mysewa.example.com',
    BACKEND_ORIGIN='https://api.example.com',
    BACKEND_URL='https://api.example.com/database/',
)
class HimalPayCheckoutDepositTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            phone='9800000991',
            password='testpass123',
            email='checkout@example.com',
            first_name='Ram',
            last_name='Bahadur',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.wallet, _ = Wallet.objects.get_or_create(user=self.user)
        self.wallet.balance = Decimal('50.00')
        self.wallet.save(update_fields=['balance'])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _pending_deposit(self, amount='1000.00', order_id=ORDER_ID):
        return Deposit.objects.create(
            user=self.user,
            amount=Decimal(amount),
            status=Deposit.STATUS_PROCESSING,
            provider=Deposit.PROVIDER_HIMALPAY_CHECKOUT,
            purchase_order_identifier=order_id,
            process_id=PROCESS_ID,
            bank_name='Himal Pay',
            verification_status=Deposit.VERIFY_UNVERIFIED,
        )

    def test_create_deposit_pending_and_correct_amount(self):
        with patch.object(
            HimalPayCheckoutAPI,
            'initiate_checkout',
            return_value=_initiate_payload('ignored'),
        ) as mocked:
            deposit, payment_url = create_checkout_deposit(self.user, Decimal('1000.00'))
        self.assertTrue(mocked.called)
        args, kwargs = mocked.call_args
        self.assertEqual(kwargs['amount_rupees'], Decimal('1000.00'))
        self.assertEqual(kwargs['product_name'], 'MySewa Wallet Deposit')
        self.assertIn('order=', kwargs['return_url'])
        self.assertIn('/api/deposit/checkout/return/', kwargs['return_url'])
        self.assertEqual(deposit.status, Deposit.STATUS_PROCESSING)
        self.assertEqual(deposit.amount, Decimal('1000.00'))
        self.assertEqual(deposit.provider, Deposit.PROVIDER_HIMALPAY_CHECKOUT)
        self.assertEqual(deposit.process_id, PROCESS_ID)
        self.assertTrue(deposit.purchase_order_identifier)
        self.assertIn('process_id=', payment_url)
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_successful_verification_credits_wallet_once(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=100000, order_id=ORDER_ID)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            outcome, deposit = verify_deposit(deposit)
        self.assertEqual(outcome, SETTLED)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(deposit.status, 'approved')
        self.assertEqual(deposit.verification_status, Deposit.VERIFY_VERIFIED)
        self.assertEqual(deposit.verified_amount, Decimal('1000.00'))
        self.assertEqual(self.wallet.balance, Decimal('1050.00'))
        self.assertEqual(deposit.balance_before, Decimal('50.00'))
        self.assertEqual(deposit.balance_after, Decimal('1050.00'))

    def test_duplicate_callback_does_not_double_credit(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=100000, order_id=ORDER_ID)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            first, _ = verify_deposit(deposit)
            second, deposit = verify_deposit(deposit)
        self.assertEqual(first, SETTLED)
        self.assertEqual(second, ALREADY_PROCESSED)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('1050.00'))
        self.assertEqual(Deposit.objects.filter(user=self.user, status='approved').count(), 1)

    def test_amount_mismatch_does_not_credit(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=50000, order_id=ORDER_ID)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            outcome, deposit = verify_deposit(deposit)
        self.assertEqual(outcome, AMOUNT_MISMATCH)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(deposit.status, 'failed')
        self.assertEqual(deposit.verification_status, Deposit.VERIFY_MISMATCH)
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
        self.assertIn('mismatch', (deposit.failure_reason or '').lower())

    def test_failed_and_cancelled_payment_do_not_credit(self):
        for hp_status, local in (('failed', 'failed'), ('cancelled', 'cancelled'), ('expired', 'expired')):
            deposit = self._pending_deposit(order_id=f'{ORDER_ID}-{hp_status}')
            deposit.process_id = f'{PROCESS_ID}-{hp_status}'
            deposit.save(update_fields=['process_id'])
            payload = _status_payload(
                payment_status=hp_status,
                amount_paisa=100000,
                order_id=deposit.purchase_order_identifier,
                process_id=deposit.process_id,
            )
            with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
                outcome, deposit = verify_deposit(deposit)
            self.assertEqual(outcome, FAILED_PAYMENT)
            deposit.refresh_from_db()
            self.assertEqual(deposit.status, local)
            self.wallet.refresh_from_db()
            self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_started_payment_stays_pending(self):
        deposit = self._pending_deposit()
        payload = _status_payload(payment_status='started', amount_paisa=100000)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            outcome, deposit = verify_deposit(deposit)
        self.assertEqual(outcome, PENDING_PAYMENT)
        deposit.refresh_from_db()
        self.assertIn(deposit.status, ('pending', 'processing'))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_verify_endpoint_ignores_client_success_flag(self):
        deposit = self._pending_deposit()
        payload = _status_payload(payment_status='started', amount_paisa=100000)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            resp = self.client.post(
                reverse('deposit_checkout_verify'),
                {
                    'id': deposit.pk,
                    'status': 'completed',
                    'payment': 'success',
                    'amount': '99999',
                },
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertNotEqual(deposit.status, 'approved')
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
        self.assertEqual(resp.json().get('outcome'), PENDING_PAYMENT)

    def test_webhook_without_identifier_is_rejected(self):
        resp = self.client.post(
            reverse('deposit_checkout_webhook'),
            {'payment': {'status': 'completed'}, 'amount': 100000},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_webhook_duplicate_is_idempotent(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=100000, order_id=ORDER_ID)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            first = self.client.post(
                reverse('deposit_checkout_webhook'),
                {'process_id': PROCESS_ID},
                format='json',
            )
            second = self.client.post(
                reverse('deposit_checkout_webhook'),
                {'process_id': PROCESS_ID, 'payment': {'status': 'completed'}},
                format='json',
            )
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertTrue(second.json().get('already_processed'))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('1050.00'))

    def test_initiate_api_creates_pending_row(self):
        with patch.object(
            HimalPayCheckoutAPI,
            'initiate_checkout',
            return_value=_initiate_payload('x'),
        ):
            resp = self.client.post(
                reverse('deposit_checkout_initiate'),
                {'amount': '1000'},
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        body = resp.json()
        self.assertTrue(body.get('payment_url'))
        data = body.get('data') or {}
        self.assertEqual(data.get('status'), 'processing')
        self.assertEqual(Decimal(data.get('amount')), Decimal('1000.00'))
        details = data.get('checkout_details') or {}
        self.assertEqual(details.get('provider'), 'Himal Pay')
        self.assertEqual(details.get('product_name'), 'MySewa Wallet Deposit')
        self.assertEqual(details.get('currency'), 'NPR')
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_below_checkout_minimum_rejected(self):
        with self.assertRaises(HimalPayError):
            create_checkout_deposit(self.user, Decimal('9.99'))

    def test_order_mismatch_rejected(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=100000, order_id='SOME-OTHER-ORDER')
        outcome, deposit = settle_from_checkout_status(deposit, payload)
        from .services.checkout_deposit import ORDER_MISMATCH
        self.assertEqual(outcome, ORDER_MISMATCH)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
        self.assertEqual(deposit.verification_status, Deposit.VERIFY_MISMATCH)

    def test_extract_only_documented_identifiers(self):
        found = extract_documented_identifiers({
            'payment': {'status': 'completed', 'amount': 1},
            'nested': {'process_id': PROCESS_ID},
            'purchase_order_identifier': ORDER_ID,
            'secret': 'should-be-ignored',
        })
        self.assertEqual(found['process_id'], PROCESS_ID)
        self.assertEqual(found['purchase_order_identifier'], ORDER_ID)
        self.assertNotIn('secret', found)
        self.assertNotIn('status', found)

    def test_checkout_client_uses_checkout_header_not_reseller_key(self):
        api = HimalPayCheckoutAPI()
        api.api_key = 'mck_live_secret'
        headers = api._headers()
        self.assertEqual(headers['X-Checkout-API-Key'], 'mck_live_secret')
        self.assertNotIn('X-API-Key', headers)

    def test_admin_cannot_approve_unverified_checkout(self):
        staff = User.objects.create_user(
            phone='9800000992',
            password='testpass123',
            email='admin-co@example.com',
            is_staff=True,
            is_superuser=True,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        deposit = self._pending_deposit()
        admin_client = APIClient()
        admin_client.force_authenticate(user=staff)
        resp = admin_client.post(reverse('admin_approve_deposit', args=[deposit.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_no_checkout_payout_method(self):
        self.assertFalse(hasattr(HimalPayCheckoutAPI, 'payout'))
        self.assertFalse(hasattr(HimalPayCheckoutAPI, 'payin'))
        self.assertTrue(hasattr(HimalPayCheckoutAPI, 'initiate_checkout'))
        self.assertTrue(hasattr(HimalPayCheckoutAPI, 'checkout_status'))

    def test_initiate_requires_authentication(self):
        guest = APIClient()
        resp = guest.post(
            reverse('deposit_checkout_initiate'),
            {'amount': '1000'},
            format='json',
        )
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
        self.assertFalse(Deposit.objects.filter(user=self.user, provider='himalpay_checkout').exists())

    def test_initiate_rejects_invalid_amount(self):
        for amount in ('0', '-10', 'abc', '9.99'):
            resp = self.client.post(
                reverse('deposit_checkout_initiate'),
                {'amount': amount},
                format='json',
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, amount)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_initiate_provider_failure_does_not_credit(self):
        with patch.object(
            HimalPayCheckoutAPI,
            'initiate_checkout',
            side_effect=HimalPayError('Checkout unavailable', status_code=502),
        ):
            resp = self.client.post(
                reverse('deposit_checkout_initiate'),
                {'amount': '1000'},
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_502_BAD_GATEWAY)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
        failed = Deposit.objects.filter(user=self.user, provider='himalpay_checkout').first()
        self.assertIsNotNone(failed)
        self.assertEqual(failed.status, 'failed')
        self.assertNotEqual(failed.status, 'approved')

    def test_unknown_payment_status_does_not_credit(self):
        deposit = self._pending_deposit()
        payload = _status_payload(payment_status='unknown', amount_paisa=100000)
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            outcome, deposit = verify_deposit(deposit)
        self.assertEqual(outcome, PENDING_PAYMENT)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertNotEqual(deposit.status, 'approved')
        self.assertEqual(self.wallet.balance, Decimal('50.00'))

    def test_checkout_details_include_merchant_from_status(self):
        deposit = self._pending_deposit()
        deposit.provider_payload = _status_payload()
        deposit.save(update_fields=['provider_payload'])
        details = public_checkout_details(deposit)
        self.assertEqual(details['merchant_name'], 'Sita Store')
        self.assertEqual(details['merchant_phone'], '9800000000')
        self.assertEqual(details['product_name'], 'MySewa Wallet Deposit')
        self.assertEqual(details['currency'], 'NPR')

    def test_initiate_payload_uses_documented_fields(self):
        with patch.object(
            HimalPayCheckoutAPI,
            'initiate_checkout',
            return_value=_initiate_payload('x'),
        ) as mocked:
            create_checkout_deposit(self.user, Decimal('250.00'))
        kwargs = mocked.call_args.kwargs
        self.assertEqual(set(kwargs.keys()), {
            'amount_rupees', 'purchase_order_identifier', 'return_url',
            'product_name', 'customer_details',
        })
        self.assertIn('name', kwargs['customer_details'])
        self.assertIn('phone', kwargs['customer_details'])

    def test_return_endpoint_verifies_then_redirects(self):
        deposit = self._pending_deposit()
        payload = _status_payload(amount_paisa=100000, order_id=ORDER_ID)
        guest = APIClient()
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=payload):
            resp = guest.get(
                reverse('deposit_checkout_return'),
                {'order': ORDER_ID},
            )
        self.assertEqual(resp.status_code, status.HTTP_302_FOUND)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(deposit.status, 'approved')
        self.assertEqual(self.wallet.balance, Decimal('1050.00'))
        self.assertIn('/app/checkout-return', resp.url)


class HimalPayCheckoutRefundTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            phone='9800000993',
            password='testpass123',
            email='refund@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.wallet, _ = Wallet.objects.get_or_create(user=self.user)
        self.wallet.balance = Decimal('50.00')
        self.wallet.save(update_fields=['balance'])

    def test_refunded_status_reverses_credit(self):
        deposit = Deposit.objects.create(
            user=self.user,
            amount=Decimal('1000.00'),
            status=Deposit.STATUS_PROCESSING,
            provider=Deposit.PROVIDER_HIMALPAY_CHECKOUT,
            purchase_order_identifier='REFUND-ORDER',
            process_id='proc-refund',
            verification_status=Deposit.VERIFY_UNVERIFIED,
        )
        completed = _status_payload(
            amount_paisa=100000, order_id='REFUND-ORDER', process_id='proc-refund',
        )
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=completed):
            verify_deposit(deposit)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('1050.00'))

        refunded = _status_payload(
            payment_status='refunded',
            amount_paisa=100000,
            order_id='REFUND-ORDER',
            process_id='proc-refund',
        )
        with patch.object(HimalPayCheckoutAPI, 'checkout_status', return_value=refunded):
            outcome, deposit = verify_deposit(deposit)
        self.assertEqual(outcome, SETTLED)
        deposit.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(deposit.status, 'refunded')
        self.assertEqual(self.wallet.balance, Decimal('50.00'))
