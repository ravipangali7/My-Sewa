"""
DRF Serializers for all models
"""
import re
import secrets
import string
from datetime import date
from collections import defaultdict
from decimal import Decimal
from django.db import IntegrityError, OperationalError, ProgrammingError, transaction
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.hashers import make_password
from django.contrib.auth import get_user_model
from .models import (
    Wallet,
    WalletAdjustment,
    WalletTransfer,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    WaterBillTransaction,
    ElectricityBillTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    DeviceToken,
    UserFeeConfig,
    DealerCommissionConfig,
    DealerCommission,
    ServiceCommissionRule,
    KYCSubmission,
    KYCDocument,
    KYCAuditLog,
    StatementReconcileRun,
    StatementDiscrepancy,
    WalletBalanceIssue,
    HomePopup,
    PushNotification,
    SupportChatThread,
    SupportChatMessage,
    DealerPayoutAccount,
)

User = get_user_model()

_TRANSACTION_PIN_RE = re.compile(r'^\d{4}$')


def _generate_user_password(length=12):
    alphabet = string.ascii_letters + string.digits
    chars = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
    ]
    chars.extend(secrets.choice(alphabet) for _ in range(max(0, length - 3)))
    secrets.SystemRandom().shuffle(chars)
    return ''.join(chars)


def validate_transaction_pin_value(value):
    """Ensure transaction PIN is exactly 4 numeric digits."""
    pin = (value or '').strip()
    if not _TRANSACTION_PIN_RE.match(pin):
        raise serializers.ValidationError(
            'Transaction PIN must be exactly 4 digits.'
        )
    return pin


def validate_date_of_birth_value(value):
    """Ensure date of birth is present and not in the future."""
    if value is None:
        raise serializers.ValidationError('Date of birth is required.')
    if value > date.today():
        raise serializers.ValidationError('Date of birth cannot be in the future.')
    return value


def _related_user_brief(user):
    if user is None:
        return None
    return {
        'id': user.pk,
        'phone': user.phone,
        'name': _user_display_name(user),
        'role': getattr(user, 'role', 'customer'),
    }


def _wallet_freeze_fields(wallet):
    if wallet is None:
        return {
            'wallet_frozen': False,
            'wallet_status': 'unfrozen',
            'freeze_reason': '',
        }
    frozen = bool(getattr(wallet, 'is_frozen', False))
    return {
        'wallet_frozen': frozen,
        'wallet_status': 'frozen' if frozen else 'unfrozen',
        'freeze_reason': getattr(wallet, 'freeze_reason', '') or '',
    }


class UserSerializer(serializers.ModelSerializer):
    """User serializer for registration and profile - phone number as username"""
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True, required=True, label="Confirm Password")
    transaction_pin = serializers.CharField(write_only=True, required=True, min_length=4, max_length=4)
    has_transaction_pin = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'date_of_birth',
            'password', 'password2', 'transaction_pin', 'has_transaction_pin',
        )
        extra_kwargs = {
            'phone': {'required': True},
            # Model allows blank/null for legacy rows; registration always requires email.
            'email': {'required': True, 'allow_blank': False, 'allow_null': False},
            'date_of_birth': {'required': True, 'allow_null': False},
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

    def validate_date_of_birth(self, value):
        return validate_date_of_birth_value(value)

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
            date_of_birth=validated_data['date_of_birth'],
            account_status=User.ACCOUNT_STATUS_PENDING,
            transaction_pin=make_password(raw_pin),
        )
        # Wallet will be created automatically via signal
        return user


