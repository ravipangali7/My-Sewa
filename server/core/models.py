from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import MinValueValidator
import json


class CustomUserManager(BaseUserManager):
    """Custom user manager where phone is the unique identifier"""
    
    def create_user(self, phone, password=None, **extra_fields):
        """Create and save a regular user with the given phone and password"""
        if not phone:
            raise ValueError('The phone field must be set')
        # Ensure is_active defaults to True if not explicitly set
        extra_fields.setdefault('is_active', True)
        user = self.model(phone=phone, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, password=None, **extra_fields):
        """Create and save a superuser with the given phone and password"""
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(phone, password, **extra_fields)


class CustomUser(AbstractUser):
    """Custom User model with phone number as authentication field"""
    ACCOUNT_STATUS_PENDING = 'pending'
    ACCOUNT_STATUS_APPROVED = 'approved'  # displayed as "Active" in the UI
    ACCOUNT_STATUS_CHOICES = [
        (ACCOUNT_STATUS_PENDING, 'Pending'),
        (ACCOUNT_STATUS_APPROVED, 'Active'),
    ]

    # Make username nullable since we're using phone as USERNAME_FIELD
    username = models.CharField(max_length=150, blank=True, null=True)
    
    phone = models.CharField(
        max_length=50,
        unique=True,
        help_text="Phone number (any length, any starting digit)"
    )
    email = models.EmailField(blank=True, null=True)
    first_name = models.CharField(max_length=30, blank=True)
    last_name = models.CharField(max_length=30, blank=True)
    avatar = models.ImageField(
        upload_to='avatars/',
        null=True,
        blank=True,
        help_text="Profile picture",
    )
    account_status = models.CharField(
        max_length=20,
        choices=ACCOUNT_STATUS_CHOICES,
        default=ACCOUNT_STATUS_APPROVED,
        db_index=True,
        help_text="Pending users can log in but cannot perform transactions until set to Active.",
    )
    transaction_pin = models.CharField(
        max_length=128,
        blank=True,
        default='',
        help_text="Hashed transaction PIN (4–6 digits). Empty if not set.",
    )
    date_of_birth = models.DateField(
        null=True,
        blank=True,
        help_text="Date of birth (AD). Required for new registrations; nullable for legacy users.",
    )

    KYC_STATUS_NOT_SUBMITTED = 'not_submitted'
    KYC_STATUS_PENDING = 'pending'
    KYC_STATUS_APPROVED = 'approved'
    KYC_STATUS_REJECTED = 'rejected'
    KYC_STATUS_CHOICES = [
        (KYC_STATUS_NOT_SUBMITTED, 'Not Submitted'),
        (KYC_STATUS_PENDING, 'Pending'),
        (KYC_STATUS_APPROVED, 'Approved'),
        (KYC_STATUS_REJECTED, 'Rejected'),
    ]

    kyc_status = models.CharField(
        max_length=20,
        choices=KYC_STATUS_CHOICES,
        default=KYC_STATUS_NOT_SUBMITTED,
        db_index=True,
        help_text="Denormalized KYC status for fast access checks and field locking.",
    )
    citizenship_number = models.CharField(
        max_length=50,
        blank=True,
        default='',
        help_text="Citizenship / national ID number from the latest KYC submission.",
    )

    # Use phone as the authentication field
    USERNAME_FIELD = 'phone'
    REQUIRED_FIELDS = []  # Remove email from required fields

    @property
    def is_account_approved(self):
        """Staff/superusers are always treated as approved for business activity."""
        if self.is_staff or self.is_superuser:
            return True
        return self.account_status == self.ACCOUNT_STATUS_APPROVED

    @property
    def is_kyc_approved(self):
        if self.is_staff or self.is_superuser:
            return True
        return self.kyc_status == self.KYC_STATUS_APPROVED

    @property
    def is_kyc_verified(self):
        """True when KYC is approved (no staff bypass — used for identity field locks)."""
        return self.kyc_status == self.KYC_STATUS_APPROVED

    @property
    def profile_locked(self):
        """Identity fields (name, DOB, citizenship, KYC docs) are locked after verification."""
        return self.is_kyc_verified

    def save(self, *args, **kwargs):
        # Automatically set username = phone for compatibility
        if self.phone:
            self.username = self.phone
        # Ensure is_active defaults to True for new users
        if self.pk is None and not hasattr(self, '_is_active_set'):
            self.is_active = True
        super().save(*args, **kwargs)
    
    def __str__(self):
        return self.phone
    
    objects = CustomUserManager()

    class Meta:
        verbose_name = "User"
        verbose_name_plural = "Users"


