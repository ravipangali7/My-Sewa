"""
Helpers for reading and enforcing the Settings singleton configuration.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Optional

from rest_framework import status
from rest_framework.response import Response

from ..models import Settings, UserFeeConfig


def get_app_config() -> Dict[str, Any]:
    try:
        return Settings.load().get_config()
    except Exception:
        from ..models import default_app_config, merge_app_config
        return merge_app_config(default_app_config())


def _to_decimal(value, default: str = '0') -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


_USER_FEE_OVERRIDE_KEYS = (
    'transfer_charge_enabled',
    'transfer_charge_flat',
    'transfer_charge_percent',
    'topup_charge_percent',
)


def resolve_tx_cfg_for_user(user=None, tx_cfg=None) -> Dict[str, Any]:
    """
    Merge global transactions config with optional per-user UserFeeConfig overrides.
    Null fields on UserFeeConfig mean "use global".
    """
    cfg = dict(tx_cfg if isinstance(tx_cfg, dict) else (get_app_config().get('transactions') or {}))
    if user is None:
        return cfg
    try:
        fee = getattr(user, 'fee_config', None)
        if fee is None:
            fee = UserFeeConfig.objects.filter(user_id=getattr(user, 'pk', None)).first()
    except Exception:
        fee = None
    if fee is None:
        return cfg
    for key in _USER_FEE_OVERRIDE_KEYS:
        value = getattr(fee, key, None)
        if value is not None:
            cfg[key] = value
    return cfg


def _platform_transfer_percent_charge(amount, percent) -> Decimal:
    pct = _to_decimal(percent)
    if pct <= 0:
        return Decimal('0.00')
    return (_to_decimal(amount) * pct / Decimal('100')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP
    )


def payment_disabled_response(feature: str) -> Response:
    labels = {
        'deposits': 'Manual wallet load is currently disabled.',
        'topups': 'Mobile top-ups are currently disabled.',
        'transfers': 'Bank transfers are currently disabled.',
        'remittances': 'Remittance payouts are currently disabled.',
        'internet_bills': 'Internet bill payments are currently disabled.',
        'data_packs': 'Data pack top-ups are currently disabled.',
        'water_bills': 'Water bill payments are currently disabled.',
        'electricity_bills': 'Electricity bill payments are currently disabled.',
        'community_electricity': 'Community electricity payments are currently disabled.',
    }
    return Response(
        {
            'error': labels.get(feature, 'This feature is currently disabled.'),
            'message': labels.get(feature, 'This feature is currently disabled.'),
            'code': f'{feature}_disabled',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def maintenance_response(config: Optional[Dict] = None) -> Response:
    cfg = config or get_app_config()
    security = cfg.get('security') or {}
    message = (
        security.get('maintenance_message')
        or 'MySewa is under maintenance. Please try again later.'
    )
    return Response(
        {
            'error': 'maintenance_mode',
            'message': message,
            'code': 'maintenance_mode',
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def validate_amount_bounds(
    amount,
    *,
    min_amount,
    max_amount,
    label: str = 'Amount',
) -> Optional[str]:
    """Return an error message if amount is outside bounds, else None."""
    value = _to_decimal(amount)
    min_v = _to_decimal(min_amount)
    max_v = _to_decimal(max_amount)
    if value < min_v:
        return f'Minimum {label.lower()} is Rs. {min_v.normalize()}.'
    if max_v > 0 and value > max_v:
        return f'Maximum {label.lower()} is Rs. {max_v.normalize()}.'
    return None


def platform_topup_charge(amount, percent=None, user=None) -> Decimal:
    """
    Extra platform fee as a percent of top-up amount.
    When user is provided, prefer UserFeeConfig.topup_charge_percent over percent/global.
    """
    if user is not None:
        cfg = resolve_tx_cfg_for_user(user)
        pct = _to_decimal(cfg.get('topup_charge_percent', 0))
    elif percent is None:
        cfg = get_app_config().get('transactions') or {}
        pct = _to_decimal(cfg.get('topup_charge_percent', 0))
    else:
        pct = _to_decimal(percent)
    if pct <= 0:
        return Decimal('0.00')
    fee = (_to_decimal(amount) * pct / Decimal('100')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP
    )
    return fee


def platform_transfer_charge(flat) -> Decimal:
    fee = _to_decimal(flat)
    if fee <= 0:
        return Decimal('0.00')
    return fee.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def platform_transfer_cashback(amount, flat=0, percent=0) -> Decimal:
    """Platform cashback from Super Admin settings (flat and/or percent)."""
    base = _to_decimal(amount)
    cashback = _to_decimal(flat)
    pct = _to_decimal(percent)
    if pct > 0:
        cashback += (base * pct / Decimal('100')).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
    if cashback <= 0:
        return Decimal('0.00')
    return cashback.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def resolve_transfer_fees(amount, provider_charge, provider_cashback, tx_cfg=None, user=None):
    """
    Apply Super Admin charge/cashback toggles and configured amounts.

    - transfer_charge_enabled + transfer_charge_flat/percent gate platform charge
    - When charge is disabled, no charge is applied (provider charge ignored)
    - cashback_enabled gates cashback; configured flat/percent take priority,
      otherwise provider cashback is used when enabled
    - Optional user prefers UserFeeConfig overrides over global Settings.config
    """
    cfg = resolve_tx_cfg_for_user(user, tx_cfg)
    charge_enabled = bool(cfg.get('transfer_charge_enabled', True))
    cashback_enabled = bool(cfg.get('cashback_enabled', True))

    if charge_enabled:
        platform_fee = platform_transfer_charge(cfg.get('transfer_charge_flat', 0))
        platform_fee += _platform_transfer_percent_charge(
            amount, cfg.get('transfer_charge_percent', 0)
        )
        charge = _to_decimal(provider_charge) + platform_fee
    else:
        platform_fee = Decimal('0.00')
        charge = Decimal('0.00')

    if cashback_enabled:
        configured = platform_transfer_cashback(
            amount,
            cfg.get('transfer_cashback_flat', 0),
            cfg.get('transfer_cashback_percent', 0),
        )
        cashback = configured if configured > 0 else _to_decimal(provider_cashback)
    else:
        cashback = Decimal('0.00')

    total = _to_decimal(amount) + charge - cashback
    if total < 0:
        total = Decimal('0.00')
    return {
        'charge': charge.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'cashback': cashback.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'platform_charge': platform_fee,
        'total_debited': total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'charge_enabled': charge_enabled,
        'cashback_enabled': cashback_enabled,
    }


def require_feature_enabled(feature: str) -> Optional[Response]:
    """
    feature: 'deposits' | 'topups' | 'transfers' | 'remittances'
    Returns a Response if disabled, else None.
    """
    payment = get_app_config().get('payment') or {}
    key = {
        'deposits': 'deposits_enabled',
        'topups': 'topups_enabled',
        'transfers': 'transfers_enabled',
        'remittances': 'remittances_enabled',
        'internet_bills': 'internet_bills_enabled',
        'data_packs': 'data_packs_enabled',
        'water_bills': 'water_bills_enabled',
        'electricity_bills': 'electricity_bills_enabled',
        'community_electricity': 'community_electricity_enabled',
    }.get(feature)
    if key and not payment.get(key, True):
        return payment_disabled_response(feature)
    return None


_USER_FEATURE_MESSAGES = {
    'fund_transfer': (
        'can_fund_transfer',
        'Fund transfer is disabled for this account.',
        'fund_transfer_forbidden',
    ),
    'wallet_adjustment': (
        'can_wallet_adjust',
        'Wallet adjustment is disabled for this account.',
        'wallet_adjustment_forbidden',
    ),
}


def require_user_feature(user, feature: str) -> Optional[Response]:
    """
    Per-user feature access. feature: 'fund_transfer' | 'wallet_adjustment'.
    Returns a 403 Response when the user is not allowed, else None.
    """
    spec = _USER_FEATURE_MESSAGES.get(feature)
    if spec is None:
        return None
    field, message, code = spec
    if user is None:
        return Response(
            {
                'error': 'authentication_required',
                'message': 'Authentication required.',
                'code': 'authentication_required',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if getattr(user, field, True):
        return None
    return Response(
        {
            'error': message,
            'message': message,
            'code': code,
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def require_wallet_not_blocked(user) -> Optional[Response]:
    """Block outbound payments when the user's wallet is locked by statement mismatch."""
    from .wallet_guard import require_wallet_not_blocked as _impl
    return _impl(user)


