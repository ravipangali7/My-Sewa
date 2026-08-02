"""
Helpers for reading and enforcing the Settings singleton configuration.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Optional

from rest_framework import status
from rest_framework.response import Response

from ..models import Settings


def get_app_config() -> Dict[str, Any]:
    return Settings.load().get_config()


def _to_decimal(value, default: str = '0') -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def payment_disabled_response(feature: str) -> Response:
    labels = {
        'deposits': 'Wallet deposits are currently disabled.',
        'topups': 'Mobile top-ups are currently disabled.',
        'transfers': 'Bank transfers are currently disabled.',
        'remittances': 'Remittance payouts are currently disabled.',
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


def platform_topup_charge(amount, percent) -> Decimal:
    """Extra platform fee as a percent of top-up amount."""
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


def resolve_transfer_fees(amount, provider_charge, provider_cashback, tx_cfg=None):
    """
    Apply Super Admin charge/cashback toggles and configured amounts.

    - transfer_charge_enabled + transfer_charge_flat gate platform charge
    - When charge is disabled, no charge is applied (provider charge ignored)
    - cashback_enabled gates cashback; configured flat/percent take priority,
      otherwise provider cashback is used when enabled
    """
    cfg = tx_cfg if isinstance(tx_cfg, dict) else (get_app_config().get('transactions') or {})
    charge_enabled = bool(cfg.get('transfer_charge_enabled', True))
    cashback_enabled = bool(cfg.get('cashback_enabled', True))

    if charge_enabled:
        platform_fee = platform_transfer_charge(cfg.get('transfer_charge_flat', 0))
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
    }.get(feature)
    if key and not payment.get(key, True):
        return payment_disabled_response(feature)
    return None


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
    When True, deposits/topups/transfers finalize as approved/success
    without waiting for Super Admin manual verification.
    """
    cfg = config or get_app_config()
    tx = cfg.get('transactions') or {}
    return bool(tx.get('auto_status_verified', False))


def get_himalpay_credentials() -> Dict[str, str]:
    """
    Resolve HimalPay credentials: Settings.config.integrations first, then env.
    """
    from django.conf import settings as django_settings

    env_key = (getattr(django_settings, 'HIMALPAY_API_KEY', '') or '').strip()
    env_base = (
        getattr(django_settings, 'HIMALPAY_BASE_URL', '')
        or 'https://uatapi.himalpay.com.np/api/v1'
    ).strip()

    try:
        integrations = get_app_config().get('integrations') or {}
    except Exception:
        integrations = {}

    db_key = str(integrations.get('himalpay_api_key') or '').strip()
    db_base = str(integrations.get('himalpay_base_url') or '').strip()

    return {
        'api_key': db_key or env_key,
        'base_url': (db_base or env_base).rstrip('/'),
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
            'session_timeout_minutes': (cfg.get('security') or {}).get(
                'session_timeout_minutes', 60
            ),
        },
        # Never expose HimalPay secrets on the public endpoint
    }
