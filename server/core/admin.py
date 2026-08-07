from django import forms
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import (
    Wallet,
    WalletAdjustment,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    WaterBillTransaction,
    CommunityElectricityTransaction,
    UserFeeConfig,
    DeviceToken,
    KYCSubmission,
    KYCDocument,
    KYCAuditLog,
    SecurityAuditLog,
)

User = get_user_model()


class CustomUserAdminForm(forms.ModelForm):
    """Require email when creating a new user; model may still allow blank for legacy rows."""

    class Meta:
        model = User
        fields = (
            'phone', 'email', 'first_name', 'last_name', 'nickname', 'business_name', 'avatar',
            'date_of_birth', 'account_status', 'kyc_status', 'citizenship_number',
            'is_active', 'is_staff',
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['phone'].required = True
        # New users must have an email; existing legacy accounts may still be blank.
        if not self.instance.pk:
            self.fields['email'].required = True
            self.fields['date_of_birth'].required = True

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip()
        if not self.instance.pk and not email:
            raise forms.ValidationError('Email address is required.')
        return email or None


@admin.register(User)
class CustomUserAdmin(admin.ModelAdmin):
    form = CustomUserAdminForm
    list_display = (
        'phone', 'email', 'first_name', 'last_name', 'nickname',
        'account_status', 'kyc_status', 'is_active', 'date_joined',
    )
    list_filter = ('account_status', 'kyc_status', 'is_active', 'is_staff', 'date_joined')
    search_fields = (
        'phone', 'email', 'first_name', 'last_name', 'nickname', 'business_name',
        'citizenship_number',
    )
    readonly_fields = ('date_joined', 'last_login')
    fields = (
        'phone', 'email', 'first_name', 'last_name', 'nickname', 'business_name', 'avatar',
        'date_of_birth', 'account_status', 'kyc_status', 'citizenship_number',
        'is_active', 'is_staff',
        'date_joined', 'last_login',
    )


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('user', 'balance', 'created_at', 'updated_at')
    list_filter = ('created_at', 'updated_at')
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at')
    ordering = ('-updated_at',)


@admin.register(WalletAdjustment)
class WalletAdjustmentAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'adjustment_type', 'amount', 'balance_before', 'balance_after',
        'created_by', 'created_at',
    )
    list_filter = ('adjustment_type', 'created_at')
    search_fields = (
        'user__phone', 'reason', 'reference', 'created_by__phone',
    )
    readonly_fields = (
        'wallet', 'user', 'amount', 'adjustment_type',
        'balance_before', 'balance_after', 'reason', 'created_by',
        'created_at', 'reference',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(Deposit)
class DepositAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'amount', 'transaction_id', 'deposit_date', 'status',
        'created_at', 'updated_at',
    )
    list_filter = ('status', 'deposit_date', 'created_at', 'updated_at')
    search_fields = (
        'user__username', 'user__email', 'user__phone',
        'transaction_id', 'bank_name', 'note', 'rejection_reason',
    )
    readonly_fields = (
        'user', 'amount', 'transaction_id', 'deposit_date', 'bank_name',
        'screenshot_proof', 'note', 'rejection_reason',
        'balance_before', 'balance_after',
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
                # Signal credits wallet and sets balance_before / balance_after
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
        'total_debited', 'balance_before', 'balance_after', 'reference_id',
        'provider_response', 'created_at', 'updated_at',
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
        'charge', 'cashback', 'total_debited', 'balance_before', 'balance_after',
        'verified', 'provider_response', 'created_at', 'updated_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(RemittanceTransaction)
class RemittanceTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'ref_no', 'amount', 'status', 'total_credited',
        'merchant_txn_id', 'created_at',
    )
    list_filter = ('status', 'created_at')
    search_fields = (
        'user__phone', 'ref_no', 'merchant_txn_id', 'provider_txn_id',
        'reference_id', 'receiver_name', 'sender_name',
    )
    readonly_fields = [f.name for f in RemittanceTransaction._meta.fields]
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(WaterBillTransaction)
class WaterBillTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'connection_no', 'customer_code', 'counter', 'amount',
        'status', 'total_debited', 'merchant_txn_id', 'created_at',
    )
    list_filter = ('status', 'created_at')
    search_fields = (
        'user__phone', 'connection_no', 'customer_code', 'counter',
        'merchant_txn_id', 'service_hub_txn_id', 'reference_id', 'session_id',
    )
    readonly_fields = [f.name for f in WaterBillTransaction._meta.fields]
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(CommunityElectricityTransaction)
class CommunityElectricityTransactionAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'platform_name', 'customer_ref', 'service_slug', 'amount',
        'status', 'total_debited', 'merchant_txn_id', 'created_at',
    )
    list_filter = ('status', 'platform_id', 'created_at')
    search_fields = (
        'user__phone', 'platform_id', 'platform_name', 'customer_ref',
        'service_slug', 'counter_code', 'merchant_txn_id',
        'service_hub_txn_id', 'reference_id', 'session_id',
    )
    readonly_fields = [f.name for f in CommunityElectricityTransaction._meta.fields]
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(UserFeeConfig)
class UserFeeConfigAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'transfer_charge_enabled',
        'transfer_charge_flat',
        'transfer_charge_percent',
        'topup_charge_percent',
        'updated_at',
    )
    search_fields = ('user__phone', 'user__email', 'user__first_name', 'user__last_name')
    readonly_fields = ('updated_at',)
    autocomplete_fields = ('user',)
    fields = (
        'user',
        'transfer_charge_enabled',
        'transfer_charge_flat',
        'transfer_charge_percent',
        'topup_charge_percent',
        'updated_at',
    )


