from django.urls import path
from .views import (
    auth_views,
    wallet_views,
    deposit_views,
    settings_views,
    topup_views,
    bank_transfer_views,
    remittance_views,
    internet_views,
    water_views,
    electricity_views,
    community_electricity_views,
    data_pack_views,
    admin_views,
    kyc_views,
    popup_views,
)

urlpatterns = [
    # Authentication endpoints
    path('api/auth/register/', auth_views.register, name='register'),
    path('api/auth/login/', auth_views.login, name='login'),
    path('api/auth/verify-login-otp/', auth_views.verify_login_otp, name='verify_login_otp'),
    path('api/auth/resend-login-otp/', auth_views.resend_login_otp, name='resend_login_otp'),
    path('api/auth/logout/', auth_views.logout, name='logout'),
    path(
        'api/auth/delete-account/<str:phone>/<str:password>/',
        auth_views.delete_account,
        name='delete_account',
    ),
    path('api/auth/profile/', auth_views.profile, name='profile'),
    path('api/auth/change-password/', auth_views.change_password, name='change_password'),
    path(
        'api/auth/request-change-phone-otp/',
        auth_views.request_change_phone_otp,
        name='request_change_phone_otp',
    ),
    path('api/auth/change-phone/', auth_views.change_phone, name='change_phone'),
    path(
        'api/auth/request-email-change/',
        auth_views.request_email_change,
        name='request_email_change',
    ),
    path(
        'api/auth/confirm-email-change/',
        auth_views.confirm_email_change,
        name='confirm_email_change',
    ),
    path('api/auth/forgot-password/', auth_views.forgot_password, name='forgot_password'),
    path('api/auth/reset-password/', auth_views.reset_password, name='reset_password'),
    path('api/auth/set-transaction-pin/', auth_views.set_transaction_pin, name='set_transaction_pin'),
    path('api/auth/change-transaction-pin/', auth_views.change_transaction_pin, name='change_transaction_pin'),
    path(
        'api/auth/request-transaction-pin-reset-otp/',
        auth_views.request_transaction_pin_reset_otp,
        name='request_transaction_pin_reset_otp',
    ),
    path(
        'api/auth/reset-transaction-pin/',
        auth_views.reset_transaction_pin,
        name='reset_transaction_pin',
    ),
    path('api/auth/has-transaction-pin/', auth_views.has_transaction_pin, name='has_transaction_pin'),
    path('api/auth/verify-transaction-pin/', auth_views.verify_transaction_pin, name='verify_transaction_pin'),
    path('api/auth/device-token/', auth_views.device_token, name='device_token'),

    # Wallet endpoints
    path('api/wallet/balance/', wallet_views.get_wallet_balance, name='wallet_balance'),
    path('api/wallet/transactions/', wallet_views.get_transaction_history, name='transaction_history'),

    # Deposit endpoints
    path('api/deposit/create/', deposit_views.create_deposit, name='create_deposit'),
    path('api/deposit/list/', deposit_views.list_deposits, name='list_deposits'),
    path('api/deposit/<int:deposit_id>/', deposit_views.get_deposit, name='get_deposit'),

    # KYC endpoints (multi-document identity verification)
    path('api/kyc/', kyc_views.get_kyc_status, name='kyc_status'),
    path('api/kyc/submit/', kyc_views.submit_kyc, name='kyc_submit'),
    path('api/kyc/documents/', kyc_views.kyc_documents, name='kyc_documents'),

    # Settings endpoints
    path('api/settings/', settings_views.get_settings, name='get_settings'),

    # Home popups (authenticated users)
    path('api/popups/active/', popup_views.active_home_popup, name='active_home_popup'),
    path(
        'api/popups/<int:popup_id>/shown/',
        popup_views.record_home_popup_shown,
        name='record_home_popup_shown',
    ),

    # Topup endpoints (HimalPay NTC / NCELL)
    path('api/topup/ntc/', topup_views.topup_ntc, name='topup_ntc'),
    path('api/topup/ncell/', topup_views.topup_ncell, name='topup_ncell'),
    path('api/topup/history/', topup_views.topup_history, name='topup_history'),
    path('api/topup/services/', topup_views.topup_services, name='topup_services'),
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
    path('api/remittance/verify-citizenship/', remittance_views.verify_citizenship, name='remittance_verify_citizenship'),
    path('api/remittance/receive/', remittance_views.receive_remittance, name='remittance_receive'),
    path('api/remittance/history/', remittance_views.remittance_history, name='remittance_history'),
    path('api/remittance/status/', remittance_views.remittance_status, name='remittance_status'),

    # Internet bill payment (ISP)
    path('api/internet/isps/', internet_views.list_isps, name='internet_isps'),
    path('api/internet/inquiry/', internet_views.inquiry_bill, name='internet_inquiry'),
    path('api/internet/pay/', internet_views.pay_bill, name='internet_pay'),
    path('api/internet/history/', internet_views.internet_bill_history, name='internet_history'),
    path('api/internet/status/', internet_views.internet_bill_status, name='internet_status'),

    # KUKL water bill payment (Khane Pani)
    path('api/water/counters/', water_views.list_counters, name='water_counters'),
    path('api/water/inquiry/', water_views.inquiry_bill, name='water_inquiry'),
    path('api/water/pay/', water_views.pay_bill, name='water_pay'),
    path('api/water/history/', water_views.water_bill_history, name='water_history'),
    path('api/water/status/', water_views.water_bill_status, name='water_status'),

    # NEA Electricity
    path('api/electricity/counters/', electricity_views.list_counters, name='electricity_counters'),
    path('api/electricity/inquiry/', electricity_views.inquiry_bill, name='electricity_inquiry'),
    path('api/electricity/pay/', electricity_views.pay_bill, name='electricity_pay'),
    path('api/electricity/history/', electricity_views.electricity_bill_history, name='electricity_history'),
    path('api/electricity/status/', electricity_views.electricity_bill_status, name='electricity_status'),

    # Community electricity (Himchuli, Watermark, Dreamer, Softlab, BPC)
    path(
        'api/community-electricity/providers/',
        community_electricity_views.list_providers,
        name='community_electricity_providers',
    ),
    path(
        'api/community-electricity/counters/',
        community_electricity_views.list_counters,
        name='community_electricity_counters',
    ),
    path(
        'api/community-electricity/inquiry/',
        community_electricity_views.inquiry_bill,
        name='community_electricity_inquiry',
    ),
    path(
        'api/community-electricity/pay/',
        community_electricity_views.pay_bill,
        name='community_electricity_pay',
    ),
    path(
        'api/community-electricity/history/',
        community_electricity_views.community_electricity_history,
        name='community_electricity_history',
    ),
    path(
        'api/community-electricity/status/',
        community_electricity_views.community_electricity_status,
        name='community_electricity_status',
    ),

    # Data pack top-up (NTC / NCELL)
    path('api/data-pack/inquiry/', data_pack_views.inquiry_packages, name='data_pack_inquiry'),
    path('api/data-pack/pay/', data_pack_views.pay_data_pack, name='data_pack_pay'),
    path('api/data-pack/history/', data_pack_views.data_pack_history, name='data_pack_history'),
    path('api/data-pack/status/', data_pack_views.data_pack_status, name='data_pack_status'),

    # Admin / staff console
    path('api/admin/dashboard/', admin_views.admin_dashboard, name='admin_dashboard'),
    path('api/admin/reports/', admin_views.admin_reports, name='admin_reports'),
    path('api/admin/users/', admin_views.admin_list_users, name='admin_list_users'),
    path('api/admin/users/<int:user_id>/report/', admin_views.admin_user_report, name='admin_user_report'),
    path('api/admin/users/<int:user_id>/', admin_views.admin_user_detail, name='admin_user_detail'),
    path('api/admin/users/<int:user_id>/fees/', admin_views.admin_user_fees, name='admin_user_fees'),
    path(
        'api/admin/users/<int:user_id>/set-transaction-pin/',
        admin_views.admin_set_user_transaction_pin,
        name='admin_set_user_transaction_pin',
    ),
    path('api/admin/wallets/', admin_views.admin_list_wallets, name='admin_list_wallets'),
    path('api/admin/wallets/<int:wallet_id>/transactions/', admin_views.admin_wallet_transactions, name='admin_wallet_transactions'),
    path('api/admin/transactions/', admin_views.admin_transaction_history, name='admin_transaction_history'),
    path('api/admin/wallets/<int:wallet_id>/', admin_views.admin_wallet_detail, name='admin_wallet_detail'),
    path('api/admin/deposits/', admin_views.admin_list_deposits, name='admin_list_deposits'),
    path('api/admin/deposits/<int:deposit_id>/', admin_views.admin_get_deposit, name='admin_get_deposit'),
    path('api/admin/deposits/<int:deposit_id>/approve/', admin_views.admin_approve_deposit, name='admin_approve_deposit'),
    path('api/admin/deposits/<int:deposit_id>/reject/', admin_views.admin_reject_deposit, name='admin_reject_deposit'),
    path('api/admin/kyc/', admin_views.admin_list_kyc, name='admin_list_kyc'),
    path('api/admin/kyc/<int:kyc_id>/', admin_views.admin_get_kyc, name='admin_get_kyc'),
    path('api/admin/kyc/<int:kyc_id>/approve/', admin_views.admin_approve_kyc, name='admin_approve_kyc'),
    path('api/admin/kyc/<int:kyc_id>/reject/', admin_views.admin_reject_kyc, name='admin_reject_kyc'),
    path('api/admin/topups/', admin_views.admin_list_topups, name='admin_list_topups'),
    path('api/admin/topups/<int:topup_id>/', admin_views.admin_get_topup, name='admin_get_topup'),
    path('api/admin/topups/<int:topup_id>/status/', admin_views.admin_update_topup_status, name='admin_update_topup_status'),
    path('api/admin/data-packs/', admin_views.admin_list_data_packs, name='admin_list_data_packs'),
    path('api/admin/data-packs/<int:data_pack_id>/', admin_views.admin_get_data_pack, name='admin_get_data_pack'),
    path('api/admin/data-packs/<int:data_pack_id>/status/', admin_views.admin_update_data_pack_status, name='admin_update_data_pack_status'),
    path('api/admin/internet-bills/', admin_views.admin_list_internet_bills, name='admin_list_internet_bills'),
    path('api/admin/internet-bills/<int:bill_id>/', admin_views.admin_get_internet_bill, name='admin_get_internet_bill'),
    path('api/admin/internet-bills/<int:bill_id>/status/', admin_views.admin_update_internet_bill_status, name='admin_update_internet_bill_status'),
    path('api/admin/water-bills/', admin_views.admin_list_water_bills, name='admin_list_water_bills'),
    path('api/admin/water-bills/<int:bill_id>/', admin_views.admin_get_water_bill, name='admin_get_water_bill'),
    path('api/admin/water-bills/<int:bill_id>/status/', admin_views.admin_update_water_bill_status, name='admin_update_water_bill_status'),
    path('api/admin/electricity-bills/', admin_views.admin_list_electricity_bills, name='admin_list_electricity_bills'),
    path('api/admin/electricity-bills/<int:bill_id>/', admin_views.admin_get_electricity_bill, name='admin_get_electricity_bill'),
    path('api/admin/electricity-bills/<int:bill_id>/status/', admin_views.admin_update_electricity_bill_status, name='admin_update_electricity_bill_status'),
    path('api/admin/community-electricity/', admin_views.admin_list_community_electricity, name='admin_list_community_electricity'),
    path('api/admin/community-electricity/<int:bill_id>/', admin_views.admin_get_community_electricity, name='admin_get_community_electricity'),
    path('api/admin/community-electricity/<int:bill_id>/status/', admin_views.admin_update_community_electricity_status, name='admin_update_community_electricity_status'),
    path('api/admin/transfers/', admin_views.admin_list_transfers, name='admin_list_transfers'),
    path('api/admin/commission-history/', admin_views.admin_commission_history, name='admin_commission_history'),
    path('api/admin/transfers/<int:transfer_id>/status/', admin_views.admin_update_transfer_status, name='admin_update_transfer_status'),
    path('api/admin/remittances/', admin_views.admin_list_remittances, name='admin_list_remittances'),
    path('api/admin/remittances/<int:remittance_id>/', admin_views.admin_get_remittance, name='admin_get_remittance'),
    path('api/admin/remittances/<int:remittance_id>/status/', admin_views.admin_update_remittance_status, name='admin_update_remittance_status'),
    path('api/admin/settings/', admin_views.admin_settings, name='admin_settings'),
    path('api/admin/settings/export/', admin_views.admin_export_data, name='admin_export_data'),
    path('api/admin/export/', admin_views.admin_export_data, name='admin_export_data_alt'),
    path('api/admin/settings/test-email/', admin_views.admin_test_smtp_email, name='admin_test_smtp_email'),
    path('api/admin/popups/', admin_views.admin_popups, name='admin_popups'),
    path('api/admin/popups/<int:popup_id>/', admin_views.admin_popup_detail, name='admin_popup_detail'),
    path('api/admin/push/', admin_views.admin_push_status, name='admin_push_status'),
    path('api/admin/push/send/', admin_views.admin_push_send, name='admin_push_send'),
    path('api/admin/himalpay/status/', admin_views.admin_himalpay_status, name='admin_himalpay_status'),
    path('api/admin/statement/', admin_views.admin_statement_list, name='admin_statement_list'),
    path('api/admin/statement/run/', admin_views.admin_statement_run, name='admin_statement_run'),
    path('api/admin/statement/runs/', admin_views.admin_statement_runs, name='admin_statement_runs'),
    path('api/admin/statement/balance/', admin_views.admin_statement_balance, name='admin_statement_balance'),
    path('api/admin/statement/ledger/', admin_views.admin_statement_ledger, name='admin_statement_ledger'),
    path('api/admin/statement/history/', admin_views.admin_statement_history, name='admin_statement_history'),
    path('api/admin/statement/correct/', admin_views.admin_statement_correct, name='admin_statement_correct'),
    path('api/admin/statement/discrepancies/<int:discrepancy_id>/solve/', admin_views.admin_statement_solve, name='admin_statement_solve'),
    path('api/admin/statement/discrepancies/<int:discrepancy_id>/ignore/', admin_views.admin_statement_ignore, name='admin_statement_ignore'),
]
