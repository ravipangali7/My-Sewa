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
    
    # Use phone as the authentication field
    USERNAME_FIELD = 'phone'
    REQUIRED_FIELDS = []  # Remove email from required fields
    
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


class Settings(models.Model):
    """Singleton model for QR code and bank details"""
    qr_code = models.ImageField(upload_to='settings/', null=True, blank=True, help_text="QR code image for deposits")
    bank_details = models.JSONField(default=dict, help_text="Bank account details in JSON format")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # Ensure only one instance exists
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # Prevent deletion
        pass

    @classmethod
    def load(cls):
        obj, created = cls.objects.get_or_create(pk=1)
        return obj

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
    screenshot_proof = models.ImageField(upload_to='deposits/', help_text="Screenshot proof of payment")
    note = models.TextField(blank=True, null=True, help_text="Optional note from user")
    rejection_reason = models.TextField(
        blank=True,
        null=True,
        help_text="Reason provided by admin when rejecting the deposit",
    )
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