class UserProfileSerializer(serializers.ModelSerializer):
    """User profile serializer for reading profile information (no password fields)"""
    avatar_url = serializers.SerializerMethodField()
    has_transaction_pin = serializers.SerializerMethodField()
    kyc_verified = serializers.SerializerMethodField()
    profile_locked = serializers.SerializerMethodField()
    assigned_dealer = serializers.SerializerMethodField()
    parent_agent = serializers.SerializerMethodField()
    assigned_sub_agent = serializers.SerializerMethodField()
    wallet_frozen = serializers.SerializerMethodField()
    wallet_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'nickname', 'business_name',
            'date_of_birth',
            'avatar', 'avatar_url',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'role', 'assigned_dealer_id', 'parent_agent_id', 'assigned_sub_agent_id',
            'can_fund_transfer', 'can_wallet_adjust', 'can_remittance_transfer',
            'kyc_status', 'citizenship_number', 'kyc_verified', 'profile_locked',
            'has_transaction_pin', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
            'wallet_frozen', 'wallet_status',
            'date_joined', 'last_login',
        )
        read_only_fields = (
            'id', 'phone', 'avatar', 'is_active', 'is_staff', 'is_superuser',
            'account_status', 'role', 'assigned_dealer_id', 'parent_agent_id',
            'assigned_sub_agent_id',
            'can_fund_transfer', 'can_wallet_adjust', 'can_remittance_transfer',
            'kyc_status', 'citizenship_number',
            'kyc_verified', 'profile_locked',
            'has_transaction_pin', 'date_joined', 'last_login',
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

    def get_kyc_verified(self, obj):
        return obj.kyc_status == User.KYC_STATUS_APPROVED

    def get_profile_locked(self, obj):
        return obj.kyc_status == User.KYC_STATUS_APPROVED

    def get_assigned_dealer(self, obj):
        return _related_user_brief(getattr(obj, 'assigned_dealer', None))

    def get_parent_agent(self, obj):
        return _related_user_brief(getattr(obj, 'parent_agent', None))

    def get_assigned_sub_agent(self, obj):
        return _related_user_brief(getattr(obj, 'assigned_sub_agent', None))

    def get_wallet_frozen(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return bool(wallet and getattr(wallet, 'is_frozen', False))

    def get_wallet_status(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return 'frozen' if wallet and getattr(wallet, 'is_frozen', False) else 'unfrozen'


class AdminUserSerializer(serializers.ModelSerializer):
    """Admin user list with wallet balance"""
    avatar_url = serializers.SerializerMethodField()
    wallet_balance = serializers.SerializerMethodField()
    wallet_id = serializers.SerializerMethodField()
    has_transaction_pin = serializers.SerializerMethodField()
    assigned_dealer = serializers.SerializerMethodField()
    parent_agent = serializers.SerializerMethodField()
    assigned_sub_agent = serializers.SerializerMethodField()
    wallet_frozen = serializers.SerializerMethodField()
    wallet_status = serializers.SerializerMethodField()
    commission_rate = serializers.SerializerMethodField()
    tds_rate = serializers.SerializerMethodField()
    sub_agent_commission_rate = serializers.SerializerMethodField()
    super_admin_rate = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'nickname',
            'avatar', 'avatar_url',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'role', 'assigned_dealer_id', 'parent_agent_id', 'assigned_sub_agent_id',
            'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
            'can_fund_transfer', 'can_wallet_adjust', 'can_remittance_transfer',
            'kyc_status', 'citizenship_number',
            'date_joined', 'last_login',
            'wallet_id', 'wallet_balance', 'wallet_frozen', 'wallet_status',
            'has_transaction_pin',
            'commission_rate', 'tds_rate', 'sub_agent_commission_rate', 'super_admin_rate',
        )
        read_only_fields = (
            'id', 'kyc_status', 'citizenship_number',
            'date_joined', 'last_login', 'avatar_url', 'wallet_id', 'wallet_balance',
            'has_transaction_pin',
        )

    def get_has_transaction_pin(self, obj):
        return bool(obj.transaction_pin)

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

    def get_assigned_dealer(self, obj):
        return _related_user_brief(getattr(obj, 'assigned_dealer', None))

    def get_parent_agent(self, obj):
        return _related_user_brief(getattr(obj, 'parent_agent', None))

    def get_assigned_sub_agent(self, obj):
        return _related_user_brief(getattr(obj, 'assigned_sub_agent', None))

    def get_wallet_frozen(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return bool(wallet and getattr(wallet, 'is_frozen', False))

    def get_wallet_status(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return 'frozen' if wallet and getattr(wallet, 'is_frozen', False) else 'unfrozen'

    def _commission_config(self, obj):
        return getattr(obj, 'dealer_commission_config', None)

    def get_commission_rate(self, obj):
        config = self._commission_config(obj)
        if config is None:
            return None
        return str(config.commission_rate)

    def get_tds_rate(self, obj):
        config = self._commission_config(obj)
        if config is None:
            return None
        return None if config.tds_rate is None else str(config.tds_rate)

    def get_sub_agent_commission_rate(self, obj):
        config = self._commission_config(obj)
        if config is None:
            return None
        return str(getattr(config, 'sub_agent_commission_rate', 0) or 0)

    def get_super_admin_rate(self, obj):
        config = self._commission_config(obj)
        if config is None:
            return None
        return str(getattr(config, 'super_admin_rate', 0) or 0)


class AdminUserWriteSerializer(serializers.ModelSerializer):
    """Create / update users from the admin console (password optional on update)."""
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True,
    )
    password2 = serializers.CharField(
        write_only=True, required=False, allow_blank=True, label='Confirm Password',
    )
    assigned_dealer = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), required=False, allow_null=True,
    )
    parent_agent = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), required=False, allow_null=True,
    )
    assigned_sub_agent = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), required=False, allow_null=True,
    )
    commission_rate = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, write_only=True,
    )
    tds_rate = serializers.DecimalField(
        max_digits=7, decimal_places=4, required=False, allow_null=True, write_only=True,
    )
    sub_agent_commission_rate = serializers.DecimalField(
        max_digits=7, decimal_places=4, required=False, allow_null=True, write_only=True,
    )
    super_admin_rate = serializers.DecimalField(
        max_digits=7, decimal_places=4, required=False, allow_null=True, write_only=True,
    )

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name',
            'is_active', 'is_staff', 'is_superuser', 'account_status',
            'role', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
            'can_fund_transfer', 'can_wallet_adjust', 'can_remittance_transfer',
            'commission_rate', 'tds_rate', 'sub_agent_commission_rate', 'super_admin_rate',
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
            'role': {'required': False},
            'can_fund_transfer': {'required': False},
            'can_wallet_adjust': {'required': False},
            'can_remittance_transfer': {'required': False},
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

        if creating and not password and not password2:
            generated = _generate_user_password()
            attrs['password'] = generated
            attrs['password2'] = generated
            password = generated
            password2 = generated

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

        request = self.context.get('request')
        actor = getattr(request, 'user', None) if request is not None else None
        from .services.hierarchy import apply_hierarchy_defaults, validate_hierarchy_links
        errors = validate_hierarchy_links(attrs, instance=self.instance, actor=actor)
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def _save_dealer_rates(self, user, validated_data):
        rate = validated_data.pop('commission_rate', serializers.empty)
        tds = validated_data.pop('tds_rate', serializers.empty)
        sub_rate = validated_data.pop('sub_agent_commission_rate', serializers.empty)
        sa_rate = validated_data.pop('super_admin_rate', serializers.empty)
        if all(v is serializers.empty for v in (rate, tds, sub_rate, sa_rate)):
            return
        role = getattr(user, 'role', None)
        if role not in (User.ROLE_DEALER,):
            return
        config, _ = DealerCommissionConfig.objects.get_or_create(user=user)
        update_fields = ['updated_at']
        if rate is not serializers.empty:
            config.commission_rate = rate if rate is not None else Decimal('0')
            update_fields.append('commission_rate')
        if tds is not serializers.empty:
            config.tds_rate = tds
            update_fields.append('tds_rate')
        if sub_rate is not serializers.empty:
            config.sub_agent_commission_rate = sub_rate if sub_rate is not None else Decimal('0')
            update_fields.append('sub_agent_commission_rate')
        if sa_rate is not serializers.empty:
            config.super_admin_rate = sa_rate if sa_rate is not None else Decimal('0')
            update_fields.append('super_admin_rate')
        config.save(update_fields=update_fields)

    def create(self, validated_data):
        validated_data.pop('password2', None)
        password = validated_data.pop('password')
        phone = validated_data.pop('phone')
        rates = {
            'commission_rate': validated_data.pop('commission_rate', serializers.empty),
            'tds_rate': validated_data.pop('tds_rate', serializers.empty),
            'sub_agent_commission_rate': validated_data.pop('sub_agent_commission_rate', serializers.empty),
            'super_admin_rate': validated_data.pop('super_admin_rate', serializers.empty),
        }
        from .services.hierarchy import apply_hierarchy_defaults, is_admin_actor, ROLE_DEALER
        request = self.context.get('request')
        actor = getattr(request, 'user', None) if request is not None else None
        if actor is not None and not is_admin_actor(actor) and getattr(actor, 'role', None) == ROLE_DEALER:
            validated_data['assigned_dealer'] = actor
            validated_data.setdefault('role', User.ROLE_CUSTOMER)
        # Newly created Users stay Pending until Super Admin approval.
        validated_data['account_status'] = User.ACCOUNT_STATUS_PENDING
        user = User.objects.create_user(phone, password=password, **validated_data)
        apply_hierarchy_defaults(user)
        user.save(update_fields=['assigned_dealer', 'parent_agent', 'assigned_sub_agent', 'role'])
        self._save_dealer_rates(user, rates)
        try:
            from .services.notifications import notify_user_provisioned
            notify_user_provisioned(user, password, created_by=actor)
        except Exception:
            pass
        return user

    def update(self, instance, validated_data):
        validated_data.pop('password2', None)
        password = validated_data.pop('password', None) or None
        rates = {
            'commission_rate': validated_data.pop('commission_rate', serializers.empty),
            'tds_rate': validated_data.pop('tds_rate', serializers.empty),
            'sub_agent_commission_rate': validated_data.pop('sub_agent_commission_rate', serializers.empty),
            'super_admin_rate': validated_data.pop('super_admin_rate', serializers.empty),
        }

        request = self.context.get('request')
        actor = getattr(request, 'user', None) if request is not None else None
        from .services.hierarchy import apply_hierarchy_defaults, is_admin_actor
        if actor is not None and not is_admin_actor(actor):
            validated_data.pop('account_status', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        apply_hierarchy_defaults(instance)

        if password:
            instance.set_password(password)

        instance.save()
        self._save_dealer_rates(instance, rates)
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
            'balance',
            'transactions_blocked', 'blocked_reason', 'blocked_at',
            'blocked_merchant_txn_id', 'unblocked_at', 'unblocked_by',
            'is_frozen', 'freeze_reason', 'frozen_at', 'frozen_by',
            'freeze_unfrozen_at', 'freeze_unfrozen_by',
            'wallet_status',
            'created_at', 'updated_at',
        )

    wallet_status = serializers.SerializerMethodField()

    def get_wallet_status(self, obj):
        return 'frozen' if getattr(obj, 'is_frozen', False) else 'unfrozen'


class AdminWalletWriteSerializer(serializers.ModelSerializer):
    """Staff-only wallet balance update (legacy balance-set payload)."""

    class Meta:
        model = Wallet
        fields = ('balance',)


def _dealer_commission_map(adjustments) -> dict:
    """Bulk-load DealerCommission rows keyed by (txn_type, txn_id)."""
    by_type = defaultdict(list)
    for adj in adjustments:
        if getattr(adj, 'kind', None) != WalletAdjustment.KIND_DEALER_COMMISSION:
            continue
        txn_type = (getattr(adj, 'source_txn_type', None) or '').strip()
        txn_id = getattr(adj, 'source_txn_id', None)
        if txn_type and txn_id:
            by_type[txn_type].append(txn_id)
    if not by_type:
        return {}
    rows = []
    for txn_type, ids in by_type.items():
        rows.extend(DealerCommission.objects.filter(txn_type=txn_type, txn_id__in=ids))
    return {(row.txn_type, row.txn_id): row for row in rows}


class WalletAdjustmentListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        items = list(data)
        self.child.context['_dealer_commissions'] = _dealer_commission_map(items)
        return super().to_representation(items)


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
    gross_commission = serializers.SerializerMethodField()
    tds_amount = serializers.SerializerMethodField()
    tds_rate = serializers.SerializerMethodField()
    net_commission = serializers.SerializerMethodField()

    class Meta:
        model = WalletAdjustment
        list_serializer_class = WalletAdjustmentListSerializer
        fields = (
            'id', 'wallet', 'user', 'amount', 'display_amount',
            'adjustment_type', 'adjustment_type_display', 'kind',
            'source_txn_type', 'source_txn_id',
            'gross_commission', 'tds_amount', 'tds_rate', 'net_commission',
            'balance_before', 'balance_after', 'reason',
            'created_by', 'created_by_phone', 'created_at', 'reference',
        )
        read_only_fields = fields

    def get_display_amount(self, obj):
        return f"{abs(obj.amount):.2f}"

    def _commission_row(self, obj):
        if getattr(obj, 'kind', None) != WalletAdjustment.KIND_DEALER_COMMISSION:
            return None
        txn_type = (getattr(obj, 'source_txn_type', None) or '').strip()
        txn_id = getattr(obj, 'source_txn_id', None)
        if not txn_type or not txn_id:
            return None
        cache = self.context.get('_dealer_commissions')
        key = (txn_type, txn_id)
        if isinstance(cache, dict):
            return cache.get(key)
        return DealerCommission.objects.filter(txn_type=txn_type, txn_id=txn_id).first()

    def _commission_money(self, obj, field: str):
        row = self._commission_row(obj)
        if row is None:
            return None
        value = getattr(row, field, None)
        if value is None:
            return None
        if field == 'tds_rate':
            return f'{Decimal(value):.4f}'
        return f'{Decimal(value):.2f}'

    def get_gross_commission(self, obj):
        return self._commission_money(obj, 'gross_commission')

    def get_tds_amount(self, obj):
        return self._commission_money(obj, 'tds_amount')

    def get_tds_rate(self, obj):
        return self._commission_money(obj, 'tds_rate')

    def get_net_commission(self, obj):
        return self._commission_money(obj, 'net_commission')


