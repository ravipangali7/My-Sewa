from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    Wallet,
    GgrWallet,
    GgrTransaction,
    MonthlyGgrSettlement,
    ShareholderWallet,
    ShareholderRevenueLog,
    ShareholderWithdrawal,
    PlatformServiceFeeConfig,
)
from .services.ggr_service import (
    buy_ggr_coins,
    process_game_event,
    settle_monthly_ggr_for_user,
    process_payment_api_deposit,
    process_payment_api_withdraw,
    execute_shareholder_withdrawal,
)

User = get_user_model()


class GgrAndShareholderTests(TestCase):
    def setUp(self):
        # Configure service fees
        config = PlatformServiceFeeConfig.get_config()
        config.ggr_monthly_profit_percent = Decimal('10.00')
        config.payment_api_deposit_percent = Decimal('1.50')
        config.payment_api_withdraw_percent = Decimal('2.00')
        config.save()

        # Create Shareholder user
        self.shareholder = User.objects.create_user(
            phone='9800000001',
            email='shareholder@example.com',
            password='Password123!',
            role=User.ROLE_SHAREHOLDER,
            share_percent=Decimal('100.00'),
            is_active=True,
        )

        # Create API User (Merchant / Gaming operator)
        self.api_user = User.objects.create_user(
            phone='9800000002',
            email='merchant@example.com',
            password='Password123!',
            role=User.ROLE_CUSTOMER,
            is_api_user=True,
            is_active=True,
        )
        self.api_user_wallet, _ = Wallet.objects.get_or_create(user=self.api_user)
        self.api_user_wallet.balance = Decimal('50000.00')
        self.api_user_wallet.save()

        # Create Regular User (Non-API user)
        self.regular_user = User.objects.create_user(
            phone='9800000003',
            email='regular@example.com',
            password='Password123!',
            role=User.ROLE_CUSTOMER,
            is_api_user=False,
            is_active=True,
        )

        self.client = APIClient()

    def test_shareholder_is_staff_and_has_wallet(self):
        self.assertTrue(self.shareholder.is_staff)
        wallet = ShareholderWallet.objects.filter(shareholder=self.shareholder).first()
        self.assertIsNotNone(wallet)

    def test_buy_ggr_coins(self):
        # API user buys 10,000 GGR coins
        txn = buy_ggr_coins(self.api_user, Decimal('10000.00'))
        self.assertEqual(txn.amount, Decimal('10000.00'))

        self.api_user_wallet.refresh_from_db()
        self.assertEqual(self.api_user_wallet.balance, Decimal('40000.00'))

        ggr_wallet = GgrWallet.objects.get(user=self.api_user)
        self.assertEqual(ggr_wallet.coin_balance, Decimal('10000.00'))
        self.assertEqual(ggr_wallet.total_bought, Decimal('10000.00'))

    def test_non_api_user_cannot_buy_ggr(self):
        with self.assertRaises(PermissionError):
            buy_ggr_coins(self.regular_user, Decimal('1000.00'))

    def test_game_events(self):
        # 1. Player loses 1,000 coins -> GGR coins decrease
        buy_ggr_coins(self.api_user, Decimal('10000.00'))
        process_game_event(self.api_user, 'player_loss', Decimal('1000.00'))

        ggr_wallet = GgrWallet.objects.get(user=self.api_user)
        self.assertEqual(ggr_wallet.coin_balance, Decimal('9000.00'))
        self.assertEqual(ggr_wallet.total_lost, Decimal('1000.00'))

        # 2. Player wins 2,000 -> GGR coins increase by 10% bonus (2000 * 1.10 = 2200)
        process_game_event(self.api_user, 'player_win', Decimal('2000.00'))
        ggr_wallet.refresh_from_db()
        self.assertEqual(ggr_wallet.coin_balance, Decimal('11200.00'))
        self.assertEqual(ggr_wallet.total_won, Decimal('2200.00'))

    def test_monthly_ggr_profit_settlement_and_shareholder_fee(self):
        # Setup net profit: won 2,200, lost 1,000 -> Net profit = 1,200
        buy_ggr_coins(self.api_user, Decimal('10000.00'))
        process_game_event(self.api_user, 'player_loss', Decimal('1000.00'))
        process_game_event(self.api_user, 'player_win', Decimal('2000.00'))

        # Run settlement
        settlement = settle_monthly_ggr_for_user(self.api_user, '2026-10')
        self.assertEqual(settlement.net_profit, Decimal('1200.00'))
        # 10% of 1200 = 120.00
        self.assertEqual(settlement.fee_amount, Decimal('120.00'))

        # Verify fee credited to Shareholder wallet
        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        self.assertEqual(sh_wallet.balance, Decimal('120.00'))

    def test_payment_api_deposit_and_withdraw(self):
        initial_cash = self.api_user_wallet.balance

        # 1. Deposit: Player deposits 10,000 NPR (1.5% fee = 150 NPR to Shareholder, 9,850 NPR to User balance)
        dep_res = process_payment_api_deposit(self.api_user, Decimal('10000.00'), 'player_42', 'REF_DEP_100')
        self.assertEqual(Decimal(dep_res['fee_amount']), Decimal('150.00'))
        self.assertEqual(Decimal(dep_res['net_credited']), Decimal('9850.00'))

        self.api_user_wallet.refresh_from_db()
        self.assertEqual(self.api_user_wallet.balance, initial_cash + Decimal('9850.00'))

        # 2. Withdraw: Player withdraws 5,000 NPR (2% fee = 100 NPR to Shareholder, total debit 5,100 NPR from User)
        wth_res = process_payment_api_withdraw(self.api_user, Decimal('5000.00'), 'player_42', 'REF_WTH_100')
        self.assertEqual(Decimal(wth_res['fee_amount']), Decimal('100.00'))
        self.assertEqual(Decimal(wth_res['total_debited']), Decimal('5100.00'))

        # Check total shareholder revenue accumulated (150 from deposit + 100 from withdraw = 250)
        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        self.assertEqual(sh_wallet.balance, Decimal('250.00'))

    def test_shareholder_can_withdraw_revenue(self):
        # Accumulate 1,000 fee for shareholder
        process_payment_api_deposit(self.api_user, Decimal('100000.00')) # 1.5% = 1500 NPR fee

        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        self.assertEqual(sh_wallet.balance, Decimal('1500.00'))

        # Shareholder withdraws 1,000 to bank
        withdrawal = execute_shareholder_withdrawal(
            shareholder=self.shareholder,
            amount=Decimal('1000.00'),
            payout_method='bank',
            account_name='Shareholder Ravi',
            account_number='0192837465',
            bank_name='Nabil Bank',
        )
        self.assertEqual(withdrawal.amount, Decimal('1000.00'))

        sh_wallet.refresh_from_db()
        self.assertEqual(sh_wallet.balance, Decimal('500.00'))
        self.assertEqual(sh_wallet.total_withdrawn, Decimal('1000.00'))
