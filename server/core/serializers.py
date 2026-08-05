"""
DRF Serializers for all models
"""
import re
from decimal import Decimal
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.hashers import make_password
from django.contrib.auth import get_user_model
from .models import (
    Wallet,
    WalletAdjustment,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    DataPackTransaction,
    DeviceToken,
    UserFeeConfig,
)

User = get_user_model()

_TRANSACTION_PIN_RE = re.compile(r'^\d{4,6}$')


def validate_transaction_pin_value(value):
    """Ensure transaction PIN is 4–6 numeric digits."""
    pin = (value or '').strip()
    if not _TRANSACTION_PIN_RE.match(pin):
        raise serializers.ValidationError(
            'Transaction PIN must be 4 to 6 digits.'
        )
    return pin


class UserSerializer(serializers.ModelSerializer):
    """User serializer for registration and profile - phone number as username"""
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True, required=True, label="Confirm Password")
    transaction_pin = serializers.CharField(write_only=True, required=True, min_length=4, max_length=6)
    has_transaction_pin = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name',
            'password', 'password2', 'transaction_pin', 'has_transaction_pin',
        )
        extra_kwargs = {
            'phone': {'required': True},
            # Model allows blank/null for legacy rows; registration always requires email.
            'email': {'required': True, 'allow_blank': False, 'allow_null': False},
            'first_name': {'required': False},
            'last_name': {'required': False},
        }

    def get_has_transaction_pin(self, obj):
        return bool(obj.transaction_pin)

    def validate_email(self, value):
        email = (value or '').strip()
        if not email:
            raise serializers.ValidationError('Email address is required.')
        return email

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({"password": "Password fields didn't match."})
        return attrs

    def create(self, validated_data):
        validated_data.pop('password2')
        phone = validated_data.pop('phone')
        raw_pin = validated_data.pop('transaction_pin')
        # Self-registration starts as Pending until Super Admin activates the account.
        user = User.objects.create_user(
            phone,  # This maps to USERNAME_FIELD which is 'phone'
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            account_status=User.ACCOUNT_STATUS_PENDING,
            transaction_pin=make_password(raw_pin),
        )
        # Wallet will be created automatically via signal
        return user


class UserProfileSerializer(serializers.ModelSerializer):
    """User profile serializer for reading profile information (no password fields)"""
    avatar_url = serializers.SerializerMethodField()
    has_transaction_pin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'avatar', 'avatar_url',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'has_transaction_pin',
            'date_joined', 'last_login',
        )
        read_only_fields = (
            'id', 'phone', 'avatar', 'is_active', 'is_staff', 'is_superuser',
            'account_status', 'has_transaction_pin', 'date_joined', 'last_login',
        )

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.avatar.url)
        return obj.avatar.url

    def get_has_transaction_pin(self, obj):
        return bool(obj.transaction_pin)


