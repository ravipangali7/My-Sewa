from django.urls import path
from .views import (
    auth_views,
    wallet_views,
    deposit_views,
    settings_views,
    topup_views,
    bank_transfer_views,
    remittance_views,
    admin_views,
)

urlpatterns = [
    # Authentication endpoints
    path('api/auth/register/', auth_views.register, name='register'),
    path('api/auth/login/', auth_views.login, name='login'),
    path('api/auth/logout/', auth_views.logout, name='logout'),
    path('api/auth/profile/', auth_views.profile, name='profile'),
    path('api/auth/change-password/', auth_views.change_password, name='change_password'),
    path('api/auth/change-phone/', auth_views.change_phone, name='change_phone'),
    path('api/auth/forgot-password/', auth_views.forgot_password, name='forgot_password'),
    path('api/auth/reset-password/', auth_views.reset_password, name='reset_password'),

    # Wallet endpoints
    path('api/wallet/balance/', wallet_views.get_wallet_balance, name='wallet_balance'),
    path('api/wallet/transactions/', wallet_views.get_transaction_history, name='transaction_history'),

    # Deposit endpoints
    path('api/deposit/create/', deposit_views.create_deposit, name='create_deposit'),
    path('api/deposit/list/', deposit_views.list_deposits, name='list_deposits'),
    path('api/deposit/<int:deposit_id>/', deposit_views.get_deposit, name='get_deposit'),

    # Settings endpoints
    path('api/settings/', settings_views.get_settings, name='get_settings'),

    # Topup endpoints (HimalPay NTC / NCELL)
    path('api/topup/ntc/', topup_views.topup_ntc, name='topup_ntc'),
    path('api/topup/ncell/', topup_views.topup_ncell, name='topup_ncell'),
    path('api/topup/history/', topup_views.topup_history, name='topup_history'),
    path('api/topup/calculate-charge/', topup_views.calculate_charge, name='topup_calculate_charge'),
    path('api/topup/status/', topup_views.check_transaction_status, name='topup_status'),

    # Bank Transfer endpoints (HimalPay)
    path('api/bank-transfer/banks/', bank_transfer_views.list_banks, name='bank_transfer_banks'),
    path('api/bank-transfer/verify/', bank_transfer_views.verify_account, name='bank_transfer_verify'),
    path('api/bank-transfer/calculate/', bank_transfer_views.calculate_transfer_charge, name='bank_transfer_calculate'),
    path('api/bank-transfer/create/', bank_transfer_views.create_bank_transfer, name='bank_transfer_create'),
    path('api/bank-transfer/history/', bank_transfer_views.bank_transfer_history, name='bank_transfer_history'),
    path('api/bank-transfer/status/', bank_transfer_views.bank_transfer_status, name='bank_transfer_status'),

    # Remittance endpoints (HimalPay Samsara)
    path('api/remittance/lookup/', remittance_views.lookup_remittance, name='remittance_lookup'),
    path('api/remittance/receive/', remittance_views.receive_remittance, name='remittance_receive'),
    path('api/remittance/history/', remittance_views.remittance_history, name='remittance_history'),
    path('api/remittance/status/', remittance_views.remittance_status, name='remittance_status'),

    # Admin / staff console
    path('api/admin/dashboard/', admin_views.admin_dashboard, name='admin_dashboard'),
    path('api/admin/users/', admin_views.admin_list_users, name='admin_list_users'),
    path('api/admin/users/<int:user_id>/', admin_views.admin_user_detail, name='admin_user_detail'),
    path('api/admin/wallets/', admin_views.admin_list_wallets, name='admin_list_wallets'),
    path('api/admin/wallets/<int:wallet_id>/', admin_views.admin_wallet_detail, name='admin_wallet_detail'),
    path('api/admin/deposits/', admin_views.admin_list_deposits, name='admin_list_deposits'),
    path('api/admin/deposits/<int:deposit_id>/', admin_views.admin_get_deposit, name='admin_get_deposit'),
    path('api/admin/deposits/<int:deposit_id>/approve/', admin_views.admin_approve_deposit, name='admin_approve_deposit'),
    path('api/admin/deposits/<int:deposit_id>/reject/', admin_views.admin_reject_deposit, name='admin_reject_deposit'),
    path('api/admin/topups/', admin_views.admin_list_topups, name='admin_list_topups'),
    path('api/admin/topups/<int:topup_id>/', admin_views.admin_get_topup, name='admin_get_topup'),
    path('api/admin/topups/<int:topup_id>/status/', admin_views.admin_update_topup_status, name='admin_update_topup_status'),
    path('api/admin/transfers/', admin_views.admin_list_transfers, name='admin_list_transfers'),
    path('api/admin/transfers/<int:transfer_id>/status/', admin_views.admin_update_transfer_status, name='admin_update_transfer_status'),
    path('api/admin/remittances/', admin_views.admin_list_remittances, name='admin_list_remittances'),
    path('api/admin/remittances/<int:remittance_id>/', admin_views.admin_get_remittance, name='admin_get_remittance'),
    path('api/admin/remittances/<int:remittance_id>/status/', admin_views.admin_update_remittance_status, name='admin_update_remittance_status'),
    path('api/admin/settings/', admin_views.admin_settings, name='admin_settings'),
    path('api/admin/himalpay/status/', admin_views.admin_himalpay_status, name='admin_himalpay_status'),
]
