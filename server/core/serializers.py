"""
DRF Serializers for all models
"""
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth import get_user_model
from .models import Wallet, Deposit, Settings, TopupTransaction, BankTransferTransaction

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """User serializer for registration and profile - phone number as username"""
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True, required=True, label="Confirm Password")

    class Meta:
        model = User
        fields = ('id', 'phone', 'email', 'first_name', 'last_name', 'password', 'password2')
        extra_kwargs = {
            'phone': {'required': True},
            'email': {'required': False},
            'first_name': {'required': False},
            'last_name': {'required': False},
        }

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({"password": "Password fields didn't match."})
        return attrs

    def create(self, validated_data):
        validated_data.pop('password2')
        phone = validated_data.pop('phone')
        # Self-registration starts as Pending until Super Admin activates the account.
        user = User.objects.create_user(
            phone,  # This maps to USERNAME_FIELD which is 'phone'
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            account_status=User.ACCOUNT_STATUS_PENDING,
        )
        # Wallet will be created automatically via signal
        return user


class UserProfileSerializer(serializers.ModelSerializer):
    """User profile serializer for reading profile information (no password fields)"""
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'avatar', 'avatar_url',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'date_joined', 'last_login',
        )
        read_only_fields = (
            'id', 'phone', 'avatar', 'is_active', 'is_staff', 'is_superuser',
            'account_status', 'date_joined', 'last_login',
        )

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.avatar.url)
        return obj.avatar.url


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

    def validate(self, attrs):
        password = attrs.get('password') or ''
        password2 = attrs.get('password2') or ''
        creating = self.instance is None

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
    """Staff-only wallet balance update."""

    class Meta:
        model = Wallet
        fields = ('balance',)


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
            'screenshot_proof', 'note', 'rejection_reason', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'status', 'rejection_reason', 'created_at', 'updated_at',
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
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'status', 'service_hub_txn_id', 'merchant_txn_id',
            'charge', 'cashback', 'total_debited', 'reference_id',
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
            'reference_id', 'charge', 'cashback', 'total_debited', 'verified',
            'created_at', 'updated_at',
        )
        read_only_fields = fields


class BankAccountVerifySerializer(serializers.Serializer):
    """Verify destination bank account before transfer"""
    bank_code = serializers.CharField(max_length=50, required=True)
    account_name = serializers.CharField(max_length=150, required=True)
    account_number = serializers.CharField(max_length=50, required=True)
    is_mobile = serializers.BooleanField(required=False, default=False)
    merchant_txn_id = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate_bank_code(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Bank code is required.")
        return value.strip().upper()

    def validate_account_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Account name is required.")
        return value.strip()

    def validate_account_number(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Account number is required.")
        return value.strip()


class BankTransferCreateSerializer(serializers.Serializer):
    """Create / process bank transfer"""
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=True)
    destination_bank = serializers.CharField(max_length=50, required=True)
    destination_bank_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    destination_acc_no = serializers.CharField(max_length=50, required=True)
    destination_acc_name = serializers.CharField(max_length=150, required=True)
    is_destination_mobile = serializers.BooleanField(required=False, default=False)
    transaction_remarks = serializers.CharField(max_length=255, required=False, default='Fund Transfer')
    transaction_remarks_2 = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    transaction_remarks_3 = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    merchant_txn_id = serializers.CharField(max_length=100, required=False, allow_blank=True)

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
        if not value or not value.strip():
            raise serializers.ValidationError("Destination account name is required.")
        return value.strip()


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
