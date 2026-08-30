from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from .serializers import ResetPasswordSerializer
from .services.himalpay import (
    HimalPayAPI,
    HimalPayError,
    assess_inbound_bank_qr_capability,
    looks_like_inbound_qr_service_name,
)
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

    def test_reseller_statement_and_balance_bypass(self):
        client = HimalPayAPI()
        client.bypass_api = True
        entries = client.get_reseller_statement(from_date='2026-08-01', to_date='2026-08-09')
        self.assertIsInstance(entries, list)
        self.assertTrue(entries)
        self.assertEqual(entries[0]['direction'], 'debit')
        balance = client.get_reseller_balance()
        self.assertIn('balance', balance)
        self.assertIn('total_balance_in_rupees', balance)
        self.assertEqual(balance.get('source'), 'bypass')

    def test_normalize_reseller_balance_nested_wallet(self):
        nested = HimalPayAPI._normalize_reseller_balance(
            {
                'status': 'SUCCESS',
                'data': {
                    'wallet': {
                        'balance': 5000000,
                        'bonus_balance': 100,
                    }
                },
            }
        )
        self.assertEqual(nested['balance'], 5000000)
        self.assertEqual(nested['balance_in_rupees'], 50000.0)
        self.assertEqual(nested['bonus_balance_in_rupees'], 1.0)
        self.assertEqual(nested['total_balance_in_rupees'], 50001.0)
        self.assertTrue(HimalPayAPI._balance_payload_has_amounts(nested))


class InboundBankQrCapabilityTests(SimpleTestCase):
    """Reseller API must not be treated as bank-QR collection into MySewa wallets."""

    def test_documented_reseller_services_are_not_inbound_qr(self):
        self.assertFalse(looks_like_inbound_qr_service_name('BANK_TRANSFER'))
        self.assertFalse(looks_like_inbound_qr_service_name('SAMSARA_PAY'))
        self.assertFalse(looks_like_inbound_qr_service_name('NTC'))

    def test_capability_is_unsupported_without_inventing_endpoints(self):
        result = assess_inbound_bank_qr_capability([
            {'name': 'NTC'},
            {'name': 'BANK_TRANSFER'},
            {'name': 'SAMSARA_PAY'},
        ])
        self.assertFalse(result['supported'])
        self.assertEqual(result['hinted_service_names'], [])
        self.assertIn('Reseller API', result['reason'])
        self.assertIn('does not generate NepalPay/Fonepay merchant QRs', result['reason'])

    def test_hinted_names_are_reported_but_not_treated_as_supported(self):
        result = assess_inbound_bank_qr_capability([
            {'name': 'NTC'},
            {'name': 'NEPALPAY_QR'},
        ])
        self.assertFalse(result['supported'])
        self.assertEqual(result['hinted_service_names'], ['NEPALPAY_QR'])
        self.assertIn('NEPALPAY_QR', result['reason'])
        self.assertIn('will not call them', result['reason'])


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
        self.assertFalse(HimalPayAPI.is_remittance_already_received('', raw))

    def test_already_received_vendor_state_detected(self):
        raw = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Already Received',
                'vendor_status': '1',
                'data': {
                    'ref_no': 'S1001',
                    'receiver_name': 'TEST',
                    'payout_amt': '0.0000',
                },
            },
        }
        self.assertEqual(HimalPayAPI.extract_provider_message(raw), 'Already Received')
        self.assertTrue(HimalPayAPI.is_remittance_already_received('', raw))
        parsed = HimalPayAPI.parse_remittance_lookup(raw)
        self.assertEqual(parsed['payout_amt'], Decimal('0.00'))

    def test_already_paid_message_detected(self):
        self.assertTrue(
            HimalPayAPI.is_remittance_already_received('Remittance already paid')
        )
        self.assertFalse(
            HimalPayAPI.is_remittance_already_received('Amount is locked')
        )

    def test_extract_provider_message_stringified_nested_vendor_state(self):
        import json
        raw = {
            'status': 'SUCCESS',
            'data': json.dumps({
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Amount is locked',
                'vendor_status': '1',
                'data': {
                    'ref_no': 'S1001',
                    'payout_amt': '0.0000',
                    'receiver_name': 'TEST',
                },
            }),
        }
        self.assertEqual(HimalPayAPI.extract_provider_message(raw), 'Amount is locked')

    def test_extract_provider_message_ignores_success_noise(self):
        raw = {
            'status': 'SUCCESS',
            'message': 'SUCCESS',
            'data': {
                'status': 'SUCCESS',
                'ms_status': 'SUCCESS',
                'vendor_status': '1',
                'vendor_state': 'Already Received',
                'data': {'ref_no': 'S1001', 'payout_amt': '0'},
            },
        }
        self.assertEqual(HimalPayAPI.extract_provider_message(raw), 'Already Received')

    def test_extract_provider_message_list_wrapped_data(self):
        raw = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'data': [
                    {
                        'vendor_state': 'Amount is locked',
                        'ref_no': 'S1001',
                        'payout_amt': '0.0000',
                    }
                ],
            },
        }
        self.assertEqual(HimalPayAPI.extract_provider_message(raw), 'Amount is locked')

    def test_amount_locked_detection(self):
        raw = {
            'status': 'SUCCESS',
            'data': {
                'vendor_state': 'Amount is locked',
                'data': {'ref_no': 'S1001', 'payout_amt': '0'},
            },
        }
        self.assertTrue(HimalPayAPI.is_remittance_amount_locked('', raw))
        self.assertEqual(HimalPayAPI.extract_vendor_state(raw), 'Amount is locked')
        self.assertFalse(HimalPayAPI.is_remittance_already_received('', raw))

    def test_zero_payout_never_reports_invalid_amount_label(self):
        """Regression: locked/already-received must not surface Invalid amount."""
        locked = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Amount is locked',
                'data': {'ref_no': 'S1001', 'payout_amt': '0.0000'},
            },
        }
        already = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'vendor_state': 'Already Received',
                'data': {'ref_no': 'S1001', 'payout_amt': '0.0000'},
            },
        }
        self.assertTrue(HimalPayAPI.is_remittance_amount_locked('', locked))
        self.assertTrue(HimalPayAPI.is_remittance_already_received('', already))
        for raw in (locked, already):
            parsed = HimalPayAPI.parse_remittance_lookup(raw)
            self.assertEqual(parsed['payout_amt'], Decimal('0.00'))
            msg = HimalPayAPI.extract_provider_message(raw)
            self.assertNotIn('Invalid amount', msg)
            self.assertNotIn('missing or zero', msg.casefold())

    def test_ms_message_already_been_paid(self):
        """HimalPay often puts the real reason in ms_message (not vendor_state)."""
        raw = {
            'status': 'SUCCESS',
            'data': {
                'core_transaction_uuid': 'abc123',
                'ms_status': 'FAILED',
                'ms_message': 'Transaction reference has already been paid',
                'vendor_state': '',
                'data': {'ref_no': 'S1001', 'payout_amt': '0.0000'},
            },
        }
        msg = HimalPayAPI.extract_provider_message(raw)
        self.assertEqual(msg, 'Transaction reference has already been paid')
        self.assertTrue(HimalPayAPI.is_remittance_already_received(msg, raw))
        self.assertTrue(HimalPayAPI.is_remittance_already_received('', raw))
        self.assertNotIn('missing or zero', msg.casefold())
        self.assertNotIn('Remittance not available', msg)


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


class RemittanceNetCreditTests(SimpleTestCase):
    """Inbound loads credit amount - charge + cashback (never gross when charged)."""

    def test_gross_100_charge_5_credits_95(self):
        from .models import RemittanceTransaction
        from .views.remittance_views import _apply_load_fields

        txn = RemittanceTransaction(
            amount=Decimal('100.00'),
            total_credited=Decimal('100.00'),
            charge=Decimal('0.00'),
            cashback=Decimal('0.00'),
            ref_no='S100TEST',
        )
        himalpay = HimalPayAPI()
        # Provider echoed gross as total_credited while applying a charge.
        _apply_load_fields(
            txn,
            himalpay,
            {
                'amount': 10000,  # paisa
                'charge': 500,
                'cashback': 0,
                'total_credited': 10000,
                'transaction_id': 'TXN1',
                'reference_id': 'S100TEST',
            },
            persist=False,
        )
        self.assertEqual(txn.charge, Decimal('5.00'))
        self.assertEqual(txn.total_credited, Decimal('95.00'))

    def test_provider_net_total_credited_is_respected(self):
        from .models import RemittanceTransaction
        from .views.remittance_views import _apply_load_fields

        txn = RemittanceTransaction(
            amount=Decimal('100.00'),
            total_credited=Decimal('100.00'),
            ref_no='S100TEST2',
        )
        himalpay = HimalPayAPI()
        _apply_load_fields(
            txn,
            himalpay,
            {
                'amount': 10000,
                'charge': 500,
                'cashback': 0,
                'total_credited': 9500,
            },
            persist=False,
        )
        self.assertEqual(txn.total_credited, Decimal('95.00'))

    def test_missing_total_credited_computes_net(self):
        from .models import RemittanceTransaction
        from .views.remittance_views import _apply_load_fields

        txn = RemittanceTransaction(
            amount=Decimal('100.00'),
            total_credited=Decimal('100.00'),
            ref_no='S100TEST3',
        )
        himalpay = HimalPayAPI()
        _apply_load_fields(
            txn,
            himalpay,
            {
                'amount': 10000,
                'charge': 500,
                'cashback': 200,
            },
            persist=False,
        )
        self.assertEqual(txn.total_credited, Decimal('97.00'))


class WalletEmailDirectionTests(TestCase):
    """Payment/remittance emails debit Admin Wallet and show remaining balances."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone='9800000099',
            password='testpass123',
            email='customer@example.com',
            first_name='Cust',
            last_name='Omer',
        )
        self.admin = User.objects.create_superuser(
            phone='9800000001',
            password='adminpass123',
            email='admin@example.com',
        )
        from .models import Wallet, Settings

        Wallet.objects.get_or_create(user=self.user, defaults={'balance': Decimal('500.00')})
        settings = Settings.load()
        cfg = settings.config if isinstance(settings.config, dict) else {}
        notif = dict(cfg.get('notifications') or {})
        notif.update(
            {
                'email_on_wallet_credit': True,
                'email_on_wallet_debit': True,
                'email_on_wallet_adjustment': True,
                'admin_alert_email': 'admin@example.com',
            }
        )
        cfg['notifications'] = notif
        settings.config = cfg
        settings.save()

    def test_customer_credit_sends_admin_debit(self):
        from unittest.mock import patch
        from .services import notifications as notif

        sent = []

        def fake_send(subject, message, recipients, html_body=None, fail_silently=True):
            sent.append(
                {
                    'subject': subject,
                    'message': message,
                    'recipients': list(recipients),
                    'html': html_body or '',
                }
            )
            return True

        with patch.object(notif, 'send_smtp_email', side_effect=fake_send):
            with patch.object(
                notif,
                '_admin_float_balance',
                return_value=Decimal('200.00'),
            ):
                notif.notify_wallet_credit(
                    self.user,
                    Decimal('95.00'),
                    balance_after=Decimal('595.00'),
                    reason='Remittance net of charge',
                    ref='REF95',
                )

        self.assertEqual(len(sent), 2)
        customer = next(m for m in sent if 'customer@example.com' in m['recipients'])
        admin = next(m for m in sent if 'admin@example.com' in m['recipients'])
        self.assertIn('credited', customer['subject'].lower())
        self.assertIn('Rs. 95', customer['message'])
        self.assertIn('credited to your wallet', customer['message'].lower())
        self.assertIn('Rs. 595', customer['message'])
        self.assertIn('debit', admin['subject'].lower())
        self.assertIn('Rs. 95', admin['message'])
        self.assertIn('debited from the admin wallet', admin['message'].lower())
        self.assertIn('Rs. 200', admin['message'])
        self.assertIn('admin wallet debited', admin['html'].lower())

    def test_customer_debit_sends_admin_debit(self):
        from unittest.mock import patch
        from .services import notifications as notif

        sent = []

        def fake_send(subject, message, recipients, html_body=None, fail_silently=True):
            sent.append(
                {
                    'subject': subject,
                    'message': message,
                    'recipients': list(recipients),
                    'html': html_body or '',
                }
            )
            return True

        with patch.object(notif, 'send_smtp_email', side_effect=fake_send):
            with patch.object(
                notif,
                '_admin_float_balance',
                return_value=Decimal('200.00'),
            ):
                notif.notify_wallet_debit(
                    self.user,
                    Decimal('100.00'),
                    balance_after=Decimal('400.00'),
                    reason='Bank transfer',
                    ref='XFER100',
                )

        self.assertEqual(len(sent), 2)
        customer = next(m for m in sent if 'customer@example.com' in m['recipients'])
        admin = next(m for m in sent if 'admin@example.com' in m['recipients'])
        self.assertIn('debited', customer['subject'].lower())
        self.assertIn('Rs. 100', customer['message'])
        self.assertIn('deducted from your wallet', customer['message'].lower())
        self.assertIn('Rs. 400', customer['message'])
        self.assertIn('debit', admin['subject'].lower())
        self.assertIn('Rs. 100', admin['message'])
        self.assertIn('debited from the admin wallet', admin['message'].lower())
        self.assertIn('Rs. 200', admin['message'])
        self.assertIn('admin wallet balance', admin['html'].lower())

class RemittanceWalletCreditIntegrationTests(TestCase):
    """End-to-end: remittance with charge credits net amount and snapshots balances."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            phone='9800000088',
            password='testpass123',
            email='remit@example.com',
        )
        from .models import Wallet

        self.wallet, _ = Wallet.objects.get_or_create(
            user=self.user, defaults={'balance': Decimal('10.00')}
        )
        self.wallet.balance = Decimal('10.00')
        self.wallet.save(update_fields=['balance'])

    def test_inbound_credit_uses_net_of_charge(self):
        from .models import RemittanceTransaction
        from .services.txn_status import apply_inbound_status_change
        from .views.remittance_views import _apply_load_fields

        txn = RemittanceTransaction.objects.create(
            user=self.user,
            ref_no='S100NET95',
            samsara_link_id='link-net-95',
            amount=Decimal('100.00'),
            total_credited=Decimal('100.00'),
            status='pending',
            merchant_txn_id='MYSEWA_REM_NET95',
        )
        himalpay = HimalPayAPI()
        _apply_load_fields(
            txn,
            himalpay,
            {
                'amount': 10000,
                'charge': 500,
                'cashback': 0,
                'total_credited': 10000,
                'status': 'SUCCESS',
            },
        )
        txn.refresh_from_db()
        self.assertEqual(txn.total_credited, Decimal('95.00'))

        ok, err = apply_inbound_status_change(txn, 'success')
        self.assertTrue(ok, err)
        txn.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('105.00'))
        self.assertEqual(txn.balance_before, Decimal('10.00'))
        self.assertEqual(txn.balance_after, Decimal('105.00'))