def require_account_approved(user) -> Optional[Response]:
    """
    Block business transactions for accounts that are still pending approval.
    Staff / superusers are always allowed.
    """
    if user is None:
        return Response(
            {
                'error': 'authentication_required',
                'message': 'Authentication required.',
                'code': 'authentication_required',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if getattr(user, 'is_account_approved', True):
        return None
    return Response(
        {
            'error': 'account_pending',
            'message': (
                'Your account is pending Super Admin approval. '
                'You can sign in, but transactions are disabled until your account is Active.'
            ),
            'code': 'account_pending',
            'account_status': getattr(user, 'account_status', 'pending'),
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def is_auto_status_verified(config: Optional[Dict] = None) -> bool:
    """
    When True, top-ups/transfers/bills finalize as success without waiting
    for Super Admin manual verification.

    Manual wallet deposits are never auto-approved; they always require
    Super Admin review on the Admin Deposits page.
    """
    cfg = config or get_app_config()
    tx = cfg.get('transactions') or {}
    return bool(tx.get('auto_status_verified', False))


def get_himalpay_credentials() -> Dict[str, str]:
    """
    Resolve HimalPay credentials: Settings.config.integrations first, then env.

    Optional portal login (phone or email + password) is used as a LIVE fallback
    for statement/balance via /users/statement and /users/me/wallet when the
    reseller ledger routes are not deployed yet.
    """
    from django.conf import settings as django_settings

    env_key = (getattr(django_settings, 'HIMALPAY_API_KEY', '') or '').strip()
    env_base = (
        getattr(django_settings, 'HIMALPAY_BASE_URL', '')
        or 'https://api.himalpay.com.np/api/v1'
    ).strip()
    env_phone = (getattr(django_settings, 'HIMALPAY_PORTAL_PHONE', '') or '').strip()
    env_email = (getattr(django_settings, 'HIMALPAY_PORTAL_EMAIL', '') or '').strip()
    env_password = (getattr(django_settings, 'HIMALPAY_PORTAL_PASSWORD', '') or '').strip()

    try:
        integrations = get_app_config().get('integrations') or {}
    except Exception:
        integrations = {}

    db_key = str(integrations.get('himalpay_api_key') or '').strip()
    db_base = str(integrations.get('himalpay_base_url') or '').strip()
    db_phone = str(integrations.get('himalpay_portal_phone') or '').strip()
    db_email = str(integrations.get('himalpay_portal_email') or '').strip()
    db_password = str(integrations.get('himalpay_portal_password') or '').strip()

    return {
        'api_key': db_key or env_key,
        'base_url': (db_base or env_base).rstrip('/'),
        'portal_phone': db_phone or env_phone,
        'portal_email': db_email or env_email,
        'portal_password': db_password or env_password,
    }


def public_config(config: Optional[Dict] = None) -> Dict[str, Any]:
    """Config safe to expose on the public settings endpoint."""
    cfg = config or get_app_config()
    notifications = dict(cfg.get('notifications') or {})
    # Hide admin-only contact details from anonymous clients
    notifications.pop('admin_alert_email', None)
    return {
        'site': cfg.get('site') or {},
        'payment': cfg.get('payment') or {},
        'transactions': cfg.get('transactions') or {},
        'notifications': {
            'email_on_deposit': bool(notifications.get('email_on_deposit')),
            'email_on_topup': bool(notifications.get('email_on_topup')),
            'sms_on_deposit_approved': bool(notifications.get('sms_on_deposit_approved')),
            'email_on_wallet_credit': bool(notifications.get('email_on_wallet_credit')),
            'email_on_wallet_debit': bool(notifications.get('email_on_wallet_debit')),
            'email_on_transfer': bool(notifications.get('email_on_transfer')),
            'email_on_wallet_adjustment': bool(notifications.get('email_on_wallet_adjustment')),
            'notify_low_balance': bool(notifications.get('notify_low_balance')),
            'low_balance_threshold': notifications.get('low_balance_threshold', 100),
        },
        'security': {
            'require_deposit_screenshot': bool(
                (cfg.get('security') or {}).get('require_deposit_screenshot', True)
            ),
            'maintenance_mode': bool((cfg.get('security') or {}).get('maintenance_mode')),
            'maintenance_message': (cfg.get('security') or {}).get('maintenance_message') or '',
            'allow_new_registrations': bool(
                (cfg.get('security') or {}).get('allow_new_registrations', True)
            ),
            'otp_login_enabled': bool(
                (cfg.get('security') or {}).get('otp_login_enabled', True)
            ),
            'session_timeout_minutes': (cfg.get('security') or {}).get(
                'session_timeout_minutes', 60
            ),
        },
        # Never expose HimalPay / SMTP secrets on the public endpoint
    }