@admin.register(DeviceToken)
class DeviceTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'platform', 'token_preview', 'updated_at', 'created_at')
    list_filter = ('platform', 'updated_at')
    search_fields = ('user__phone', 'token')
    readonly_fields = ('created_at', 'updated_at')
    ordering = ('-updated_at',)

    @admin.display(description='Token')
    def token_preview(self, obj):
        t = obj.token or ''
        if len(t) <= 24:
            return t
        return f'{t[:12]}…{t[-8:]}'


class KYCDocumentInline(admin.TabularInline):
    model = KYCDocument
    extra = 0
    readonly_fields = ('document_type', 'side', 'file', 'uploaded_at')
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(KYCSubmission)
class KYCSubmissionAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'user', 'citizenship_number', 'status', 'reviewed_by',
        'submitted_at', 'created_at',
    )
    list_filter = ('status', 'submitted_at', 'created_at')
    search_fields = (
        'user__phone', 'user__email', 'citizenship_number', 'rejection_reason',
    )
    readonly_fields = (
        'user', 'citizenship_number', 'status', 'rejection_reason',
        'reviewed_by', 'reviewed_at', 'submitted_at', 'created_at', 'updated_at',
    )
    inlines = [KYCDocumentInline]
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False


@admin.register(KYCDocument)
class KYCDocumentAdmin(admin.ModelAdmin):
    list_display = ('submission', 'document_type', 'side', 'uploaded_at')
    list_filter = ('document_type', 'side', 'uploaded_at')
    search_fields = (
        'submission__user__phone', 'submission__citizenship_number',
    )
    readonly_fields = (
        'submission', 'document_type', 'side', 'file', 'uploaded_at',
    )
    ordering = ('-uploaded_at',)

    def has_add_permission(self, request):
        return False


@admin.register(KYCAuditLog)
class KYCAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'action', 'actor', 'old_status', 'new_status', 'created_at',
    )
    list_filter = ('action', 'created_at')
    search_fields = ('user__phone', 'actor__phone')
    readonly_fields = (
        'user', 'submission', 'action', 'actor',
        'old_status', 'new_status', 'details', 'created_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(SecurityAuditLog)
class SecurityAuditLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'action', 'ip_address', 'created_at')
    list_filter = ('action', 'created_at')
    search_fields = ('user__phone', 'ip_address')
    readonly_fields = (
        'user', 'action', 'ip_address', 'user_agent', 'details', 'created_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