class WalletAdjustmentWriteSerializer(serializers.Serializer):
    """
    Admin manual load / wallet adjust payload.
    Prefer {amount, adjustment_type, reason}:
      - credit = Manual Load / Add Fund
      - debit  = subtract funds
    Also accepts legacy `{balance, reason}` to set an absolute balance.
    Creates a WalletAdjustment audit row on success.
    """
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=Decimal('0.01'),
    )
    adjustment_type = serializers.ChoiceField(
        choices=(
            ('credit', 'Manual Load (Add Fund)'),
            ('debit', 'Debit'),
        ),
        required=False,
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


def _user_display_name(user) -> str:
    full = f"{(user.first_name or '').strip()} {(user.last_name or '').strip()}".strip()
    if full:
        return full
    nick = (getattr(user, 'nickname', None) or '').strip()
    if nick:
        return nick
    biz = (getattr(user, 'business_name', None) or '').strip()
    if biz:
        return biz
    return (user.phone or '').strip()


class WalletTransferSerializer(serializers.ModelSerializer):
    """Wallet-to-wallet transfer as seen by the requesting user."""
    sender_phone = serializers.CharField(source='sender.phone', read_only=True)
    sender_name = serializers.SerializerMethodField()
    recipient_phone = serializers.CharField(source='recipient.phone', read_only=True)
    recipient_name = serializers.SerializerMethodField()
    direction = serializers.SerializerMethodField()
    counterparty_phone = serializers.SerializerMethodField()
    counterparty_name = serializers.SerializerMethodField()
    balance_before = serializers.SerializerMethodField()
    balance_after = serializers.SerializerMethodField()
    cashback = serializers.SerializerMethodField()
    himalpay_charge = serializers.SerializerMethodField()

    class Meta:
        model = WalletTransfer
        fields = (
            'id', 'amount', 'remarks', 'status', 'reference', 'created_at',
            'sender', 'sender_phone', 'sender_name',
            'recipient', 'recipient_phone', 'recipient_name',
            'direction', 'counterparty_phone', 'counterparty_name',
            'balance_before', 'balance_after',
            'sender_balance_before', 'sender_balance_after',
            'recipient_balance_before', 'recipient_balance_after',
            'charge', 'total_debited', 'cashback', 'himalpay_charge',
        )
        read_only_fields = fields

    def _viewer(self):
        viewer = self.context.get('viewer')
        if viewer is not None:
            return viewer
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _is_received(self, obj):
        viewer = self._viewer()
        return bool(viewer and obj.recipient_id == getattr(viewer, 'pk', None))

    def get_sender_name(self, obj):
        return _user_display_name(obj.sender)

    def get_recipient_name(self, obj):
        return _user_display_name(obj.recipient)

    def get_direction(self, obj):
        return 'received' if self._is_received(obj) else 'sent'

    def get_counterparty_phone(self, obj):
        other = obj.sender if self._is_received(obj) else obj.recipient
        return other.phone or ''

    def get_counterparty_name(self, obj):
        other = obj.sender if self._is_received(obj) else obj.recipient
        return _user_display_name(other)

    def get_balance_before(self, obj):
        value = (
            obj.recipient_balance_before
            if self._is_received(obj)
            else obj.sender_balance_before
        )
        return f'{value:.2f}'

    def get_balance_after(self, obj):
        value = (
            obj.recipient_balance_after
            if self._is_received(obj)
            else obj.sender_balance_after
        )
        return f'{value:.2f}'

    def _charge_snapshot(self, obj):
        cached = getattr(obj, '_txn_charge_snap', None)
        if cached is False:
            return None
        if cached is not None:
            return cached
        from .services.txn_charges import get_transaction_charge
        found = get_transaction_charge(obj)
        obj._txn_charge_snap = found if found is not None else False
        return found

    def get_cashback(self, obj):
        if self._is_received(obj):
            return '0.00'
        snap = self._charge_snapshot(obj)
        if snap is None:
            return '0.00'
        return f'{snap.cashback:.2f}'

    def get_himalpay_charge(self, obj):
        if self._is_received(obj):
            return '0.00'
        snap = self._charge_snapshot(obj)
        if snap is None:
            return '0.00'
        return f'{snap.himalpay_charge:.2f}'


class WalletTransferLookupSerializer(serializers.Serializer):
    phone = serializers.CharField(required=True, allow_blank=False, max_length=20)


class WalletTransferCreateSerializer(serializers.Serializer):
    recipient_phone = serializers.CharField(required=True, allow_blank=False, max_length=20)
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=True, min_value=Decimal('0.01'),
    )
    remarks = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default='',
    )
    transaction_pin = serializers.CharField(
        required=True, write_only=True, min_length=4, max_length=4,
    )

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
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


class PushBalanceUserSerializer(serializers.ModelSerializer):
    """Dealer downline user card for the Push Balance page."""
    wallet_balance = serializers.SerializerMethodField()
    wallet_frozen = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    role_label = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone', 'email', 'first_name', 'last_name', 'nickname',
            'business_name', 'role', 'account_status', 'is_active',
            'display_name', 'role_label', 'wallet_balance', 'wallet_frozen',
        )
        read_only_fields = fields

    def get_wallet_balance(self, obj):
        wallet = getattr(obj, 'wallet', None)
        if wallet is None:
            return '0.00'
        return str(wallet.balance)

    def get_wallet_frozen(self, obj):
        wallet = getattr(obj, 'wallet', None)
        return bool(wallet and getattr(wallet, 'is_frozen', False))

    def get_display_name(self, obj):
        biz = (getattr(obj, 'business_name', None) or '').strip()
        if biz:
            return biz
        return _user_display_name(obj)

    def get_role_label(self, obj):
        role = getattr(obj, 'role', None) or 'customer'
        return {
            'customer': 'USER',
            'dealer': 'DEALER',
            'agent': 'AGENT',
            'sub_agent': 'SUB-AGENT',
        }.get(role, 'USER')


class PushBalanceCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=True, min_value=1)
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=True, min_value=Decimal('0.01'),
    )
    remarks = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default='Push Balance',
    )
    transaction_pin = serializers.CharField(
        required=True, write_only=True, min_length=4, max_length=4,
    )

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        from .services.app_config import get_app_config, validate_amount_bounds
        tx = get_app_config().get('transactions') or {}
        err = validate_amount_bounds(
            value,
            min_amount=tx.get('min_transfer', 10),
            max_amount=tx.get('max_transfer', 100000),
            label='Push balance',
        )
        if err:
            raise serializers.ValidationError(err)
        return value


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    """User profile update serializer (name, nickname, business, DOB, avatar).

    After KYC verification, first_name / last_name / date_of_birth /
    citizenship_number cannot be changed (Task 16).
    Nickname and business_name remain editable. Email is changed via OTP flow.
    """
    # Accepted so clients get a clear lock error if they try to change it.
    citizenship_number = serializers.CharField(
        required=False, allow_blank=True, max_length=50,
    )

    class Meta:
        model = User
        fields = (
            'first_name', 'last_name', 'nickname', 'business_name',
            'date_of_birth', 'citizenship_number', 'avatar',
        )
        extra_kwargs = {
            'first_name': {'required': False, 'allow_blank': True},
            'last_name': {'required': False, 'allow_blank': True},
            'nickname': {'required': False, 'allow_blank': True},
            'business_name': {'required': False, 'allow_blank': True},
            # Required when missing on the account; otherwise optional to change.
            'date_of_birth': {'required': False, 'allow_null': False},
            'avatar': {'required': False},
        }

    def validate_date_of_birth(self, value):
        return validate_date_of_birth_value(value)

    def validate(self, attrs):
        from .services.kyc import (
            PROFILE_IDENTITY_LOCKED_FIELDS,
            collect_locked_field_errors,
            is_profile_locked,
        )

        instance = self.instance
        if instance is not None and is_profile_locked(instance):
            # Prefer initial_data so unchanged re-posts and citizenship attempts are caught.
            proposed = {}
            for field in PROFILE_IDENTITY_LOCKED_FIELDS:
                if field in self.initial_data:
                    proposed[field] = (
                        attrs[field] if field in attrs else self.initial_data.get(field)
                    )
            lock_errors = collect_locked_field_errors(instance, proposed)
            if lock_errors:
                lock_errors['non_field_errors'] = [
                    'Identity fields are locked after KYC verification.',
                ]
                raise serializers.ValidationError(lock_errors)
            # Drop locked fields from attrs so identical re-posts do not write them.
            for field in PROFILE_IDENTITY_LOCKED_FIELDS:
                attrs.pop(field, None)

        if instance is not None and not instance.date_of_birth:
            # Require DOB when completing identity fields; allow avatar-only patches.
            identity_keys = {'first_name', 'last_name', 'date_of_birth'}
            if identity_keys.intersection(attrs) and attrs.get('date_of_birth') is None:
                raise serializers.ValidationError({
                    'date_of_birth': 'Date of birth is required.',
                })

        # Citizenship number is managed via KYC submit, not free-form profile edits.
        if instance is not None and 'citizenship_number' in attrs:
            from .services.kyc import identity_field_changed
            if identity_field_changed(instance, 'citizenship_number', attrs['citizenship_number']):
                raise serializers.ValidationError({
                    'citizenship_number': (
                        'Citizenship number can only be updated via KYC submission.'
                    ),
                })
            attrs.pop('citizenship_number', None)

        return attrs


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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)
    confirm_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

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


