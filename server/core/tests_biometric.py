import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import BiometricAssertion, BiometricDevice, Wallet
from django.contrib.auth import get_user_model

User = get_user_model()


class BiometricAuthTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            phone='9800000401',
            password='testpass123',
            email='bio@example.com',
            first_name='Bio',
            last_name='User',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.user.transaction_pin = make_password('1234')
        self.user.save(update_fields=['transaction_pin'])
        Wallet.objects.get_or_create(user=self.user, defaults={'balance': Decimal('500.00')})
        wallet = Wallet.objects.get(user=self.user)
        wallet.balance = Decimal('500.00')
        wallet.save(update_fields=['balance'])
        self.recipient = User.objects.create_user(
            phone='9800000402',
            password='testpass123',
            email='bio-recv@example.com',
            first_name='Recv',
            last_name='Two',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        Wallet.objects.get_or_create(
            user=self.recipient, defaults={'balance': Decimal('10.00')},
        )
        recv_wallet = Wallet.objects.get(user=self.recipient)
        recv_wallet.balance = Decimal('10.00')
        recv_wallet.save(update_fields=['balance'])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.device_id = str(uuid.uuid4())
        self.secret = 'a' * 48

    def _enable(self, purpose):
        return self.client.post(
            reverse('biometric_enable'),
            {'device_id': self.device_id, 'secret': self.secret, 'purpose': purpose},
            format='json',
        )

    def test_enable_login_and_pin_independently(self):
        login_res = self._enable('login')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.login_biometric_enabled)
        self.assertFalse(self.user.transaction_pin_biometric_enabled)

        pin_res = self._enable('transaction_pin')
        self.assertEqual(pin_res.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.login_biometric_enabled)
        self.assertTrue(self.user.transaction_pin_biometric_enabled)

        profile = self.client.get(reverse('profile'))
        self.assertEqual(profile.status_code, status.HTTP_200_OK)
        body = profile.json()
        user = body.get('user') or body
        self.assertTrue(user.get('login_biometric_enabled'))
        self.assertTrue(user.get('transaction_pin_biometric_enabled'))

        disable_login = self.client.post(
            reverse('biometric_disable'),
            {'purpose': 'login', 'device_id': self.device_id},
            format='json',
        )
        self.assertEqual(disable_login.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertFalse(self.user.login_biometric_enabled)
        self.assertTrue(self.user.transaction_pin_biometric_enabled)

    def test_biometric_login_issues_token(self):
        self.assertEqual(self._enable('login').status_code, status.HTTP_200_OK)
        anon = APIClient()
        res = anon.post(
            reverse('biometric_login'),
            {'device_id': self.device_id, 'secret': self.secret},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))
        self.assertTrue(res.json().get('authenticated'))
        self.assertTrue(res.json().get('token'))
        self.assertTrue(Token.objects.filter(key=res.json()['token'], user=self.user).exists())

    def test_biometric_login_rejects_wrong_secret(self):
        self.assertEqual(self._enable('login').status_code, status.HTTP_200_OK)
        anon = APIClient()
        res = anon.post(
            reverse('biometric_login'),
            {'device_id': self.device_id, 'secret': 'b' * 48},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(res.json().get('authenticated'))

    def test_wallet_transfer_with_biometric_assertion(self):
        self.assertEqual(self._enable('transaction_pin').status_code, status.HTTP_200_OK)
        assertion = self.client.post(
            reverse('biometric_assertion'),
            {
                'device_id': self.device_id,
                'secret': self.secret,
                'purpose': 'transaction_pin',
            },
            format='json',
        )
        self.assertEqual(assertion.status_code, status.HTTP_200_OK)
        self.assertTrue(assertion.json().get('authenticated'))

        transfer = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': self.recipient.phone,
                'amount': '50.00',
                'remarks': 'Biometric transfer',
                'use_biometric': True,
            },
            format='json',
        )
        self.assertEqual(transfer.status_code, status.HTTP_201_CREATED, transfer.content)
        sender_wallet = Wallet.objects.get(user=self.user)
        recv_wallet = Wallet.objects.get(user=self.recipient)
        self.assertEqual(sender_wallet.balance, Decimal('450.00'))
        self.assertEqual(recv_wallet.balance, Decimal('60.00'))
        used = BiometricAssertion.objects.filter(user=self.user, used_at__isnull=False)
        self.assertEqual(used.count(), 1)

    def test_use_biometric_without_assertion_does_not_transfer(self):
        self.assertEqual(self._enable('transaction_pin').status_code, status.HTTP_200_OK)
        transfer = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': self.recipient.phone,
                'amount': '50.00',
                'use_biometric': True,
            },
            format='json',
        )
        self.assertEqual(transfer.status_code, status.HTTP_400_BAD_REQUEST)
        sender_wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(sender_wallet.balance, Decimal('500.00'))

    def test_pin_still_works_when_biometric_is_enabled(self):
        self.assertEqual(self._enable('transaction_pin').status_code, status.HTTP_200_OK)
        transfer = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': self.recipient.phone,
                'amount': '25.00',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(transfer.status_code, status.HTTP_201_CREATED, transfer.content)
        sender_wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(sender_wallet.balance, Decimal('475.00'))

    def test_assertion_is_single_use(self):
        self.assertEqual(self._enable('transaction_pin').status_code, status.HTTP_200_OK)
        self.client.post(
            reverse('biometric_assertion'),
            {
                'device_id': self.device_id,
                'secret': self.secret,
                'purpose': 'transaction_pin',
            },
            format='json',
        )
        first = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': self.recipient.phone,
                'amount': '10.00',
                'use_biometric': True,
            },
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': self.recipient.phone,
                'amount': '10.00',
                'use_biometric': True,
            },
            format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        sender_wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(sender_wallet.balance, Decimal('490.00'))

    def test_password_change_disables_login_biometric(self):
        self.assertEqual(self._enable('login').status_code, status.HTTP_200_OK)
        self.assertEqual(self._enable('transaction_pin').status_code, status.HTTP_200_OK)
        res = self.client.post(
            reverse('change_password'),
            {
                'current_password': 'testpass123',
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertFalse(self.user.login_biometric_enabled)
        self.assertTrue(self.user.transaction_pin_biometric_enabled)
        device = BiometricDevice.objects.get(device_id=self.device_id)
        self.assertFalse(device.login_enabled)
        self.assertTrue(device.pin_enabled)
