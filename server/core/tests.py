from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from .serializers import ResetPasswordSerializer
from .services.himalpay import HimalPayAPI, HimalPayError
from .views.bank_transfer_views import _resolve_destination_bank

User = get_user_model()

_RESET_DOB_IDENTITY_MESSAGE = (
    'Unable to verify your identity. '
    'Please check your details and try again.'
)


class RupeesPaisaConversionTests(SimpleTestCase):
    """MySewa uses rupees; HimalPay uses paisa (×100)."""

    def test_rs_100_becomes_exactly_10000_paisa(self):
        self.assertEqual(HimalPayAPI.to_paisa(100), 10000)
        self.assertEqual(HimalPayAPI.to_paisa('100'), 10000)
        self.assertEqual(HimalPayAPI.to_paisa('100.00'), 10000)
        self.assertEqual(HimalPayAPI.to_paisa(Decimal('100.00')), 10000)
        self.assertEqual(HimalPayAPI.to_paisa(100.0), 10000)

    def test_round_trip_common_amounts(self):
        for rupees in ('0.01', '10', '10.10', '100.50', '999.99', '5000'):
            paisa = HimalPayAPI.to_paisa(rupees)
            self.assertEqual(HimalPayAPI.to_rupees(paisa), Decimal(rupees).quantize(Decimal('0.01')))

    def test_bank_transfer_payload_uses_paisa_at_top_level_and_in_data(self):
        client = HimalPayAPI()
        client.bypass_api = True
        response = client.bank_transfer(
            amount_rupees=100,
            merchant_transaction_id='MYSEWA_BT_TEST100',
            destination_bank='LXBLNPKA',
            destination_acc_no='1845008000023',
            destination_acc_name='Test User',
            is_destination_mobile='n',
            transaction_remarks='Fund Transfer',
        )
        self.assertEqual(response['amount'], 10000)
        self.assertEqual(response['data']['amount'], 10000)
        self.assertEqual(response['data']['destination_bank'], 'LXBLNPKA')
        self.assertEqual(response['data']['is_destination_mobile'], 'n')
        self.assertEqual(response['data']['transaction_remarks'], 'Fund Transfer')
        self.assertEqual(response['data']['transaction_remarks_2'], '')
        self.assertEqual(response['data']['transaction_remarks_3'], '')

    def test_process_payment_never_sends_rupees_as_amount(self):
        client = HimalPayAPI()
        client.bypass_api = True
        response = client.process_payment(
            wallet_service_name=HimalPayAPI.SERVICE_NTC,
            amount_rupees=Decimal('100.00'),
            merchant_transaction_id='MYSEWA_NTC_TEST100',
            data={'number': '9800000000'},
        )
        self.assertEqual(response['amount'], 10000)
        self.assertIsInstance(response['amount'], int)

    def test_calculate_charge_sends_paisa(self):
        client = HimalPayAPI()
        client.bypass_api = True
        result = client.calculate_cashback_and_charge(
            HimalPayAPI.SERVICE_BANK_TRANSFER,
            100,
        )
        self.assertEqual(result['amount'], 10000)
        self.assertTrue(result['merchant_transaction_id'].startswith('MYSEWA_CALC_'))

    def test_calculate_charge_accepts_merchant_txn_id(self):
        client = HimalPayAPI()
        client.bypass_api = True
        result = client.calculate_cashback_and_charge(
            HimalPayAPI.SERVICE_BANK_TRANSFER,
            100,
            merchant_transaction_id='MYSEWA_CALC_CUSTOM01',
        )
        self.assertEqual(result['merchant_transaction_id'], 'MYSEWA_CALC_CUSTOM01')
        self.assertEqual(result['amount'], 10000)

    def test_invalid_amount_rejected(self):
        with self.assertRaises(HimalPayError):
            HimalPayAPI.to_paisa('not-a-number')
        with self.assertRaises(HimalPayError):
            HimalPayAPI.to_paisa(None)