class ChangeTransactionPinSerializer(serializers.Serializer):
    """Change transaction PIN after verifying the current PIN."""
    current_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)
    confirm_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_current_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_confirm_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate(self, attrs):
        if attrs['transaction_pin'] != attrs['confirm_pin']:
            raise serializers.ValidationError(
                {'confirm_pin': 'PIN fields did not match.'}
            )
        if attrs['current_pin'] == attrs['transaction_pin']:
            raise serializers.ValidationError(
                {'transaction_pin': 'New PIN must be different from the current PIN.'}
            )
        return attrs


class VerifyTransactionPinSerializer(serializers.Serializer):
    """Client-side pre-check for transaction PIN before submitting a payment."""
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)


class ResetTransactionPinSerializer(serializers.Serializer):
    """
    Reset transaction PIN after verifying account password or email OTP.
    Provide exactly one of ``current_password`` or ``otp``.
    """
    current_password = serializers.CharField(
        required=False, write_only=True, allow_blank=True, default='',
    )
    otp = serializers.CharField(
        required=False, write_only=True, allow_blank=True, default='', max_length=10,
    )
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)
    confirm_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_confirm_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate(self, attrs):
        if attrs['transaction_pin'] != attrs['confirm_pin']:
            raise serializers.ValidationError(
                {'confirm_pin': 'PIN fields did not match.'}
            )
        password = (attrs.get('current_password') or '').strip()
        otp = (attrs.get('otp') or '').strip()
        attrs['current_password'] = password
        attrs['otp'] = otp
        if password and otp:
            raise serializers.ValidationError(
                {'otp': 'Use either account password or OTP, not both.'}
            )
        if not password and not otp:
            raise serializers.ValidationError(
                {
                    'current_password': [
                        'Enter your account password, or request an email OTP to reset your PIN.'
                    ],
                }
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
    date_of_birth = serializers.DateField(
        required=True,
        input_formats=['%Y-%m-%d'],
        error_messages={
            'required': 'Date of birth is required.',
            'invalid': 'Enter a valid date of birth in YYYY-MM-DD format.',
            'null': 'Date of birth is required.',
        },
    )
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)
    confirm_password = serializers.CharField(required=True, write_only=True)

    def validate_phone(self, value):
        return (value or '').strip()

    def validate_date_of_birth(self, value):
        return validate_date_of_birth_value(value)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return attrs


class ChangePhoneSerializer(serializers.Serializer):
    """Change phone number — requires current password and email OTP."""
    new_phone = serializers.CharField(required=True, max_length=50)
    current_password = serializers.CharField(required=True, write_only=True)
    otp = serializers.CharField(required=True, max_length=6, min_length=6)

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

    def validate_otp(self, value):
        otp = (value or '').strip()
        if not otp.isdigit() or len(otp) != 6:
            raise serializers.ValidationError('Enter the 6-digit verification code.')
        return otp


class RequestChangePhoneOtpSerializer(serializers.Serializer):
    """Start phone change: verify password and queue OTP to registered email."""
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


class RequestEmailChangeSerializer(serializers.Serializer):
    """Request OTP to the registered email before changing email address."""
    new_email = serializers.EmailField(required=True)
    current_password = serializers.CharField(required=True, write_only=True)

    def validate_new_email(self, value):
        email = (value or '').strip().lower()
        if not email:
            raise serializers.ValidationError('Email address is required.')
        user = self.context['request'].user
        current = (user.email or '').strip().lower()
        if email == current:
            raise serializers.ValidationError('This is already your current email address.')
        if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
            raise serializers.ValidationError('This email address is already registered.')
        return email


class ConfirmEmailChangeSerializer(serializers.Serializer):
    """Confirm email change with the OTP sent to the registered email."""
    otp = serializers.CharField(required=True, max_length=6, min_length=6)

    def validate_otp(self, value):
        otp = (value or '').strip()
        if not otp.isdigit() or len(otp) != 6:
            raise serializers.ValidationError('Enter the 6-digit verification code.')
        return otp


class WalletSerializer(serializers.ModelSerializer):
    """Wallet serializer"""
    user = serializers.StringRelatedField(read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)

    class Meta:
        model = Wallet
        fields = (
            'id', 'user', 'phone', 'balance',
            'transactions_blocked', 'blocked_reason', 'blocked_at',
            'is_frozen', 'freeze_reason', 'frozen_at',
            'wallet_status',
            'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'balance',
            'transactions_blocked', 'blocked_reason', 'blocked_at',
            'is_frozen', 'freeze_reason', 'frozen_at',
            'created_at', 'updated_at',
        )

    wallet_status = serializers.SerializerMethodField()

    def get_wallet_status(self, obj):
        return 'frozen' if getattr(obj, 'is_frozen', False) else 'unfrozen'


