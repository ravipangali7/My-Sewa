from decimal import Decimal

from django.test import SimpleTestCase

from .services.himalpay import HimalPayAPI, HimalPayError
from .views.bank_transfer_views import _resolve_destination_bank


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