class BankCodeResolveTests(SimpleTestCase):
    """Short tickers like CTZN must become HimalPay SWIFT codes."""

    def test_legacy_ctzn_maps_to_swifts(self):
        client = HimalPayAPI()
        client.bypass_api = True
        self.assertEqual(
            _resolve_destination_bank(client, 'CTZN', 'Citizens Bank International'),
            'CTZNNPKA',
        )

    def test_already_swift_unchanged(self):
        client = HimalPayAPI()
        client.bypass_api = True
        self.assertEqual(
            _resolve_destination_bank(client, 'LXBLNPKA', 'Laxmi Sunrise Bank'),
            'LXBLNPKA',
        )

    def test_legacy_map_without_list(self):
        client = HimalPayAPI()
        client.bypass_api = True
        self.assertEqual(_resolve_destination_bank(client, 'NICA', ''), 'NICENPKA')


class IspInquiryParseTests(SimpleTestCase):
    """ISP inquiry must unwrap HimalPay nesting and handle Vianet bill shape."""

    VIANET_ISP = {
        'id': 'vianet',
        'name': 'Vianet',
        'get_service': 'VIANET_GET',
        'pay_service': 'VIANET_PAY',
        'customer_field': 'customer_id',
    }

    def test_vianet_vendor_failure_surfaces_message(self):
        from .services.himalpay_parse import detect_inquiry_vendor_failure

        raw = {
            'status': 'SUCCESS',
            'data': {
                'status': 'FAILED',
                'data': 'You have no pending bills right now !!',
                'error': 'Unknown Error occured. Check details',
                'error_code': '7000',
            },
        }
        self.assertEqual(
            detect_inquiry_vendor_failure(raw),
            'You have no pending bills right now !!',
        )

    def test_vianet_payment_id_parsed_as_package(self):
        from .services.himalpay_parse import parse_isp_inquiry

        raw = {
            'status': 'SUCCESS',
            'data': {
                'status': 'SUCCESS',
                'data': {
                    'payment_id': '1613122_PP',
                    'session_id': 50050,
                    'customer_name': 'Jane Doe',
                    'plan': '25 Mbps Unlimited',
                    'amount': 474600,
                },
            },
        }
        parsed = parse_isp_inquiry(raw, self.VIANET_ISP, '534201')
        self.assertEqual(len(parsed['packages']), 1)
        pkg = parsed['packages'][0]
        self.assertEqual(pkg['id'], '1613122_PP')
        self.assertEqual(pkg['name'], '25 Mbps Unlimited')
        self.assertEqual(pkg['amount'], '4746.00')
        self.assertEqual(pkg['pay_data']['payment_id'], '1613122_PP')
        self.assertEqual(pkg['pay_data']['session_id'], 50050)
        self.assertEqual(pkg['pay_data']['customer_id'], '534201')
        self.assertEqual(parsed['customer_name'], 'Jane Doe')
        self.assertEqual(parsed['subscription_status'], 'SUCCESS')

    def test_subscription_status_prefers_vendor_failed_over_wrapper_success(self):
        from .services.himalpay_parse import parse_isp_inquiry

        raw = {
            'status': 'SUCCESS',
            'data': {
                'status': 'FAILED',
                'data': 'You have no pending bills right now !!',
            },
        }
        parsed = parse_isp_inquiry(raw, self.VIANET_ISP, '534201')
        self.assertEqual(parsed['subscription_status'], 'FAILED')
        self.assertEqual(parsed['packages'], [])

    def test_payable_amount_integer_rupees_not_paisa(self):
        from .services.himalpay_parse import parse_isp_inquiry

        raw = {
            'status': 'SUCCESS',
            'data': {
                'status': 'SUCCESS',
                'data': {
                    'payment_id': 'ABC123',
                    'session_id': 77,
                    'amount': 1150,
                    'payable_amount': 1150,
                    'plan': 'Monthly Bill',
                },
            },
        }
        parsed = parse_isp_inquiry(raw, self.VIANET_ISP, '534201')
        self.assertEqual(parsed['payable_amount'], '1150.00')
        self.assertEqual(parsed['packages'][0]['amount'], '1150.00')