class Wallet(models.Model):
    """User wallet to store balance"""
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='wallet')
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0.00, validators=[MinValueValidator(0)])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.phone} - Rs. {self.balance}"

    class Meta:
        verbose_name = "Wallet"
        verbose_name_plural = "Wallets"


class WalletAdjustment(models.Model):
    """Admin wallet balance adjustment (manual load / debit) in transaction history."""
    ADJUSTMENT_TYPE_CHOICES = [
        ('credit', 'Manual Load (Add Fund)'),
        ('debit', 'Debit'),
    ]

    wallet = models.ForeignKey(
        Wallet, on_delete=models.CASCADE, related_name='adjustments',
    )
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='wallet_adjustments',
        help_text="Denormalized wallet owner for easy querying",
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Signed delta: positive for credit, negative for debit",
    )
    adjustment_type = models.CharField(max_length=10, choices=ADJUSTMENT_TYPE_CHOICES)
    balance_before = models.DecimalField(max_digits=10, decimal_places=2)
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='wallet_adjustments_created',
        help_text="Admin who performed the adjustment",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reference = models.CharField(max_length=100, unique=True, null=True, blank=True)

    def __str__(self):
        sign = '+' if self.amount >= 0 else ''
        return f"{self.user.phone} {sign}{self.amount} ({self.adjustment_type})"

    class Meta:
        verbose_name = "Wallet Adjustment"
        verbose_name_plural = "Wallet Adjustments"
        ordering = ['-created_at']


def default_app_config():
    """Default application-wide settings used by the Settings singleton."""
    return {
        'site': {
            'site_name': 'MySewa',
            'tagline': 'Digital wallet & bill payments',
            'support_email': '',
            'support_phone': '',
            'address': '',
            'currency': 'NPR',
            'timezone': 'Asia/Kathmandu',
        },
        'payment': {
            'deposits_enabled': True,
            'topups_enabled': True,
            'transfers_enabled': True,
            'remittances_enabled': True,
            'internet_bills_enabled': True,
            'data_packs_enabled': True,
            'min_deposit': 100,
            'max_deposit': 100000,
            'deposit_instructions': '',
        },
        'transactions': {
            'min_topup': 10,
            'max_topup': 5000,
            'min_transfer': 10,
            'max_transfer': 100000,
            'topup_charge_percent': 0,
            'transfer_charge_enabled': True,
            'transfer_charge_flat': 0,
            'cashback_enabled': True,
            'transfer_cashback_flat': 0,
            'transfer_cashback_percent': 0,
            'daily_transfer_limit': 200000,
            'auto_status_verified': False,
        },
        'notifications': {
            'email_on_deposit': True,
            'email_on_topup': False,
            'sms_on_deposit_approved': True,
            'email_on_wallet_credit': True,
            'email_on_wallet_debit': False,
            'email_on_transfer': False,
            'email_on_wallet_adjustment': True,
            'admin_alert_email': '',
            'notify_low_balance': False,
            'low_balance_threshold': 100,
        },
        'security': {
            'require_deposit_screenshot': True,
            'max_failed_logins': 5,
            'session_timeout_minutes': 60,
            'maintenance_mode': False,
            'maintenance_message': '',
            'allow_new_registrations': True,
        },
        'integrations': {
            'himalpay_api_key': '',
            'himalpay_base_url': 'https://api.himalpay.com.np/api/v1',
        },
        # Agent / branch defaults sent with SAMSARA_PAY (not collected from the user)
        'remittance': {
            'payout_location_name': 'MySewa',
            'payout_agent_state': 'Bagmati',
            'payout_agent_district': 'Kathmandu',
            'payout_agent_municipality': 'Kathmandu Metropolitan City',
            'payout_agent_ward_number': '10',
            'payout_agent_pan_number': '',
            'teller_contact': '',
            'payout_payment_type': 'Cash',
            'payout_payment_number': '',
            'payout_payment_bank_name': '',
            'payout_payment_bank_branch': '',
        },
    }