class DepositSerializer(serializers.ModelSerializer):
    """Deposit request serializer"""
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    payout_account_id = serializers.IntegerField(read_only=True, allow_null=True)
    payout_account = serializers.SerializerMethodField()

    class Meta:
        model = Deposit
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'amount', 'status', 'status_display',
            'transaction_id', 'deposit_date', 'bank_name',
            'payout_account', 'payout_account_id',
            'screenshot_proof', 'note', 'rejection_reason',
            'balance_before', 'balance_after', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'user', 'status', 'rejection_reason',
            'balance_before', 'balance_after', 'created_at', 'updated_at',
        )

    def get_payout_account(self, obj):
        account = getattr(obj, 'payout_account', None)
        if account is None:
            return None
        return {
            'id': account.pk,
            'method': account.method,
            'label': account.label,
            'account_name': account.account_name,
            'account_number': account.account_number,
            'dealer_id': account.dealer_id,
        }

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class DepositCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating deposit requests — limits come from Settings.config."""
    screenshot_proof = serializers.ImageField(required=False, allow_null=True)
    transaction_id = serializers.CharField(max_length=120, required=True, allow_blank=False)
    deposit_date = serializers.DateField(required=True)
    bank_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    note = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    payout_account_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Deposit
        fields = (
            'amount', 'transaction_id', 'deposit_date', 'bank_name',
            'screenshot_proof', 'note', 'payout_account_id',
        )

    def validate_transaction_id(self, value):
        tid = (value or '').strip()
        if not tid:
            raise serializers.ValidationError("Transaction ID is required.")
        return tid

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
        if 'bank_name' in attrs and attrs['bank_name'] is not None:
            attrs['bank_name'] = attrs['bank_name'].strip()
        payout_id = attrs.pop('payout_account_id', None)
        if payout_id:
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request is not None else None
            from .services.hierarchy import customer_assigned_dealer
            dealer = customer_assigned_dealer(user)
            account = DealerPayoutAccount.objects.filter(
                pk=payout_id,
                status=DealerPayoutAccount.STATUS_APPROVED,
            ).first()
            if account is None:
                raise serializers.ValidationError({
                    'payout_account_id': 'Payout account not found or not approved.',
                })
            if dealer is None or account.dealer_id != dealer.pk:
                raise serializers.ValidationError({
                    'payout_account_id': 'This payout account is not available for your account.',
                })
            attrs['payout_account'] = account
        return attrs


class DealerPayoutAccountSerializer(serializers.ModelSerializer):
    dealer_id = serializers.IntegerField(source='dealer.id', read_only=True)
    dealer_phone = serializers.CharField(source='dealer.phone', read_only=True)
    dealer_name = serializers.SerializerMethodField()
    qr_code_url = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    method_display = serializers.CharField(source='get_method_display', read_only=True)
    qr_code = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = DealerPayoutAccount
        fields = (
            'id', 'dealer_id', 'dealer_phone', 'dealer_name',
            'method', 'method_display', 'label',
            'account_name', 'account_number', 'bank_name', 'branch',
            'qr_code', 'qr_code_url',
            'status', 'status_display', 'rejection_reason',
            'reviewed_at', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'dealer_id', 'dealer_phone', 'dealer_name',
            'status', 'status_display', 'rejection_reason',
            'reviewed_at', 'created_at', 'updated_at',
        )

    def get_dealer_name(self, obj):
        dealer = getattr(obj, 'dealer', None)
        if dealer is None:
            return ''
        return ' '.join(
            part for part in (dealer.first_name, dealer.last_name) if part
        ).strip() or dealer.phone

    def get_qr_code_url(self, obj):
        if not obj.qr_code:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.qr_code.url)
        return obj.qr_code.url

    def validate(self, attrs):
        method = attrs.get('method', getattr(self.instance, 'method', None))
        account_name = (attrs.get('account_name') or getattr(self.instance, 'account_name', '') or '').strip()
        account_number = (attrs.get('account_number') or getattr(self.instance, 'account_number', '') or '').strip()
        bank_name = (attrs.get('bank_name') or getattr(self.instance, 'bank_name', '') or '').strip()
        if not account_name:
            raise serializers.ValidationError({'account_name': 'Account name is required.'})
        if not account_number:
            raise serializers.ValidationError({'account_number': 'Account number / wallet ID is required.'})
        if method == DealerPayoutAccount.METHOD_BANK and not bank_name:
            raise serializers.ValidationError({'bank_name': 'Bank name is required for bank accounts.'})
        creating = self.instance is None
        qr = attrs.get('qr_code')
        if creating and not qr:
            raise serializers.ValidationError({'qr_code': 'QR code is required.'})
        if 'account_name' in attrs:
            attrs['account_name'] = account_name
        if 'account_number' in attrs:
            attrs['account_number'] = account_number
        if 'bank_name' in attrs:
            attrs['bank_name'] = bank_name
        label = (attrs.get('label') or '').strip()
        if not label:
            if method == DealerPayoutAccount.METHOD_KHALTI:
                label = 'Khalti'
            elif method == DealerPayoutAccount.METHOD_ESEWA:
                label = 'eSewa'
            else:
                label = bank_name or 'Bank account'
            attrs['label'] = label
        return attrs


class SettingsSerializer(serializers.ModelSerializer):
    """Settings serializer"""
    qr_code_url = serializers.SerializerMethodField()
    khalti_qr_code_url = serializers.SerializerMethodField()
    esewa_qr_code_url = serializers.SerializerMethodField()
    logo_url = serializers.SerializerMethodField()
    apk_url = serializers.SerializerMethodField()
    bank_details = serializers.SerializerMethodField()
    config = serializers.SerializerMethodField()

    class Meta:
        model = Settings
        fields = (
            'id',
            'qr_code', 'qr_code_url',
            'khalti_qr_code', 'khalti_qr_code_url',
            'esewa_qr_code', 'esewa_qr_code_url',
            'logo', 'logo_url',
            'auto_update_enabled', 'app_version',
            'apk', 'apk_url',
            'bank_details', 'config',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at', 'apk_url')

    def _absolute_media_url(self, file_field):
        if not file_field:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(file_field.url)
        return file_field.url

    def get_qr_code_url(self, obj):
        return self._absolute_media_url(obj.qr_code)

    def get_khalti_qr_code_url(self, obj):
        return self._absolute_media_url(obj.khalti_qr_code)

    def get_esewa_qr_code_url(self, obj):
        return self._absolute_media_url(obj.esewa_qr_code)

    def get_logo_url(self, obj):
        return self._absolute_media_url(obj.logo)

    def get_apk_url(self, obj):
        return self._absolute_media_url(obj.apk)

    def get_bank_details(self, obj):
        from .services.payment_accounts import enrich_bank_details_qr_urls
        return enrich_bank_details_qr_urls(obj.bank_details, self.context.get('request'))

    def get_config(self, obj):
        config = obj.get_config()
        # Mask SMTP password for admin responses (never send the raw secret)
        try:
            from .services.smtp import smtp_config_for_admin, PASSWORD_MASK
            config = dict(config)
            config['smtp'] = smtp_config_for_admin(config)
            integrations = dict(config.get('integrations') or {})
            portal_password = str(integrations.get('himalpay_portal_password') or '').strip()
            if portal_password:
                integrations['himalpay_portal_password'] = PASSWORD_MASK
                integrations['himalpay_portal_password_set'] = True
            else:
                integrations['himalpay_portal_password'] = ''
                integrations['himalpay_portal_password_set'] = False
            config['integrations'] = integrations
        except Exception:
            pass
        return config


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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

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
            'provider_charge', 'platform_charge',
            'balance_before', 'balance_after', 'verified',
            'created_at', 'updated_at',
        )
        read_only_fields = fields


class CommissionHistorySerializer(serializers.ModelSerializer):
    """Super Admin ledger of transfer charges and MySewa commission earned."""
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source = serializers.SerializerMethodField()
    commission = serializers.SerializerMethodField()
    earned = serializers.SerializerMethodField()

    class Meta:
        model = BankTransferTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'amount', 'destination_bank', 'destination_bank_name',
            'destination_acc_no', 'destination_acc_name', 'is_destination_mobile',
            'transaction_remarks', 'status', 'status_display',
            'merchant_txn_id', 'provider_txn_id',
            'charge', 'provider_charge', 'platform_charge', 'commission', 'earned',
            'cashback', 'total_debited', 'source', 'created_at', 'updated_at',
        )
        read_only_fields = fields

    def get_source(self, _obj):
        return 'bank_transfer'

    def get_commission(self, obj):
        return str(obj.platform_charge)

    def get_earned(self, obj):
        if obj.status == 'success':
            return str(obj.platform_charge)
        return '0.00'


class DealerCommissionSerializer(serializers.ModelSerializer):
    dealer_phone = serializers.CharField(source='dealer.phone', read_only=True)
    dealer_name = serializers.SerializerMethodField()
    source_phone = serializers.CharField(source='source_user.phone', read_only=True, allow_null=True)
    source_name = serializers.SerializerMethodField()
    sub_agent_phone = serializers.CharField(source='sub_agent.phone', read_only=True, allow_null=True)
    sub_agent_name = serializers.SerializerMethodField()
    txn_type_display = serializers.CharField(source='get_txn_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = DealerCommission
        fields = (
            'id', 'dealer', 'dealer_phone', 'dealer_name',
            'source_user', 'source_phone', 'source_name',
            'sub_agent', 'sub_agent_phone', 'sub_agent_name',
            'txn_type', 'txn_type_display', 'txn_id', 'reference',
            'txn_amount', 'commission_rate', 'gross_commission',
            'tds_rate', 'tds_amount', 'net_commission',
            'sub_agent_commission_rate', 'sub_agent_commission',
            'super_admin_rate', 'super_admin_profit',
            'status', 'status_display', 'created_at', 'updated_at',
        )
        read_only_fields = fields

    def get_dealer_name(self, obj):
        return _user_display_name(obj.dealer)

    def get_source_name(self, obj):
        if obj.source_user is None:
            return ''
        return _user_display_name(obj.source_user)

    def get_sub_agent_name(self, obj):
        if obj.sub_agent is None:
            return ''
        return _user_display_name(obj.sub_agent)


class ServiceCommissionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceCommissionRule
        fields = (
            'id', 'dealer', 'txn_type', 'dealer_rate', 'sub_agent_rate',
            'super_admin_rate', 'updated_at',
        )
        read_only_fields = ('id', 'updated_at')


class BankAccountVerifySerializer(serializers.Serializer):
    """Verify destination bank account before transfer"""
    bank_code = serializers.CharField(max_length=50, required=True)
    bank_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

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
    wallet_service_name = serializers.CharField(required=True, max_length=80)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=True)

    def validate_wallet_service_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('wallet_service_name is required.')
        return name

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
    citizenship_review_pending = serializers.SerializerMethodField()
    citizenship_front = serializers.SerializerMethodField()
    citizenship_back = serializers.SerializerMethodField()

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
            'citizenship_front', 'citizenship_back',
            'status', 'status_display', 'merchant_txn_id', 'provider_txn_id',
            'reference_id', 'charge', 'cashback', 'total_credited',
            'balance_before', 'balance_after',
            'wallet_credited', 'citizenship_review_pending',
            'created_at', 'updated_at',
        )
        read_only_fields = fields

    def _absolute_media_url(self, file_field):
        try:
            if not file_field:
                return None
            url = file_field.url
        except (ValueError, OSError, AttributeError):
            return None
        request = self.context.get('request')
        if request:
            try:
                return request.build_absolute_uri(url)
            except (ValueError, OSError):
                return url
        return url

    def get_citizenship_front(self, obj):
        if 'citizenship_front' in obj.get_deferred_fields():
            return None
        try:
            return self._absolute_media_url(getattr(obj, 'citizenship_front', None))
        except (ValueError, OSError, AttributeError, ProgrammingError, OperationalError):
            return None

    def get_citizenship_back(self, obj):
        if 'citizenship_back' in obj.get_deferred_fields():
            return None
        try:
            return self._absolute_media_url(getattr(obj, 'citizenship_back', None))
        except (ValueError, OSError, AttributeError, ProgrammingError, OperationalError):
            return None

    def get_citizenship_review_pending(self, obj) -> bool:
        lookup = obj.lookup_response if isinstance(obj.lookup_response, dict) else {}
        return bool(lookup.get('citizenship_review_pending') and lookup.get('himalpay_received'))


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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

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


class AdminInternetBillSerializer(InternetBillTransactionSerializer):
    """Staff internet bill detail — includes raw provider response for support."""

    class Meta(InternetBillTransactionSerializer.Meta):
        fields = InternetBillTransactionSerializer.Meta.fields + ('provider_response',)


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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value


class WaterBillTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = WaterBillTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'connection_no', 'customer_code', 'counter', 'customer_name',
            'session_id', 'payment_type', 'amount', 'pay_service',
            'status', 'status_display', 'merchant_txn_id',
            'service_hub_txn_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminWaterBillSerializer(WaterBillTransactionSerializer):
    """Staff water bill detail — includes raw provider response for support."""

    class Meta(WaterBillTransactionSerializer.Meta):
        fields = WaterBillTransactionSerializer.Meta.fields + ('provider_response',)


class WaterBillInquirySerializer(serializers.Serializer):
    connection_no = serializers.CharField(max_length=50)
    customer_code = serializers.CharField(max_length=50)
    counter = serializers.CharField(max_length=100)

    def validate_connection_no(self, value):
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Connection number is required.')
        return cleaned

    def validate_customer_code(self, value):
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Customer code is required.')
        return cleaned

    def validate_counter(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Counter is required.')
        return cleaned


class WaterBillPaySerializer(serializers.Serializer):
    connection_no = serializers.CharField(max_length=50)
    customer_code = serializers.CharField(max_length=50)
    counter = serializers.CharField(max_length=100)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    session_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    payment_type = serializers.CharField(max_length=50, required=False, allow_blank=True, default='Bill Payment')
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    pay_data = serializers.JSONField(required=False)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value


class ElectricityBillTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ElectricityBillTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'sc_no', 'consumer_id', 'office_code', 'office_name', 'customer_name',
            'session_id', 'amount', 'pay_service',
            'status', 'status_display', 'merchant_txn_id',
            'service_hub_txn_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminElectricityBillSerializer(ElectricityBillTransactionSerializer):
    """Staff electricity bill detail — includes raw provider response for support."""

    class Meta(ElectricityBillTransactionSerializer.Meta):
        fields = ElectricityBillTransactionSerializer.Meta.fields + ('provider_response',)


class ElectricityBillInquirySerializer(serializers.Serializer):
    sc_no = serializers.CharField(max_length=50)
    consumer_id = serializers.CharField(max_length=50)
    office_code = serializers.CharField(max_length=100)

    def validate_sc_no(self, value):
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('SC number is required.')
        return cleaned

    def validate_consumer_id(self, value):
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Consumer ID is required.')
        return cleaned

    def validate_office_code(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Office / counter is required.')
        return cleaned


class ElectricityBillPaySerializer(serializers.Serializer):
    sc_no = serializers.CharField(max_length=50)
    consumer_id = serializers.CharField(max_length=50)
    office_code = serializers.CharField(max_length=100)
    office_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    session_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    pay_data = serializers.JSONField(required=False)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value


class CommunityElectricityTransactionSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = CommunityElectricityTransaction
        fields = (
            'id', 'user', 'user_id', 'phone', 'first_name', 'last_name',
            'platform_id', 'platform_name', 'service_slug', 'counter_code',
            'customer_ref', 'consumer_id', 'customer_name', 'month',
            'session_id', 'amount', 'pay_service',
            'status', 'status_display', 'merchant_txn_id',
            'service_hub_txn_id', 'charge', 'cashback', 'total_debited',
            'balance_before', 'balance_after',
            'reference_id', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminCommunityElectricitySerializer(CommunityElectricityTransactionSerializer):
    """Staff community electricity detail — includes raw provider response."""

    class Meta(CommunityElectricityTransactionSerializer.Meta):
        fields = CommunityElectricityTransactionSerializer.Meta.fields + ('provider_response',)


class CommunityElectricityCountersSerializer(serializers.Serializer):
    platform_id = serializers.CharField(max_length=50)
    customer_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_ref = serializers.CharField(max_length=100, required=False, allow_blank=True)
    service_slug = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_platform_id(self, value):
        cleaned = (value or '').strip().lower()
        if cleaned not in ('bpc', 'watermark'):
            raise serializers.ValidationError(
                'Counters/slugs are only available for bpc and watermark.'
            )
        return cleaned


class CommunityElectricityInquirySerializer(serializers.Serializer):
    platform_id = serializers.CharField(max_length=50)
    customer_ref = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_no = serializers.CharField(max_length=100, required=False, allow_blank=True)
    consumer_no = serializers.CharField(max_length=100, required=False, allow_blank=True)
    consumer_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    service_slug = serializers.CharField(max_length=150, required=False, allow_blank=True)
    counter_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    month = serializers.IntegerField(required=False, allow_null=True)

    def validate_platform_id(self, value):
        cleaned = (value or '').strip().lower()
        if cleaned not in ('himchuli', 'watermark', 'dreamer', 'softlab', 'bpc'):
            raise serializers.ValidationError('Unsupported platform.')
        return cleaned

    def validate(self, attrs):
        platform_id = attrs.get('platform_id')
        # Normalize platform-specific customer keys into customer_ref when needed.
        if platform_id == 'himchuli':
            attrs['customer_ref'] = (
                attrs.get('customer_number') or attrs.get('customer_ref') or ''
            ).strip()
            if not attrs['customer_ref']:
                raise serializers.ValidationError({'customer_number': 'Customer number is required.'})
            if not (attrs.get('service_slug') or '').strip():
                attrs['service_slug'] = 'himchuli'
        elif platform_id in ('watermark', 'softlab'):
            attrs['customer_ref'] = (
                attrs.get('customer_code') or attrs.get('customer_ref') or ''
            ).strip()
            if not attrs['customer_ref']:
                raise serializers.ValidationError({'customer_code': 'Customer code is required.'})
            if not (attrs.get('service_slug') or '').strip():
                raise serializers.ValidationError({'service_slug': 'Service slug is required.'})
            if platform_id == 'softlab' and attrs.get('month') is None:
                attrs['month'] = 0
        elif platform_id == 'dreamer':
            attrs['customer_ref'] = (
                attrs.get('customer_no') or attrs.get('customer_ref') or ''
            ).strip()
            if not attrs['customer_ref']:
                raise serializers.ValidationError({'customer_no': 'Customer number is required.'})
            if not (attrs.get('service_slug') or '').strip():
                raise serializers.ValidationError({'service_slug': 'Service slug is required.'})
        elif platform_id == 'bpc':
            attrs['customer_ref'] = (
                attrs.get('consumer_no') or attrs.get('customer_ref') or ''
            ).strip()
            if not attrs['customer_ref']:
                raise serializers.ValidationError({'consumer_no': 'Consumer number is required.'})
            if not str(attrs.get('consumer_id') or '').strip():
                raise serializers.ValidationError({'consumer_id': 'Consumer ID is required.'})
            if not (attrs.get('counter_code') or '').strip():
                raise serializers.ValidationError({'counter_code': 'Counter code is required.'})
        return attrs


class CommunityElectricityPaySerializer(serializers.Serializer):
    platform_id = serializers.CharField(max_length=50)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    session_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_ref = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_no = serializers.CharField(max_length=100, required=False, allow_blank=True)
    consumer_no = serializers.CharField(max_length=100, required=False, allow_blank=True)
    consumer_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    service_slug = serializers.CharField(max_length=150, required=False, allow_blank=True)
    counter_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    month = serializers.IntegerField(required=False, allow_null=True)
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    pay_data = serializers.JSONField(required=False)
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

    def validate_transaction_pin(self, value):
        return validate_transaction_pin_value(value)

    def validate_platform_id(self, value):
        cleaned = (value or '').strip().lower()
        if cleaned not in ('himchuli', 'watermark', 'dreamer', 'softlab', 'bpc'):
            raise serializers.ValidationError('Unsupported platform.')
        return cleaned

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

    def validate(self, attrs):
        platform_id = attrs.get('platform_id')
        if platform_id == 'himchuli':
            attrs['customer_ref'] = (
                attrs.get('customer_number') or attrs.get('customer_ref') or ''
            ).strip()
        elif platform_id in ('watermark', 'softlab'):
            attrs['customer_ref'] = (
                attrs.get('customer_code') or attrs.get('customer_ref') or ''
            ).strip()
        elif platform_id == 'dreamer':
            attrs['customer_ref'] = (
                attrs.get('customer_no') or attrs.get('customer_ref') or ''
            ).strip()
        elif platform_id == 'bpc':
            attrs['customer_ref'] = (
                attrs.get('consumer_no') or attrs.get('customer_ref') or ''
            ).strip()
        if not attrs.get('customer_ref'):
            raise serializers.ValidationError({'customer_ref': 'Customer reference is required.'})
        return attrs


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


class AdminDataPackSerializer(DataPackTransactionSerializer):
    """Staff data pack detail — includes raw provider response for support."""

    class Meta(DataPackTransactionSerializer.Meta):
        fields = DataPackTransactionSerializer.Meta.fields + ('provider_response',)


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
    transaction_pin = serializers.CharField(required=True, write_only=True, min_length=4, max_length=4)

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
    cashback_flat = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False,
    )

    class Meta:
        model = UserFeeConfig
        fields = (
            'transfer_charge_enabled',
            'transfer_charge_flat',
            'transfer_charge_percent',
            'topup_charge_percent',
            'cashback_flat',
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
        if len(token) < 20:
            raise serializers.ValidationError('Device token is too short.')
        from .services.push import is_real_fcm_token
        if not is_real_fcm_token(token):
            raise serializers.ValidationError('Placeholder or stub tokens are not stored.')
        return token

    def create(self, validated_data):
        user = self.context['request'].user
        token = validated_data['token']
        platform = validated_data.get('platform') or DeviceToken.PLATFORM_UNKNOWN
        # Unique on token: same FCM token is stored once and reassigned to this user.
        try:
            with transaction.atomic():
                obj, _created = DeviceToken.objects.update_or_create(
                    token=token,
                    defaults={'user': user, 'platform': platform},
                )
                return obj
        except IntegrityError:
            obj = DeviceToken.objects.get(token=token)
            obj.user = user
            obj.platform = platform
            obj.save(update_fields=['user', 'platform', 'updated_at'])
            return obj


class KYCDocumentSerializer(serializers.ModelSerializer):
    """Read serializer for KYC document images."""
    document_type_display = serializers.CharField(
        source='get_document_type_display', read_only=True,
    )
    side_display = serializers.CharField(source='get_side_display', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = KYCDocument
        fields = (
            'id', 'document_type', 'document_type_display',
            'side', 'side_display', 'file', 'file_url', 'uploaded_at',
        )
        read_only_fields = fields

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url


class KYCDocumentUploadSerializer(serializers.Serializer):
    """Multipart upload for a single KYC document."""
    document_type = serializers.ChoiceField(choices=KYCDocument.DOCUMENT_TYPE_CHOICES)
    side = serializers.ChoiceField(
        choices=KYCDocument.SIDE_CHOICES,
        required=False,
        default=KYCDocument.SIDE_SINGLE,
    )
    file = serializers.ImageField()


class KYCSubmissionSerializer(serializers.ModelSerializer):
    """Full KYC submission with nested documents."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    documents = KYCDocumentSerializer(many=True, read_only=True)
    reviewed_by_phone = serializers.CharField(
        source='reviewed_by.phone', read_only=True, default=None,
    )
    phone = serializers.CharField(source='user.phone', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    date_of_birth = serializers.DateField(
        source='user.date_of_birth', read_only=True, allow_null=True,
    )

    class Meta:
        model = KYCSubmission
        fields = (
            'id', 'user_id', 'phone', 'first_name', 'last_name', 'date_of_birth',
            'status', 'status_display', 'citizenship_number',
            'rejection_reason', 'reviewed_by', 'reviewed_by_phone',
            'reviewed_at', 'submitted_at', 'documents',
            'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminKYCUpdateSerializer(serializers.Serializer):
    """Staff / Super Admin corrections on submitted KYC identity fields."""
    citizenship_number = serializers.CharField(
        max_length=50, required=False, allow_blank=False,
    )
    first_name = serializers.CharField(
        max_length=30, required=False, allow_blank=True,
    )
    last_name = serializers.CharField(
        max_length=30, required=False, allow_blank=True,
    )
    date_of_birth = serializers.DateField(
        required=False, allow_null=True,
    )

    def validate_citizenship_number(self, value):
        number = (value or '').strip()
        if len(number) < 3:
            raise serializers.ValidationError('Citizenship number is required.')
        return number


class KYCSubmitSerializer(serializers.Serializer):
    """Create or resubmit KYC (citizenship number + optional document batch)."""
    citizenship_number = serializers.CharField(max_length=50)

    def validate_citizenship_number(self, value):
        number = (value or '').strip()
        if len(number) < 3:
            raise serializers.ValidationError('Citizenship number is required.')
        return number


class KYCStatusSerializer(serializers.Serializer):
    """Aggregate KYC status payload for the authenticated user."""
    kyc_status = serializers.CharField()
    citizenship_number = serializers.CharField(allow_blank=True)
    kyc_verified = serializers.BooleanField()
    profile_locked = serializers.BooleanField()
    can_submit = serializers.BooleanField()
    submission = KYCSubmissionSerializer(allow_null=True)


class KYCAuditLogSerializer(serializers.ModelSerializer):
    actor_phone = serializers.CharField(source='actor.phone', read_only=True, default=None)
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model = KYCAuditLog
        fields = (
            'id', 'user', 'submission', 'action', 'action_display',
            'actor', 'actor_phone', 'old_status', 'new_status',
            'details', 'created_at',
        )
        read_only_fields = fields


class StatementReconcileRunSerializer(serializers.ModelSerializer):
    triggered_by_display = serializers.CharField(
        source='get_triggered_by_display', read_only=True,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    triggered_by_user_phone = serializers.CharField(
        source='triggered_by_user.phone', read_only=True, default=None,
    )

    class Meta:
        model = StatementReconcileRun
        fields = (
            'id', 'from_date', 'to_date', 'triggered_by', 'triggered_by_display',
            'triggered_by_user', 'triggered_by_user_phone', 'status', 'status_display',
            'hp_entries', 'matched', 'issues_open', 'issues_new',
            'himalpay_balance_paisa', 'himalpay_bonus_balance_paisa',
            'himalpay_balance_rupees', 'himalpay_statement_logs',
            'error_message', 'created_at', 'finished_at',
        )
        read_only_fields = fields


class StatementDiscrepancySerializer(serializers.ModelSerializer):
    issue_type_display = serializers.CharField(
        source='get_issue_type_display', read_only=True,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    txn_type_display = serializers.CharField(
        source='get_txn_type_display', read_only=True, default='',
    )
    user_phone = serializers.CharField(source='user.phone', read_only=True, default=None)
    user_name = serializers.SerializerMethodField()
    can_solve = serializers.SerializerMethodField()
    can_correct = serializers.SerializerMethodField()
    suggested_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True, allow_null=True,
    )
    hp_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, coerce_to_string=True,
    )
    hp_net_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, coerce_to_string=True,
    )
    local_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, coerce_to_string=True, allow_null=True,
    )

    class Meta:
        model = StatementDiscrepancy
        fields = (
            'id', 'run', 'issue_type', 'issue_type_display', 'status', 'status_display',
            'transaction_uuid', 'merchant_txn_id', 'wallet_service_name', 'direction',
            'hp_status', 'hp_amount', 'hp_net_amount', 'local_status', 'local_amount',
            'txn_type', 'txn_type_display', 'txn_id', 'user', 'user_phone', 'user_name',
            'himalpay_snapshot', 'suggested_adjustment_type', 'suggested_amount',
            'reason', 'can_solve', 'can_correct', 'resolved_by', 'resolved_at',
            'resolution_adjustment', 'created_at', 'updated_at',
        )
        read_only_fields = fields

    def get_user_name(self, obj):
        user = obj.user
        if not user:
            return None
        name = f'{user.first_name or ""} {user.last_name or ""}'.strip()
        return name or user.phone

    def get_can_solve(self, obj):
        return bool(
            obj.status == StatementDiscrepancy.STATUS_OPEN
            and obj.user_id
            and obj.suggested_adjustment_type
            and obj.suggested_amount is not None
            and Decimal(str(obj.suggested_amount)) > 0
        )

    def get_can_correct(self, obj):
        return bool(obj.user_id)