class AdminUserSerializer(serializers.ModelSerializer):
    """Admin user list with wallet balance"""
    avatar_url = serializers.SerializerMethodField()
    wallet_balance = serializers.SerializerMethodField()
    wallet_id = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'avatar', 'avatar_url',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'date_joined', 'last_login',
            'wallet_id', 'wallet_balance',
        )

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.avatar.url)
        return obj.avatar.url

    def get_wallet_balance(self, obj):
        wallet = getattr(obj, 'wallet', None)
        if wallet is None:
            return '0.00'
        return str(wallet.balance)

    def get_wallet_id(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return wallet.id if wallet else None


class AdminUserWriteSerializer(serializers.ModelSerializer):
    """Create / update users from the admin console (password optional on update)."""
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True,
    )
    password2 = serializers.CharField(
        write_only=True, required=False, allow_blank=True, label='Confirm Password',
    )

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'password', 'password2',
        )
        extra_kwargs = {
            'phone': {'required': True},
            # Required on create (see validate); optional on edit for legacy blank emails.
            'email': {'required': False, 'allow_blank': True, 'allow_null': True},
            'first_name': {'required': False, 'allow_blank': True},
            'last_name': {'required': False, 'allow_blank': True},
            'is_active': {'required': False},
            'is_staff': {'required': False},
            'is_superuser': {'required': False},
            'account_status': {'required': False},
        }

    def validate_phone(self, value):
        phone = (value or '').strip()
        if not phone:
            raise serializers.ValidationError('Phone number is required.')
        qs = User.objects.filter(phone=phone)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('This phone number is already registered.')
        return phone

    def validate_email(self, value):
        if value is None:
            return value
        email = value.strip()
        if not email:
            return ''
        return email

    def validate(self, attrs):
        password = attrs.get('password') or ''
        password2 = attrs.get('password2') or ''
        creating = self.instance is None

        if creating:
            email = (attrs.get('email') or '').strip()
            if not email:
                raise serializers.ValidationError({'email': 'Email address is required.'})
            attrs['email'] = email

        if creating and not password:
            raise serializers.ValidationError({'password': 'Password is required when creating a user.'})

        if password or password2:
            if password != password2:
                raise serializers.ValidationError({'password': "Password fields didn't match."})
            if not password:
                raise serializers.ValidationError({'password': 'Password cannot be empty.'})
            # Match change-password: min 8 chars only (admins often set temporary passwords)
            if len(password) < 8:
                raise serializers.ValidationError(
                    {'password': 'Password must be at least 8 characters.'}
                )

        return attrs

    def create(self, validated_data):
        validated_data.pop('password2', None)
        password = validated_data.pop('password')
        phone = validated_data.pop('phone')
        # Admin-created users default to Active unless explicitly set to Pending.
        validated_data.setdefault('account_status', User.ACCOUNT_STATUS_APPROVED)
        return User.objects.create_user(phone, password=password, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('password2', None)
        password = validated_data.pop('password', None) or None

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()
        return instance


class AdminWalletSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)

    class Meta:
        model = Wallet
        fields = (
            'id', 'user_id', 'phone', 'first_name', 'last_name',
            'balance', 'created_at', 'updated_at',
        )


class AdminWalletWriteSerializer(serializers.ModelSerializer):
    """Staff-only wallet balance update (legacy balance-set payload)."""

    class Meta:
        model = Wallet
        fields = ('balance',)


class WalletAdjustmentSerializer(serializers.ModelSerializer):
    """Wallet adjustment as seen in transaction history."""
    created_by_phone = serializers.CharField(
        source='created_by.phone', read_only=True, allow_null=True,
    )
    adjustment_type_display = serializers.CharField(
        source='get_adjustment_type_display', read_only=True,
    )
    # Absolute magnitude for display (amount field is signed).
    display_amount = serializers.SerializerMethodField()

    class Meta:
        model = WalletAdjustment
        fields = (
            'id', 'wallet', 'user', 'amount', 'display_amount',
            'adjustment_type', 'adjustment_type_display',
            'balance_before', 'balance_after', 'reason',
            'created_by', 'created_by_phone', 'created_at', 'reference',
        )
        read_only_fields = fields

    def get_display_amount(self, obj):
        return f"{abs(obj.amount):.2f}"


class WalletAdjustmentWriteSerializer(serializers.Serializer):
    """
    Prefer auditable adjustment payload.
    Also accepts legacy `{balance, reason}` to set an absolute balance.
    """
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=Decimal('0.01'),
    )
    adjustment_type = serializers.ChoiceField(
        choices=('credit', 'debit'), required=False,
    )
    balance = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=Decimal('0'),
    )
    reason = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)
    reference = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=100,
    )

    def validate(self, attrs):
        has_adjustment = (
            attrs.get('amount') is not None and attrs.get('adjustment_type')
        )
        has_balance = attrs.get('balance') is not None
        if not has_adjustment and not has_balance:
            raise serializers.ValidationError(
                "Provide either {amount, adjustment_type, reason} or {balance, reason}."
            )
        if has_adjustment and has_balance:
            raise serializers.ValidationError(
                "Provide either adjustment fields or balance, not both."
            )
        return attrs


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    """User profile update serializer (email, name, avatar)"""

    class Meta:
        model = User
        fields = ('email', 'first_name', 'last_name', 'avatar')
        extra_kwargs = {
            'email': {'required': False, 'allow_blank': True},
            'first_name': {'required': False, 'allow_blank': True},
            'last_name': {'required': False, 'allow_blank': True},
            'avatar': {'required': False},
        }