def merge_app_config(stored):
    """Deep-merge stored config onto defaults so new keys appear automatically."""
    defaults = default_app_config()
    if not isinstance(stored, dict):
        return defaults
    merged = {}
    for section, section_defaults in defaults.items():
        stored_section = stored.get(section) if isinstance(stored.get(section), dict) else {}
        merged[section] = {**section_defaults, **stored_section}
    # Preserve any custom top-level sections admins may have added
    for key, value in stored.items():
        if key not in merged:
            merged[key] = value
    return merged


class Settings(models.Model):
    """Singleton model for QR code, bank details, and global app configuration"""
    qr_code = models.ImageField(upload_to='settings/', null=True, blank=True, help_text="QR code image for deposits")
    logo = models.ImageField(
        upload_to='settings/logo/',
        null=True,
        blank=True,
        help_text="Brand logo used across the app and as the favicon",
    )
    bank_details = models.JSONField(default=dict, help_text="Bank account details in JSON format")
    config = models.JSONField(default=default_app_config, blank=True, help_text="Application-wide configuration")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # Ensure only one instance exists
        self.pk = 1
        self.config = merge_app_config(self.config)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # Prevent deletion
        pass

    @classmethod
    def load(cls):
        obj, created = cls.objects.get_or_create(pk=1)
        return obj

    def get_config(self):
        return merge_app_config(self.config)

    def __str__(self):
        return "Application Settings"

    class Meta:
        verbose_name = "Settings"
        verbose_name_plural = "Settings"


class Deposit(models.Model):
    """User deposit requests"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='deposits')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)])
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    screenshot_proof = models.ImageField(
        upload_to='deposits/',
        null=True,
        blank=True,
        help_text="Screenshot proof of payment (required when security.require_deposit_screenshot is on)",
    )
    note = models.TextField(blank=True, null=True, help_text="Optional note from user")
    rejection_reason = models.TextField(
        blank=True,
        null=True,
        help_text="Reason provided by admin when rejecting the deposit",
    )
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.phone} - Rs. {self.amount} - {self.status}"

    class Meta:
        verbose_name = "Deposit"
        verbose_name_plural = "Deposits"
        ordering = ['-created_at']


class TopupTransaction(models.Model):
    """Mobile topup transactions (NTC / NCELL via HimalPay)"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    PRODUCT_CHOICES = [
        (1, 'NTC'),
        (2, 'NCELL'),
    ]

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='topup_transactions')
    mobile_number = models.CharField(max_length=50, help_text="Mobile number to topup (any length)")
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)])
    product_id = models.IntegerField(choices=PRODUCT_CHOICES, help_text="1 for NTC, 2 for NCELL")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    service_hub_txn_id = models.CharField(
        max_length=100, blank=True, null=True,
        help_text="Provider transaction ID (HimalPay / legacy Service Hub)",
    )
    merchant_txn_id = models.CharField(max_length=100, unique=True, help_text="Unique merchant transaction ID")
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_debited = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    provider_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        product_name = dict(self.PRODUCT_CHOICES).get(self.product_id, 'Unknown')
        return f"{self.user.phone} - {product_name} - {self.mobile_number} - Rs. {self.amount}"

    class Meta:
        verbose_name = "Topup Transaction"
        verbose_name_plural = "Topup Transactions"
        ordering = ['-created_at']