class WalletBalanceIssueSerializer(serializers.ModelSerializer):
    txn_type_display = serializers.CharField(
        source='get_txn_type_display', read_only=True, default='',
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    direction_display = serializers.CharField(
        source='get_direction_display', read_only=True, default='',
    )
    user_phone = serializers.CharField(source='user.phone', read_only=True, default=None)
    user_name = serializers.SerializerMethodField()
    user_email = serializers.CharField(source='user.email', read_only=True, default=None)
    shared_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    can_share = serializers.SerializerMethodField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=True)
    balance_before = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True,
    )
    recorded_balance_after = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True,
    )
    expected_balance_after = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True,
    )
    current_wallet_balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True,
    )
    suggested_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True, allow_null=True,
    )

    class Meta:
        model = WalletBalanceIssue
        fields = (
            'id', 'fingerprint', 'user', 'user_phone', 'user_name', 'user_email',
            'txn_type', 'txn_type_display', 'txn_id', 'party', 'direction',
            'direction_display', 'amount', 'balance_before', 'recorded_balance_after',
            'expected_balance_after', 'current_wallet_balance', 'txn_at',
            'txn_reference', 'txn_status', 'service_name', 'description',
            'txn_snapshot', 'suggested_adjustment_type', 'suggested_amount',
            'status', 'status_display', 'reason', 'can_share',
            'detected_at', 'shared_by', 'shared_by_name', 'shared_at',
            'resolved_by', 'resolved_by_name', 'resolved_at',
            'resolution_adjustment', 'email_sent_at', 'created_at', 'updated_at',
        )
        read_only_fields = fields

    def get_user_name(self, obj):
        user = obj.user
        if not user:
            return None
        name = f'{user.first_name or ""} {user.last_name or ""}'.strip()
        return name or user.phone

    def _admin_name(self, admin):
        if not admin:
            return None
        name = f'{admin.first_name or ""} {admin.last_name or ""}'.strip()
        return name or admin.phone

    def get_shared_by_name(self, obj):
        return self._admin_name(obj.shared_by)

    def get_resolved_by_name(self, obj):
        return self._admin_name(obj.resolved_by)

    def get_can_share(self, obj):
        return bool(
            obj.status == WalletBalanceIssue.STATUS_OPEN
            and obj.user_id
            and obj.suggested_adjustment_type
            and obj.suggested_amount is not None
        )


