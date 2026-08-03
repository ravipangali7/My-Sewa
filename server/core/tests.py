from decimal import Decimal

from django.test import SimpleTestCase

from .services.himalpay import HimalPayAPI, HimalPayError


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
        )
        self.assertEqual(response['amount'], 10000)
        self.assertEqual(response['data']['amount'], 10000)

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

    def test_invalid_amount_rejected(self):
        with self.assertRaises(HimalPayError):
            HimalPayAPI.to_paisa('not-a-number')
        with self.assertRaises(HimalPayError):
            HimalPayAPI.to_paisa(None)