class BankTransferTransaction(models.Model):
    """Outbound bank transfer via HimalPay"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='bank_transfers')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)])
    destination_bank = models.CharField(max_length=50, help_text="Bank code (e.g. LXBLNPKA)")
    destination_bank_name = models.CharField(max_length=150, blank=True, default='')
    destination_acc_no = models.CharField(max_length=50)
    destination_acc_name = models.CharField(max_length=150)
    is_destination_mobile = models.BooleanField(default=False)
    transaction_remarks = models.CharField(max_length=255, default='Fund Transfer')
    transaction_remarks_2 = models.CharField(max_length=255, blank=True, default='')
    transaction_remarks_3 = models.CharField(max_length=255, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    merchant_txn_id = models.CharField(max_length=100, unique=True)
    provider_txn_id = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_debited = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    verified = models.BooleanField(default=False)
    provider_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return (
            f"{self.user.phone} - {self.destination_bank} "
            f"{self.destination_acc_no} - Rs. {self.amount} - {self.status}"
        )

    class Meta:
        verbose_name = "Bank Transfer Transaction"
        verbose_name_plural = "Bank Transfer Transactions"
        ordering = ['-created_at']


class RemittanceTransaction(models.Model):
    """Inbound remittance payout via HimalPay Samsara (SAMSARA_GET / SAMSARA_PAY)."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='remittance_transactions',
    )
    ref_no = models.CharField(max_length=100, db_index=True, help_text="Remittance reference number")
    samsara_link_id = models.CharField(
        max_length=100, blank=True, default='',
        help_text="core_transaction_uuid from SAMSARA_GET",
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[MinValueValidator(0.01)],
        help_text="Payout amount in NPR (rupees)",
    )
    payout_currency = models.CharField(max_length=10, blank=True, default='NPR')

    sender_name = models.CharField(max_length=200, blank=True, default='')
    sender_address = models.CharField(max_length=255, blank=True, default='')
    sender_city = models.CharField(max_length=100, blank=True, default='')
    sender_country = models.CharField(max_length=100, blank=True, default='')
    receiver_name = models.CharField(max_length=200, blank=True, default='')
    receiver_phone = models.CharField(max_length=50, blank=True, default='')
    receiver_country = models.CharField(max_length=100, blank=True, default='')
    payment_type = models.CharField(max_length=50, blank=True, default='')
    txn_date = models.CharField(max_length=80, blank=True, default='')

    beneficiary_gender = models.CharField(max_length=20, blank=True, default='')
    beneficiary_nationality = models.CharField(max_length=50, blank=True, default='Nepali')
    beneficiary_state = models.CharField(max_length=100, blank=True, default='')
    beneficiary_district = models.CharField(max_length=100, blank=True, default='')
    beneficiary_municipality = models.CharField(max_length=150, blank=True, default='')
    beneficiary_ward_number = models.CharField(max_length=20, blank=True, default='')
    beneficiary_city = models.CharField(max_length=100, blank=True, default='')
    beneficiary_address = models.CharField(max_length=255, blank=True, default='')
    beneficiary_relation = models.CharField(max_length=50, blank=True, default='SELF')
    beneficiary_occupation = models.CharField(max_length=100, blank=True, default='')
    beneficiary_citizenship_number = models.CharField(max_length=100, blank=True, default='')
    beneficiary_citizenship_issuing_district = models.CharField(max_length=100, blank=True, default='')
    beneficiary_id_type = models.CharField(max_length=50, blank=True, default='Citizenship')
    beneficiary_id_number = models.CharField(max_length=100, blank=True, default='')
    beneficiary_id_issue_date = models.CharField(max_length=30, blank=True, default='')
    beneficiary_id_issue_by = models.CharField(max_length=100, blank=True, default='')
    beneficiary_mobile_no = models.CharField(max_length=50, blank=True, default='')
    beneficiary_dob = models.CharField(max_length=30, blank=True, default='')
    remittance_purpose = models.CharField(max_length=80, blank=True, default='FAMILY_SUPPORT')

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    merchant_txn_id = models.CharField(max_length=100, unique=True)
    provider_txn_id = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_credited = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    wallet_credited = models.BooleanField(default=False)
    lookup_response = models.JSONField(default=dict, blank=True)
    provider_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.phone} - {self.ref_no} - Rs. {self.amount} - {self.status}"

    class Meta:
        verbose_name = "Remittance Transaction"
        verbose_name_plural = "Remittance Transactions"
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['ref_no'],
                condition=models.Q(status='success'),
                name='unique_successful_remittance_ref_no',
            ),
        ]