class RemittanceLookupParseTests(SimpleTestCase):
    """SAMSARA_GET responses vary in nesting; parser must still find payout_amt."""

    def test_docs_shape(self):
        parsed = HimalPayAPI.parse_remittance_lookup({
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'reference_id': 'S1001',
                'data': {
                    'payout_amt': '50.0000',
                    'ref_no': 'S1001',
                    'receiver_name': 'TEST',
                    'sender_name': 'SENDER',
                },
            },
        })
        self.assertEqual(parsed['samsara_link_id'], 'abc123')
        self.assertEqual(parsed['payout_amt'], Decimal('50.00'))
        self.assertEqual(parsed['receiver_name'], 'TEST')

    def test_stringified_inner_data(self):
        import json
        parsed = HimalPayAPI.parse_remittance_lookup({
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'data': json.dumps({
                    'payout_amt': '1500.0000',
                    'ref_no': 'S1002',
                    'receiver_name': 'NESTED',
                }),
            },
        })
        self.assertEqual(parsed['samsara_link_id'], 'abc123')
        self.assertEqual(parsed['payout_amt'], Decimal('1500.00'))
        self.assertEqual(parsed['receiver_name'], 'NESTED')

    def test_list_wrapped_inner_data(self):
        parsed = HimalPayAPI.parse_remittance_lookup({
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'data': [{'payout_amt': '99.50', 'ref_no': 'S1003', 'receiver_name': 'LIST'}],
            },
        })
        self.assertEqual(parsed['payout_amt'], Decimal('99.50'))
        self.assertEqual(parsed['ref_no'], 'S1003')

    def test_extra_nesting_and_formatted_amount(self):
        parsed = HimalPayAPI.parse_remittance_lookup({
            'data': {
                'status': 'SUCCESS',
                'data': {
                    'core_transaction_uuid': 'link-1',
                    'data': {
                        'data': {
                            'payout_amt': 'NPR 1,250.5000',
                            'ref_no': 'S1004',
                            'receiver_name': 'DEEP',
                        }
                    },
                },
            },
        })
        self.assertEqual(parsed['samsara_link_id'], 'link-1')
        self.assertEqual(parsed['payout_amt'], Decimal('1250.50'))

    def test_bypass_lookup_shape(self):
        client = HimalPayAPI()
        client.bypass_api = True
        raw = client.lookup_remittance('S1001227917')
        parsed = HimalPayAPI.parse_remittance_lookup(raw)
        self.assertTrue(parsed['samsara_link_id'])
        self.assertGreater(parsed['payout_amt'], 0)

    def test_extract_provider_message_vendor_state_locked(self):
        raw = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Amount is locked',
                'vendor_status': '1',
                'data': {
                    'ref_no': 'S1001',
                    'receiver_name': 'TEST',
                },
            },
        }
        message = HimalPayAPI.extract_provider_message(raw)
        self.assertEqual(message, 'Amount is locked')

    def test_locked_amount_lookup_has_zero_payout(self):
        raw = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Amount is locked',
                'data': {
                    'ref_no': 'S1001',
                    'receiver_name': 'TEST',
                },
            },
        }
        parsed = HimalPayAPI.parse_remittance_lookup(raw)
        self.assertEqual(parsed['payout_amt'], Decimal('0.00'))
        self.assertEqual(HimalPayAPI.extract_provider_message(raw), 'Amount is locked')


