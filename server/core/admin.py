from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Wallet, Deposit, Settings, TopupTransaction, BankTransferTransaction

User = get_user_model()


@admin.register(User)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ('phone', 'email', 'first_name', 'last_name', 'account_status', 'is_active', 'date_joined')
    list_filter = ('account_status', 'is_active', 'is_staff', 'date_joined')
    search_fields = ('phone', 'email', 'first_name', 'last_name')
    readonly_fields = ('date_joined', 'last_login')
    fields = (
        'phone', 'email', 'first_name', 'last_name', 'avatar',
        'account_status', 'is_active', 'is_staff', 'date_joined', 'last_login',
    )


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('user', 'balance', 'created_at', 'updated_at')
    list_filter = ('created_at', 'updated_at')
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')
    ordering = ('-updated_at',)


@admin.register(Deposit)
class DepositAdmin(admin.ModelAdmin):
    list_display = ('user', 'amount', 'status', 'created_at', 'updated_at')
    list_filter = ('status', 'created_at', 'updated_at')
    search_fields = ('user__username', 'user__email', 'note', 'rejection_reason')
    readonly_fields = (
        'user', 'amount', 'screenshot_proof', 'note', 'rejection_reason',
        'created_at', 'updated_at',
    )
    ordering = ('-created_at',)
    actions = ['approve_deposits', 'reject_deposits']

    def approve_deposits(self, request, queryset):
        """Approve selected deposits and update wallet balance"""
        approved_count = 0
        for deposit in queryset.filter(status='pending'):
            with transaction.atomic():
                deposit.status = 'approved'
                deposit.save()
                # Signal will handle wallet balance update
                wallet = Wallet.objects.get(user=deposit.user)
                wallet.balance += deposit.amount
                wallet.save()
                approved_count += 1
        self.message_user(request, f'{approved_count} deposit(s) approved successfully.')
    approve_deposits.short_description = "Approve selected deposits"

    def reject_deposits(self, request, queryset):
        """Reject selected deposits"""
        rejected_count = queryset.filter(status='pending').update(status='rejected')
        self.message_user(request, f'{rejected_count} deposit(s) rejected.')
    reject_deposits.short_description = "Reject selected deposits"

    def has_add_permission(self, request):
        return False  # Deposits can only be created via API


@admin.register(Settings)
class SettingsAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'updated_at')
    readonly_fields = ('created_at', 'updated_at')
    fields = ('logo', 'qr_code', 'bank_details', 'config', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        # Only allow one instance
        return not Settings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False  # Prevent deletion

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        # Ensure singleton exists
        Settings.load()
        return qs


@admin.register(TopupTransaction)
class TopupTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'mobile_number', 'product_id', 'amount', 'status',
        'total_debited', 'merchant_txn_id', 'created_at',
    )
    list_filter = ('status', 'product_id', 'created_at')
    search_fields = ('user__username', 'mobile_number', 'merchant_txn_id', 'service_hub_txn_id', 'reference_id')
    readonly_fields = (
        'user', 'mobile_number', 'amount', 'product_id', 'status',
        'service_hub_txn_id', 'merchant_txn_id', 'charge', 'cashback',
        'total_debited', 'reference_id', 'provider_response',
        'created_at', 'updated_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(BankTransferTransaction)
class BankTransferTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'destination_bank', 'destination_acc_no', 'amount',
        'status', 'total_debited', 'merchant_txn_id', 'created_at',
    )
    list_filter = ('status', 'destination_bank', 'created_at')
    search_fields = (
        'user__phone', 'destination_acc_no', 'destination_acc_name',
        'merchant_txn_id', 'provider_txn_id', 'reference_id',
    )
    readonly_fields = (
        'user', 'amount', 'destination_bank', 'destination_bank_name',
        'destination_acc_no', 'destination_acc_name', 'is_destination_mobile',
        'transaction_remarks', 'transaction_remarks_2', 'transaction_remarks_3',
        'status', 'merchant_txn_id', 'provider_txn_id', 'reference_id',
        'charge', 'cashback', 'total_debited', 'verified', 'provider_response',
        'created_at', 'updated_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False