class InternetBillTransaction(models.Model):
    """Internet / ISP bill payment via HimalPay."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='internet_bills',
    )
    isp_id = models.CharField(max_length=50)
    isp_name = models.CharField(max_length=100)
    customer_id = models.CharField(max_length=100)
    customer_name = models.CharField(max_length=200, blank=True, default='')
    package_name = models.CharField(max_length=255, blank=True, default='')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)])
    pay_service = models.CharField(max_length=80)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    merchant_txn_id = models.CharField(max_length=100, unique=True)
    service_hub_txn_id = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_debited = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    inquiry_response = models.JSONField(default=dict, blank=True)
    pay_payload = models.JSONField(default=dict, blank=True)
    provider_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.phone} - {self.isp_name} - {self.customer_id} - Rs. {self.amount}"

    class Meta:
        verbose_name = "Internet Bill Transaction"
        verbose_name_plural = "Internet Bill Transactions"
        ordering = ['-created_at']


class DataPackTransaction(models.Model):
    """Mobile data pack top-up (NTC / NCELL) via HimalPay."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    OPERATOR_CHOICES = [
        ('NTC', 'NTC'),
        ('NCELL', 'NCELL'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='data_pack_transactions',
    )
    operator = models.CharField(max_length=10, choices=OPERATOR_CHOICES)
    mobile_number = models.CharField(max_length=50)
    package_name = models.CharField(max_length=255, blank=True, default='')
    package_id = models.CharField(max_length=50, blank=True, default='')
    product_code = models.CharField(max_length=100, blank=True, default='')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)])
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    merchant_txn_id = models.CharField(max_length=100, unique=True)
    service_hub_txn_id = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_debited = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    inquiry_response = models.JSONField(default=dict, blank=True)
    provider_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.phone} - {self.operator} Data - {self.mobile_number} - Rs. {self.amount}"

    class Meta:
        verbose_name = "Data Pack Transaction"
        verbose_name_plural = "Data Pack Transactions"
        ordering = ['-created_at']


class UserFeeConfig(models.Model):
    """Per-user overrides for transfer / top-up platform charges (null = use global)."""

    user = models.OneToOneField(
        CustomUser, on_delete=models.CASCADE, related_name='fee_config',
    )
    transfer_charge_enabled = models.BooleanField(
        null=True,
        blank=True,
        help_text="null = use global Settings.config",
    )
    transfer_charge_flat = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
    )
    transfer_charge_percent = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
    )
    topup_charge_percent = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Fee config — {self.user.phone}'

    class Meta:
        verbose_name = 'User Fee Config'
        verbose_name_plural = 'User Fee Configs'


class DeviceToken(models.Model):
    """FCM / web push device token registered by the mobile shell or browser."""

    PLATFORM_ANDROID = 'android'
    PLATFORM_IOS = 'ios'
    PLATFORM_WEB = 'web'
    PLATFORM_UNKNOWN = 'unknown'
    PLATFORM_CHOICES = [
        (PLATFORM_ANDROID, 'Android'),
        (PLATFORM_IOS, 'iOS'),
        (PLATFORM_WEB, 'Web'),
        (PLATFORM_UNKNOWN, 'Unknown'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='device_tokens',
    )
    token = models.CharField(max_length=512, unique=True, db_index=True)
    platform = models.CharField(
        max_length=20, choices=PLATFORM_CHOICES, default=PLATFORM_UNKNOWN,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.phone} ({self.platform})'

    class Meta:
        verbose_name = 'Device Token'
        verbose_name_plural = 'Device Tokens'
        ordering = ['-updated_at']


class KYCSubmission(models.Model):
    """User KYC verification submission (supports resubmit after rejection)."""

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='kyc_submissions',
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True,
    )
    citizenship_number = models.CharField(max_length=50)
    rejection_reason = models.TextField(blank=True, default='')
    reviewed_by = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kyc_reviews',
        help_text='Admin who approved or rejected this submission',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.phone} — KYC {self.status}'

    class Meta:
        verbose_name = 'KYC Submission'
        verbose_name_plural = 'KYC Submissions'
        ordering = ['-created_at']