class ResetPasswordSerializerTests(SimpleTestCase):
    """date_of_birth must be present and YYYY-MM-DD before reset can proceed."""

    def _base(self, **overrides):
        data = {
            'phone': '9800000001',
            'otp': '123456',
            'date_of_birth': '1990-05-15',
            'new_password': 'securepass1',
            'confirm_password': 'securepass1',
        }
        data.update(overrides)
        return data

    def test_accepts_iso_date(self):
        serializer = ResetPasswordSerializer(data=self._base())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['date_of_birth'], date(1990, 5, 15))

    def test_rejects_missing_date_of_birth(self):
        data = self._base()
        del data['date_of_birth']
        serializer = ResetPasswordSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('date_of_birth', serializer.errors)

    def test_rejects_invalid_date_format(self):
        serializer = ResetPasswordSerializer(data=self._base(date_of_birth='15/05/1990'))
        self.assertFalse(serializer.is_valid())
        self.assertIn('date_of_birth', serializer.errors)
        self.assertIn(
            'YYYY-MM-DD',
            ' '.join(str(e) for e in serializer.errors['date_of_birth']),
        )

    def test_rejects_future_date_of_birth(self):
        serializer = ResetPasswordSerializer(
            data=self._base(date_of_birth='2999-01-01'),
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('date_of_birth', serializer.errors)


class ResetPasswordDobMatchTests(TestCase):
    """Password reset succeeds only when submitted DOB equals registered DOB."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse('reset_password')
        self.phone = '9801112233'
        self.otp = '654321'
        self.dob = date(1992, 3, 20)
        self.user = User.objects.create_user(
            self.phone,
            password='oldpassword1',
            email='reset@example.com',
            date_of_birth=self.dob,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        cache.set(f'password_reset_otp:{self.phone}', self.otp, timeout=900)

    def _payload(self, **overrides):
        data = {
            'phone': self.phone,
            'otp': self.otp,
            'date_of_birth': self.dob.isoformat(),
            'new_password': 'newpassword1',
            'confirm_password': 'newpassword1',
        }
        data.update(overrides)
        return data

    def test_reset_succeeds_when_dob_matches(self):
        response = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newpassword1'))
        self.assertIsNone(cache.get(f'password_reset_otp:{self.phone}'))

    def test_reset_rejects_wrong_dob_with_non_leaky_error(self):
        response = self.client.post(
            self.url,
            self._payload(date_of_birth='1990-01-01'),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['message'], _RESET_DOB_IDENTITY_MESSAGE)
        self.assertEqual(
            response.data['errors']['date_of_birth'],
            [_RESET_DOB_IDENTITY_MESSAGE],
        )
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpassword1'))

    def test_reset_rejects_missing_dob_on_account_same_error(self):
        self.user.date_of_birth = None
        self.user.save(update_fields=['date_of_birth'])
        response = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['message'], _RESET_DOB_IDENTITY_MESSAGE)
        self.assertEqual(
            response.data['errors']['date_of_birth'],
            [_RESET_DOB_IDENTITY_MESSAGE],
        )
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpassword1'))

    def test_reset_requires_date_of_birth_field(self):
        payload = self._payload()
        del payload['date_of_birth']
        response = self.client.post(self.url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('date_of_birth', response.data.get('errors', {}))


class KycManualReviewWorkflowTests(TestCase):
    """
    KYC never auto-verifies. Submit/resubmit → Pending; only staff Approve
    or Reject (with mandatory reason) changes status. Rejected users may
    resubmit, which returns to Pending.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            '9802223344',
            password='testpass12',
            email='kyc-user@example.com',
            first_name='Kyc',
            last_name='User',
            date_of_birth=date(1990, 1, 15),
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.staff = User.objects.create_user(
            '9802223355',
            password='staffpass12',
            email='kyc-admin@example.com',
            is_staff=True,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.submit_url = reverse('kyc_submit')
        self.status_url = reverse('kyc_status')

    def _tiny_png(self, name='doc.png'):
        from io import BytesIO
        from django.core.files.uploadedfile import SimpleUploadedFile
        try:
            from PIL import Image
        except ImportError:  # pragma: no cover
            self.skipTest('Pillow is required for KYC image upload tests')
        buf = BytesIO()
        Image.new('RGB', (8, 8), color=(20, 40, 80)).save(buf, format='PNG')
        return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')

    def _submit_kyc(self, citizenship_number='12-34-56-78901'):
        """POST multipart with citizenship front+back (same keys as the web client)."""
        from django.test.client import BOUNDARY

        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)
        front = self._tiny_png('front.png')
        back = self._tiny_png('back.png')
        parts = []

        def add_field(name, value):
            parts.append(
                f'--{BOUNDARY}\r\n'
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f'{value}\r\n'
            )

        def add_file(name, uploaded):
            content = uploaded.read()
            parts.append(
                f'--{BOUNDARY}\r\n'
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{uploaded.name}"\r\n'
                f'Content-Type: {uploaded.content_type}\r\n\r\n'
            )
            parts.append(content)
            parts.append('\r\n')

        add_field('citizenship_number', citizenship_number)
        add_file('file', front)
        add_field('document_type', 'citizenship')
        add_field('side', 'front')
        add_file('file', back)
        add_field('document_type', 'citizenship')
        add_field('side', 'back')
        parts.append(f'--{BOUNDARY}--\r\n')

        payload = b''.join(
            p.encode('utf-8') if isinstance(p, str) else p for p in parts
        )
        return self.client.post(
            self.submit_url,
            data=payload,
            content_type=f'multipart/form-data; boundary={BOUNDARY}',
        )

    def test_submit_stays_pending_not_auto_verified(self):
        response = self._submit_kyc()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.user.refresh_from_db()
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_PENDING)
        self.assertFalse(self.user.is_kyc_verified)
        payload = response.data['data']
        self.assertEqual(payload['kyc_status'], 'pending')
        self.assertFalse(payload['kyc_verified'])
        self.assertFalse(payload['can_submit'])
        self.assertEqual(payload['submission']['status'], 'pending')

    def test_reject_requires_reason_and_sets_rejected(self):
        submit = self._submit_kyc()
        kyc_id = submit.data['data']['submission']['id']

        self.client.force_authenticate(user=self.staff)
        missing = self.client.post(
            reverse('admin_reject_kyc', kwargs={'kyc_id': kyc_id}),
            {},
            format='json',
        )
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('reason', missing.data['error'].lower())

        rejected = self.client.post(
            reverse('admin_reject_kyc', kwargs={'kyc_id': kyc_id}),
            {'rejection_reason': 'Citizenship image is blurry'},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_200_OK)
        self.assertEqual(rejected.data['data']['status'], 'rejected')
        self.assertEqual(
            rejected.data['data']['rejection_reason'],
            'Citizenship image is blurry',
        )

        self.user.refresh_from_db()
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_REJECTED)
        self.assertFalse(self.user.is_kyc_verified)

        self.client.force_authenticate(user=self.user)
        status_res = self.client.get(self.status_url)
        self.assertEqual(status_res.status_code, status.HTTP_200_OK)
        self.assertEqual(status_res.data['kyc_status'], 'rejected')
        self.assertTrue(status_res.data['can_submit'])
        self.assertEqual(
            status_res.data['submission']['rejection_reason'],
            'Citizenship image is blurry',
        )

    def test_resubmit_after_reject_returns_to_pending(self):
        submit = self._submit_kyc('11-22-33-44444')
        kyc_id = submit.data['data']['submission']['id']

        self.client.force_authenticate(user=self.staff)
        self.client.post(
            reverse('admin_reject_kyc', kwargs={'kyc_id': kyc_id}),
            {'rejection_reason': 'Wrong document side'},
            format='json',
        )

        resubmit = self._submit_kyc('11-22-33-55555')
        self.assertEqual(resubmit.status_code, status.HTTP_201_CREATED)
        self.user.refresh_from_db()
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_PENDING)
        self.assertFalse(self.user.is_kyc_verified)
        self.assertEqual(resubmit.data['data']['kyc_status'], 'pending')
        self.assertEqual(resubmit.data['data']['submission']['status'], 'pending')
        self.assertNotEqual(resubmit.data['data']['submission']['id'], kyc_id)
        self.assertFalse(resubmit.data['data']['submission'].get('rejection_reason'))

    def test_approve_marks_verified_and_blocks_resubmit(self):
        submit = self._submit_kyc()
        kyc_id = submit.data['data']['submission']['id']

        self.client.force_authenticate(user=self.staff)
        approved = self.client.post(
            reverse('admin_approve_kyc', kwargs={'kyc_id': kyc_id}),
            {},
            format='json',
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data['data']['status'], 'approved')

        self.user.refresh_from_db()
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_APPROVED)
        self.assertTrue(self.user.is_kyc_verified)

        blocked = self._submit_kyc()
        self.assertEqual(blocked.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('verification', blocked.data['error'].lower())

    def test_admin_can_edit_pending_kyc_then_approve(self):
        submit = self._submit_kyc('99-88-77-66554')
        kyc_id = submit.data['data']['submission']['id']

        self.client.force_authenticate(user=self.staff)
        updated = self.client.patch(
            reverse('admin_get_kyc', kwargs={'kyc_id': kyc_id}),
            {
                'citizenship_number': '11-22-33-44556',
                'first_name': 'Corrected',
                'last_name': 'Name',
                'date_of_birth': '1991-05-20',
            },
            format='json',
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertEqual(updated.data['data']['citizenship_number'], '11-22-33-44556')
        self.assertEqual(updated.data['data']['first_name'], 'Corrected')
        self.assertEqual(updated.data['data']['last_name'], 'Name')
        self.assertEqual(str(updated.data['data']['date_of_birth']), '1991-05-20')
        self.assertEqual(updated.data['data']['status'], 'pending')

        self.user.refresh_from_db()
        self.assertEqual(self.user.citizenship_number, '11-22-33-44556')
        self.assertEqual(self.user.first_name, 'Corrected')
        self.assertEqual(self.user.last_name, 'Name')
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_PENDING)

        approved = self.client.post(
            reverse('admin_approve_kyc', kwargs={'kyc_id': kyc_id}),
            {},
            format='json',
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data['data']['status'], 'approved')
        self.assertEqual(approved.data['data']['citizenship_number'], '11-22-33-44556')

        self.user.refresh_from_db()
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_APPROVED)
        self.assertTrue(self.user.is_kyc_verified)
        self.assertEqual(self.user.citizenship_number, '11-22-33-44556')

    def test_admin_can_edit_approved_kyc_details(self):
        submit = self._submit_kyc('99-88-77-66554')
        kyc_id = submit.data['data']['submission']['id']

        self.client.force_authenticate(user=self.staff)
        approved = self.client.post(
            reverse('admin_approve_kyc', kwargs={'kyc_id': kyc_id}),
            {},
            format='json',
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)

        updated = self.client.patch(
            reverse('admin_get_kyc', kwargs={'kyc_id': kyc_id}),
            {
                'citizenship_number': '55-44-33-22110',
                'first_name': 'Fixed',
                'last_name': 'Identity',
                'date_of_birth': '1988-12-01',
            },
            format='json',
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertEqual(updated.data['data']['citizenship_number'], '55-44-33-22110')
        self.assertEqual(updated.data['data']['first_name'], 'Fixed')
        self.assertEqual(updated.data['data']['last_name'], 'Identity')
        self.assertEqual(str(updated.data['data']['date_of_birth']), '1988-12-01')
        self.assertEqual(updated.data['data']['status'], 'approved')

        self.user.refresh_from_db()
        self.assertEqual(self.user.citizenship_number, '55-44-33-22110')
        self.assertEqual(self.user.first_name, 'Fixed')
        self.assertEqual(self.user.last_name, 'Identity')
        self.assertEqual(self.user.date_of_birth, date(1988, 12, 1))
        self.assertEqual(self.user.kyc_status, User.KYC_STATUS_APPROVED)
        self.assertTrue(self.user.is_kyc_verified)