class HomePopupSerializer(serializers.ModelSerializer):
    """Serializer for home-screen popups managed by staff."""

    image_url = serializers.SerializerMethodField()

    class Meta:
        model = HomePopup
        fields = (
            'id', 'title', 'body', 'image', 'image_url',
            'max_per_24h', 'is_active', 'sort_order',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'image_url', 'created_at', 'updated_at')
        extra_kwargs = {
            'image': {'write_only': True, 'required': False, 'allow_null': True},
        }

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url

    def validate(self, attrs):
        title = attrs.get('title', getattr(self.instance, 'title', '') if self.instance else '')
        body = attrs.get('body', getattr(self.instance, 'body', '') if self.instance else '')
        image = attrs.get('image', getattr(self.instance, 'image', None) if self.instance else None)
        clearing_image = self.context.get('clear_image')
        if clearing_image:
            image = None
        has_text = bool((title or '').strip() or (body or '').strip())
        has_image = bool(image)
        if not has_text and not has_image:
            raise serializers.ValidationError(
                'Popup must include text, an image, or both.'
            )
        max_per = attrs.get('max_per_24h')
        if max_per is not None and int(max_per) < 1:
            raise serializers.ValidationError(
                {'max_per_24h': 'Must be at least 1 time per 24 hours.'}
            )
        return attrs