class KYCDocument(models.Model):
    """Identity document image attached to a KYC submission."""

    DOC_CITIZENSHIP = 'citizenship'
    DOC_PASSPORT = 'passport'
    DOC_DRIVING_LICENSE = 'driving_license'
    DOC_NATIONAL_ID = 'national_id'
    DOC_OTHER = 'other'
    DOCUMENT_TYPE_CHOICES = [
        (DOC_CITIZENSHIP, 'Citizenship'),
        (DOC_PASSPORT, 'Passport'),
        (DOC_DRIVING_LICENSE, 'Driving License'),
        (DOC_NATIONAL_ID, 'National ID'),
        (DOC_OTHER, 'Other'),
    ]

    SIDE_FRONT = 'front'
    SIDE_BACK = 'back'
    SIDE_SINGLE = 'single'
    SIDE_CHOICES = [
        (SIDE_FRONT, 'Front'),
        (SIDE_BACK, 'Back'),
        (SIDE_SINGLE, 'Single'),
    ]

    submission = models.ForeignKey(
        KYCSubmission, on_delete=models.CASCADE, related_name='documents',
    )
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPE_CHOICES)
    side = models.CharField(max_length=10, choices=SIDE_CHOICES, default=SIDE_SINGLE)
    file = models.ImageField(
        upload_to='kyc/',
        help_text='Scanned or photographed identity document',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.submission_id} — {self.document_type}/{self.side}'

    class Meta:
        verbose_name = 'KYC Document'
        verbose_name_plural = 'KYC Documents'
        ordering = ['uploaded_at', 'id']


class KYCAuditLog(models.Model):
    """Audit trail for KYC create / update / review actions."""

    ACTION_CREATED = 'created'
    ACTION_UPDATED = 'updated'
    ACTION_DOCUMENT_UPLOADED = 'document_uploaded'
    ACTION_APPROVED = 'approved'
    ACTION_REJECTED = 'rejected'
    ACTION_STATUS_CHANGED = 'status_changed'
    ACTION_PROFILE_UPDATED = 'profile_updated'
    ACTION_PROFILE_LOCK_BLOCKED = 'profile_lock_blocked'
    ACTION_CHOICES = [
        (ACTION_CREATED, 'Created'),
        (ACTION_UPDATED, 'Updated'),
        (ACTION_DOCUMENT_UPLOADED, 'Document Uploaded'),
        (ACTION_APPROVED, 'Approved'),
        (ACTION_REJECTED, 'Rejected'),
        (ACTION_STATUS_CHANGED, 'Status Changed'),
        (ACTION_PROFILE_UPDATED, 'Profile Updated'),
        (ACTION_PROFILE_LOCK_BLOCKED, 'Profile Lock Blocked'),
    ]

    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='kyc_audit_logs',
    )
    submission = models.ForeignKey(
        KYCSubmission,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    actor = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kyc_actions_performed',
        help_text='User or admin who performed the action',
    )
    old_status = models.CharField(max_length=20, blank=True, default='')
    new_status = models.CharField(max_length=20, blank=True, default='')
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.user.phone} — {self.action} @ {self.created_at}'

    class Meta:
        verbose_name = 'KYC Audit Log'
        verbose_name_plural = 'KYC Audit Logs'
        ordering = ['-created_at']
