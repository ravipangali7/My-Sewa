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
    ShareholderPayoutAccount,
    Deposit,
    PlatformServiceFeeConfig,
)
from .services.ggr_service import (
    buy_ggr_coins,
    process_game_event,
    settle_monthly_ggr_for_user,
    process_payment_api_deposit,
    process_payment_api_withdraw,
    execute_shareholder_withdrawal,
    sync_historical_revenue_to_shareholders,
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
            is_ggr_user=True,
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
            is_ggr_user=False,
            is_active=True,
        )

    def test_regular_user_cannot_access_ggr_or_payment_api(self):
        client = APIClient()
        client.force_authenticate(user=self.regular_user)

        res = client.get('/api/v1/ggr/dashboard/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'api_user_required')

        res = client.post('/api/v1/payment/deposit/', {'amount': 1000})
        self.assertEqual(res.status_code, 403)

    def test_is_ggr_user_permission_gate(self):
        # API user with is_ggr_user = False
        non_ggr_api_user = User.objects.create_user(
            phone='9800000099',
            password='Password123!',
            is_api_user=True,
            is_ggr_user=False,
            is_active=True,
        )
        w, _ = Wallet.objects.get_or_create(user=non_ggr_api_user)
        w.balance = Decimal('20000.00')
        w.save()

        client = APIClient()
        client.force_authenticate(user=non_ggr_api_user)

        # GGR dashboard indicates is_ggr_enabled = False
        res = client.get('/api/v1/ggr/dashboard/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_ggr_enabled'])

        # GGR buy fails with 403
        res = client.post('/api/v1/ggr/buy/', {'amount': 1000})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'ggr_disabled')

        # GGR game-event fails with 403
        res = client.post('/api/v1/ggr/game-event/', {'event_type': 'player_win', 'amount': 500})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'ggr_disabled')

        # But Payment API still works for this merchant
        res = client.post('/api/v1/payment/deposit/', {'amount': 1000, 'player_id': 'p1'})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])

    def test_buy_ggr_coins_deducts_cash_and_credits_ggr(self):
        initial_cash = self.api_user_wallet.balance
        txn = buy_ggr_coins(self.api_user, Decimal('10000.00'))

        self.assertEqual(txn.amount, Decimal('10000.00'))
        self.assertEqual(txn.balance_after, Decimal('10000.00'))

        self.api_user_wallet.refresh_from_db()
        self.assertEqual(self.api_user_wallet.balance, initial_cash - Decimal('10000.00'))

        ggr_wallet = GgrWallet.objects.get(user=self.api_user)
        self.assertEqual(ggr_wallet.coin_balance, Decimal('10000.00'))
        self.assertEqual(ggr_wallet.total_bought, Decimal('10000.00'))

    def test_game_event_loss_decreases_coins(self):
        buy_ggr_coins(self.api_user, Decimal('10000.00'))

        txn = process_game_event(self.api_user, 'player_loss', Decimal('2000.00'), 'ROUND_01')
        self.assertEqual(txn.amount, Decimal('-2000.00'))
        self.assertEqual(txn.balance_after, Decimal('8000.00'))

        ggr_wallet = GgrWallet.objects.get(user=self.api_user)
        self.assertEqual(ggr_wallet.coin_balance, Decimal('8000.00'))
        self.assertEqual(ggr_wallet.total_lost, Decimal('2000.00'))

    def test_game_event_win_increases_coins_by_10_percent_bonus(self):
        buy_ggr_coins(self.api_user, Decimal('10000.00'))

        # Player wins 1000. GGR coin should increase by 10% bonus: 1000 * 1.10 = 1100
        txn = process_game_event(self.api_user, 'player_win', Decimal('1000.00'), 'ROUND_02')
        self.assertEqual(txn.amount, Decimal('1100.00'))
        self.assertEqual(txn.balance_after, Decimal('11100.00'))

        ggr_wallet = GgrWallet.objects.get(user=self.api_user)
        self.assertEqual(ggr_wallet.coin_balance, Decimal('11100.00'))
        self.assertEqual(ggr_wallet.total_won, Decimal('1100.00'))

    def test_monthly_ggr_settlement_takes_10_percent_profit_and_credits_shareholder(self):
        buy_ggr_coins(self.api_user, Decimal('20000.00'))

        # Win 11,000, Lost 1,000 -> Net profit = 10,000
        process_game_event(self.api_user, 'player_win', Decimal('10000.00')) # credits 11,000
        process_game_event(self.api_user, 'player_loss', Decimal('1000.00')) # debits 1,000

        self.api_user_wallet.refresh_from_db()
        initial_cash = self.api_user_wallet.balance

        # Settle monthly GGR (10% on 10,000 profit = 1,000 NPR fee)
        settlement = settle_monthly_ggr_for_user(self.api_user, '2026-10')
        self.assertEqual(settlement.net_profit, Decimal('10000.00'))
        self.assertEqual(settlement.fee_amount, Decimal('1000.00'))

        # Check user cash debited by 1,000
        self.api_user_wallet.refresh_from_db()
        self.assertEqual(self.api_user_wallet.balance, initial_cash - Decimal('1000.00'))

        # Check shareholder received 1,000 fee
        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        self.assertEqual(sh_wallet.balance, Decimal('1000.00'))
        self.assertEqual(sh_wallet.total_earned, Decimal('1000.00'))

    def test_payment_api_deposit_and_withdraw_fees(self):
        initial_cash = self.api_user_wallet.balance

        # 1. Deposit: Player deposits 10,000 NPR (1.5% fee = 150 NPR to Shareholder, 9,850 credited to User)
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

    def test_deposit_model_approval_cuts_fee_and_credits_shareholders(self):
        # Normal deposit creation
        deposit = Deposit.objects.create(
            user=self.api_user,
            amount=Decimal('10000.00'),
            status=Deposit.STATUS_PENDING,
        )
        initial_user_balance = Wallet.objects.get(user=self.api_user).balance
        initial_sh_balance = ShareholderWallet.objects.get(shareholder=self.shareholder).balance

        # Admin approves deposit
        deposit.status = Deposit.STATUS_APPROVED
        deposit.save()

        # Fee is 1.5% = 150. Net credited to user = 9,850.
        user_wallet = Wallet.objects.get(user=self.api_user)
        self.assertEqual(user_wallet.balance, initial_user_balance + Decimal('9850.00'))

        # Shareholder wallet credited 150
        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        self.assertEqual(sh_wallet.balance, initial_sh_balance + Decimal('150.00'))

        # Audit log exists
        log = ShareholderRevenueLog.objects.filter(reference=f'DEP-{deposit.pk}').first()
        self.assertIsNotNone(log)
        self.assertEqual(log.amount, Decimal('150.00'))

    def test_shareholder_payout_account_and_withdrawal(self):
        # 1. Create payout account
        pa = ShareholderPayoutAccount.objects.create(
            shareholder=self.shareholder,
            method='bank',
            label='My Nabil Account',
            account_name='John Doe',
            account_number='9876543210',
            bank_name='Nabil Bank',
            is_default=True,
        )
        self.assertEqual(pa.method, 'bank')

        # 2. Fund shareholder wallet
        sh_wallet = ShareholderWallet.objects.get(shareholder=self.shareholder)
        sh_wallet.balance = Decimal('5000.00')
        sh_wallet.save()

        # 3. Withdraw using payout_account_id
        wth = execute_shareholder_withdrawal(
            shareholder=self.shareholder,
            amount=Decimal('2000.00'),
            payout_account_id=pa.id,
        )
        self.assertEqual(wth.amount, Decimal('2000.00'))
        self.assertEqual(wth.payout_account, pa)
        self.assertEqual(wth.account_name, 'John Doe')
        self.assertEqual(wth.account_number, '9876543210')

        sh_wallet.refresh_from_db()
        self.assertEqual(sh_wallet.balance, Decimal('3000.00'))
        self.assertEqual(sh_wallet.total_withdrawn, Decimal('2000.00'))

    def test_sync_historical_revenue_utility(self):
        # Create un-synced approved deposit by bypassing signal
        Deposit.objects.filter(pk=1).delete()
        dep = Deposit.objects.create(
            user=self.api_user,
            amount=Decimal('20000.00'),
            status=Deposit.STATUS_APPROVED,
        )
        # Clear any revenue logs for it to simulate past deposit before feature
        ShareholderRevenueLog.objects.filter(reference=f'DEP-{dep.pk}').delete()

        sh_before = ShareholderWallet.objects.get(shareholder=self.shareholder).balance

        # Run sync
        res = sync_historical_revenue_to_shareholders()
        self.assertGreaterEqual(res['synced_deposits_count'], 1)

        sh_after = ShareholderWallet.objects.get(shareholder=self.shareholder).balance
        self.assertGreater(sh_after, sh_before)