class ChangePasswordSerializer(serializers.Serializer):
    """Change password serializer — matches app rules (min 8 chars, must match)."""
    current_password = serializers.CharField(required=True, write_only=True)
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)
    confirm_password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return attrs


class SetTransactionPinSerializer(serializers.Serializer):
    """Set transaction PIN for authenticated users who do not yet have one."""
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)
    confirm_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_confirm_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate(self, attrs):
        if attrs['transaction_pin'] != attrs['confirm_pin']:
            raise serializers.ValidationError(
                {'confirm_pin': 'PIN fields did not match.'}
            )
        return attrs


class VerifyTransactionPinSerializer(serializers.Serializer):
    """Client-side pre-check for transaction PIN before submitting a payment."""
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)


class ForgotPasswordSerializer(serializers.Serializer):
    phone = serializers.CharField(required=True, max_length=50)

    def validate_phone(self, value):
        phone = (value or '').strip()
        if not phone:
            raise serializers.ValidationError('Phone number is required.')
        return phone


class ResetPasswordSerializer(serializers.Serializer):
    phone = serializers.CharField(required=True, max_length=50)
    otp = serializers.CharField(required=True, max_length=10)
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)
    confirm_password = serializers.CharField(required=True, write_only=True)

    def validate_phone(self, value):
        return (value or '').strip()

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return attrs


class ChangePhoneSerializer(serializers.Serializer):
    """Change phone number serializer — requires current password"""
    new_phone = serializers.CharField(required=True, max_length=50)
    current_password = serializers.CharField(required=True, write_only=True)

    def validate_new_phone(self, value):
        phone = value.strip()
        if not phone:
            raise serializers.ValidationError('Phone number is required.')
        user = self.context['request'].user
        if phone == user.phone:
            raise serializers.ValidationError('This is already your current phone number.')
        if User.objects.filter(phone=phone).exclude(pk=user.pk).exists():
            raise serializers.ValidationError('This phone number is already registered.')
        return phone


class WalletSerializer(serializers.ModelSerializer):
    """Wallet serializer"""
    user = serializers.StringRelatedField(read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)

    class Meta:
        model = Wallet
        fields = ('id', 'user', 'phone', 'balance', 'created_at', 'updated_at')
        read_only_fields = ('id', 'user', 'balance', 'created_at', 'updated_at')