class StatementReconcileTests(TestCase):
    """HimalPay reseller statement vs MySewa top-up matching and solve."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            phone='9800000099',
            password='testpass123',
            email='admin-stmt@example.com',
            is_staff=True,
            is_superuser=True,
        )
        self.user = User.objects.create_user(
            phone='9800000077',
            password='testpass123',
            email='user-stmt@example.com',
        )
        from .models import Wallet, TopupTransaction

        self.wallet, _ = Wallet.objects.get_or_create(
            user=self.user, defaults={'balance': Decimal('500.00')},
        )
        self.wallet.balance = Decimal('500.00')
        self.wallet.save(update_fields=['balance'])
        self.TopupTransaction = TopupTransaction
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _mock_api(self, entries):
        class FakeAPI:
            def get_reseller_statement(self, **kwargs):
                return entries

            def get_reseller_balance(self):
                return {
                    'balance': 1000000,
                    'bonus_balance': 0,
                    'balance_in_rupees': 10000.0,
                    'bonus_balance_in_rupees': 0.0,
                    'total_balance_in_rupees': 10000.0,
                }

        return FakeAPI()

    def test_matched_success_creates_no_issue(self):
        from .models import StatementDiscrepancy
        from .services.statement_reconcile import run_statement_reconcile

        uuid = 'HP-MATCH-OK-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='success',
            merchant_txn_id='MYSEWA_NTC_MATCHOK',
            service_hub_txn_id=uuid,
            total_debited=Decimal('100.00'),
            balance_before=Decimal('600.00'),
            balance_after=Decimal('500.00'),
        )
        entries = [{
            'direction': 'debit',
            'amount': 10000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
        }]
        run = run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
        )
        self.assertEqual(run.status, 'success')
        self.assertEqual(run.matched, 1)
        self.assertEqual(len(run.himalpay_statement_logs), 1)
        self.assertEqual(
            run.himalpay_statement_logs[0].get('transaction_uuid'),
            uuid,
        )
        self.assertEqual(
            StatementDiscrepancy.objects.filter(status='open').count(),
            0,
        )

        list_resp = self.client.get(reverse('admin_statement_list'))
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK, list_resp.content)
        self.assertEqual(len(list_resp.data.get('statement_logs') or []), 1)
        self.assertEqual(
            list_resp.data['statement_logs'][0].get('transaction_uuid'),
            uuid,
        )
        self.assertEqual(
            len(list_resp.data['summary']['latest_run'].get('himalpay_statement_logs') or []),
            1,
        )

    def test_status_mismatch_suggests_debit_and_solve_adjusts_wallet(self):
        from .models import StatementDiscrepancy, WalletAdjustment
        from .services.statement_reconcile import run_statement_reconcile

        uuid = 'HP-MISMATCH-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_MISMATCH',
            service_hub_txn_id=uuid,
            total_debited=Decimal('100.00'),
        )
        entries = [{
            'direction': 'debit',
            'amount': 10000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
        }]
        run = run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
            triggered_by_user=self.admin,
        )
        self.assertEqual(run.issues_new, 1)
        disc = StatementDiscrepancy.objects.get(status='open')
        self.assertEqual(disc.issue_type, 'status_mismatch')
        self.assertEqual(disc.suggested_adjustment_type, 'debit')
        self.assertEqual(Decimal(disc.suggested_amount), Decimal('100.00'))

        resp = self.client.post(
            reverse('admin_statement_solve', args=[disc.pk]),
            {},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        disc.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(disc.status, 'resolved')
        self.assertEqual(self.wallet.balance, Decimal('400.00'))
        adj = WalletAdjustment.objects.get(pk=disc.resolution_adjustment_id)
        self.assertEqual(adj.adjustment_type, 'debit')
        self.assertEqual(adj.amount, Decimal('-100.00'))

    def test_ledger_includes_all_user_txns_and_groups_by_user(self):
        from .models import Deposit, StatementDiscrepancy
        from .services.statement_reconcile import (
            build_statement_ledger,
            group_ledger_by_user,
            run_statement_reconcile,
        )

        uuid = 'HP-LEDGER-OK-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('50.00'),
            product_id=1,
            status='success',
            merchant_txn_id='MYSEWA_NTC_LEDGER',
            service_hub_txn_id=uuid,
            total_debited=Decimal('50.00'),
            balance_before=Decimal('550.00'),
            balance_after=Decimal('500.00'),
        )
        # Pending top-up without provider UUID must still appear on MySewa side
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('25.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_PENDING',
            service_hub_txn_id='',
            total_debited=Decimal('25.00'),
        )
        Deposit.objects.create(
            user=self.user,
            amount=Decimal('200.00'),
            status='approved',
            transaction_id='DEP-LEDGER-1',
        )
        entries = [{
            'direction': 'debit',
            'amount': 5000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
        }]
        run = run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
        )
        rows = build_statement_ledger(
            from_date=date.today(),
            to_date=date.today(),
            run=run,
        )
        keys = {r['key'] for r in rows}
        self.assertIn(f'hp:{uuid}', keys)
        self.assertTrue(any(k.startswith('local:topup:') for k in keys))
        self.assertTrue(any(k.startswith('deposit:') for k in keys))
        self.assertEqual(
            StatementDiscrepancy.objects.filter(status='open').count(),
            0,
        )

        by_user = group_ledger_by_user(rows)
        self.assertTrue(any(g['user_id'] == self.user.pk for g in by_user))
        user_group = next(g for g in by_user if g['user_id'] == self.user.pk)
        self.assertGreaterEqual(user_group['row_count'], 3)

        ledger_resp = self.client.get(
            reverse('admin_statement_ledger'),
            {'from_date': date.today().isoformat(), 'to_date': date.today().isoformat()},
        )
        self.assertEqual(ledger_resp.status_code, status.HTTP_200_OK, ledger_resp.content)
        self.assertGreaterEqual(ledger_resp.data['counts']['total'], 3)
        self.assertTrue(ledger_resp.data.get('by_user'))

    def test_statement_correct_credits_wallet(self):
        from .models import WalletAdjustment

        before = self.wallet.balance
        resp = self.client.post(
            reverse('admin_statement_correct'),
            {
                'user_id': self.user.pk,
                'adjustment_type': 'credit',
                'amount': '15.50',
                'reason': 'Missed remittance top-up correction',
                'transaction_uuid': 'HP-MANUAL-1',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, before + Decimal('15.50'))
        adj = WalletAdjustment.objects.get(pk=resp.data['adjustment_id'])
        self.assertEqual(adj.adjustment_type, 'credit')
        self.assertIn('Statement ledger correction', adj.reason)

    def test_himalpay_history_from_stored_logs(self):
        from .services.statement_reconcile import run_statement_reconcile

        uuid = 'HP-HIST-001'
        entries = [{
            'direction': 'debit',
            'amount': 10000,
            'balance_before': 500000,
            'balance_after': 490000,
            'bonus_balance_before': 0,
            'bonus_balance_after': 0,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
            'reference_id': 'REF-HIST',
        }]
        run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
        )
        resp = self.client.get(
            reverse('admin_statement_history'),
            {
                'from_date': date.today().isoformat(),
                'to_date': date.today().isoformat(),
                'live': '0',
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertGreaterEqual(resp.data['counts']['total'], 1)
        item = resp.data['items'][0]
        self.assertEqual(item['transaction_uuid'], uuid)
        self.assertEqual(item['direction'], 'debit')
        self.assertEqual(item['balance_before'], '5000.00')
        self.assertEqual(item['balance_after'], '4900.00')

        csv_resp = self.client.get(
            reverse('admin_statement_history'),
            {
                'from_date': date.today().isoformat(),
                'to_date': date.today().isoformat(),
                'live': '0',
                'export': 'csv',
            },
        )
        self.assertEqual(csv_resp.status_code, status.HTTP_200_OK, csv_resp.content)
        self.assertIn(uuid, csv_resp.content.decode('utf-8'))

    def test_amount_mismatch_and_balance_mismatch(self):
        from .models import StatementDiscrepancy
        from .services.statement_reconcile import run_statement_reconcile

        uuid = 'HP-AMT-MIS-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='success',
            merchant_txn_id='MYSEWA_NTC_AMT',
            service_hub_txn_id=uuid,
            total_debited=Decimal('100.00'),
            balance_before=Decimal('600.00'),
            balance_after=Decimal('500.00'),
        )
        entries = [{
            'direction': 'debit',
            'amount': 15000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
        }]
        run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
        )
        disc = StatementDiscrepancy.objects.get(status='open')
        self.assertEqual(disc.issue_type, 'amount_mismatch')

        uuid2 = 'HP-BAL-MIS-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('50.00'),
            product_id=1,
            status='success',
            merchant_txn_id='MYSEWA_NTC_BAL',
            service_hub_txn_id=uuid2,
            total_debited=Decimal('50.00'),
            balance_before=Decimal('500.00'),
            balance_after=Decimal('450.00'),
        )
        StatementDiscrepancy.objects.filter(status='open').update(status='ignored')
        entries2 = [{
            'direction': 'debit',
            'amount': 5000,
            'balance_before': 200000,
            'balance_after': 100000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid2,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T11:00:00Z',
        }]
        run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries2),
        )
        bal_disc = StatementDiscrepancy.objects.get(status='open', transaction_uuid=uuid2)
        self.assertEqual(bal_disc.issue_type, 'balance_mismatch')

    def test_hp_success_without_wallet_blocks_and_admin_unblocks(self):
        from .models import StatementDiscrepancy
        from .services.statement_reconcile import run_statement_reconcile

        uuid = 'HP-BLOCK-001'
        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='failed',
            merchant_txn_id='MYSEWA_NTC_BLOCK',
            service_hub_txn_id=uuid,
            total_debited=Decimal('100.00'),
        )
        entries = [{
            'direction': 'debit',
            'amount': 10000,
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'transaction_uuid': uuid,
            'status': 'SUCCESS',
            'wallet_service_name': 'NTC',
            'transaction_cashback': 0,
            'transaction_charge': 0,
            'created_at': '2026-08-09T10:00:00Z',
        }]
        run_statement_reconcile(
            from_date=date.today(),
            to_date=date.today(),
            himalpay=self._mock_api(entries),
        )
        disc = StatementDiscrepancy.objects.get(status='open')
        self.assertEqual(disc.issue_type, 'status_mismatch')
        self.wallet.refresh_from_db()
        self.assertTrue(self.wallet.transactions_blocked)

        resp = self.client.post(
            reverse('admin_wallet_unblock', args=[self.wallet.pk]),
            {},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.wallet.refresh_from_db()
        self.assertFalse(self.wallet.transactions_blocked)

        from .services.wallet_guard import require_wallet_not_blocked, block_wallet
        block_wallet(self.user, reason='test lock', merchant_txn_id='MYSEWA_NTC_BLOCK', notify=False)
        blocked_resp = require_wallet_not_blocked(self.user)
        self.assertIsNotNone(blocked_resp)
        self.assertEqual(blocked_resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(blocked_resp.data.get('code'), 'wallet_blocked')

    def test_start_matching_returns_run_instead_of_500(self):
        from unittest.mock import patch
        from .models import StatementReconcileRun
        from .services.statement_reconcile import run_statement_reconcile_range

        today = date.today()
        run = run_statement_reconcile_range(
            from_date=today,
            to_date=today,
            himalpay=self._mock_api([]),
        )
        self.assertIsInstance(run, StatementReconcileRun)
        self.assertIsNotNone(run.pk)

        with patch(
            'core.services.statement_reconcile.HimalPayAPI',
            return_value=self._mock_api([]),
        ):
            resp = self.client.post(
                reverse('admin_statement_run'),
                {'from_date': today.isoformat(), 'to_date': today.isoformat()},
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertTrue(resp.data.get('data'))
        self.assertIn('issues_new', resp.data['data'])
        self.assertIn('issues_open', resp.data['data'])


class WalletBeforeAfterCheckTests(TestCase):
    """User wallet before/after mismatch detection and Issue Share correction."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            phone='9800000199',
            password='testpass123',
            email='admin-ba@example.com',
            first_name='Super',
            last_name='Admin',
            is_staff=True,
            is_superuser=True,
        )
        self.user = User.objects.create_user(
            phone='9800000177',
            password='testpass123',
            email='user-ba@example.com',
            first_name='Ram',
            last_name='Bahadur',
        )
        from .models import Wallet, TopupTransaction

        self.wallet, _ = Wallet.objects.get_or_create(
            user=self.user, defaults={'balance': Decimal('1000.00')},
        )
        self.wallet.balance = Decimal('1000.00')
        self.wallet.save(update_fields=['balance'])
        self.TopupTransaction = TopupTransaction
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _mismatched_topup(self, *, merchant='MYSEWA_BA_100'):
        return self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='success',
            merchant_txn_id=merchant,
            service_hub_txn_id='HP-BA-100',
            total_debited=Decimal('100.00'),
            balance_before=Decimal('1000.00'),
            balance_after=Decimal('1000.00'),
        )

    def test_scan_detects_deduction_not_reflected_in_after_balance(self):
        from .models import WalletBalanceIssue
        from .services.wallet_before_after import scan_wallet_before_after

        txn = self._mismatched_topup()
        today = date.today()
        stats = scan_wallet_before_after(from_date=today, to_date=today)
        self.assertEqual(stats['created'], 1)
        issue = WalletBalanceIssue.objects.get(status='open')
        self.assertEqual(issue.txn_id, txn.pk)
        self.assertEqual(issue.amount, Decimal('100.00'))
        self.assertEqual(issue.balance_before, Decimal('1000.00'))
        self.assertEqual(issue.recorded_balance_after, Decimal('1000.00'))
        self.assertEqual(issue.expected_balance_after, Decimal('900.00'))
        self.assertEqual(issue.suggested_adjustment_type, 'debit')
        self.assertEqual(issue.suggested_amount, Decimal('100.00'))

        scan_wallet_before_after(from_date=today, to_date=today)
        self.assertEqual(WalletBalanceIssue.objects.count(), 1)

    def test_matching_snapshot_is_not_flagged(self):
        from .models import WalletBalanceIssue
        from .services.wallet_before_after import scan_wallet_before_after

        self.TopupTransaction.objects.create(
            user=self.user,
            mobile_number='9801112233',
            amount=Decimal('100.00'),
            product_id=1,
            status='success',
            merchant_txn_id='MYSEWA_BA_OK',
            total_debited=Decimal('100.00'),
            balance_before=Decimal('1000.00'),
            balance_after=Decimal('900.00'),
        )
        today = date.today()
        stats = scan_wallet_before_after(from_date=today, to_date=today)
        self.assertEqual(stats['mismatches'], 0)
        self.assertEqual(WalletBalanceIssue.objects.count(), 0)

    def test_issue_share_adjusts_wallet_emails_and_blocks_duplicate(self):
        from unittest.mock import patch
        from .models import WalletAdjustment, WalletBalanceIssue
        from .services.wallet_before_after import scan_wallet_before_after

        self._mismatched_topup()
        today = date.today()
        scan_wallet_before_after(from_date=today, to_date=today)
        issue = WalletBalanceIssue.objects.get(status='open')

        list_resp = self.client.get(reverse('admin_wallet_before_after_list'))
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK, list_resp.content)
        self.assertGreaterEqual(list_resp.data['summary']['open_issues'], 1)

        with patch(
            'core.services.notifications.notify_wallet_before_after_correction',
            return_value=True,
        ) as notify:
            resp = self.client.post(
                reverse('admin_wallet_before_after_share', args=[issue.pk]),
                {},
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        notify.assert_called_once()
        email_ctx = notify.call_args[0][1]
        self.assertEqual(email_ctx['amount'], '100.00')
        self.assertEqual(email_ctx['balance_before'], '1000.00')
        self.assertEqual(email_ctx['expected_after'], '900.00')
        self.assertEqual(email_ctx['corrected_balance'], '900.00')

        issue.refresh_from_db()
        self.wallet.refresh_from_db()
        self.assertEqual(issue.status, 'resolved')
        self.assertEqual(issue.shared_by_id, self.admin.pk)
        self.assertIsNotNone(issue.shared_at)
        self.assertEqual(self.wallet.balance, Decimal('900.00'))
        adj = WalletAdjustment.objects.get(pk=issue.resolution_adjustment_id)
        self.assertEqual(adj.adjustment_type, 'debit')
        self.assertEqual(adj.amount, Decimal('-100.00'))
        self.assertEqual(adj.reference, f'BA-ISSUE-{issue.pk}')
        self.assertIsNotNone(issue.email_sent_at)

        dup = self.client.post(
            reverse('admin_wallet_before_after_share', args=[issue.pk]),
            {},
            format='json',
        )
        self.assertEqual(dup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(WalletAdjustment.objects.filter(reference=adj.reference).count(), 1)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('900.00'))

    def test_correction_email_explains_date_amount_and_balance(self):
        from unittest.mock import patch
        from django.utils import timezone
        from .services.notifications import notify_wallet_before_after_correction

        captured = {}

        def fake_send(**kwargs):
            captured.update(kwargs)
            return True

        with patch('core.services.notifications._send_txn_email', side_effect=fake_send):
            sent = notify_wallet_before_after_correction(self.user, {
                'issue_id': 1,
                'amount': '100.00',
                'balance_before': '1000.00',
                'expected_after': '900.00',
                'corrected_balance': '900.00',
                'txn_at': timezone.now(),
                'txn_reference': 'MYSEWA_BA_100',
                'service_name': 'Mobile top-up',
                'direction': 'debit',
                'description': 'Mobile top-up to 9801112233',
            })
        self.assertTrue(sent)
        intro = captured.get('text_intro') or ''
        self.assertIn('Rs. 1,000', intro)
        self.assertIn('Rs. 100', intro)
        self.assertIn('not reflected correctly', intro.lower())
        self.assertIn('Rs. 900', intro)
        rows = dict(captured.get('rows') or [])
        self.assertEqual(rows.get('Transaction / reference ID'), 'MYSEWA_BA_100')
        self.assertIn('Transaction date', rows)
        self.assertIn('Transaction time', rows)


class HomePopupFrequencyTests(TestCase):
    """Per-user 24-hour home popup display caps."""

    def setUp(self):
        self.user = User.objects.create_user(
            phone='9800111222',
            password='testpass123',
            email='popup-user@example.com',
        )
        self.other = User.objects.create_user(
            phone='9800111333',
            password='testpass123',
            email='popup-other@example.com',
        )
        self.staff = User.objects.create_user(
            phone='9800111444',
            password='testpass123',
            email='popup-admin@example.com',
            is_staff=True,
        )
        from .models import HomePopup

        self.popup = HomePopup.objects.create(
            title='Promo',
            body='Hello',
            max_per_24h=3,
            is_active=True,
            sort_order=0,
        )
        self.client = APIClient()

    def test_admin_create_requires_content(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            reverse('admin_popups'),
            {'title': '', 'body': '', 'max_per_24h': 2},
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_create_and_list(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            reverse('admin_popups'),
            {
                'title': 'Welcome',
                'body': 'New feature',
                'max_per_24h': 2,
                'is_active': 'true',
                'sort_order': '1',
            },
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        listed = self.client.get(reverse('admin_popups'))
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(listed.data['count'], 2)

    def test_user_capped_after_max_views_within_window(self):
        self.client.force_authenticate(user=self.user)
        for _ in range(3):
            active = self.client.get(reverse('active_home_popup'))
            self.assertEqual(active.status_code, status.HTTP_200_OK)
            self.assertIsNotNone(active.data['popup'])
            shown = self.client.post(
                reverse('record_home_popup_shown', kwargs={'popup_id': self.popup.pk}),
            )
            self.assertEqual(shown.status_code, status.HTTP_200_OK, shown.content)

        active = self.client.get(reverse('active_home_popup'))
        self.assertEqual(active.status_code, status.HTTP_200_OK)
        self.assertIsNone(active.data['popup'])

        blocked = self.client.post(
            reverse('record_home_popup_shown', kwargs={'popup_id': self.popup.pk}),
        )
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_counts_are_per_user(self):
        self.client.force_authenticate(user=self.user)
        for _ in range(3):
            self.client.post(
                reverse('record_home_popup_shown', kwargs={'popup_id': self.popup.pk}),
            )

        self.client.force_authenticate(user=self.other)
        active = self.client.get(reverse('active_home_popup'))
        self.assertIsNotNone(active.data['popup'])
        shown = self.client.post(
            reverse('record_home_popup_shown', kwargs={'popup_id': self.popup.pk}),
        )
        self.assertEqual(shown.status_code, status.HTTP_200_OK)

    def test_window_resets_after_24_hours(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import HomePopupImpression
        from .services.home_popup import get_active_popup_for_user, record_popup_shown

        now = timezone.now()
        HomePopupImpression.objects.create(
            popup=self.popup,
            user=self.user,
            window_started_at=now - timedelta(hours=25),
            view_count=3,
            last_shown_at=now - timedelta(hours=24),
        )
        self.assertIsNotNone(get_active_popup_for_user(self.user, now=now))
        self.assertTrue(record_popup_shown(self.popup, self.user, now=now))
        state = HomePopupImpression.objects.get(popup=self.popup, user=self.user)
        self.assertEqual(state.view_count, 1)


class AdminDataExportTests(TestCase):
    """Full DB export must honor ?format=sql|xlsx|csv (not DRF renderer suffixes)."""

    def setUp(self):
        self.staff = User.objects.create_user(
            phone='9800000088',
            password='testpass123',
            email='admin-export@example.com',
            is_staff=True,
        )
        self.user = User.objects.create_user(
            phone='9800000089',
            password='testpass123',
            email='user-export@example.com',
        )
        self.client = APIClient()

    def test_sql_format_query_param_downloads_dump(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_export_data'), {'format': 'sql'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content[:500])
        self.assertIn('.sql', resp['Content-Disposition'])
        body = resp.content.decode('utf-8')
        self.assertIn('phpMyAdmin SQL Dump', body)
        self.assertIn('CREATE TABLE', body)

    def test_xlsx_and_csv_exports(self):
        self.client.force_authenticate(user=self.staff)
        xlsx = self.client.get('/api/admin/settings/export/', {'format': 'xlsx'})
        self.assertEqual(xlsx.status_code, status.HTTP_200_OK, xlsx.content[:500])
        self.assertIn('.xlsx', xlsx['Content-Disposition'])
        self.assertTrue(xlsx.content.startswith(b'PK'))

        csv_zip = self.client.get('/api/admin/export/', {'format': 'csv'})
        self.assertEqual(csv_zip.status_code, status.HTTP_200_OK, csv_zip.content[:500])
        self.assertIn('.zip', csv_zip['Content-Disposition'])
        self.assertTrue(csv_zip.content.startswith(b'PK'))

    def test_unknown_format_is_400_not_404(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_export_data'), {'format': 'pdf'})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_non_staff_forbidden(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(reverse('admin_export_data'), {'format': 'sql'})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class UserFeatureAccessTests(TestCase):
    """Per-user Fund Transfer and Wallet Adjustment toggles."""

    def setUp(self):
        self.staff = User.objects.create_user(
            phone='9800000101',
            password='testpass123',
            email='staff-access@example.com',
            is_staff=True,
        )
        self.user = User.objects.create_user(
            phone='9800000102',
            password='testpass123',
            email='user-access@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.client = APIClient()

    def test_new_users_have_both_features_enabled(self):
        self.assertTrue(self.user.can_fund_transfer)
        self.assertTrue(self.user.can_wallet_adjust)

    def test_admin_can_toggle_access_flags(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            reverse('admin_user_detail', args=[self.user.pk]),
            {'can_fund_transfer': False, 'can_wallet_adjust': False},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json().get('data') or {}
        self.assertFalse(data.get('can_fund_transfer'))
        self.assertFalse(data.get('can_wallet_adjust'))
        self.user.refresh_from_db()
        self.assertFalse(self.user.can_fund_transfer)
        self.assertFalse(self.user.can_wallet_adjust)

    def test_disabled_fund_transfer_is_forbidden(self):
        self.user.can_fund_transfer = False
        self.user.save(update_fields=['can_fund_transfer'])
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(
            reverse('bank_transfer_create'),
            {
                'amount': '100',
                'destination_bank': 'LXBLNPKA',
                'destination_acc_no': '1845008000023',
                'destination_acc_name': 'Test User',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'fund_transfer_forbidden')

    def test_disabled_wallet_adjustment_is_forbidden(self):
        from .models import Wallet

        self.staff.can_wallet_adjust = False
        self.staff.save(update_fields=['can_wallet_adjust'])
        wallet, _ = Wallet.objects.get_or_create(
            user=self.user, defaults={'balance': Decimal('100.00')},
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            reverse('admin_wallet_detail', args=[wallet.pk]),
            {
                'amount': '10.00',
                'adjustment_type': 'credit',
                'reason': 'Test load',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'wallet_adjustment_forbidden')


class WalletTransferTests(TestCase):
    """MySewa user-to-user wallet transfers gated by can_wallet_adjust."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from .models import Wallet

        self.sender = User.objects.create_user(
            phone='9800000301',
            password='testpass123',
            email='sender-wt@example.com',
            first_name='Sender',
            last_name='One',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.sender.transaction_pin = make_password('1234')
        self.sender.save(update_fields=['transaction_pin'])
        self.recipient = User.objects.create_user(
            phone='9800000302',
            password='testpass123',
            email='recipient-wt@example.com',
            first_name='Recipient',
            last_name='Two',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        Wallet.objects.get_or_create(
            user=self.sender, defaults={'balance': Decimal('500.00')},
        )
        sender_wallet = Wallet.objects.get(user=self.sender)
        sender_wallet.balance = Decimal('500.00')
        sender_wallet.save(update_fields=['balance'])
        Wallet.objects.get_or_create(
            user=self.recipient, defaults={'balance': Decimal('10.00')},
        )
        recipient_wallet = Wallet.objects.get(user=self.recipient)
        recipient_wallet.balance = Decimal('10.00')
        recipient_wallet.save(update_fields=['balance'])
        self.client = APIClient()
        self.client.force_authenticate(user=self.sender)

    def test_lookup_recipient_by_phone(self):
        resp = self.client.post(
            reverse('wallet_transfer_lookup'),
            {'phone': '9800000302'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json().get('phone'), '9800000302')
        self.assertIn('Recipient', resp.json().get('name') or '')

    def test_cannot_lookup_self(self):
        resp = self.client.post(
            reverse('wallet_transfer_lookup'),
            {'phone': '9800000301'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('code'), 'self_transfer')

    def test_transfer_moves_balance(self):
        from .models import Wallet, WalletTransfer

        resp = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': '9800000302',
                'amount': '125.50',
                'remarks': 'Test send',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json().get('data') or {}
        self.assertEqual(data.get('direction'), 'sent')
        self.assertEqual(data.get('counterparty_phone'), '9800000302')
        self.sender.wallet.refresh_from_db()
        self.recipient.wallet.refresh_from_db()
        self.assertEqual(self.sender.wallet.balance, Decimal('374.50'))
        self.assertEqual(self.recipient.wallet.balance, Decimal('135.50'))
        self.assertEqual(WalletTransfer.objects.count(), 1)

        self.client.force_authenticate(user=self.recipient)
        history = self.client.get(reverse('wallet_transfer_history'))
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        items = history.json().get('items') or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get('direction'), 'received')

    def test_insufficient_balance(self):
        resp = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': '9800000302',
                'amount': '9999',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('error'), 'Insufficient balance')

    def test_disabled_flag_blocks_transfer(self):
        self.sender.can_wallet_adjust = False
        self.sender.save(update_fields=['can_wallet_adjust'])
        resp = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': '9800000302',
                'amount': '10',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'wallet_adjustment_forbidden')


class RemittanceReceiveDocumentTests(TestCase):
    """Receive remittance requires citizenship images and sends HimalPay document links."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from .models import Settings, Wallet

        self.user = User.objects.create_user(
            phone='9800000202',
            password='testpass123',
            email='citdocs@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.user.transaction_pin = make_password('1234')
        self.user.save(update_fields=['transaction_pin'])
        Wallet.objects.get_or_create(user=self.user, defaults={'balance': Decimal('0.00')})

        settings = Settings.load()
        cfg = settings.get_config()
        cfg['payment']['remittances_enabled'] = True
        cfg.setdefault('remittance', {})
        cfg['remittance']['payout_agent_pan_number'] = '123456789'
        cfg['remittance']['teller_contact'] = '9800000000'
        settings.config = cfg
        settings.save()

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.receive_payload = {
            'ref_no': 'S100CITIZEN1',
            'samsara_link_id': 'link-cit-1',
            'amount': '100.00',
            'receiver_name': 'Ram Bahadur Thapa',
            'beneficiary_gender': 'Male',
            'beneficiary_state': 'Bagmati',
            'beneficiary_district': 'Kathmandu',
            'beneficiary_municipality': 'Kathmandu Metropolitan City',
            'beneficiary_ward_number': '10',
            'beneficiary_address': 'Kathmandu',
            'beneficiary_occupation': 'EMPLOYED',
            'beneficiary_citizenship_number': '28-01-75-01234',
            'beneficiary_citizenship_issuing_district': 'Kathmandu',
            'beneficiary_id_number': '28-01-75-01234',
            'beneficiary_id_issue_date': '2008-11-23',
            'beneficiary_id_issue_by': 'Kathmandu',
            'beneficiary_mobile_no': '9800000202',
            'beneficiary_dob': '1988-05-28',
            'transaction_pin': '1234',
        }

    @staticmethod
    def _png_file(name):
        from io import BytesIO
        from PIL import Image

        buf = BytesIO()
        Image.new('RGB', (48, 48), 'white').save(buf, format='PNG')
        buf.seek(0)
        buf.name = name
        return buf

    def _multipart(self):
        payload = dict(self.receive_payload)
        payload['front'] = self._png_file('front.png')
        payload['back'] = self._png_file('back.png')
        return payload

    def test_receive_blocked_without_citizenship_images(self):
        resp = self.client.post(
            reverse('remittance_receive'),
            self.receive_payload,
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        body = resp.json()
        self.assertEqual(body.get('error'), 'Citizenship images required')

    def test_receive_sends_document_links_and_credits_wallet(self):
        from unittest.mock import patch
        from .models import RemittanceTransaction, Wallet

        fake_success = {
            'status': 'SUCCESS',
            'amount': 10000,
            'charge': 0,
            'cashback': 0,
            'total_credited': 10000,
            'transaction_id': 'HP-CIT-1',
            'reference_id': 'S100CITIZEN1',
            'message': 'SAMSARA_PAY load successful',
        }
        with patch.object(HimalPayAPI, 'receive_remittance', return_value=fake_success) as pay:
            resp = self.client.post(
                reverse('remittance_receive'),
                self._multipart(),
                format='multipart',
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content[:500])
        body = resp.json()
        self.assertEqual(body.get('data', {}).get('status'), 'success')
        self.assertTrue(body.get('data', {}).get('wallet_credited'))
        pay.assert_called_once()
        sent_data = pay.call_args.kwargs['data']
        self.assertIn('document_front_link', sent_data)
        self.assertIn('document_back_link', sent_data)
        self.assertIn('/api/public/remittance-documents/', sent_data['document_front_link'])
        self.assertTrue(sent_data['document_front_link'].endswith('/front/'))
        self.assertTrue(sent_data['document_back_link'].endswith('/back/'))
        txn = RemittanceTransaction.objects.get(ref_no='S100CITIZEN1')
        self.assertTrue(txn.citizenship_front)
        self.assertTrue(txn.citizenship_back)
        self.assertEqual(txn.status, 'success')
        wallet = Wallet.objects.get(user=self.user)
        self.assertEqual(wallet.balance, Decimal('100.00'))

        public = APIClient()
        front_resp = public.get(reverse(
            'remittance_public_document',
            kwargs={'merchant_txn_id': txn.merchant_txn_id, 'side': 'front'},
        ))
        back_resp = public.get(reverse(
            'remittance_public_document',
            kwargs={'merchant_txn_id': txn.merchant_txn_id, 'side': 'back'},
        ))
        self.assertEqual(front_resp.status_code, 200)
        self.assertEqual(back_resp.status_code, 200)
        self.assertGreater(len(b''.join(front_resp.streaming_content)), 0)

    def test_receive_keeps_failed_when_himalpay_fails(self):
        from unittest.mock import patch
        from .models import RemittanceTransaction

        with patch.object(
            HimalPayAPI,
            'receive_remittance',
            side_effect=HimalPayError('Payout failed', status_code=400),
        ):
            resp = self.client.post(
                reverse('remittance_receive'),
                self._multipart(),
                format='multipart',
            )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        txn = RemittanceTransaction.objects.get(ref_no='S100CITIZEN1')
        self.assertEqual(txn.status, 'failed')
        self.assertTrue(txn.citizenship_front)
        self.assertTrue(txn.citizenship_back)


class AdminRemittanceListTests(TestCase):
    """Admin remittance ledger must serialize without 500s."""

    def setUp(self):
        self.staff = User.objects.create_user(
            phone='9800000301',
            password='testpass123',
            email='admin-rem@example.com',
            is_staff=True,
        )
        self.user = User.objects.create_user(
            phone='9800000302',
            password='testpass123',
            email='user-rem@example.com',
            first_name='Ram',
            last_name='Thapa',
        )
        self.client = APIClient()

    def test_admin_list_remittances_returns_items_and_summary(self):
        from .models import RemittanceTransaction

        RemittanceTransaction.objects.create(
            user=self.user,
            ref_no='S100ADMIN1',
            samsara_link_id='link-admin-1',
            amount=Decimal('2500.00'),
            total_credited=Decimal('2500.00'),
            sender_name='Sita Sharma',
            receiver_name='Ram Thapa',
            status='success',
            merchant_txn_id='MYSEWA_REM_ADMIN1',
            lookup_response={'himalpay_received': True, 'citizenship_review_pending': True},
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_list_remittances'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content[:500])
        body = resp.json()
        self.assertEqual(body['stats']['total'], 1)
        self.assertEqual(body['stats']['success'], 1)
        self.assertEqual(len(body['items']), 1)
        item = body['items'][0]
        self.assertEqual(item['ref_no'], 'S100ADMIN1')
        self.assertEqual(item['phone'], '9800000302')
        self.assertTrue(item['citizenship_review_pending'])
        self.assertIsNone(item['citizenship_front'])
        self.assertIsNone(item['citizenship_back'])
        self.assertIn('total_credit', body['summary'])


class DealerCommissionAndHierarchyTests(TestCase):
    """Dealer commission, TDS, customer mapping, remittance flag, freeze, sub-agents."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from .models import DealerCommissionConfig, Wallet

        self.staff = User.objects.create_user(
            phone='9800000401',
            password='testpass123',
            email='staff-dealer@example.com',
            is_staff=True,
            is_superuser=True,
        )
        self.dealer = User.objects.create_user(
            phone='9800000402',
            password='testpass123',
            email='dealer@example.com',
            first_name='Dealer',
            last_name='One',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        DealerCommissionConfig.objects.create(
            user=self.dealer,
            commission_rate=Decimal('10.00'),
            tds_rate=Decimal('15.0000'),
        )
        self.agent = User.objects.create_user(
            phone='9800000403',
            password='testpass123',
            email='agent@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_CUSTOMER,
            assigned_dealer=self.dealer,
        )
        self.agent.transaction_pin = make_password('1234')
        self.agent.save(update_fields=['transaction_pin'])
        self.other_agent = User.objects.create_user(
            phone='9800000404',
            password='testpass123',
            email='agent2@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_CUSTOMER,
            assigned_dealer=self.dealer,
        )
        self.customer = User.objects.create_user(
            phone='9800000405',
            password='testpass123',
            email='cust-dealer@example.com',
            first_name='Cust',
            last_name='Omer',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=self.dealer,
        )
        self.customer.transaction_pin = make_password('1234')
        self.customer.save(update_fields=['transaction_pin'])
        wallet, _ = Wallet.objects.get_or_create(user=self.customer)
        wallet.balance = Decimal('1000.00')
        wallet.save(update_fields=['balance'])
        self.client = APIClient()

    def test_dealer_commission_and_tds_calculation(self):
        from .models import DealerCommission, TopupTransaction, WalletAdjustment
        from .services.dealer_commission import calculate_commission
        from .services.txn_status import apply_outbound_status_change

        figures = calculate_commission(Decimal('200.00'), Decimal('10.00'), Decimal('15'))
        self.assertEqual(figures['gross_commission'], Decimal('10.00'))
        self.assertEqual(figures['tds_amount'], Decimal('1.50'))
        self.assertEqual(figures['net_commission'], Decimal('8.50'))

        txn = TopupTransaction.objects.create(
            user=self.customer,
            mobile_number='9800000999',
            amount=Decimal('200.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_COMM1',
            total_debited=Decimal('200.00'),
        )
        ok, err = apply_outbound_status_change(txn, 'success')
        self.assertTrue(ok, err)
        row = DealerCommission.objects.get(txn_type='topup', txn_id=txn.pk)
        self.assertEqual(row.dealer_id, self.dealer.pk)
        self.assertEqual(row.source_user_id, self.customer.pk)
        self.assertEqual(row.gross_commission, Decimal('10.00'))
        self.assertEqual(row.tds_rate, Decimal('15.0000'))
        self.assertEqual(row.tds_amount, Decimal('1.50'))
        self.assertEqual(row.net_commission, Decimal('8.50'))
        self.assertEqual(row.commission_rate, Decimal('10.00'))
        dealer_adj = WalletAdjustment.objects.get(
            user=self.dealer, kind=WalletAdjustment.KIND_DEALER_COMMISSION, source_txn_id=txn.pk,
        )
        self.assertEqual(dealer_adj.amount, Decimal('8.50'))
        self.assertIn('TDS Charge', dealer_adj.reason)
        self.assertIn('Gross Rs 10.00', dealer_adj.reason)
        self.assertIn('Net Rs 8.50', dealer_adj.reason)
        self.assertIn(self.customer.phone, dealer_adj.reason)

        self.client.force_authenticate(user=self.dealer)
        hist = self.client.get(reverse('transaction_history'))
        self.assertEqual(hist.status_code, status.HTTP_200_OK, hist.content[:500])
        adj_payload = next(
            a for a in hist.json().get('wallet_adjustments') or []
            if a.get('kind') == 'dealer_commission' and a.get('source_txn_id') == txn.pk
        )
        self.assertEqual(adj_payload['gross_commission'], '10.00')
        self.assertEqual(adj_payload['tds_amount'], '1.50')
        self.assertEqual(adj_payload['net_commission'], '8.50')
        self.assertEqual(adj_payload['display_amount'], '8.50')

    def test_customer_dealer_mapping_via_admin(self):
        other = User.objects.create_user(
            phone='9800000406',
            password='testpass123',
            email='unmapped@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            reverse('admin_user_detail', args=[other.pk]),
            {'assigned_dealer': self.dealer.pk, 'role': 'customer'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        other.refresh_from_db()
        self.assertEqual(other.assigned_dealer_id, self.dealer.pk)
        data = resp.json().get('data') or {}
        self.assertEqual((data.get('assigned_dealer') or {}).get('phone'), self.dealer.phone)

    def test_remittance_enabled_and_disabled(self):
        self.client.force_authenticate(user=self.customer)
        self.assertTrue(self.customer.can_remittance_transfer)
        resp = self.client.post(reverse('remittance_lookup'), {'ref_no': 'S100TEST'}, format='json')
        if resp.status_code == status.HTTP_403_FORBIDDEN:
            self.assertNotEqual(resp.json().get('code'), 'remittance_transfer_forbidden')

        self.customer.can_remittance_transfer = False
        self.customer.save(update_fields=['can_remittance_transfer'])
        resp = self.client.post(reverse('remittance_lookup'), {'ref_no': 'S100TEST'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.json().get('code'), 'remittance_transfer_forbidden')
        resp = self.client.post(
            reverse('remittance_receive'),
            {'ref_no': 'S100TEST', 'samsara_link_id': 'x', 'amount': '100'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_frozen_wallet_blocks_debit_and_unfreeze_restores(self):
        from .models import Wallet
        from .services.wallet_guard import freeze_wallet, unfreeze_wallet

        wallet = Wallet.objects.get(user=self.customer)
        freeze_wallet(wallet, self.staff, reason='Test freeze')
        wallet.refresh_from_db()
        self.assertTrue(wallet.is_frozen)

        recipient = User.objects.create_user(
            phone='9800000407',
            password='testpass123',
            email='recv-freeze@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        Wallet.objects.get_or_create(user=recipient)
        self.client.force_authenticate(user=self.customer)
        before = Wallet.objects.get(user=self.customer).balance
        resp = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': recipient.phone,
                'amount': '10',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, resp.content)
        self.assertEqual(resp.json().get('code'), 'wallet_frozen')
        self.assertIn('frozen', (resp.json().get('message') or '').lower())
        self.customer.wallet.refresh_from_db()
        self.assertEqual(self.customer.wallet.balance, before)

        unfreeze_wallet(wallet, self.staff)
        from .services.txn_charges import TXN_WALLET_TRANSFER, quote_charges
        quote = quote_charges(Decimal('10.00'), TXN_WALLET_TRANSFER, self.customer)
        resp = self.client.post(
            reverse('wallet_transfer_create'),
            {
                'recipient_phone': recipient.phone,
                'amount': '10',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        self.customer.wallet.refresh_from_db()
        self.assertEqual(self.customer.wallet.balance, before - quote['wallet_amount'])

    def test_frozen_wallet_blocks_deposit_create(self):
        from .models import Deposit, Wallet
        from .services.wallet_guard import freeze_wallet

        wallet = Wallet.objects.get(user=self.customer)
        freeze_wallet(wallet, self.staff, reason='Test freeze')
        self.client.force_authenticate(user=self.customer)
        resp = self.client.post(
            reverse('create_deposit'),
            {
                'amount': '100',
                'transaction_id': 'TXN-FREEZE-1',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, resp.content)
        self.assertEqual(resp.json().get('code'), 'wallet_frozen')
        self.assertFalse(Deposit.objects.filter(user=self.customer).exists())

    def test_wallet_balance_before_after_and_failed_rollback(self):
        from .models import TopupTransaction, Wallet
        from .services.txn_status import apply_outbound_status_change

        wallet = Wallet.objects.get(user=self.customer)
        start = wallet.balance
        txn = TopupTransaction.objects.create(
            user=self.customer,
            mobile_number='9800000888',
            amount=Decimal('50.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_BAL1',
            total_debited=Decimal('50.00'),
        )
        ok, err = apply_outbound_status_change(txn, 'success')
        self.assertTrue(ok, err)
        txn.refresh_from_db()
        wallet.refresh_from_db()
        self.assertEqual(txn.balance_before, start)
        self.assertEqual(txn.balance_after, start - Decimal('50.00'))
        self.assertEqual(wallet.balance, start - Decimal('50.00'))

        ok, err = apply_outbound_status_change(txn, 'failed')
        self.assertTrue(ok, err)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, start)

        too_big = TopupTransaction.objects.create(
            user=self.customer,
            mobile_number='9800000777',
            amount=Decimal('99999.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_BAL2',
            total_debited=Decimal('99999.00'),
        )
        ok, err = apply_outbound_status_change(too_big, 'success')
        self.assertFalse(ok)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, start)
        too_big.refresh_from_db()
        self.assertEqual(too_big.status, 'pending')

    def test_internal_transfer_email_after_commit(self):
        from unittest.mock import patch
        from .models import Wallet

        recipient = User.objects.create_user(
            phone='9800000408',
            password='testpass123',
            email='recv-mail@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        Wallet.objects.get_or_create(user=recipient, defaults={'balance': Decimal('0.00')})
        self.client.force_authenticate(user=self.customer)
        with patch('core.views.wallet_transfer_views.notify_wallet_transfer') as notify:
            notify.side_effect = RuntimeError('smtp down')
            resp = self.client.post(
                reverse('wallet_transfer_create'),
                {
                    'recipient_phone': recipient.phone,
                    'amount': '25',
                    'transaction_pin': '1234',
                },
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        notify.assert_called_once()
        self.customer.wallet.refresh_from_db()

    def test_sub_agent_endpoints_are_gone(self):
        self.client.force_authenticate(user=self.dealer)
        resp = self.client.get(reverse('dealer_sub_agents'))
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)
        resp = self.client.post(
            reverse('agent_sub_agents'),
            {
                'phone': '9800000410',
                'email': 'sub1@example.com',
                'password': 'testpass123',
                'password2': 'testpass123',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)

    def test_admin_can_list_network_and_unauthorized_is_forbidden(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_list_users'), {'role': 'dealer'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        phones = [u['phone'] for u in resp.json().get('items') or []]
        self.assertIn(self.dealer.phone, phones)

        resp = self.client.get(reverse('admin_dealer_commissions'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.customer)
        resp = self.client.get(reverse('admin_list_users'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.post(
            reverse('admin_wallet_freeze', args=[self.customer.wallet.pk]),
            {},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_freeze_unfreeze_endpoints(self):
        self.client.force_authenticate(user=self.staff)
        wallet_id = self.customer.wallet.pk
        resp = self.client.post(reverse('admin_wallet_freeze', args=[wallet_id]), {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['data']['wallet_status'], 'frozen')
        resp = self.client.post(reverse('admin_wallet_unfreeze', args=[wallet_id]), {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['data']['wallet_status'], 'unfrozen')

    def test_dealer_creates_user_and_cannot_see_other_dealer(self):
        other_dealer = User.objects.create_user(
            phone='9800000490',
            password='testpass123',
            email='dealer-b@example.com',
            role=User.ROLE_DEALER,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        other_customer = User.objects.create_user(
            phone='9800000491',
            password='testpass123',
            email='cust-b@example.com',
            role=User.ROLE_CUSTOMER,
            assigned_dealer=other_dealer,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.client.force_authenticate(user=self.dealer)
        resp = self.client.post(
            reverse('dealer_customers'),
            {
                'phone': '9800000492',
                'email': 'user-a1@example.com',
                'password': 'testpass123',
                'password2': 'testpass123',
                'first_name': 'A1',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json().get('data') or {}
        self.assertEqual(data.get('role'), 'customer')
        self.assertEqual(data.get('assigned_dealer_id'), self.dealer.pk)
        user_id = data['id']

        resp = self.client.get(reverse('dealer_customer_detail', args=[user_id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        resp = self.client.get(reverse('dealer_customer_detail', args=[other_customer.pk]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        resp = self.client.get(reverse('dealer_dashboard'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.json()
        self.assertIn('wallet_balance', body)

        self.client.force_authenticate(user=other_dealer)
        resp = self.client.get(reverse('dealer_customer_detail', args=[user_id]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.get(reverse('dealer_customers'))
        phones = [item['phone'] for item in resp.json().get('items') or []]
        self.assertNotIn(self.customer.phone, phones)

    def test_user_dealer_assignment_is_optional(self):
        unassigned = User.objects.create_user(
            phone='9800000493',
            password='testpass123',
            email='free-user@example.com',
            role=User.ROLE_CUSTOMER,
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        self.assertIsNone(unassigned.assigned_dealer_id)
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            reverse('admin_user_detail', args=[unassigned.pk]),
            {'assigned_dealer': None, 'role': 'customer'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        unassigned.refresh_from_db()
        self.assertIsNone(unassigned.assigned_dealer_id)

    def test_configured_charges_debit_and_credit(self):
        from .models import ServiceChargeConfig
        from .services.txn_charges import TXN_BANK_TRANSFER, TXN_REMITTANCE, quote_charges, quote_to_public

        self.dealer.dealer_commission_config.commission_rate = Decimal('0.00')
        self.dealer.dealer_commission_config.save(update_fields=['commission_rate'])

        ServiceChargeConfig.objects.update_or_create(
            txn_type=TXN_BANK_TRANSFER,
            defaults={
                'user_charge_type': 'flat',
                'system_charge_flat': Decimal('100.00'),
                'system_charge_percent': Decimal('0'),
                'dealer_charge_type': 'flat',
                'dealer_commission_flat': Decimal('100.00'),
                'dealer_commission_percent': Decimal('0'),
                'himalpay_charge_flat': Decimal('10.00'),
                'himalpay_charge_percent': Decimal('0'),
            },
        )
        ServiceChargeConfig.objects.update_or_create(
            txn_type=TXN_REMITTANCE,
            defaults={
                'user_charge_type': 'flat',
                'system_charge_flat': Decimal('100.00'),
                'system_charge_percent': Decimal('0'),
                'dealer_charge_type': 'flat',
                'dealer_commission_flat': Decimal('100.00'),
                'dealer_commission_percent': Decimal('0'),
                'himalpay_charge_flat': Decimal('10.00'),
                'himalpay_charge_percent': Decimal('0'),
            },
        )
        debit = quote_charges(Decimal('1000.00'), TXN_BANK_TRANSFER, self.customer)
        self.assertEqual(debit['wallet_amount'], Decimal('1210.00'))
        self.assertEqual(debit['system_charge'], Decimal('100.00'))
        self.assertEqual(debit['dealer_commission'], Decimal('100.00'))
        self.assertEqual(debit['himalpay_charge'], Decimal('10.00'))
        public = quote_to_public(debit)
        self.assertEqual(public['himalpay_charge'], '10.00')
        self.assertEqual(public['cashback'], '0.00')
        self.assertEqual(public['charge'], '210.00')

        ServiceChargeConfig.objects.filter(txn_type=TXN_BANK_TRANSFER).update(
            dealer_charge_type='percent',
            dealer_commission_percent=Decimal('50.0000'),
        )
        debit_percent = quote_charges(Decimal('1000.00'), TXN_BANK_TRANSFER, self.customer)
        self.assertEqual(debit_percent['dealer_commission'], Decimal('500.00'))

        unassigned = User.objects.create_user(
            phone='9800000498',
            password='testpass123',
            email='no-dealer@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        ServiceChargeConfig.objects.filter(txn_type=TXN_BANK_TRANSFER).update(
            dealer_charge_type='flat',
            dealer_commission_percent=Decimal('0'),
        )
        debit_plain = quote_charges(Decimal('1000.00'), TXN_BANK_TRANSFER, unassigned)
        self.assertEqual(debit_plain['dealer_commission'], Decimal('0.00'))
        self.assertEqual(debit_plain['wallet_amount'], Decimal('1110.00'))

        credit = quote_charges(
            Decimal('1000.00'), TXN_REMITTANCE, self.customer, direction='credit',
        )
        self.assertEqual(credit['wallet_amount'], Decimal('790.00'))

    def test_user_debit_holds_cashback_then_credits_separately(self):
        from .models import (
            DealerCommission,
            ServiceChargeConfig,
            UserFeeConfig,
            Wallet,
            WalletAdjustment,
            TopupTransaction,
        )
        from .services.txn_charges import TXN_TOPUP, persist_transaction_charge, quote_charges
        from .services.txn_status import apply_outbound_status_change

        self.dealer.dealer_commission_config.commission_rate = Decimal('0.00')
        self.dealer.dealer_commission_config.tds_rate = Decimal('0.0000')
        self.dealer.dealer_commission_config.save(update_fields=['commission_rate', 'tds_rate'])
        ServiceChargeConfig.objects.update_or_create(
            txn_type=TXN_TOPUP,
            defaults={
                'user_charge_type': 'flat',
                'system_charge_flat': Decimal('35.00'),
                'system_charge_percent': Decimal('0'),
                'dealer_charge_type': 'flat',
                'dealer_commission_flat': Decimal('100.00'),
                'dealer_commission_percent': Decimal('0'),
                'himalpay_charge_flat': Decimal('0.00'),
                'himalpay_charge_percent': Decimal('0'),
            },
        )
        fee, _ = UserFeeConfig.objects.get_or_create(user=self.customer)
        fee.cashback_flat = Decimal('65.00')
        fee.save(update_fields=['cashback_flat'])

        wallet = Wallet.objects.get(user=self.customer)
        wallet.balance = Decimal('2000.00')
        wallet.save(update_fields=['balance'])

        quote = quote_charges(Decimal('1000.00'), TXN_TOPUP, self.customer)
        self.assertEqual(quote['system_charge'], Decimal('35.00'))
        self.assertEqual(quote['dealer_commission'], Decimal('100.00'))
        self.assertEqual(quote['cashback'], Decimal('65.00'))
        self.assertEqual(quote['wallet_amount'], Decimal('1200.00'))
        self.assertEqual(quote['visible_charge'], Decimal('200.00'))

        txn = TopupTransaction.objects.create(
            user=self.customer,
            mobile_number='9800000991',
            amount=Decimal('1000.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_CB1',
            charge=quote['visible_charge'],
            cashback=quote['cashback'],
            total_debited=quote['wallet_amount'],
        )
        persist_transaction_charge(txn, quote)
        ok, err = apply_outbound_status_change(txn, 'success')
        self.assertTrue(ok, err)

        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('865.00'))
        txn.refresh_from_db()
        self.assertEqual(txn.balance_before, Decimal('2000.00'))
        self.assertEqual(txn.balance_after, Decimal('800.00'))

        cashback_row = WalletAdjustment.objects.get(
            user=self.customer, kind=WalletAdjustment.KIND_CASHBACK, source_txn_id=txn.pk,
        )
        self.assertEqual(cashback_row.amount, Decimal('65.00'))
        self.assertEqual(cashback_row.adjustment_type, 'credit')
        self.assertEqual(cashback_row.balance_before, Decimal('800.00'))
        self.assertEqual(cashback_row.balance_after, Decimal('865.00'))
        self.assertIn('Cashback return', cashback_row.reason)
        self.assertFalse(
            WalletAdjustment.objects.filter(
                user=self.customer, kind=WalletAdjustment.KIND_DEALER_COMMISSION,
            ).exists()
        )

        row = DealerCommission.objects.get(txn_type='topup', txn_id=txn.pk)
        self.assertEqual(row.dealer_id, self.dealer.pk)
        self.assertEqual(row.source_user_id, self.customer.pk)
        self.assertEqual(row.gross_commission, Decimal('100.00'))
        self.assertEqual(row.net_commission, Decimal('100.00'))
        dealer_adj = WalletAdjustment.objects.get(
            user=self.dealer, kind=WalletAdjustment.KIND_DEALER_COMMISSION, source_txn_id=txn.pk,
        )
        self.assertEqual(dealer_adj.amount, Decimal('100.00'))
        self.assertIn(self.customer.phone, dealer_adj.reason)

    def test_fund_transfer_total_includes_commission_cashback_not_provider_fee(self):
        """100 + user 60 + network 40 + cashback 50 = 250, not 205 (live HimalPay Rs 5)."""
        from .models import (
            BankTransferTransaction,
            ServiceChargeConfig,
            UserFeeConfig,
            Wallet,
            WalletAdjustment,
        )
        from .services.txn_charges import (
            TXN_BANK_TRANSFER,
            persist_transaction_charge,
            quote_charges,
            quote_to_public,
        )
        from .services.txn_status import apply_outbound_status_change

        self.dealer.dealer_commission_config.commission_rate = Decimal('0.00')
        self.dealer.dealer_commission_config.tds_rate = Decimal('0.0000')
        self.dealer.dealer_commission_config.save(update_fields=['commission_rate', 'tds_rate'])
        ServiceChargeConfig.objects.update_or_create(
            txn_type=TXN_BANK_TRANSFER,
            defaults={
                'user_charge_type': 'flat',
                'system_charge_flat': Decimal('60.00'),
                'system_charge_percent': Decimal('0'),
                'dealer_charge_type': 'flat',
                'dealer_commission_flat': Decimal('40.00'),
                'dealer_commission_percent': Decimal('0'),
                'himalpay_charge_flat': Decimal('0.00'),
                'himalpay_charge_percent': Decimal('0'),
            },
        )
        fee, _ = UserFeeConfig.objects.get_or_create(user=self.customer)
        fee.cashback_flat = Decimal('50.00')
        fee.save(update_fields=['cashback_flat'])

        quote = quote_charges(
            Decimal('100.00'),
            TXN_BANK_TRANSFER,
            self.customer,
            provider_charge=Decimal('5.00'),
            cashback=Decimal('0.00'),
        )
        self.assertEqual(quote['system_charge'], Decimal('60.00'))
        self.assertEqual(quote['dealer_commission'], Decimal('40.00'))
        self.assertEqual(quote['himalpay_charge'], Decimal('0.00'))
        self.assertEqual(quote['cashback'], Decimal('50.00'))
        self.assertEqual(quote['wallet_amount'], Decimal('250.00'))
        public = quote_to_public(quote)
        self.assertEqual(public['total_debited'], '250.00')
        self.assertEqual(public['cashback_credit'], '50.00')
        self.assertEqual(public['cashback'], '50.00')
        self.assertEqual(public['charge'], '100.00')
        self.assertEqual(public['himalpay_charge'], '0.00')

        wallet = Wallet.objects.get(user=self.customer)
        wallet.balance = Decimal('1000.00')
        wallet.save(update_fields=['balance'])
        txn = BankTransferTransaction.objects.create(
            user=self.customer,
            amount=Decimal('100.00'),
            destination_bank='NIBL',
            destination_acc_no='1234567890',
            destination_acc_name='Test',
            status='pending',
            merchant_txn_id='MYSEWA_BT_CB250',
            charge=quote['system_charge'] + quote['dealer_commission'],
            cashback=quote['cashback'],
            total_debited=quote['wallet_amount'],
        )
        persist_transaction_charge(txn, quote)
        ok, err = apply_outbound_status_change(txn, 'success')
        self.assertTrue(ok, err)

        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('800.00'))
        cashback_row = WalletAdjustment.objects.get(
            user=self.customer, kind=WalletAdjustment.KIND_CASHBACK, source_txn_id=txn.pk,
        )
        self.assertEqual(cashback_row.amount, Decimal('50.00'))
        self.assertEqual(cashback_row.adjustment_type, 'credit')
        self.assertEqual(cashback_row.balance_before, Decimal('750.00'))
        self.assertEqual(cashback_row.balance_after, Decimal('800.00'))
        self.assertIn('Cashback return', cashback_row.reason)

    def test_admin_commission_setup_dealers_and_cashback_tree(self):
        from .models import UserFeeConfig

        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_commission_setup_dealers'), {'q': 'Dealer'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        phones = [item['phone'] for item in resp.json().get('items') or []]
        self.assertIn(self.dealer.phone, phones)

        resp = self.client.put(
            reverse('admin_commission_setup_dealer_detail', args=[self.dealer.pk]),
            {'commission_amount': '100.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['commission_amount'], '100.00')
        user_phones = [u['phone'] for u in resp.json().get('users') or []]
        self.assertIn(self.customer.phone, user_phones)

        resp = self.client.put(
            reverse('admin_commission_setup_dealer_cashback', args=[self.dealer.pk]),
            {'apply_to_all': True, 'cashback': '65.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        fee = UserFeeConfig.objects.get(user=self.customer)
        self.assertEqual(fee.cashback_flat, Decimal('65.00'))

        resp = self.client.put(
            reverse('admin_commission_setup_dealer_cashback', args=[self.dealer.pk]),
            {'user_id': self.customer.pk, 'cashback': '40.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        fee.refresh_from_db()
        self.assertEqual(fee.cashback_flat, Decimal('40.00'))

        self.client.force_authenticate(user=self.customer)
        resp = self.client.get(reverse('admin_commission_setup_dealers'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_hierarchical_commission_and_historical_snapshot(self):
        from .models import DealerCommission, ServiceCommissionRule, TopupTransaction
        from .services.txn_status import apply_outbound_status_change

        ServiceCommissionRule.objects.create(
            dealer=self.dealer,
            txn_type='topup',
            dealer_rate=Decimal('10.00'),
        )

        txn = TopupTransaction.objects.create(
            user=self.customer,
            mobile_number='9800000666',
            amount=Decimal('1000.00'),
            product_id=1,
            status='pending',
            merchant_txn_id='MYSEWA_NTC_HIER1',
            total_debited=Decimal('1000.00'),
        )
        ok, err = apply_outbound_status_change(txn, 'success')
        self.assertTrue(ok, err)
        row = DealerCommission.objects.get(txn_type='topup', txn_id=txn.pk)
        self.assertEqual(row.dealer_id, self.dealer.pk)
        self.assertIsNone(row.sub_agent_id)
        self.assertEqual(row.source_user_id, self.customer.pk)
        self.assertEqual(row.gross_commission, Decimal('10.00'))
        self.assertEqual(row.tds_amount, Decimal('1.50'))
        self.assertEqual(row.net_commission, Decimal('8.50'))
        self.assertEqual(row.sub_agent_commission, Decimal('0.00'))

        config = self.dealer.dealer_commission_config
        config.commission_rate = Decimal('1.00')
        config.save(update_fields=['commission_rate', 'updated_at'])
        row.refresh_from_db()
        self.assertEqual(row.commission_rate, Decimal('10.00'))
        self.assertEqual(row.gross_commission, Decimal('10.00'))

    def test_admin_hierarchy_and_profit_and_dealer_cannot_access_admin(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('admin_hierarchy'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        phones = [item['phone'] for item in resp.json().get('items') or []]
        self.assertIn(self.dealer.phone, phones)

        resp = self.client.get(reverse('admin_dealer_profit'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('items', resp.json())

        self.client.force_authenticate(user=self.dealer)
        resp = self.client.get(reverse('admin_hierarchy'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.get(reverse('admin_list_users'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class SupportChatHierarchyTests(TestCase):
    """Support Chat is strictly Admin ↔ User/Dealer."""

    def setUp(self):
        self.staff = User.objects.create_user(
            phone='9800000501',
            password='testpass123',
            email='staff-chat@example.com',
            is_staff=True,
            is_superuser=True,
            first_name='Super',
            last_name='Admin',
        )
        self.staff_two = User.objects.create_user(
            phone='9800000508',
            password='testpass123',
            email='staff2-chat@example.com',
            is_staff=True,
            is_superuser=True,
            first_name='Second',
            last_name='Admin',
        )
        self.dealer = User.objects.create_user(
            phone='9800000502',
            password='testpass123',
            email='dealer-chat@example.com',
            first_name='Dealer',
            last_name='One',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        self.other_dealer = User.objects.create_user(
            phone='9800000509',
            password='testpass123',
            email='dealer2-chat@example.com',
            first_name='Dealer',
            last_name='Two',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        self.agent = User.objects.create_user(
            phone='9800000503',
            password='testpass123',
            email='agent-chat@example.com',
            first_name='Agent',
            last_name='One',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_AGENT,
            assigned_dealer=self.dealer,
        )
        self.other_agent = User.objects.create_user(
            phone='9800000504',
            password='testpass123',
            email='agent2-chat@example.com',
            first_name='Agent',
            last_name='Two',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_AGENT,
            assigned_dealer=self.dealer,
        )
        self.sub_agent = User.objects.create_user(
            phone='9800000505',
            password='testpass123',
            email='sub-chat@example.com',
            first_name='Sub',
            last_name='Agent',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_SUB_AGENT,
            assigned_dealer=self.dealer,
            parent_agent=self.agent,
        )
        self.customer = User.objects.create_user(
            phone='9800000506',
            password='testpass123',
            email='cust-chat@example.com',
            first_name='Cust',
            last_name='Omer',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_CUSTOMER,
            assigned_dealer=self.dealer,
            parent_agent=self.agent,
            assigned_sub_agent=self.sub_agent,
        )
        self.stray_customer = User.objects.create_user(
            phone='9800000507',
            password='testpass123',
            email='stray-chat@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_CUSTOMER,
        )
        self.client = APIClient()

    def _ids(self, resp):
        return {item['id'] for item in resp.json().get('items') or []}

    def _start_thread(self, actor, target_id, expected=status.HTTP_200_OK):
        self.client.force_authenticate(user=actor)
        resp = self.client.post(
            reverse('support_chat_threads'),
            {'user_id': target_id},
            format='json',
        )
        self.assertEqual(resp.status_code, expected, resp.content)
        return resp

    def test_super_admin_can_chat_with_users_and_dealers(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('support_chat_contacts'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        ids = self._ids(resp)
        self.assertIn(self.agent.pk, ids)
        self.assertIn(self.customer.pk, ids)
        self.assertIn(self.sub_agent.pk, ids)
        self.assertIn(self.dealer.pk, ids)
        self.assertIn(self.stray_customer.pk, ids)
        self.assertNotIn(self.staff_two.pk, ids)
        resp = self._start_thread(self.staff, self.customer.pk)
        thread_id = resp.json()['id']
        resp = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'Hello from super admin'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)

    def test_user_and_dealer_can_only_contact_admin(self):
        for actor in (self.customer, self.dealer, self.agent, self.sub_agent):
            self.client.force_authenticate(user=actor)
            resp = self.client.get(reverse('support_chat_contacts'))
            self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
            ids = self._ids(resp)
            self.assertIn(self.staff.pk, ids)
            self.assertNotIn(self.staff_two.pk, ids)
            self.assertNotIn(self.customer.pk, ids)
            self.assertNotIn(self.dealer.pk, ids)
            self.assertNotIn(self.agent.pk, ids)
            self.assertNotIn(self.other_agent.pk, ids)
            self.assertNotIn(self.sub_agent.pk, ids)
            self.assertNotIn(self.stray_customer.pk, ids)
            items = resp.json().get('items') or []
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]['name'], 'Super Admin')
            self.assertEqual(items[0]['phone'], '')
            self.assertTrue(items[0].get('identity_hidden'))

    def test_customer_can_start_chat_with_admin(self):
        resp = self._start_thread(self.customer, self.staff.pk)
        thread_id = resp.json()['id']
        resp = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'Need help with my wallet'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)

    def test_dealer_can_start_chat_with_admin(self):
        self._start_thread(self.dealer, self.staff.pk)

    def test_users_and_dealers_cannot_chat_with_each_other(self):
        pairs = (
            (self.customer, self.stray_customer.pk),
            (self.customer, self.dealer.pk),
            (self.customer, self.agent.pk),
            (self.dealer, self.customer.pk),
            (self.dealer, self.other_dealer.pk),
            (self.dealer, self.agent.pk),
            (self.agent, self.customer.pk),
            (self.agent, self.other_agent.pk),
            (self.sub_agent, self.customer.pk),
            (self.sub_agent, self.agent.pk),
        )
        for actor, target_id in pairs:
            resp = self._start_thread(actor, target_id, expected=status.HTTP_403_FORBIDDEN)
            self.assertEqual(resp.json().get('code'), 'support_chat_forbidden')

    def test_admin_sees_and_can_reply_to_user_threads(self):
        resp = self._start_thread(self.customer, self.staff.pk)
        thread_id = resp.json()['id']
        self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'Hello admin'},
            format='json',
        )
        self.client.force_authenticate(user=self.staff_two)
        resp = self.client.get(reverse('support_chat_threads'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertIn(thread_id, {item['id'] for item in resp.json().get('items') or []})
        resp = self.client.get(reverse('support_chat_messages', args=[thread_id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        resp = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'We can help'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)

    def test_peer_threads_are_hidden_and_blocked(self):
        from .services.support_chat import get_or_create_thread

        thread = get_or_create_thread(self.customer, self.dealer)
        self.client.force_authenticate(user=self.customer)
        resp = self.client.get(reverse('support_chat_threads'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertNotIn(thread.pk, {item['id'] for item in resp.json().get('items') or []})
        resp = self.client.get(reverse('support_chat_messages', args=[thread.pk]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=self.other_agent)
        resp = self.client.get(reverse('support_chat_messages', args=[thread.pk]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_super_admin_personal_details_are_not_searchable(self):
        self.client.force_authenticate(user=self.customer)
        resp = self.client.get(reverse('support_chat_contacts'), {'q': self.staff.phone})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json().get('items'), [])
        resp = self.client.get(reverse('support_chat_contacts'), {'q': 'Second'})
        self.assertEqual(resp.json().get('items'), [])
        resp = self.client.get(reverse('support_chat_contacts'), {'q': self.stray_customer.phone})
        self.assertEqual(resp.json().get('items'), [])
        resp = self.client.get(reverse('support_chat_contacts'), {'q': 'Super Admin'})
        items = resp.json().get('items') or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['name'], 'Super Admin')
        self.assertEqual(items[0]['phone'], '')

    def test_thread_and_attachment_are_private_to_the_owner(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self._start_thread(self.customer, self.staff.pk)
        thread_id = resp.json()['id']
        upload = SimpleUploadedFile(
            'proof.png',
            b'\x89PNG\r\n\x1a\n' + b'x' * 32,
            content_type='image/png',
        )
        resp = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'Need help', 'file': upload, 'client_nonce': 'nonce-cust-1'},
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        payload = resp.json()
        self.assertEqual(payload.get('kind'), 'image')
        self.assertEqual(payload.get('sender_display_name'), 'Cust Omer')
        self.assertTrue(payload.get('has_attachment'))
        msg_id = payload['id']
        dup = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'Need help', 'client_nonce': 'nonce-cust-1'},
            format='multipart',
        )
        self.assertEqual(dup.json().get('id'), msg_id)

        self.client.force_authenticate(user=self.stray_customer)
        resp = self.client.get(reverse('support_chat_threads'))
        self.assertNotIn(thread_id, {item['id'] for item in resp.json().get('items') or []})
        resp = self.client.get(reverse('support_chat_messages', args=[thread_id]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.get(reverse('support_chat_attachment', args=[thread_id, msg_id]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.dealer)
        resp = self.client.get(reverse('support_chat_messages', args=[thread_id]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.get(reverse('support_chat_attachment', args=[thread_id, msg_id]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.staff_two)
        resp = self.client.get(reverse('support_chat_messages', args=[thread_id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        items = resp.json().get('items') or []
        self.assertEqual(items[0].get('sender_display_name'), 'Cust Omer')
        resp = self.client.get(reverse('support_chat_attachment', args=[thread_id, msg_id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(getattr(resp, 'streaming', False))
        b"".join(resp.streaming_content)
        reply = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'body': 'We can help'},
            format='json',
        )
        self.assertEqual(reply.status_code, status.HTTP_201_CREATED, reply.content)
        self.assertEqual(reply.json().get('sender_display_name'), 'Super Admin')
        self.assertTrue(reply.json().get('sender_is_support'))

        self.client.force_authenticate(user=self.customer)
        resp = self.client.get(reverse('support_chat_messages', args=[thread_id]))
        names = {item.get('sender_display_name') for item in resp.json().get('items') or []}
        self.assertIn('Super Admin', names)
        thread_resp = self.client.get(reverse('support_chat_threads'))
        other_user = (thread_resp.json().get('items') or [{}])[0].get('other_user') or {}
        self.assertEqual(other_user.get('name'), 'Super Admin')
        self.assertEqual(other_user.get('phone'), '')

    def test_rejected_attachment_types_are_blocked(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self._start_thread(self.customer, self.staff.pk)
        thread_id = resp.json()['id']
        exe = SimpleUploadedFile('hack.exe', b'MZxxxx', content_type='application/x-msdownload')
        resp = self.client.post(
            reverse('support_chat_messages', args=[thread_id]),
            {'file': exe},
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.content)
        self.assertEqual(resp.json().get('code'), 'file_type_not_allowed')


class UserProvisioningAndPayoutTests(TestCase):
    """Dealer user creation, pending approval emails, payout accounts, dealer wallet load."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from .models import Wallet

        self.staff = User.objects.create_user(
            phone='9800000801',
            password='testpass123',
            email='admin-provision@example.com',
            is_staff=True,
            is_superuser=True,
        )
        self.dealer = User.objects.create_user(
            phone='9800000802',
            password='testpass123',
            email='dealer-provision@example.com',
            first_name='Dealer',
            last_name='Two',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        self.dealer.transaction_pin = make_password('1234')
        self.dealer.save(update_fields=['transaction_pin'])
        wallet, _ = Wallet.objects.get_or_create(user=self.dealer)
        wallet.balance = Decimal('5000.00')
        wallet.save(update_fields=['balance'])
        self.client = APIClient()

    def test_dealer_creates_user_assigned_and_pending(self):
        from unittest.mock import patch

        self.client.force_authenticate(user=self.dealer)
        with patch('core.services.notifications.notify_user_provisioned') as notify:
            resp = self.client.post(
                reverse('dealer_customers'),
                {
                    'phone': '9800000810',
                    'email': 'new-user@example.com',
                    'password': 'secretpass1',
                    'password2': 'secretpass1',
                    'first_name': 'New',
                    'account_status': 'approved',
                    'assigned_dealer': 99999,
                },
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json().get('data') or {}
        self.assertEqual(data.get('role'), 'customer')
        self.assertEqual(data.get('assigned_dealer_id'), self.dealer.pk)
        self.assertEqual(data.get('account_status'), 'pending')
        notify.assert_called_once()
        created = User.objects.get(pk=data['id'])
        self.assertEqual(created.assigned_dealer_id, self.dealer.pk)
        self.assertEqual(created.account_status, User.ACCOUNT_STATUS_PENDING)

    def test_admin_creates_user_pending_and_can_approve(self):
        from unittest.mock import patch

        self.client.force_authenticate(user=self.staff)
        with patch('core.services.notifications.notify_user_provisioned') as notify:
            resp = self.client.post(
                reverse('admin_list_users'),
                {
                    'phone': '9800000811',
                    'email': 'admin-created@example.com',
                    'password': 'secretpass1',
                    'password2': 'secretpass1',
                    'account_status': 'approved',
                    'role': 'customer',
                    'assigned_dealer': self.dealer.pk,
                },
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json().get('data') or {}
        self.assertEqual(data.get('account_status'), 'pending')
        self.assertEqual(data.get('assigned_dealer_id'), self.dealer.pk)
        notify.assert_called_once()

        user_id = data['id']
        self.client.force_authenticate(user=self.dealer)
        resp = self.client.patch(
            reverse('dealer_customer_detail', args=[user_id]),
            {'account_status': 'approved'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        created = User.objects.get(pk=user_id)
        self.assertEqual(created.account_status, User.ACCOUNT_STATUS_PENDING)

        self.client.force_authenticate(user=self.staff)
        with patch('core.services.notifications.notify_account_approved') as approved:
            resp = self.client.patch(
                reverse('admin_user_detail', args=[user_id]),
                {'account_status': 'approved'},
                format='json',
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        created.refresh_from_db()
        self.assertEqual(created.account_status, User.ACCOUNT_STATUS_APPROVED)
        approved.assert_called_once()

    def _tiny_png(self, name='qr.png'):
        from io import BytesIO
        from django.core.files.uploadedfile import SimpleUploadedFile
        try:
            from PIL import Image
        except ImportError:  # pragma: no cover
            self.skipTest('Pillow is required for payout QR upload tests')
        buf = BytesIO()
        Image.new('RGB', (8, 8), color=(20, 40, 80)).save(buf, format='PNG')
        return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')

    def test_dealer_payout_account_pending_until_admin_approves(self):
        from unittest.mock import patch
        from .models import DealerPayoutAccount

        self.client.force_authenticate(user=self.dealer)
        with patch('core.views.payout_views.notify_payout_account_submitted') as submitted:
            resp = self.client.post(
                reverse('dealer_payout_accounts'),
                {
                    'method': 'esewa',
                    'account_name': 'Dealer Two',
                    'account_number': '9800000802',
                    'qr_code': self._tiny_png(),
                },
                format='multipart',
            )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        data = resp.json().get('data') or {}
        self.assertEqual(data.get('status'), 'pending')
        submitted.assert_called_once()
        account_id = data['id']

        resp = self.client.delete(reverse('dealer_payout_account_detail', args=[account_id]))
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        user = User.objects.create_user(
            phone='9800000812',
            password='testpass123',
            email='load-user@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=self.dealer,
        )
        self.client.force_authenticate(user=user)
        resp = self.client.get(reverse('deposit_destinations'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        body = resp.json()
        self.assertEqual(body.get('source'), 'platform')
        self.assertEqual(body.get('available_sources'), ['platform', 'dealer'])
        self.assertTrue(body.get('can_use_dealer'))
        self.assertEqual(
            len((body.get('dealer') or {}).get('bank_details', {}).get('accounts') or []),
            0,
        )
        self.assertIn('platform', body)
        self.assertIsNotNone((body.get('platform') or {}).get('bank_details'))

        self.client.force_authenticate(user=self.staff)
        with patch('core.views.payout_views.notify_payout_account_reviewed'):
            resp = self.client.post(reverse('admin_approve_payout_account', args=[account_id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['data']['status'], 'approved')

        self.client.force_authenticate(user=user)
        resp = self.client.get(reverse('deposit_destinations'))
        body = resp.json()
        self.assertEqual(body.get('source'), 'platform')
        self.assertEqual(body.get('available_sources'), ['platform', 'dealer'])
        self.assertTrue(body.get('can_use_dealer'))
        self.assertEqual(body.get('dealer_id'), self.dealer.pk)
        dealer_accounts = (body.get('dealer') or {}).get('bank_details', {}).get('accounts') or []
        self.assertEqual(len(dealer_accounts), 1)
        self.assertEqual(dealer_accounts[0].get('payout_account_id'), account_id)
        self.assertIsNotNone((body.get('platform') or {}).get('bank_details'))

        self.client.force_authenticate(user=self.dealer)
        resp = self.client.patch(
            reverse('dealer_payout_account_detail', args=[account_id]),
            {'account_name': 'Dealer Two Updated'},
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['data']['status'], 'pending')
        account = DealerPayoutAccount.objects.get(pk=account_id)
        self.assertEqual(account.status, DealerPayoutAccount.STATUS_PENDING)

    def test_deposit_destinations_scoped_to_assigned_dealer(self):
        from .models import DealerPayoutAccount

        own = DealerPayoutAccount.objects.create(
            dealer=self.dealer,
            method=DealerPayoutAccount.METHOD_KHALTI,
            account_name='Dealer Two',
            account_number='9800000802',
            status=DealerPayoutAccount.STATUS_APPROVED,
        )
        other_dealer = User.objects.create_user(
            phone='9800000820',
            password='testpass123',
            email='other-dealer@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        other_account = DealerPayoutAccount.objects.create(
            dealer=other_dealer,
            method=DealerPayoutAccount.METHOD_ESEWA,
            account_name='Other Dealer',
            account_number='9800000820',
            status=DealerPayoutAccount.STATUS_APPROVED,
        )

        assigned = User.objects.create_user(
            phone='9800000821',
            password='testpass123',
            email='assigned@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=self.dealer,
        )
        unassigned = User.objects.create_user(
            phone='9800000822',
            password='testpass123',
            email='unassigned@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
        )
        other_user = User.objects.create_user(
            phone='9800000823',
            password='testpass123',
            email='other-user@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=other_dealer,
        )

        self.client.force_authenticate(user=assigned)
        body = self.client.get(reverse('deposit_destinations')).json()
        self.assertEqual(body.get('available_sources'), ['platform', 'dealer'])
        self.assertTrue(body.get('can_use_dealer'))
        ids = {
            acc.get('payout_account_id')
            for acc in (body.get('dealer') or {}).get('bank_details', {}).get('accounts') or []
        }
        self.assertEqual(ids, {own.pk})
        self.assertNotIn(other_account.pk, ids)
        self.assertIsNotNone(body.get('platform'))

        self.client.force_authenticate(user=unassigned)
        body = self.client.get(reverse('deposit_destinations')).json()
        self.assertEqual(body.get('available_sources'), ['platform'])
        self.assertFalse(body.get('can_use_dealer'))
        self.assertIsNone(body.get('dealer'))

        self.client.force_authenticate(user=self.dealer)
        body = self.client.get(reverse('deposit_destinations')).json()
        self.assertEqual(body.get('available_sources'), ['platform'])
        self.assertFalse(body.get('can_use_dealer'))
        self.assertIsNone(body.get('dealer'))

        self.client.force_authenticate(user=other_user)
        body = self.client.get(reverse('deposit_destinations')).json()
        self.assertEqual(body.get('dealer_id'), other_dealer.pk)
        ids = {
            acc.get('payout_account_id')
            for acc in (body.get('dealer') or {}).get('bank_details', {}).get('accounts') or []
        }
        self.assertEqual(ids, {other_account.pk})
        self.assertNotIn(own.pk, ids)

    def test_dealer_loads_assigned_user_wallet(self):
        from django.contrib.auth.hashers import make_password
        from .models import Wallet, WalletTransfer

        user = User.objects.create_user(
            phone='9800000813',
            password='testpass123',
            email='loaded@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=self.dealer,
        )
        wallet, _ = Wallet.objects.get_or_create(user=user)
        wallet.balance = Decimal('0.00')
        wallet.save(update_fields=['balance'])
        self.dealer.transaction_pin = make_password('1234')
        self.dealer.save(update_fields=['transaction_pin'])

        self.client.force_authenticate(user=self.dealer)
        resp = self.client.post(
            reverse('dealer_load_user_wallet', args=[user.pk]),
            {'amount': '250', 'transaction_pin': '1234'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        user.wallet.refresh_from_db()
        self.dealer.wallet.refresh_from_db()
        self.assertEqual(user.wallet.balance, Decimal('250.00'))
        self.assertEqual(self.dealer.wallet.balance, Decimal('4750.00'))
        self.assertTrue(
            WalletTransfer.objects.filter(sender=self.dealer, recipient=user).exists()
        )


class DealerPushBalanceTests(TestCase):
    """Dealer loads an assigned User's wallet from the Dealer wallet."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from .models import Wallet

        self.dealer = User.objects.create_user(
            phone='9800000701',
            password='testpass123',
            email='push-dealer@example.com',
            first_name='Push',
            last_name='Dealer',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        self.dealer.transaction_pin = make_password('1234')
        self.dealer.save(update_fields=['transaction_pin'])
        dealer_wallet, _ = Wallet.objects.get_or_create(user=self.dealer)
        dealer_wallet.balance = Decimal('10000.00')
        dealer_wallet.save(update_fields=['balance'])

        self.user = User.objects.create_user(
            phone='9800000702',
            password='testpass123',
            email='push-user@example.com',
            first_name='Airwave',
            last_name='Teleservices',
            business_name='Airwave Teleservices',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_CUSTOMER,
            assigned_dealer=self.dealer,
        )
        user_wallet, _ = Wallet.objects.get_or_create(user=self.user)
        user_wallet.balance = Decimal('500.00')
        user_wallet.save(update_fields=['balance'])

        self.other_dealer = User.objects.create_user(
            phone='9800000703',
            password='testpass123',
            email='other-push-dealer@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            role=User.ROLE_DEALER,
        )
        self.outsider = User.objects.create_user(
            phone='9800000704',
            password='testpass123',
            email='push-outsider@example.com',
            account_status=User.ACCOUNT_STATUS_APPROVED,
            assigned_dealer=self.other_dealer,
        )
        outsider_wallet, _ = Wallet.objects.get_or_create(user=self.outsider)
        outsider_wallet.balance = Decimal('10.00')
        outsider_wallet.save(update_fields=['balance'])

        self.client = APIClient()
        self.client.force_authenticate(user=self.dealer)

    def test_lists_assigned_users_with_wallet_balance(self):
        resp = self.client.get(reverse('dealer_push_balance_users'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        items = resp.json().get('items') or []
        phones = [item['phone'] for item in items]
        self.assertIn(self.user.phone, phones)
        self.assertNotIn(self.outsider.phone, phones)
        self.assertNotIn(self.dealer.phone, phones)
        mine = next(item for item in items if item['phone'] == self.user.phone)
        self.assertEqual(mine['wallet_balance'], '500.00')
        self.assertEqual(mine['role_label'], 'USER')
        self.assertEqual(mine['display_name'], 'Airwave Teleservices')

    def test_push_moves_balance_and_records_transfer(self):
        from .models import WalletTransfer

        resp = self.client.post(
            reverse('dealer_push_balance'),
            {
                'user_id': self.user.pk,
                'amount': '2000.00',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        self.dealer.wallet.refresh_from_db()
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.dealer.wallet.balance, Decimal('8000.00'))
        self.assertEqual(self.user.wallet.balance, Decimal('2500.00'))
        self.assertEqual(WalletTransfer.objects.count(), 1)
        transfer = WalletTransfer.objects.get()
        self.assertEqual(transfer.sender_id, self.dealer.pk)
        self.assertEqual(transfer.recipient_id, self.user.pk)
        self.assertEqual(transfer.amount, Decimal('2000.00'))
        self.assertEqual(transfer.status, 'success')
        self.assertEqual(resp.json()['recipient']['wallet_balance'], '2500.00')

        history = self.client.get(reverse('wallet_transfer_history'))
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        items = history.json().get('items') or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get('direction'), 'sent')

    def test_cannot_push_to_user_outside_network(self):
        resp = self.client.post(
            reverse('dealer_push_balance'),
            {
                'user_id': self.outsider.pk,
                'amount': '100',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.outsider.wallet.refresh_from_db()
        self.assertEqual(self.outsider.wallet.balance, Decimal('10.00'))

    def test_wrong_pin_does_not_move_money(self):
        resp = self.client.post(
            reverse('dealer_push_balance'),
            {
                'user_id': self.user.pk,
                'amount': '100',
                'transaction_pin': '9999',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.dealer.wallet.refresh_from_db()
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.dealer.wallet.balance, Decimal('10000.00'))
        self.assertEqual(self.user.wallet.balance, Decimal('500.00'))

    def test_insufficient_dealer_balance(self):
        resp = self.client.post(
            reverse('dealer_push_balance'),
            {
                'user_id': self.user.pk,
                'amount': '20000',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json().get('error'), 'Insufficient balance')

    def test_customer_cannot_access(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(reverse('dealer_push_balance_users'))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        resp = self.client.post(
            reverse('dealer_push_balance'),
            {
                'user_id': self.user.pk,
                'amount': '100',
                'transaction_pin': '1234',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)




