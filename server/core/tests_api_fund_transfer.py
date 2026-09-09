from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import ApiFundTransferLog, ApiIdempotencyRecord, Wallet, WalletTransfer
from .services.api_keys import enable_api_access, generate_unique_api_key, mask_api_key

User = get_user_model()


def _wallet(user, balance):
    wallet, _ = Wallet.objects.get_or_create(user=user, defaults={'balance': Decimal('0.00')})
    wallet.balance = Decimal(balance)
    wallet.save(update_fields=['balance'])
    return wallet


class ApiFundTransferTests(APITestCase):
    def setUp(self):
        self.sender = User.objects.create_user(
            phone='9800000401',
            password='testpass123',
            email='api-sender@example.com',
            first_name='Api',
            last_name='Sender',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.receiver = User.objects.create_user(
            phone='9800000402',
            password='testpass123',
            email='api-receiver@example.com',
            first_name='Api',
            last_name='Receiver',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.staff = User.objects.create_user(
            phone='9800000400',
            password='testpass123',
            email='api-staff@example.com',
            is_staff=True,
            is_superuser=True,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        _wallet(self.sender, '5000.00')
        _wallet(self.receiver, '10.00')
        enable_api_access(self.sender)
        self.sender.refresh_from_db()
        self.api_key = self.sender.api_key
        self.client = APIClient()

    def _auth_api(self, key=None):
        self.client.credentials()
        self.client.force_authenticate(user=None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {key or self.api_key}')

    def _post(self, payload, key=None):
        self._auth_api(key)
        return self.client.post(
            reverse('api_v1_fund_transfer'),
            payload,
            format='json',
        )

    def test_successful_transfer(self):
        resp = self._post({
            'receiver': '9800000402',
            'amount': 1000,
            'reference': 'ORDER-10001',
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('status'), 'SUCCESS')
        self.assertEqual(data.get('reference'), 'ORDER-10001')
        self.assertTrue(data.get('transaction_id'))
        self.sender.wallet.refresh_from_db()
        self.receiver.wallet.refresh_from_db()
        self.assertEqual(self.receiver.wallet.balance, Decimal('1010.00'))
        self.assertLess(self.sender.wallet.balance, Decimal('5000.00'))
        transfer = WalletTransfer.objects.get(reference=data['transaction_id'])
        self.assertEqual(transfer.source, WalletTransfer.SOURCE_API)
        self.assertEqual(transfer.client_reference, 'ORDER-10001')
        self.assertTrue(
            ApiFundTransferLog.objects.filter(
                user=self.sender, status='success', reference='ORDER-10001',
            ).exists()
        )

    def test_invalid_api_key(self):
        resp = self._post(
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-BADKEY'},
            key='msw_this_key_does_not_exist_at_all_000',
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(resp.json().get('code'), 'invalid_api_key')

    def test_missing_authorization(self):
        self.client.credentials()
        resp = self.client.post(
            reverse('api_v1_fund_transfer'),
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-NOAUTH'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(resp.json().get('code'), 'invalid_api_key')

    def test_key_belonging_to_non_api_user(self):
        other = User.objects.create_user(
            phone='9800000403',
            password='testpass123',
            email='not-api@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        other.api_key = generate_unique_api_key()
        other.is_api_user = False
        other.save(update_fields=['api_key', 'is_api_user'])
        _wallet(other, '1000.00')
        resp = self._post(
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-NONAPI'},
            key=other.api_key,
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'api_access_disabled')
        self.assertEqual(WalletTransfer.objects.count(), 0)

    def test_disabled_api_user(self):
        self.sender.is_api_user = False
        self.sender.save(update_fields=['is_api_user'])
        resp = self._post({
            'receiver': '9800000402',
            'amount': 10,
            'reference': 'ORDER-DISABLED',
        })
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'api_access_disabled')

    def test_inactive_user(self):
        self.sender.is_active = False
        self.sender.save(update_fields=['is_active'])
        resp = self._post({
            'receiver': '9800000402',
            'amount': 10,
            'reference': 'ORDER-INACTIVE',
        })
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'user_inactive')

    def test_insufficient_balance(self):
        resp = self._post({
            'receiver': '9800000402',
            'amount': 99999,
            'reference': 'ORDER-BROKE',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'insufficient_balance')
        self.receiver.wallet.refresh_from_db()
        self.assertEqual(self.receiver.wallet.balance, Decimal('10.00'))

    def test_invalid_amount_zero_and_negative(self):
        for amount, ref in ((0, 'ORDER-ZERO'), (-5, 'ORDER-NEG')):
            resp = self._post({
                'receiver': '9800000402',
                'amount': amount,
                'reference': ref,
            })
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.content)
            self.assertEqual(resp.json().get('code'), 'invalid_amount')

    def test_invalid_receiver(self):
        resp = self._post({
            'receiver': '9800000401',
            'amount': 10,
            'reference': 'ORDER-SELF',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'invalid_receiver')

    def test_receiver_not_found(self):
        resp = self._post({
            'receiver': '9800000499',
            'amount': 10,
            'reference': 'ORDER-MISSING',
        })
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(resp.json().get('code'), 'receiver_not_found')

    def test_duplicate_reference_is_idempotent(self):
        payload = {
            'receiver': '9800000402',
            'amount': 100,
            'reference': 'ORDER-DUP-1',
        }
        first = self._post(payload)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.content)
        txn = first.json().get('transaction_id')
        sender_after = Wallet.objects.get(user=self.sender).balance
        receiver_after = Wallet.objects.get(user=self.receiver).balance

        second = self._post(payload)
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.content)
        self.assertEqual(second.json().get('transaction_id'), txn)
        self.assertEqual(WalletTransfer.objects.count(), 1)
        self.assertEqual(Wallet.objects.get(user=self.sender).balance, sender_after)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, receiver_after)

    def test_duplicate_request_same_reference(self):
        payload = {
            'receiver': '9800000402',
            'amount': 50,
            'reference': 'ORDER-DUP-2',
        }
        self._post(payload)
        again = self._post(payload)
        self.assertIn(again.status_code, (status.HTTP_200_OK, status.HTTP_409_CONFLICT))
        self.assertEqual(WalletTransfer.objects.filter(client_reference='ORDER-DUP-2').count(), 1)

    def test_atomic_rollback_when_transfer_fails(self):
        sender_before = Wallet.objects.get(user=self.sender).balance
        receiver_before = Wallet.objects.get(user=self.receiver).balance
        with patch(
            'core.services.wallet_transfer.WalletTransfer.objects.create',
            side_effect=RuntimeError('forced failure'),
        ):
            resp = self._post({
                'receiver': '9800000402',
                'amount': 25,
                'reference': 'ORDER-ROLLBACK',
            })
        self.assertEqual(resp.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(resp.json().get('code'), 'server_error')
        self.assertNotIn('forced failure', str(resp.content))
        self.assertEqual(Wallet.objects.get(user=self.sender).balance, sender_before)
        self.assertEqual(Wallet.objects.get(user=self.receiver).balance, receiver_before)
        self.assertEqual(WalletTransfer.objects.count(), 0)
        self.assertFalse(
            ApiIdempotencyRecord.objects.filter(user=self.sender, reference='ORDER-ROLLBACK').exists()
        )

    def test_api_key_regeneration_invalidates_old_key(self):
        old_key = self.api_key
        self.client.force_authenticate(user=self.sender)
        resp = self.client.post(reverse('api_developer_regenerate_key'), {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        new_key = resp.json().get('api_key')
        self.assertTrue(new_key)
        self.assertNotEqual(new_key, old_key)
        denied = self._post(
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-OLDKEY'},
            key=old_key,
        )
        self.assertEqual(denied.status_code, status.HTTP_401_UNAUTHORIZED)
        ok = self._post(
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-NEWKEY'},
            key=new_key,
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.content)

    def test_admin_enable_disable_api_access(self):
        target = User.objects.create_user(
            phone='9800000404',
            password='testpass123',
            email='api-target@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        _wallet(target, '100.00')
        self.client.force_authenticate(user=self.staff)
        enable = self.client.patch(
            reverse('admin_api_user_detail', args=[target.pk]),
            {'is_api_user': True},
            format='json',
        )
        self.assertEqual(enable.status_code, status.HTTP_200_OK, enable.content)
        target.refresh_from_db()
        self.assertTrue(target.is_api_user)
        self.assertTrue(target.api_key)
        masked = enable.json()['data'].get('api_key_masked')
        self.assertTrue(masked)
        self.assertNotEqual(masked, target.api_key)
        self.assertEqual(mask_api_key(target.api_key), masked)

        disable = self.client.patch(
            reverse('admin_api_user_detail', args=[target.pk]),
            {'is_api_user': False},
            format='json',
        )
        self.assertEqual(disable.status_code, status.HTTP_200_OK)
        target.refresh_from_db()
        self.assertFalse(target.is_api_user)
        denied = self._post(
            {'receiver': '9800000402', 'amount': 10, 'reference': 'ORDER-ADMINOFF'},
            key=target.api_key,
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_user_form_enables_api_and_generates_key(self):
        target = User.objects.create_user(
            phone='9800000405',
            password='testpass123',
            email='api-form@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            reverse('admin_user_detail', args=[target.pk]),
            {'is_api_user': True},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        target.refresh_from_db()
        self.assertTrue(target.is_api_user)
        self.assertTrue(target.api_key)

    def test_documentation_access_and_download(self):
        self.client.force_authenticate(user=self.sender)
        docs = self.client.get(reverse('api_developer_docs'))
        self.assertEqual(docs.status_code, status.HTTP_200_OK, docs.content)
        body = docs.json()
        self.assertEqual(body.get('path'), '/api/v1/fund-transfer/')
        self.assertIn('examples', body)
        self.assertIn('curl', body['examples'])

        for fmt, content_type in (
            ('markdown', 'text/markdown'),
            ('html', 'text/html'),
            ('pdf', 'application/pdf'),
        ):
            download = self.client.get(
                reverse('api_developer_docs_download'),
                {'doc_format': fmt},
            )
            self.assertEqual(download.status_code, status.HTTP_200_OK, download.content[:200])
            self.assertIn(content_type, download['Content-Type'])
            if fmt == 'pdf':
                self.assertTrue(download.content.startswith(b'%PDF'))
            else:
                self.assertIn(b'Fund Transfer', download.content)

    def test_documentation_denied_for_normal_user(self):
        self.client.force_authenticate(user=self.receiver)
        resp = self.client.get(reverse('api_developer_docs'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'api_access_disabled')
        download = self.client.get(
            reverse('api_developer_docs_download'),
            {'doc_format': 'markdown'},
        )
        self.assertEqual(download.status_code, status.HTTP_403_FORBIDDEN)

    def test_normal_user_cannot_use_fund_transfer_api(self):
        resp = self._post(
            {'receiver': '9800000401', 'amount': 10, 'reference': 'ORDER-NORMAL'},
            key='not-a-real-key',
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.client.credentials()
        self.client.force_authenticate(user=None)
        session = self.client.post(
            reverse('api_v1_fund_transfer'),
            {'receiver': '9800000401', 'amount': 10, 'reference': 'ORDER-SESSION'},
            format='json',
            HTTP_AUTHORIZATION='Token not-a-login-token',
        )
        self.assertEqual(session.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_admin_can_list_api_users_without_raw_keys(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_list_api_users'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        items = resp.json().get('items') or []
        self.assertTrue(items)
        self.assertNotIn('api_key', items[0])
        self.assertIn('api_key_masked', items[0])
        self.assertNotEqual(items[0].get('api_key_masked'), self.api_key)

    def test_profile_exposes_is_api_user_without_key(self):
        self.client.force_authenticate(user=self.sender)
        resp = self.client.get(reverse('profile'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        profile = data.get('data') or data
        self.assertTrue(profile.get('is_api_user'))
        self.assertNotIn('api_key', profile)