class DepositSerializer(serializers.ModelSerializer):
    """Deposit request serializer"""
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Deposit
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'amount', 'status', 'status_display',
            'screenshot_proof', 'note', 'rejection_reason',
            'balance_before', 'balance_after', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'status', 'rejection_reason',
            'balance_before', 'balance_after', 'created_at', 'updated_at',
        )

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class DepositCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating deposit requests — limits come from Settings.config."""
    screenshot_proof = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = Deposit
        fields = ('amount', 'screenshot_proof', 'note')

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        from .services.app_config import get_app_config, validate_amount_bounds
        payment = get_app_config().get('payment') or {}
        err = validate_amount_bounds(
            value,
            min_amount=payment.get('min_deposit', 100),
            max_amount=payment.get('max_deposit', 100000),
            label='Deposit',
        )
        if err:
            raise serializers.ValidationError(err)
        return value

    def validate(self, attrs):
        from .services.app_config import get_app_config
        security = get_app_config().get('security') or {}
        require_shot = security.get('require_deposit_screenshot', True)
        if require_shot and not attrs.get('screenshot_proof'):
            raise serializers.ValidationError({
                'screenshot_proof': 'Screenshot proof is required for deposit requests.',
            })
        return attrs


class SettingsSerializer(serializers.ModelSerializer):
    """Settings serializer"""
    qr_code_url = serializers.SerializerMethodField()
    logo_url = serializers.SerializerMethodField()
    config = serializers.SerializerMethodField()

    class Meta:
        model = Settings
        fields = (
            'id', 'qr_code', 'qr_code_url', 'logo', 'logo_url', 'bank_details', 'config',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def _absolute_media_url(self, file_field):
        if not file_field:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(file_field.url)
        return file_field.url

    def get_qr_code_url(self, obj):
        return self._absolute_media_url(obj.qr_code)

    def get_logo_url(self, obj):
        return self._absolute_media_url(obj.logo)

    def get_config(self, obj):
        return obj.get_config()


class TopupTransactionSerializer(serializers.ModelSerializer):
    """Topup transaction serializer"""
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    product_name = serializers.CharField(source='get_product_id_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = TopupTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'mobile_number', 'amount', 'product_id',
            'product_name', 'status', 'status_display', 'service_hub_txn_id',
            'merchant_txn_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'status', 'service_hub_txn_id', 'merchant_txn_id',
            'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after', 'reference_id',
            'created_at', 'updated_at',
        )

    def validate_mobile_number(self, value):
        if not value or value.strip() == '':
            raise serializers.ValidationError("Mobile number is required.")
        return value.strip()

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        if value < 10:
            raise serializers.ValidationError("Minimum topup amount is Rs. 10.")
        return value


class AdminTopupSerializer(TopupTransactionSerializer):
    """Staff top-up detail — includes raw provider response for support."""

    class Meta(TopupTransactionSerializer.Meta):
        fields = TopupTransactionSerializer.Meta.fields + ('provider_response',)


class TopupCreateSerializer(serializers.Serializer):
    """Serializer for creating topup requests"""
    mobile_number = serializers.CharField(max_length=50, required=True)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=True)
    product_id = serializers.IntegerField(required=True)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_mobile_number(self, value):
        if not value or value.strip() == '':
            raise serializers.ValidationError("Mobile number is required.")
        digits = ''.join(ch for ch in value.strip() if ch.isdigit())
        # Strip Nepal country code so prefix checks use the 10-digit local number
        if digits.startswith('977') and len(digits) >= 13:
            digits = digits[3:]
        if len(digits) < 10:
            raise serializers.ValidationError("Enter a valid mobile number (at least 10 digits).")
        if len(digits) > 10:
            digits = digits[-10:]
        return digits

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        from .services.app_config import get_app_config, validate_amount_bounds
        tx = get_app_config().get('transactions') or {}
        err = validate_amount_bounds(
            value,
            min_amount=tx.get('min_topup', 10),
            max_amount=tx.get('max_topup', 5000),
            label='Top-up',
        )
        if err:
            raise serializers.ValidationError(err)
        return value

    def validate(self, attrs):
        product_id = attrs.get('product_id')
        mobile = attrs.get('mobile_number', '')
        # Align with Nepal GSM ranges used by HimalPay NTC / NCELL top-up
        ntc_prefixes = ('984', '985', '986', '974', '975', '976')
        ncell_prefixes = ('980', '981', '982', '970')
        if product_id == 1 and not mobile.startswith(ntc_prefixes):
            raise serializers.ValidationError({'mobile_number': 'Invalid Number'})
        if product_id == 2 and not mobile.startswith(ncell_prefixes):
            raise serializers.ValidationError({'mobile_number': 'Invalid Number'})
        return attrs

    def validate_product_id(self, value):
        if value not in [1, 2]:
            raise serializers.ValidationError("Product ID must be 1 (NTC) or 2 (NCELL).")
        return value


class BankTransferTransactionSerializer(serializers.ModelSerializer):
    """Bank transfer transaction serializer"""
    user = serializers.StringRelatedField(read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = BankTransferTransaction
        fields = (
            'id', 'user', 'phone', 'amount', 'destination_bank', 'destination_bank_name',
            'destination_acc_no', 'destination_acc_name', 'is_destination_mobile',
            'transaction_remarks', 'transaction_remarks_2', 'transaction_remarks_3',
            'status', 'status_display', 'merchant_txn_id', 'provider_txn_id',
            'reference_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after', 'verified',
            'created_at', 'updated_at',
        )
        read_only_fields = fields


class BankAccountVerifySerializer(serializers.Serializer):
    """Verify destination bank account before transfer"""
    bank_code = serializers.CharField(max_length=50, required=True)
    # Optional for phone/mobile transfers — provider returns the registered name.
    account_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    account_number = serializers.CharField(max_length=50, required=True)
    is_mobile = serializers.BooleanField(required=False, default=False)
    merchant_txn_id = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate_bank_code(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Bank code is required.")
        return value.strip().upper()

    def validate_account_name(self, value):
        return (value or '').strip()

    def validate_account_number(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Account number is required.")
        return value.strip()

    def validate(self, attrs):
        is_mobile = bool(attrs.get('is_mobile'))
        name = (attrs.get('account_name') or '').strip()
        if not is_mobile and not name:
            raise serializers.ValidationError(
                {'account_name': 'Account name is required for bank transfers.'}
            )
        attrs['account_name'] = name
        return attrs


class BankTransferCreateSerializer(serializers.Serializer):
    """Create / process bank transfer"""
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=True)
    destination_bank = serializers.CharField(max_length=50, required=True)
    destination_bank_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    destination_acc_no = serializers.CharField(max_length=50, required=True)
    # Optional for phone transfers — filled from provider verify when blank.
    destination_acc_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, default=''
    )
    is_destination_mobile = serializers.BooleanField(required=False, default=False)
    transaction_remarks = serializers.CharField(max_length=255, required=False, default='Fund Transfer')
    transaction_remarks_2 = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    transaction_remarks_3 = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    merchant_txn_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        from .services.app_config import get_app_config, validate_amount_bounds
        tx = get_app_config().get('transactions') or {}
        err = validate_amount_bounds(
            value,
            min_amount=tx.get('min_transfer', 10),
            max_amount=tx.get('max_transfer', 100000),
            label='Transfer',
        )
        if err:
            raise serializers.ValidationError(err)
        return value

    def validate_destination_bank(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Destination bank code is required.")
        return value.strip().upper()

    def validate_destination_acc_no(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Destination account number is required.")
        return value.strip()

    def validate_destination_acc_name(self, value):
        return (value or '').strip()

    def validate(self, attrs):
        is_mobile = bool(attrs.get('is_destination_mobile'))
        name = (attrs.get('destination_acc_name') or '').strip()
        if not is_mobile and not name:
            raise serializers.ValidationError(
                {'destination_acc_name': 'Destination account name is required.'}
            )
        attrs['destination_acc_name'] = name
        return attrs


class CalculateChargeSerializer(serializers.Serializer):
    """Calculate HimalPay charge/cashback for a service"""
    wallet_service_name = serializers.ChoiceField(
        choices=['NTC', 'NCELL', 'BANK_TRANSFER'],
        required=True,
    )
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=True)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class TransactionStatusSerializer(serializers.Serializer):
    merchant_transaction_id = serializers.CharField(max_length=100, required=True)


class RemittanceTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = RemittanceTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'ref_no', 'samsara_link_id', 'amount', 'payout_currency',
            'sender_name', 'sender_address', 'sender_city', 'sender_country',
            'receiver_name', 'receiver_phone', 'receiver_country',
            'payment_type', 'txn_date',
            'beneficiary_gender', 'beneficiary_nationality',
            'beneficiary_state', 'beneficiary_district', 'beneficiary_municipality',
            'beneficiary_ward_number', 'beneficiary_city', 'beneficiary_address',
            'beneficiary_relation', 'beneficiary_occupation',
            'beneficiary_citizenship_number', 'beneficiary_citizenship_issuing_district',
            'beneficiary_id_type', 'beneficiary_id_number',
            'beneficiary_id_issue_date', 'beneficiary_id_issue_by',
            'beneficiary_mobile_no', 'beneficiary_dob', 'remittance_purpose',
            'status', 'status_display', 'merchant_txn_id', 'provider_txn_id',
            'reference_id', 'charge', 'cashback', 'total_credited',
            'balance_before', 'balance_after',
            'wallet_credited', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminRemittanceSerializer(RemittanceTransactionSerializer):
    class Meta(RemittanceTransactionSerializer.Meta):
        fields = RemittanceTransactionSerializer.Meta.fields + (
            'lookup_response', 'provider_response',
        )


class RemittanceLookupSerializer(serializers.Serializer):
    ref_no = serializers.CharField(max_length=100, required=True)

    def validate_ref_no(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Remittance reference number is required.')
        return value


class RemittanceReceiveSerializer(serializers.Serializer):
    ref_no = serializers.CharField(max_length=100, required=True)
    samsara_link_id = serializers.CharField(max_length=100, required=True)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=True)
    payout_currency = serializers.CharField(max_length=10, required=False, allow_blank=True, default='NPR')
    sender_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    sender_address = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    sender_city = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    sender_country = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    receiver_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    receiver_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    receiver_country = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    payment_type = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    send_agent = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    txn_date = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    beneficiary_gender = serializers.CharField(max_length=20, required=True)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)
    beneficiary_nationality = serializers.CharField(max_length=50, required=False, default='Nepali')
    beneficiary_state = serializers.CharField(max_length=100, required=True)
    beneficiary_district = serializers.CharField(max_length=100, required=True)
    beneficiary_municipality = serializers.CharField(max_length=150, required=True)
    beneficiary_ward_number = serializers.CharField(max_length=20, required=True)
    beneficiary_city = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    beneficiary_address = serializers.CharField(max_length=255, required=True)
    beneficiary_relation = serializers.CharField(max_length=50, required=False, default='SELF')
    beneficiary_occupation = serializers.CharField(max_length=100, required=True)
    beneficiary_citizenship_number = serializers.CharField(max_length=100, required=True)
    beneficiary_citizenship_issuing_district = serializers.CharField(max_length=100, required=True)
    beneficiary_id_type = serializers.CharField(max_length=50, required=False, default='Citizenship')
    beneficiary_id_number = serializers.CharField(max_length=100, required=True)
    beneficiary_id_issue_date = serializers.CharField(max_length=30, required=True)
    beneficiary_id_issue_by = serializers.CharField(max_length=100, required=True)
    beneficiary_mobile_no = serializers.CharField(max_length=50, required=True)
    beneficiary_dob = serializers.CharField(max_length=30, required=True)
    remittance_purpose = serializers.CharField(max_length=80, required=False, default='FAMILY_SUPPORT')

    def validate_ref_no(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Remittance reference number is required.')
        return value

    def validate_samsara_link_id(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Samsara link ID is required. Look up the remittance first.')
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

    def _require_text(self, value, label):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError(f'{label} is required.')
        return value

    def validate_beneficiary_gender(self, value):
        return self._require_text(value, 'Gender')

    def validate_beneficiary_state(self, value):
        return self._require_text(value, 'State / province')

    def validate_beneficiary_district(self, value):
        return self._require_text(value, 'District')

    def validate_beneficiary_municipality(self, value):
        return self._require_text(value, 'Municipality')

    def validate_beneficiary_ward_number(self, value):
        return self._require_text(value, 'Ward number')

    def validate_beneficiary_address(self, value):
        return self._require_text(value, 'Address')

    def validate_beneficiary_occupation(self, value):
        return self._require_text(value, 'Occupation')

    def validate_beneficiary_citizenship_number(self, value):
        return self._require_text(value, 'Citizenship number')

    def validate_beneficiary_citizenship_issuing_district(self, value):
        return self._require_text(value, 'Citizenship issuing district')

    def validate_beneficiary_id_number(self, value):
        return self._require_text(value, 'ID number')

    def validate_beneficiary_id_issue_date(self, value):
        return self._require_text(value, 'ID issue date')

    def validate_beneficiary_id_issue_by(self, value):
        return self._require_text(value, 'ID issued by')

    def validate_beneficiary_mobile_no(self, value):
        return self._require_text(value, 'Mobile number')

    def validate_beneficiary_dob(self, value):
        return self._require_text(value, 'Date of birth')


class InternetBillTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = InternetBillTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'isp_id', 'isp_name', 'customer_id', 'customer_name', 'package_name',
            'amount', 'status', 'status_display', 'merchant_txn_id',
            'service_hub_txn_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class InternetBillInquirySerializer(serializers.Serializer):
    isp_id = serializers.CharField(max_length=50)
    customer_id = serializers.CharField(max_length=100)

    def validate_customer_id(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Customer ID is required.')
        return cleaned


class InternetBillPaySerializer(serializers.Serializer):
    isp_id = serializers.CharField(max_length=50)
    customer_id = serializers.CharField(max_length=100)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    package_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    pay_data = serializers.JSONField()
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value


class DataPackTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = DataPackTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'operator', 'mobile_number', 'package_name', 'package_id',
            'product_code', 'amount', 'status', 'status_display',
            'merchant_txn_id', 'service_hub_txn_id', 'charge', 'cashback',
            'total_debited', 'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class DataPackInquirySerializer(serializers.Serializer):
    operator = serializers.ChoiceField(choices=['NTC', 'NCELL'])
    mobile_number = serializers.CharField(max_length=50, required=False, allow_blank=True)


class DataPackPaySerializer(serializers.Serializer):
    operator = serializers.ChoiceField(choices=['NTC', 'NCELL'])
    mobile_number = serializers.CharField(max_length=50)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    package_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    package_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    product_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=6)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_mobile_number(self, value):
        digits = ''.join(ch for ch in (value or '').strip() if ch.isdigit())
        if digits.startswith('977') and len(digits) >= 13:
            digits = digits[3:]
        if len(digits) < 10:
            raise serializers.ValidationError('Enter a valid mobile number.')
        return digits[-10:]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

class UserFeeConfigSerializer(serializers.ModelSerializer):
    """Per-user fee overrides. Null fields mean use global Settings.config defaults."""

    transfer_charge_enabled = serializers.BooleanField(required=False, allow_null=True)
    transfer_charge_flat = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
    )
    transfer_charge_percent = serializers.DecimalField(
        max_digits=7, decimal_places=4, required=False, allow_null=True,
    )
    topup_charge_percent = serializers.DecimalField(
        max_digits=7, decimal_places=4, required=False, allow_null=True,
    )

    class Meta:
        model = UserFeeConfig
        fields = (
            'transfer_charge_enabled',
            'transfer_charge_flat',
            'transfer_charge_percent',
            'topup_charge_percent',
            'updated_at',
        )
        read_only_fields = ('updated_at',)


class DeviceTokenSerializer(serializers.Serializer):
    """Register or update an FCM / web push device token."""

    token = serializers.CharField(max_length=512)
    platform = serializers.ChoiceField(
        choices=DeviceToken.PLATFORM_CHOICES,
        required=False,
        default=DeviceToken.PLATFORM_UNKNOWN,
    )

    def validate_token(self, value):
        token = (value or '').strip()
        if len(token) < 8:
            raise serializers.ValidationError('Device token is too short.')
        return token

    def create(self, validated_data):
        user = self.context['request'].user
        token = validated_data['token']
        platform = validated_data.get('platform') or DeviceToken.PLATFORM_UNKNOWN
        obj, _created = DeviceToken.objects.update_or_create(
            token=token,
            defaults={'user': user, 'platform': platform},
        )
        return obj