class PushNotificationSerializer(serializers.ModelSerializer):
    """Admin history of sent app push notifications."""

    sent_by_phone = serializers.SerializerMethodField()
    target_user_phone = serializers.SerializerMethodField()
    audience_display = serializers.CharField(source='get_audience_display', read_only=True)

    class Meta:
        model = PushNotification
        fields = (
            'id', 'title', 'body', 'audience', 'audience_display',
            'target_phone', 'target_user_phone', 'sent_by_phone',
            'sent', 'failed', 'skipped', 'target_count', 'created_at',
        )
        read_only_fields = fields

    def get_sent_by_phone(self, obj):
        user = obj.sent_by
        return getattr(user, 'phone', None) if user else None

    def get_target_user_phone(self, obj):
        if obj.target_phone:
            return obj.target_phone
        user = obj.target_user
        return getattr(user, 'phone', None) if user else None


def support_chat_user_brief(user, request=None, viewer=None):
    if user is None:
        return None
    from .services.hierarchy import is_admin_actor

    viewer = viewer or (getattr(request, 'user', None) if request else None)
    if is_admin_actor(user) and not is_admin_actor(viewer):
        return {
            'id': user.pk,
            'phone': '',
            'name': 'Super Admin',
            'role': 'admin',
            'role_label': 'Super Admin',
            'is_staff': True,
            'is_superuser': True,
            'avatar_url': None,
            'identity_hidden': True,
        }

    avatar_url = None
    if getattr(user, 'avatar', None):
        try:
            url = user.avatar.url
        except ValueError:
            url = None
        if url and request:
            avatar_url = request.build_absolute_uri(url)
        else:
            avatar_url = url
    role = getattr(user, 'role', 'customer') or 'customer'
    if getattr(user, 'is_superuser', False):
        role_label = 'Super Admin'
    elif getattr(user, 'is_staff', False) and role != 'dealer':
        role_label = 'Admin'
    elif role == 'dealer':
        role_label = 'Dealer'
    else:
        role_label = 'User'
    return {
        'id': user.pk,
        'phone': user.phone,
        'name': _user_display_name(user),
        'role': role,
        'role_label': role_label,
        'is_staff': bool(getattr(user, 'is_staff', False)),
        'is_superuser': bool(getattr(user, 'is_superuser', False)),
        'avatar_url': avatar_url,
        'identity_hidden': False,
    }


class SupportChatMessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.SerializerMethodField()
    sender_is_support = serializers.SerializerMethodField()
    sender_display_name = serializers.SerializerMethodField()
    has_attachment = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = SupportChatMessage
        fields = (
            'id', 'thread', 'sender_id', 'sender_is_support', 'sender_display_name',
            'body', 'kind', 'has_attachment', 'attachment_name', 'attachment_size',
            'attachment_content_type', 'attachment_url', 'is_read', 'created_at',
        )
        read_only_fields = fields

    def _viewer(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

    def get_sender_id(self, obj):
        from .services.hierarchy import canonical_support_admin, is_admin_actor

        viewer = self._viewer()
        if is_admin_actor(obj.sender) and not is_admin_actor(viewer):
            admin = canonical_support_admin()
            return admin.pk if admin is not None else obj.sender_id
        return obj.sender_id

    def get_sender_is_support(self, obj):
        from .services.hierarchy import is_admin_actor
        return is_admin_actor(obj.sender)

    def get_sender_display_name(self, obj):
        from .services.hierarchy import is_admin_actor
        if is_admin_actor(obj.sender):
            return 'Super Admin'
        return _user_display_name(obj.sender)

    def get_has_attachment(self, obj):
        return bool(getattr(obj, 'attachment', None))

    def get_attachment_url(self, obj):
        if not getattr(obj, 'attachment', None):
            return None
        return f'/api/support-chat/threads/{obj.thread_id}/messages/{obj.pk}/attachment/'

    def get_is_read(self, obj):
        peer_read_at = self.context.get('peer_read_at')
        if not peer_read_at:
            return False
        return peer_read_at >= obj.created_at


class SupportChatThreadSerializer(serializers.ModelSerializer):
    other_user = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = SupportChatThread
        fields = (
            'id', 'other_user', 'last_message_at', 'last_message_preview',
            'unread_count', 'created_at',
        )
        read_only_fields = fields

    def get_other_user(self, obj):
        from .services.support_chat import other_participant

        me = self.context.get('actor')
        other = other_participant(obj, me) if me is not None else obj.user_high
        return support_chat_user_brief(other, self.context.get('request'), viewer=me)

    def get_unread_count(self, obj):
        return int(self.context.get('unread_map', {}).get(obj.pk, 0))

