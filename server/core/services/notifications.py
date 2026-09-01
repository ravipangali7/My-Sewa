"""
Notification helpers that respect Settings.config.notifications toggles.

Email uses admin-configured SMTP (Settings.config.smtp) with Django EMAIL_*
env fallbacks. SMS has no provider configured yet, so when enabled we log the
outbound SMS. Push uses core.services.push (FCM when configured, otherwise
logged no-op). One notify_* call can deliver email + SMS + push together.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from django.conf import settings as django_settings
from django.utils import timezone

from .app_config import get_app_config
from .push import send_push_to_user
from .smtp import format_from_address, get_smtp_config, send_smtp_email

logger = logging.getLogger(__name__)

Row = Tuple[str, str]


def _from_email() -> str:
    return format_from_address(get_smtp_config())


def _site_name() -> str:
    site = get_app_config().get('site') or {}
    return site.get('site_name') or 'MySewa'


def _site_cfg() -> dict:
    return get_app_config().get('site') or {}


def _notif_cfg() -> dict:
    return get_app_config().get('notifications') or {}


def _user_email(user) -> Optional[str]:
    email = (getattr(user, 'email', None) or '').strip()
    return email or None


def _fmt_amount(amount) -> str:
    try:
        value = Decimal(str(amount)).quantize(Decimal('0.01'))
        text = f'{value:,.2f}'.rstrip('0').rstrip('.')
        return f'Rs. {text}'
    except Exception:
        return f'Rs. {amount}'


def _balance_line(balance_after) -> str:
    if balance_after is None:
        return ''
    return f'New balance: {_fmt_amount(balance_after)}\n'


def _wallet_balance(user):
    try:
        return user.wallet.balance
    except Exception:
        return None


def mask_email(email: str) -> str:
    """Mask an email for safe display, e.g. j***@gmail.com."""
    email = (email or '').strip()
    if not email or '@' not in email:
        return '***'
    local, _, domain = email.partition('@')
    if not local:
        return f'***@{domain}'
    return f'{local[0]}***@{domain}'


def mask_phone(phone: str) -> str:
    """Mask a phone for safe display, e.g. 98******01."""
    phone = (phone or '').strip()
    if len(phone) < 4:
        return '***'
    if len(phone) <= 6:
        return f'{phone[0]}***{phone[-1]}'
    return f'{phone[:2]}{"*" * (len(phone) - 4)}{phone[-2:]}'


def _escape(value) -> str:
    if value is None:
        return ''
    return html.escape(str(value))


def _logo_url() -> Optional[str]:
    try:
        from ..models import Settings

        settings_obj = Settings.load()
        backend_origin = (
            getattr(django_settings, 'BACKEND_ORIGIN', None)
            or getattr(django_settings, 'BACKEND_URL', None)
            or ''
        ).rstrip('/')
        frontend_origin = (
            getattr(django_settings, 'FRONTEND_ORIGIN', None)
            or getattr(django_settings, 'FRONTEND_URL', None)
            or ''
        ).rstrip('/')

        if settings_obj.logo:
            media_url = settings_obj.logo.url
            if media_url.startswith('http'):
                return media_url
            if backend_origin:
                return f'{backend_origin}{media_url}'
            return media_url

        # Fallback to public SPA logo asset
        if frontend_origin:
            return f'{frontend_origin}/logo.png'
    except Exception:
        logger.debug('Could not resolve logo URL for email', exc_info=True)
    return None


def _format_when(value=None) -> str:
    dt = value or timezone.now()
    if timezone.is_aware(dt):
        try:
            dt = timezone.localtime(dt, ZoneInfo('Asia/Kathmandu'))
        except Exception:
            dt = timezone.localtime(dt)
    if isinstance(dt, datetime):
        return dt.strftime('%d %b %Y, %I:%M %p')
    return str(dt)


def _status_colors(status: str) -> Tuple[str, str, str]:
    key = (status or '').lower()
    if key in ('success', 'approved', 'credited', 'connected'):
        return '#0a7a4b', '#ecfdf3', '#166534'
    if key in ('failed', 'rejected', 'error'):
        return '#dc2626', '#fef2f2', '#991b1b'
    return '#d97706', '#fffbeb', '#92400e'


def render_transaction_email(
    *,
    title: str,
    subtitle: str = '',
    amount_label: str = 'Amount',
    amount_display: str = '',
    status: str = 'success',
    status_label: Optional[str] = None,
    rows: Sequence[Row] = (),
    footer_note: str = '',
    greeting: str = '',
) -> str:
    """
    Branded, responsive HTML receipt matching MySewa statement/PDF colors:
    navy header (#062a5c), brand green (#0a7a4b / #20c36a), clean detail rows.
    """
    site = _site_cfg()
    site_name = _escape(_site_name())
    support_email = _escape((site.get('support_email') or '').strip())
    support_phone = _escape((site.get('support_phone') or '').strip())
    logo = _logo_url()
    tone_bg, tone_soft, tone_text = _status_colors(status)
    badge = _escape(status_label or status or 'Success')
    amount_html = _escape(amount_display) if amount_display else ''
    subtitle_html = _escape(subtitle) if subtitle else ''
    greeting_html = _escape(greeting) if greeting else ''
    note_html = _escape(footer_note) if footer_note else (
        'This is an automated message from MySewa. Please do not reply to this email.'
    )

    row_html = []
    for label, value in rows:
        if value is None or str(value).strip() == '':
            continue
        row_html.append(
            '<tr>'
            f'<td style="padding:10px 0;font-size:13px;color:#6b7280;vertical-align:top;'
            f'width:42%;border-bottom:1px solid #f1f5f9;">{_escape(label)}</td>'
            f'<td style="padding:10px 0;font-size:13px;color:#111827;font-weight:600;'
            f'text-align:right;vertical-align:top;border-bottom:1px solid #f1f5f9;">'
            f'{_escape(value)}</td>'
            '</tr>'
        )
    details = ''.join(row_html)

    logo_block = ''
    if logo:
        logo_block = (
            f'<img src="{_escape(logo)}" alt="{site_name}" width="48" height="48" '
            'style="display:block;border:0;border-radius:12px;margin:0 auto 12px;" />'
        )
    else:
        logo_block = (
            '<div style="width:48px;height:48px;border-radius:12px;margin:0 auto 12px;'
            'background:linear-gradient(135deg,#0a7a4b 0%,#20c36a 100%);'
            'color:#fff;font-weight:700;font-size:22px;line-height:48px;text-align:center;">S</div>'
        )

    support_bits = []
    if support_email:
        support_bits.append(support_email)
    if support_phone:
        support_bits.append(support_phone)
    support_line = ' · '.join(support_bits)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{_escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(6,42,92,0.08);">
          <tr>
            <td style="background:linear-gradient(120deg,#062a5c 0%,#0b3b7a 45%,#0a7a4b 100%);padding:28px 24px 22px;text-align:center;">
              {logo_block}
              <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">{site_name}</div>
              <div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.82);">Digital wallet &amp; bill payments</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              {f'<p style="margin:0 0 8px;font-size:14px;color:#4b5563;">{greeting_html}</p>' if greeting_html else ''}
              <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#062a5c;font-weight:700;">{_escape(title)}</h1>
              {f'<p style="margin:0 0 18px;font-size:14px;color:#6b7280;line-height:1.5;">{subtitle_html}</p>' if subtitle_html else '<div style="height:10px;"></div>'}
              <div style="text-align:center;padding:18px 16px;border-radius:14px;background:linear-gradient(180deg,#f0fdf4 0%,#ffffff 100%);border:1px solid #dcfce7;margin-bottom:20px;">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;">{_escape(amount_label)}</div>
                {f'<div style="margin-top:6px;font-size:30px;font-weight:800;color:#0a7a4b;letter-spacing:-0.02em;">{amount_html}</div>' if amount_html else ''}
                <div style="margin-top:12px;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:{tone_soft};color:{tone_text};font-size:12px;font-weight:700;border:1px solid {tone_bg}33;">{badge}</span>
                </div>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                {details}
              </table>
              <p style="margin:22px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">{note_html}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#062a5c;padding:18px 24px;text-align:center;">
              <div style="font-size:13px;font-weight:600;color:#ffffff;">{site_name}</div>
              {f'<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.75);">{support_line}</div>' if support_line else ''}
              <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.55);">&copy; {timezone.now().year} {site_name}. All rights reserved.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _rows_to_text(rows: Sequence[Row]) -> str:
    lines = []
    for label, value in rows:
        if value is None or str(value).strip() == '':
            continue
        lines.append(f'{label}: {value}')
    return '\n'.join(lines)


def _admin_alert_emails() -> List[str]:
    """
    Resolve Super Admin inbox(es) for notification copies.

    Prefer Settings.config.notifications.admin_alert_email; if unset, fall back
    to active superuser account emails, then active staff emails.
    """
    alert = (_notif_cfg().get('admin_alert_email') or '').strip()
    if alert:
        return [alert]

    try:
        from django.contrib.auth import get_user_model

        User = get_user_model()
        emails = list(
            User.objects.filter(is_superuser=True, is_active=True)
            .exclude(email__isnull=True)
            .exclude(email='')
            .values_list('email', flat=True)
        )
        if not emails:
            emails = list(
                User.objects.filter(is_staff=True, is_active=True)
                .exclude(email__isnull=True)
                .exclude(email='')
                .values_list('email', flat=True)
            )
    except Exception:
        logger.exception('Failed to resolve Super Admin emails')
        return []

    seen = set()
    result: List[str] = []
    for raw in emails:
        email = (raw or '').strip()
        key = email.lower()
        if not email or key in seen:
            continue
        seen.add(key)
        result.append(email)
    if not result:
        logger.warning(
            'No Super Admin alert email configured '
            '(set notifications.admin_alert_email or a superuser email)'
        )
    return result


def _send_email(
    subject: str,
    message: str,
    recipients: list,
    html_message: Optional[str] = None,
    *,
    fail_silently: bool = True,
    copy_admin: bool = True,
) -> bool:
    """
    Send an email via configured SMTP.

    When copy_admin is True (default), the identical message is also sent to the
    Super Admin so every notification email is mirrored.
    """
    recipients = [r for r in recipients if r]
    if not recipients:
        logger.info('Email skipped (no recipients): %s', subject)
        return False

    try:
        sent = send_smtp_email(
            subject,
            message,
            recipients,
            html_body=html_message,
            fail_silently=fail_silently,
        )
        if not sent:
            logger.error('Email not accepted by SMTP for %s: %s', recipients, subject)
            return False
        logger.info('Email sent to %s: %s', recipients, subject)
    except Exception:
        logger.exception('Failed to send email: %s', subject)
        if not fail_silently:
            raise
        return False

    if copy_admin:
        _mirror_email_to_admin(
            subject=subject,
            message=message,
            html_message=html_message,
            primary_recipients=recipients,
        )
    return True


def _mirror_email_to_admin(
    *,
    subject: str,
    message: str,
    html_message: Optional[str],
    primary_recipients: list,
) -> None:
    """Best-effort: send the same email content to Super Admin inbox(es)."""
    primary = {(r or '').strip().lower() for r in primary_recipients}
    admin_recipients = [
        email for email in _admin_alert_emails() if email.lower() not in primary
    ]
    if not admin_recipients:
        return
    try:
        mirrored = send_smtp_email(
            subject,
            message,
            admin_recipients,
            html_body=html_message,
            fail_silently=True,
        )
        if mirrored:
            logger.info(
                'Mirrored email to Super Admin %s: %s',
                admin_recipients,
                subject,
            )
        else:
            logger.error(
                'Failed to mirror email to Super Admin %s: %s',
                admin_recipients,
                subject,
            )
    except Exception:
        logger.exception('Failed to mirror email to Super Admin: %s', subject)


def _opposite_direction(direction: str) -> str:
    return 'debit' if direction == 'credit' else 'credit'


def _admin_float_balance():
    """
    Best-effort Admin Wallet (HimalPay reseller float) balance in rupees.
    Returns None when the float cannot be resolved.
    """
    try:
        from .himalpay import HimalPayAPI

        data = HimalPayAPI().get_reseller_balance() or {}
        for key in (
            'total_balance_in_rupees',
            'balance_in_rupees',
            'balance',
        ):
            raw = data.get(key)
            if raw is None or raw == '':
                continue
            return Decimal(str(raw))
    except Exception:
        logger.debug('Could not resolve Admin Wallet float for email', exc_info=True)
    return None


def _resolve_admin_balance_after(
    *,
    admin_direction: str,
    amount,
    admin_balance_after=None,
    admin_balance_before=None,
):
    """
    Prefer an explicit post-txn Admin Wallet balance; otherwise live float;
    otherwise derive from a known pre-txn balance ± amount.
    """
    if admin_balance_after is not None:
        try:
            return Decimal(str(admin_balance_after))
        except Exception:
            return admin_balance_after

    live = _admin_float_balance()
    if live is not None:
        return live

    if admin_balance_before is None:
        return None
    try:
        before = Decimal(str(admin_balance_before))
        delta = Decimal(str(amount))
        if admin_direction == 'debit':
            return before - delta
        return before + delta
    except Exception:
        return None


def _send_admin_wallet_email(
    *,
    user,
    admin_direction: str,
    amount,
    customer_direction: str = None,
    customer_balance_after=None,
    admin_balance_after=None,
    admin_balance_before=None,
    reason: str = None,
    ref: str = None,
    extra_rows: Optional[Sequence[Row]] = None,
    context_label: str = 'Wallet movement',
) -> None:
    """
    Notify Super Admin of an Admin Wallet debit/credit with amount and remaining balance.

    Payments and remittances debit the Admin Wallet (HimalPay float). Customer wallet
    movement is included for context (credit on remittance/deposit, debit on payment).
    """
    admin_emails = _admin_alert_emails()
    if not admin_emails:
        return

    direction = (admin_direction or 'debit').lower()
    if direction not in ('debit', 'credit'):
        direction = 'debit'

    site_name = _site_name()
    amount_display = _fmt_amount(amount)
    admin_status = 'Debited' if direction == 'debit' else 'Credited'
    cust_dir = (customer_direction or '').lower()
    customer_status = (
        'credited' if cust_dir == 'credit'
        else 'debited' if cust_dir == 'debit'
        else None
    )
    customer_phone = getattr(user, 'phone', None) or '-'
    customer_name = (
        f'{getattr(user, "first_name", "") or ""} {getattr(user, "last_name", "") or ""}'
    ).strip() or '-'
    remaining = _resolve_admin_balance_after(
        admin_direction=direction,
        amount=amount,
        admin_balance_after=admin_balance_after,
        admin_balance_before=admin_balance_before,
    )
    remaining_display = _fmt_amount(remaining) if remaining is not None else '-'

    type_label = f'Admin wallet {direction}'
    if cust_dir in ('credit', 'debit'):
        type_label = f'Admin {direction} · customer {cust_dir}'

    rows: List[Row] = [
        ('Type', type_label),
        ('Context', context_label),
        ('Customer', f'{customer_name} ({customer_phone})'),
        ('Amount', amount_display),
        ('Debit / Credit', admin_status),
        ('Admin wallet balance', remaining_display),
        (
            'Customer wallet balance',
            _fmt_amount(customer_balance_after)
            if customer_balance_after is not None
            else '-',
        ),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', admin_status),
    ]
    if extra_rows:
        # Insert extras before Status.
        rows = rows[:-1] + list(extra_rows) + rows[-1:]

    if direction == 'debit':
        title = 'Admin wallet debited'
        subtitle = (
            f'{amount_display} was debited from the Admin Wallet. '
            f'Remaining wallet balance: {remaining_display}.'
        )
        text_intro = (
            f'{amount_display} was debited from the Admin Wallet.\n'
            f'Remaining Admin Wallet balance: {remaining_display}.'
        )
        if customer_status:
            text_intro += (
                f'\nCustomer {customer_phone} wallet was {customer_status} '
                f'{amount_display}.'
            )
    else:
        title = 'Admin wallet credited'
        subtitle = (
            f'{amount_display} was credited to the Admin Wallet. '
            f'Updated wallet balance: {remaining_display}.'
        )
        text_intro = (
            f'{amount_display} was credited to the Admin Wallet.\n'
            f'Updated Admin Wallet balance: {remaining_display}.'
        )
        if customer_status:
            text_intro += (
                f'\nCustomer {customer_phone} wallet was {customer_status} '
                f'{amount_display}.'
            )

    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] Admin wallet {direction} · {customer_phone}',
        text_intro=text_intro,
        title=title,
        subtitle=subtitle,
        amount_display=amount_display,
        amount_label='Admin wallet debit' if direction == 'debit' else 'Admin wallet credit',
        status='success',
        status_label=admin_status,
        rows=rows,
        copy_admin=False,
    )


def _send_admin_opposite_wallet_email(
    *,
    user,
    customer_direction: str,
    amount,
    balance_after=None,
    reason: str = None,
    ref: str = None,
    extra_rows: Optional[Sequence[Row]] = None,
    context_label: str = 'Wallet movement',
    admin_direction: str = None,
    admin_balance_after=None,
    admin_balance_before=None,
) -> None:
    """
    Notify Super Admin of Admin Wallet movement for a customer wallet event.

    Default: opposite ledger (customer credit → admin debit).
    Payment / remittance callers pass admin_direction='debit' so the Admin Wallet
    is always shown as debited with the remaining float balance.
    """
    direction = admin_direction or _opposite_direction(customer_direction)
    _send_admin_wallet_email(
        user=user,
        admin_direction=direction,
        amount=amount,
        customer_direction=customer_direction,
        customer_balance_after=balance_after,
        admin_balance_after=admin_balance_after,
        admin_balance_before=admin_balance_before,
        reason=reason,
        ref=ref,
        extra_rows=extra_rows,
        context_label=context_label,
    )


def _send_txn_email(
    *,
    recipients: list,
    subject: str,
    text_intro: str,
    title: str,
    subtitle: str = '',
    amount_label: str = 'Amount',
    amount_display: str = '',
    status: str = 'success',
    status_label: Optional[str] = None,
    rows: Sequence[Row] = (),
    fail_silently: bool = True,
    greeting: str = '',
    footer_note: str = '',
    copy_admin: bool = True,
) -> bool:
    text = text_intro.rstrip() + '\n\n' + _rows_to_text(rows) + '\n'
    html = render_transaction_email(
        title=title,
        subtitle=subtitle,
        amount_label=amount_label,
        amount_display=amount_display,
        status=status,
        status_label=status_label,
        rows=rows,
        greeting=greeting,
        footer_note=footer_note,
    )
    return _send_email(
        subject,
        text,
        recipients,
        html_message=html,
        fail_silently=fail_silently,
        copy_admin=copy_admin,
    )


def _charge_breakdown_rows(txn) -> List[Row]:
    if txn is None:
        return []
    try:
        from .txn_charges import get_transaction_charge
        row = get_transaction_charge(txn)
    except Exception:
        row = None
    if row is None:
        return []
    rows: List[Row] = [
        ('System charge', _fmt_amount(row.system_charge)),
        ('Dealer commission', _fmt_amount(row.dealer_commission)),
        ('HimalPay charge', _fmt_amount(row.himalpay_charge)),
        ('Total charges', _fmt_amount(row.total_charges)),
    ]
    if row.cashback:
        rows.append(('Cashback', _fmt_amount(row.cashback)))
    return rows


def _notify_assigned_dealer(
    user,
    *,
    subject: str,
    text_intro: str,
    title: str,
    subtitle: str,
    rows: Sequence[Row],
    amount_display: str,
    amount_label: str = 'Amount',
    status_label: str = 'Completed',
) -> None:
    """Email the User's assigned Dealer when a transaction completes."""
    if user is None:
        return
    try:
        from .hierarchy import ROLE_DEALER, resolve_assigned_dealer
        if getattr(user, 'role', None) == ROLE_DEALER:
            return
        dealer = resolve_assigned_dealer(user)
    except Exception:
        return
    if dealer is None or dealer.pk == getattr(user, 'pk', None):
        return
    email = _user_email(dealer)
    if not email:
        return
    user_name = (
        f'{(getattr(user, "first_name", None) or "").strip()} '
        f'{(getattr(user, "last_name", None) or "").strip()}'.strip()
        or getattr(user, 'phone', '') or 'User'
    )
    dealer_rows: List[Row] = [
        ('Customer', f'{user_name} ({getattr(user, "phone", "") or "-"})'),
        *list(rows),
    ]
    _send_txn_email(
        recipients=[email],
        subject=subject,
        text_intro=text_intro,
        title=title,
        subtitle=subtitle,
        amount_display=amount_display,
        amount_label=amount_label,
        status='success',
        status_label=status_label,
        rows=dealer_rows,
        greeting=f'Hi {getattr(dealer, "first_name", "") or "there"},',
        copy_admin=False,
    )


def send_password_reset_otp(email: str, otp: str) -> bool:
    """Send a password-reset OTP to the user's registered email."""
    site_name = _site_name()
    subject = f'{site_name} Password Reset OTP'
    text = (
        f'Your {site_name} password reset code is: {otp}\n\n'
        'This code expires in 15 minutes.\n'
        'If you did not request a password reset, you can ignore this email.'
    )
    html = render_transaction_email(
        title='Password reset code',
        subtitle='Use this one-time code to reset your account password.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 15 minutes',
        rows=[
            ('Expires', '15 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note='If you did not request a password reset, you can ignore this email.',
    )
    return _send_email(subject, text, [email], html_message=html, fail_silently=True)


def send_login_otp(
    user,
    otp: str,
    *,
    expires_minutes: int = 5,
    preferred_channel: str | None = None,
) -> dict:
    """
    Send a login OTP to the user.

    preferred_channel:
      - 'email': send only to email (email login)
      - 'sms': send via SMS; also email when available so the user can still
        receive the code if SMS delivery is unavailable
      - None / other: try both channels (legacy)

    Returns a dict with email_sent / sms_sent booleans and channel hints.
    Login proceeds when at least one requested channel succeeds.
    """
    site_name = _site_name()
    email = _user_email(user)
    phone = (getattr(user, 'phone', None) or '').strip()
    expiry_label = f'{expires_minutes} minute{"s" if expires_minutes != 1 else ""}'
    prefer = (preferred_channel or '').strip().lower() or None

    if prefer == 'email':
        send_email = True
        send_sms = False
    elif prefer == 'sms':
        send_sms = True
        # Keep email as a delivery fallback for phone login.
        send_email = bool(email)
    else:
        send_email = True
        send_sms = True

    email_sent = False
    sms_sent = False

    if send_email and email:
        subject = f'{site_name} Login OTP'
        text = (
            f'Your {site_name} login verification code is: {otp}\n\n'
            f'This code expires in {expiry_label}.\n'
            'If you did not try to sign in, secure your account immediately.'
        )
        html = render_transaction_email(
            title='Login verification code',
            subtitle='Use this one-time code to finish signing in.',
            amount_label='Verification code',
            amount_display=otp,
            status='success',
            status_label=f'Valid {expiry_label}',
            rows=[
                ('Expires', expiry_label),
                ('Security tip', 'Never share this code with anyone.'),
            ],
            footer_note=(
                'If you did not try to sign in, secure your account immediately.'
            ),
        )
        email_sent = _send_email(
            subject, text, [email], html_message=html, fail_silently=True
        )

    if send_sms and phone:
        sms_message = (
            f'{site_name} login code: {otp}. '
            f'Valid for {expiry_label}. Do not share this code.'
        )
        sms_sent = _send_sms(phone, sms_message)

    return {
        'email_sent': email_sent,
        'sms_sent': sms_sent,
        'email_hint': mask_email(email) if email and email_sent else None,
        'phone_hint': mask_phone(phone) if phone and sms_sent else None,
        'channels': [
            *(['email'] if email_sent else []),
            *(['sms'] if sms_sent else []),
        ],
        'preferred_channel': prefer,
    }


def send_transaction_pin_reset_otp(email: str, otp: str) -> bool:
    """Send a transaction-PIN reset OTP to the user's registered email."""
    site_name = _site_name()
    subject = f'{site_name} Transaction PIN Reset OTP'
    text = (
        f'Your {site_name} transaction PIN reset code is: {otp}\n\n'
        'This code expires in 15 minutes.\n'
        'If you did not request a PIN reset, you can ignore this email '
        'and keep using your current PIN.'
    )
    html = render_transaction_email(
        title='Transaction PIN reset code',
        subtitle='Use this one-time code to reset your transaction PIN.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 15 minutes',
        rows=[
            ('Expires', '15 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note=(
            'If you did not request a PIN reset, you can ignore this email '
            'and keep using your current PIN.'
        ),
    )
    return _send_email(subject, text, [email], html_message=html, fail_silently=True)


def send_phone_change_otp(email: str, otp: str, new_phone: str) -> bool:
    """Send OTP to current email before changing the registered phone."""
    site_name = _site_name()
    subject = f'{site_name} Phone Change OTP'
    text = (
        f'Your {site_name} phone change verification code is: {otp}\n\n'
        f'You requested to change your phone number to {new_phone}.\n'
        'This code expires in 2 minutes.\n'
        'If you did not request this change, secure your account immediately.'
    )
    html = render_transaction_email(
        title='Phone change verification',
        subtitle=f'Confirm changing your phone number to {new_phone}.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 2 minutes',
        rows=[
            ('New phone', new_phone),
            ('Expires', '2 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note=(
            'If you did not request this change, secure your account immediately.'
        ),
    )
    return _send_email(subject, text, [email], html_message=html, fail_silently=True)


def send_email_change_otp(email: str, otp: str, new_email: str) -> bool:
    """Send OTP to the current registered email before changing email."""
    site_name = _site_name()
    subject = f'{site_name} Email Change OTP'
    text = (
        f'Your {site_name} email change verification code is: {otp}\n\n'
        f'You requested to change your email address to {new_email}.\n'
        'Enter this code in the MySewa app to confirm the change.\n'
        'This code expires in 15 minutes.\n'
        'If you did not request this change, secure your account immediately.'
    )
    html = render_transaction_email(
        title='Email change verification',
        subtitle=f'Confirm changing your email address to {new_email}.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 15 minutes',
        rows=[
            ('New email', new_email),
            ('Expires', '15 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note=(
            'If you did not request this change, secure your account immediately.'
        ),
    )
    return _send_email(subject, text, [email], html_message=html, fail_silently=True)

def notify_welcome_signup(user) -> None:
    """Thank-you / welcome email after successful registration (when email is set)."""
    if not _user_email(user):
        return
    site_name = _site_name()
    first = (getattr(user, 'first_name', None) or '').strip() or 'there'
    phone = getattr(user, 'phone', '') or '-'
    rows: List[Row] = [
        ('Account phone', phone),
        ('Email', user.email),
        ('Status', str(getattr(user, 'account_status', 'pending') or 'pending').title()),
        ('Date', _format_when(getattr(user, 'date_joined', None))),
    ]
    _send_txn_email(
        recipients=[user.email],
        subject=f'[{site_name}] Welcome — thank you for signing up',
        text_intro=(
            f'Thank you for signing up with {site_name}!\n\n'
            'Your account has been created successfully. '
            'You can sign in with your phone number and start using digital wallet services.'
        ),
        title='Thank you for signing up',
        subtitle=f'Welcome to {site_name}. Your account is ready.',
        amount_label='Welcome',
        amount_display=site_name,
        status='success',
        status_label='Registered',
        rows=rows,
        greeting=f'Hi {first},',
        footer_note=(
            'If your account is pending approval, you can sign in but transactions '
            'stay disabled until a Super Admin activates your account.'
        ),
    )


def notify_user_provisioned(user, password: str, *, created_by=None) -> None:
    """Email login credentials to the new user and ask Super Admin to approve."""
    site_name = _site_name()
    first = (getattr(user, 'first_name', None) or '').strip() or 'there'
    phone = getattr(user, 'phone', '') or '-'
    created_by_label = '-'
    if created_by is not None:
        created_by_label = (
            f'{getattr(created_by, "phone", "")} '
            f'({getattr(created_by, "role", "") or "admin"})'
        ).strip()
    dealer = getattr(user, 'assigned_dealer', None)
    dealer_label = dealer.phone if dealer is not None else '—'

    if _user_email(user) and password:
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Your account has been created',
            text_intro=(
                f'An account was created for you on {site_name}.\n\n'
                'Use the phone number and password below to sign in. '
                'Your account is Pending until a Super Admin approves it. '
                'Please change this password after you sign in.'
            ),
            title='Account created',
            subtitle='Your login details are below. Change the password after first sign-in.',
            amount_label='Status',
            amount_display='Pending',
            status='pending',
            status_label='Pending',
            rows=[
                ('Account phone', phone),
                ('Email', user.email),
                ('Password', password),
                ('Dealer', dealer_label),
                ('Created by', created_by_label),
            ],
            greeting=f'Hi {first},',
            footer_note=(
                'Keep this password private. Transactions stay disabled until '
                'a Super Admin activates your account.'
            ),
        )

    admin_emails = _admin_alert_emails()
    if not admin_emails:
        return
    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] User approval requested — {phone}',
        text_intro=(
            'A new user was created and is waiting for Super Admin approval. '
            'The account cannot transact until it is set to Active.'
        ),
        title='User approval needed',
        subtitle='Review this account in Admin → Users and set status to Active.',
        amount_label='Status',
        amount_display='Pending',
        status='pending',
        status_label='Pending',
        rows=[
            ('Phone', phone),
            ('Email', getattr(user, 'email', '') or '—'),
            ('Name', f'{getattr(user, "first_name", "")} {getattr(user, "last_name", "")}'.strip() or '—'),
            ('Role', str(getattr(user, 'role', 'customer') or 'customer')),
            ('Dealer', dealer_label),
            ('Created by', created_by_label),
        ],
        copy_admin=False,
    )


def notify_payout_account_submitted(account, *, edited: bool = False) -> None:
    """Email Super Admin when a dealer adds or edits a payout account."""
    admin_emails = _admin_alert_emails()
    if not admin_emails:
        return
    site_name = _site_name()
    dealer = getattr(account, 'dealer', None)
    dealer_phone = getattr(dealer, 'phone', '—') if dealer is not None else '—'
    action = 'updated' if edited else 'added'
    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] Dealer payout account {action} — {dealer_phone}',
        text_intro=(
            f'A Dealer {action} a payout account. It is Pending until you approve it. '
            'Assigned users cannot load via this account until it is Active.'
        ),
        title='Payout account approval needed',
        subtitle='Review this payout account in Admin → Payout accounts.',
        amount_label='Status',
        amount_display='Pending',
        status='pending',
        status_label='Pending',
        rows=[
            ('Dealer', dealer_phone),
            ('Type', account.get_method_display()),
            ('Account name', account.account_name or '—'),
            ('Account number', account.account_number or '—'),
            ('Bank', account.bank_name or '—'),
            ('Label', account.label or '—'),
        ],
        copy_admin=False,
    )


def notify_payout_account_reviewed(account) -> None:
    """Email the dealer after Super Admin approves or rejects a payout account."""
    dealer = getattr(account, 'dealer', None)
    if dealer is None or not _user_email(dealer):
        return
    site_name = _site_name()
    approved = account.status == 'approved'
    first = (getattr(dealer, 'first_name', None) or '').strip() or 'there'
    _send_txn_email(
        recipients=[dealer.email],
        subject=(
            f'[{site_name}] Payout account {"approved" if approved else "rejected"}'
        ),
        text_intro=(
            f'Your payout account ({account.get_method_display()} {account.account_number}) '
            f'has been {"approved" if approved else "rejected"}.'
            + ('' if approved else f'\n\nReason: {account.rejection_reason or "—"}')
        ),
        title='Payout account reviewed',
        subtitle=(
            'Assigned users can now load their wallets using this account.'
            if approved
            else 'Update the account details and resubmit for approval.'
        ),
        amount_label='Status',
        amount_display='Active' if approved else 'Rejected',
        status='approved' if approved else 'rejected',
        status_label='Approved' if approved else 'Rejected',
        rows=[
            ('Type', account.get_method_display()),
            ('Account name', account.account_name or '—'),
            ('Account number', account.account_number or '—'),
            ('Reason', account.rejection_reason or '—') if not approved else ('Status', 'Approved'),
        ],
        greeting=f'Hi {first},',
    )


def notify_account_approved(user) -> None:
    """Email when Super Admin activates / approves a customer account."""
    if not _user_email(user):
        return
    site_name = _site_name()
    first = (getattr(user, 'first_name', None) or '').strip() or 'there'
    _send_txn_email(
        recipients=[user.email],
        subject=f'[{site_name}] Your account is active',
        text_intro=(
            f'Good news! Your {site_name} account has been approved. '
            'You can now use deposits, transfers, top-ups, and bill payments.'
        ),
        title='Account activated',
        subtitle='Your MySewa account is approved and ready for transactions.',
        amount_label='Status',
        amount_display='Active',
        status='success',
        status_label='Approved',
        rows=[
            ('Phone', getattr(user, 'phone', '-') or '-'),
            ('Email', user.email),
            ('Status', 'Approved'),
            ('Date', _format_when()),
        ],
        greeting=f'Hi {first},',
    )


def _send_sms(phone: str, message: str) -> bool:
    """
    Placeholder SMS sender. Logs the message so the toggle is observable.
    Replace with a real SMS gateway when available.
    """
    if not phone:
        return False
    logger.info('SMS to %s: %s', phone, message)
    return True


def _push(
    user,
    title: str,
    body: str,
    *,
    event: str,
    extra: Optional[dict] = None,
) -> int:
    data = {'event': event}
    if extra:
        data.update({str(k): str(v) for k, v in extra.items()})
    return send_push_to_user(user, title, body, data)


def notify_wallet_credit(
    user,
    amount,
    balance_after=None,
    reason: str = None,
    ref: str = None,
) -> None:
    """Email (+ push) when the user's wallet is credited."""
    cfg = _notif_cfg()
    site_name = _site_name()
    if balance_after is None:
        balance_after = _wallet_balance(user)

    amount_display = _fmt_amount(amount)
    balance_display = (
        _fmt_amount(balance_after) if balance_after is not None else '-'
    )
    title = f'{site_name}: Wallet credited'
    short = f'{amount_display} credited to your wallet. {reason or ""}'.strip()
    rows: List[Row] = [
        ('Type', 'Wallet credit'),
        ('Amount', amount_display),
        ('Debit / Credit', 'Credited'),
        ('New balance', balance_display),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Credited'),
    ]

    if cfg.get('email_on_wallet_credit', True):
        if _user_email(user):
            _send_txn_email(
                recipients=[user.email],
                subject=f'[{site_name}] Wallet credited',
                text_intro=(
                    f'{amount_display} was credited to your wallet.\n'
                    f'Updated wallet balance: {balance_display}.'
                ),
                title='Wallet credited',
                subtitle=(
                    f'{amount_display} was added to your MySewa business wallet. '
                    f'New balance: {balance_display}.'
                ),
                amount_display=amount_display,
                status='success',
                status_label='Credited',
                rows=rows,
                greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=user,
            customer_direction='credit',
            admin_direction='debit',
            amount=amount,
            balance_after=balance_after,
            reason=reason,
            ref=ref,
            context_label='Wallet credit',
        )

    _push(
        user,
        title,
        short,
        event='credit',
        extra={'amount': amount, 'reason': reason or '', 'ref': ref or ''},
    )


def notify_wallet_debit(
    user,
    amount,
    balance_after=None,
    reason: str = None,
    ref: str = None,
) -> None:
    """Email (+ push) when the user's wallet is debited."""
    cfg = _notif_cfg()
    site_name = _site_name()
    if balance_after is None:
        balance_after = _wallet_balance(user)

    amount_display = _fmt_amount(amount)
    balance_display = (
        _fmt_amount(balance_after) if balance_after is not None else '-'
    )
    title = f'{site_name}: Wallet debited'
    short = f'{amount_display} deducted from your wallet. {reason or ""}'.strip()
    rows: List[Row] = [
        ('Type', 'Wallet debit'),
        ('Amount', amount_display),
        ('Debit / Credit', 'Debited'),
        ('New balance', balance_display),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Debited'),
    ]

    if cfg.get('email_on_wallet_debit', True):
        if _user_email(user):
            _send_txn_email(
                recipients=[user.email],
                subject=f'[{site_name}] Wallet debited',
                text_intro=(
                    f'{amount_display} was deducted from your wallet.\n'
                    f'Updated wallet balance: {balance_display}.'
                ),
                title='Wallet debited',
                subtitle=(
                    f'{amount_display} was deducted from your MySewa business wallet. '
                    f'New balance: {balance_display}.'
                ),
                amount_display=amount_display,
                status='success',
                status_label='Debited',
                rows=rows,
                greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=user,
            customer_direction='debit',
            admin_direction='debit',
            amount=amount,
            balance_after=balance_after,
            reason=reason,
            ref=ref,
            context_label='Wallet debit',
        )
        _notify_assigned_dealer(
            user,
            subject=f'[{site_name}] User wallet debit',
            text_intro=(
                f'{amount_display} was deducted from {getattr(user, "phone", "a user")}. '
                f'{reason or ""}'.strip()
            ),
            title='Customer wallet debit',
            subtitle=f'{amount_display} was deducted. {reason or ""}'.strip(),
            rows=rows,
            amount_display=amount_display,
            amount_label='Wallet debit',
            status_label='Debited',
        )

    _push(
        user,
        title,
        short,
        event='debit',
        extra={'amount': amount, 'reason': reason or '', 'ref': ref or ''},
    )


# Aliases used by push-oriented call sites
def notify_credit(user, amount, *, reason: str, ref: str = '') -> None:
    notify_wallet_credit(user, amount, reason=reason, ref=ref or None)


def notify_debit(user, amount, *, reason: str, ref: str = '') -> None:
    notify_wallet_debit(user, amount, reason=reason, ref=ref or None)


def notify_deposit_submitted(deposit) -> None:
    """Email user + Super Admin when a deposit request is submitted."""
    cfg = _notif_cfg()
    site_name = _site_name()
    if not cfg.get('email_on_deposit', True):
        _push(
            deposit.user,
            f'{site_name}: Deposit submitted',
            f'Your deposit request of {_fmt_amount(deposit.amount)} (#{deposit.id}) was submitted.',
            event='deposit',
            extra={'deposit_id': deposit.id, 'amount': deposit.amount},
        )
        return

    rows: List[Row] = [
        ('Deposit ID', str(deposit.id)),
        ('User', getattr(deposit.user, 'phone', '-')),
        ('Amount', _fmt_amount(deposit.amount)),
        ('Payment method', getattr(deposit, 'bank_name', None) or '-'),
        ('Transaction ID', getattr(deposit, 'transaction_id', None) or '-'),
        ('Note', deposit.note or '-'),
        ('Status', deposit.status),
        ('Date', _format_when(getattr(deposit, 'created_at', None))),
    ]
    user_email = _user_email(deposit.user)
    if user_email:
        _send_txn_email(
            recipients=[user_email],
            subject=f'[{site_name}] Deposit request submitted #{deposit.id}',
            text_intro='Your deposit request was submitted and is awaiting review.',
            title='Deposit request submitted',
            subtitle='We received your wallet load request. Super Admin will review it shortly.',
            amount_display=_fmt_amount(deposit.amount),
            status='pending',
            status_label=str(deposit.status or 'Pending').title(),
            rows=rows,
            greeting=f'Hi {getattr(deposit.user, "first_name", "") or "there"},',
            copy_admin=True,
        )
    else:
        admin_emails = _admin_alert_emails()
        if admin_emails:
            _send_txn_email(
                recipients=admin_emails,
                subject=f'[{site_name}] New deposit request #{deposit.id}',
                text_intro='A new deposit request was submitted.',
                title='New deposit request',
                subtitle='A customer submitted a wallet load request for review.',
                amount_display=_fmt_amount(deposit.amount),
                status='pending',
                status_label=str(deposit.status or 'Pending').title(),
                rows=rows,
                copy_admin=False,
            )

    _push(
        deposit.user,
        f'{site_name}: Deposit submitted',
        f'Your deposit request of {_fmt_amount(deposit.amount)} (#{deposit.id}) was submitted.',
        event='deposit',
        extra={'deposit_id': deposit.id, 'amount': deposit.amount},
    )


def notify_deposit_approved(deposit, balance_after=None) -> None:
    """Notify user on deposit approval (SMS + email + push). Covers approve credit."""
    cfg = _notif_cfg()
    site_name = _site_name()
    if balance_after is None:
        balance_after = getattr(deposit, 'balance_after', None)
    if balance_after is None:
        balance_after = _wallet_balance(deposit.user)

    message = (
        f'{site_name}: Your deposit of {_fmt_amount(deposit.amount)} '
        f'(#{deposit.id}) has been approved and credited to your wallet.'
    )
    if balance_after is not None:
        message += f' New balance: {_fmt_amount(balance_after)}.'

    if cfg.get('sms_on_deposit_approved'):
        _send_sms(deposit.user.phone, message)

    send_email = cfg.get('email_on_wallet_credit', True) or cfg.get('sms_on_deposit_approved')
    if send_email and _user_email(deposit.user):
        rows: List[Row] = [
            ('Type', 'Add fund / Manual load'),
            ('Deposit ID', str(deposit.id)),
            ('Amount', _fmt_amount(deposit.amount)),
            ('Debit / Credit', 'Credited'),
            ('Payment method', getattr(deposit, 'bank_name', None) or '-'),
            ('Transaction ID', getattr(deposit, 'transaction_id', None) or '-'),
            ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
            ('Date', _format_when(getattr(deposit, 'updated_at', None) or getattr(deposit, 'created_at', None))),
            ('Status', 'Credited'),
        ]
        _send_txn_email(
            recipients=[deposit.user.email],
            subject=f'[{site_name}] Deposit approved',
            text_intro=(
                f'{_fmt_amount(deposit.amount)} was credited to your wallet.\n'
                f'Updated wallet balance: '
                f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
            ),
            title='Deposit approved',
            subtitle=(
                f'{_fmt_amount(deposit.amount)} was added to your MySewa business wallet. '
                f'New balance: '
                f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
            ),
            amount_display=_fmt_amount(deposit.amount),
            status='success',
            status_label='Credited',
            rows=rows,
            greeting=f'Hi {getattr(deposit.user, "first_name", "") or "there"},',
            copy_admin=False,
        )
    if cfg.get('email_on_wallet_credit', True):
        _send_admin_opposite_wallet_email(
            user=deposit.user,
            customer_direction='credit',
            admin_direction='debit',
            amount=deposit.amount,
            balance_after=balance_after,
            reason='Deposit approved',
            ref=str(deposit.id),
            context_label='Deposit / wallet load',
            extra_rows=[
                ('Deposit ID', str(deposit.id)),
                ('Payment method', getattr(deposit, 'bank_name', None) or '-'),
            ],
        )

    _push(
        deposit.user,
        f'{site_name}: Deposit approved',
        message,
        event='deposit',
        extra={
            'deposit_id': deposit.id,
            'amount': deposit.amount,
            'subtype': 'approved',
        },
    )


def notify_topup_success(topup, balance_after=None) -> None:
    cfg = _notif_cfg()
    site_name = _site_name()
    if balance_after is None:
        balance_after = getattr(topup, 'balance_after', None)
    if balance_after is None:
        balance_after = _wallet_balance(topup.user)

    product = 'NTC' if topup.product_id == 1 else 'NCELL'
    # Wallet impact is net total debited (amount + charge - cashback).
    debited = topup.total_debited or topup.amount
    push_body = (
        f'{product} top-up of {_fmt_amount(topup.amount)} to {topup.mobile_number} succeeded. '
        f'Debited {_fmt_amount(debited)}.'
    )
    rows: List[Row] = [
        ('Type', 'Mobile top-up'),
        ('Operator', product),
        ('Mobile', topup.mobile_number),
        ('Top-up amount', _fmt_amount(topup.amount)),
        ('Charge', _fmt_amount(getattr(topup, 'charge', 0) or 0)),
        ('Cashback', _fmt_amount(getattr(topup, 'cashback', 0) or 0)),
        ('Total debited', _fmt_amount(debited)),
        ('Debit / Credit', 'Debited'),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reference', topup.merchant_txn_id or '-'),
        ('Date', _format_when(getattr(topup, 'created_at', None))),
        ('Status', 'Debited'),
    ]
    rows[4:4] = _charge_breakdown_rows(topup)
    if cfg.get('email_on_topup', True):
        if _user_email(topup.user):
            _send_txn_email(
                recipients=[topup.user.email],
                subject=f'[{site_name}] {product} top-up successful',
                text_intro=(
                    f'{_fmt_amount(debited)} was deducted from your wallet.\n'
                    f'Updated wallet balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                title=f'{product} top-up successful',
                subtitle=(
                    f'Recharge of {_fmt_amount(topup.amount)} to {topup.mobile_number} is complete. '
                    f'{_fmt_amount(debited)} was deducted from your wallet. '
                    f'New balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                amount_display=_fmt_amount(debited),
                amount_label='Wallet debit',
                status='success',
                status_label='Debited',
                rows=rows,
                greeting=f'Hi {getattr(topup.user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=topup.user,
            customer_direction='debit',
            admin_direction='debit',
            amount=debited,
            balance_after=balance_after,
            reason=f'{product} top-up',
            ref=topup.merchant_txn_id or str(topup.id),
            context_label='Mobile top-up',
            extra_rows=[
                ('Top-up amount', _fmt_amount(topup.amount)),
                ('Charge', _fmt_amount(getattr(topup, 'charge', 0) or 0)),
                ('Mobile', topup.mobile_number),
                *_charge_breakdown_rows(topup),
            ],
        )
        _notify_assigned_dealer(
            topup.user,
            subject=f'[{site_name}] User top-up completed',
            text_intro=(
                f'{product} top-up of {_fmt_amount(topup.amount)} by '
                f'{getattr(topup.user, "phone", "")} completed. '
                f'Debited {_fmt_amount(debited)}.'
            ),
            title='Customer top-up completed',
            subtitle=(
                f'{product} top-up of {_fmt_amount(topup.amount)} to {topup.mobile_number} '
                f'completed. Wallet debit {_fmt_amount(debited)}.'
            ),
            rows=rows,
            amount_display=_fmt_amount(debited),
            amount_label='Wallet debit',
            status_label='Debited',
        )
    _push(
        topup.user,
        f'{site_name}: Top-up successful',
        push_body,
        event='topup',
        extra={
            'amount': topup.amount,
            'total_debited': debited,
            'merchant_txn_id': topup.merchant_txn_id,
        },
    )


def notify_transfer_success(transfer, balance_after=None) -> None:
    """Email (+ push) after a successful bank transfer (wallet debit)."""
    cfg = _notif_cfg()
    site_name = _site_name()
    if balance_after is None:
        balance_after = getattr(transfer, 'balance_after', None)
    if balance_after is None:
        balance_after = _wallet_balance(transfer.user)

    dest = getattr(transfer, 'destination_acc_no', None) or getattr(
        transfer, 'destination_acc_name', None
    ) or 'account'
    dest_name = getattr(transfer, 'destination_acc_name', None) or '-'
    bank = (
        getattr(transfer, 'destination_bank_name', None)
        or getattr(transfer, 'destination_bank', None)
        or ''
    )
    debited = transfer.total_debited or transfer.amount
    title = f'{site_name}: Bank transfer successful'
    short = (
        f'Transfer of {_fmt_amount(transfer.amount)} to {dest}'
        + (f' ({bank})' if bank else '')
        + f' succeeded. Debited {_fmt_amount(debited)}.'
    )
    rows: List[Row] = [
        ('Type', 'Fund transfer'),
        ('Amount', _fmt_amount(transfer.amount)),
        ('Charge', _fmt_amount(getattr(transfer, 'charge', 0) or 0)),
        ('Cashback', _fmt_amount(getattr(transfer, 'cashback', 0) or 0)),
        ('Total debited', _fmt_amount(debited)),
        ('Account name', dest_name),
        ('Account number', str(dest)),
        ('Bank', bank or '-'),
        ('Remarks', getattr(transfer, 'transaction_remarks', None) or getattr(transfer, 'remarks', None) or '-'),
        ('Debit / Credit', 'Debited'),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reference', transfer.merchant_txn_id or '-'),
        ('Date', _format_when(getattr(transfer, 'created_at', None))),
        ('Status', 'Debited'),
    ]
    rows[3:3] = _charge_breakdown_rows(transfer)
    if cfg.get('email_on_transfer', True) or cfg.get('email_on_wallet_debit', True):
        if _user_email(transfer.user):
            _send_txn_email(
                recipients=[transfer.user.email],
                subject=f'[{site_name}] Bank transfer successful',
                text_intro=(
                    f'{_fmt_amount(debited)} was deducted from your wallet.\n'
                    f'Updated wallet balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                title='Bank transfer successful',
                subtitle=(
                    f'Transfer of {_fmt_amount(transfer.amount)} completed. '
                    f'{_fmt_amount(debited)} was deducted from your wallet. '
                    f'New balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                amount_display=_fmt_amount(debited),
                amount_label='Wallet debit',
                status='success',
                status_label='Debited',
                rows=rows,
                greeting=f'Hi {getattr(transfer.user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=transfer.user,
            customer_direction='debit',
            admin_direction='debit',
            amount=debited,
            balance_after=balance_after,
            reason='Bank transfer',
            ref=transfer.merchant_txn_id or str(transfer.id),
            context_label='Fund transfer',
            extra_rows=[
                ('Transfer amount', _fmt_amount(transfer.amount)),
                ('Charge', _fmt_amount(getattr(transfer, 'charge', 0) or 0)),
                ('Destination', f'{dest_name} · {dest}'),
                *_charge_breakdown_rows(transfer),
            ],
        )
        _notify_assigned_dealer(
            transfer.user,
            subject=f'[{site_name}] User bank transfer completed',
            text_intro=(
                f'Bank transfer of {_fmt_amount(transfer.amount)} by '
                f'{getattr(transfer.user, "phone", "")} completed. '
                f'Debited {_fmt_amount(debited)}.'
            ),
            title='Customer bank transfer completed',
            subtitle=(
                f'Transfer of {_fmt_amount(transfer.amount)} to {dest} completed. '
                f'Wallet debit {_fmt_amount(debited)}.'
            ),
            rows=rows,
            amount_display=_fmt_amount(debited),
            amount_label='Wallet debit',
            status_label='Debited',
        )

    _push(
        transfer.user,
        title,
        short,
        event='transfer',
        extra={
            'amount': transfer.amount,
            'total_debited': debited,
            'merchant_txn_id': transfer.merchant_txn_id,
        },
    )


def notify_withdrawal(
    user,
    amount,
    balance_after=None,
    reason: str = None,
    ref: str = None,
) -> None:
    """Email on withdrawal if/when withdrawals exist. Uses debit notification flag."""
    cfg = _notif_cfg()
    site_name = _site_name()
    rows: List[Row] = [
        ('Type', 'Withdrawal'),
        ('Amount', _fmt_amount(amount)),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Success'),
    ]
    if cfg.get('email_on_wallet_debit', True):
        if _user_email(user):
            _send_txn_email(
                recipients=[user.email],
                subject=f'[{site_name}] Withdrawal processed',
                text_intro='Your withdrawal has been processed.',
                title='Withdrawal processed',
                subtitle='Your withdrawal request was completed.',
                amount_display=_fmt_amount(amount),
                status='success',
                status_label='Debited',
                rows=rows,
                greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=user,
            customer_direction='debit',
            admin_direction='debit',
            amount=amount,
            balance_after=balance_after,
            reason=reason or 'Withdrawal',
            ref=ref,
            context_label='Withdrawal',
        )
    _push(
        user,
        f'{site_name}: Withdrawal processed',
        f'{_fmt_amount(amount)} withdrawn from your wallet.',
        event='withdrawal',
        extra={'amount': amount, 'ref': ref or ''},
    )


def notify_wallet_adjustment(
    user,
    old_balance=None,
    new_balance=None,
    *,
    amount=None,
    balance_before=None,
    balance_after=None,
    reason: str = None,
    ref: str = None,
) -> None:
    """
    Email (+ push) when an admin adjusts wallet balance.

    Supports both call styles:
      notify_wallet_adjustment(user, old_balance, new_balance)
      notify_wallet_adjustment(user, amount=..., balance_before=..., balance_after=...)
    """
    cfg = _notif_cfg()
    site_name = _site_name()

    before = balance_before if balance_before is not None else old_balance
    after = balance_after if balance_after is not None else new_balance

    try:
        before_val = Decimal(str(before)) if before is not None else None
        after_val = Decimal(str(after)) if after is not None else None
    except Exception:
        before_val = before
        after_val = after

    if amount is not None:
        try:
            delta = Decimal(str(amount))
        except Exception:
            delta = amount
    elif before_val is not None and after_val is not None:
        delta = after_val - before_val
    else:
        return

    if delta == 0:
        return

    adj_type = 'credit' if delta > 0 else 'debit'
    title = f'{site_name}: Balance adjustment ({adj_type})'
    short = (
        f'Your wallet was adjusted by {"+" if delta > 0 else ""}{_fmt_amount(delta)}. '
        + (f'New balance: {_fmt_amount(after_val)}.' if after_val is not None else '')
    )
    rows: List[Row] = [
        ('Type', f'Wallet {adj_type} (manual)'),
        ('Adjustment', f'{"+" if delta > 0 else ""}{_fmt_amount(delta)}'),
        ('Previous balance', _fmt_amount(before_val) if before_val is not None else '-'),
        ('New balance', _fmt_amount(after_val) if after_val is not None else '-'),
        ('Reason', reason or 'Admin balance update'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Success'),
    ]

    if cfg.get('email_on_wallet_adjustment', True):
        if _user_email(user):
            _send_txn_email(
                recipients=[user.email],
                subject=f'[{site_name}] Wallet balance adjusted',
                text_intro='Your wallet balance was adjusted by an administrator.',
                title=f'Wallet {adj_type}',
                subtitle='An administrator updated your MySewa business wallet balance.',
                amount_display=f'{"+" if delta > 0 else "−"}{_fmt_amount(abs(delta))}',
                status='success',
                status_label=adj_type.title(),
                rows=rows,
                greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=user,
            customer_direction=adj_type,
            amount=abs(delta),
            balance_after=after_val,
            reason=reason or 'Admin balance update',
            ref=ref,
            context_label='Manual wallet adjustment',
            extra_rows=[
                (
                    'Previous balance',
                    _fmt_amount(before_val) if before_val is not None else '-',
                ),
            ],
        )

    _push(
        user,
        title,
        short,
        event='adjustment',
        extra={
            'old_balance': before_val if before_val is not None else '',
            'new_balance': after_val if after_val is not None else '',
            'delta': delta,
        },
    )


def _split_when(value=None) -> Tuple[str, str]:
    dt = value or timezone.now()
    if timezone.is_aware(dt):
        try:
            dt = timezone.localtime(dt, ZoneInfo('Asia/Kathmandu'))
        except Exception:
            dt = timezone.localtime(dt)
    if isinstance(dt, datetime):
        return dt.strftime('%d %b %Y'), dt.strftime('%I:%M %p')
    return str(dt), ''


def notify_wallet_before_after_correction(user, ctx: dict) -> bool:
    """
    Email the user after Super Admin confirms a before/after wallet correction.
    Explains the original transaction date/amount and the corrected balance.
    """
    site_name = _site_name()
    txn_date, txn_time = _split_when(ctx.get('txn_at'))
    amount = ctx.get('amount')
    previous = ctx.get('balance_before')
    corrected = ctx.get('corrected_balance')
    reference = ctx.get('txn_reference') or '-'
    service = ctx.get('service_name') or ctx.get('txn_type_display') or 'transaction'
    direction = (ctx.get('direction') or 'debit').lower()
    verb = 'deducted' if direction == 'debit' else 'credited'

    intro = (
        f'Your previous wallet balance was {_fmt_amount(previous)}. '
        f'On {txn_date}, you made a transaction of {_fmt_amount(amount)}'
        f'{f" ({service})" if service else ""}, and this amount was {verb} '
        f'from the relevant transaction but was not reflected correctly in your wallet balance.\n\n'
        f'We have now corrected the wallet balance. Your actual/current balance is '
        f'{_fmt_amount(corrected)}.'
    )
    rows: List[Row] = [
        ('Transaction date', txn_date),
        ('Transaction time', txn_time or '-'),
        ('Transaction amount', _fmt_amount(amount)),
        ('Transaction / reference ID', reference),
        ('Service / type', service),
        ('Previous balance', _fmt_amount(previous)),
        ('Amount not reflected', _fmt_amount(amount)),
        ('Corrected balance', _fmt_amount(corrected)),
    ]
    if ctx.get('description'):
        rows.append(('Details', str(ctx.get('description'))))

    sent = False
    if _user_email(user):
        sent = _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Wallet balance corrected',
            text_intro=intro,
            title='Wallet balance corrected',
            subtitle='A transaction amount was not reflected in your wallet. We have corrected it.',
            amount_display=_fmt_amount(amount),
            status='success',
            status_label='Corrected',
            rows=rows,
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
            copy_admin=False,
            fail_silently=True,
        )
    _push(
        user,
        f'{site_name}: Wallet balance corrected',
        (
            f'Your wallet was corrected to {_fmt_amount(corrected)} after a '
            f'{_fmt_amount(amount)} {service} on {txn_date} was not reflected.'
        ),
        event='adjustment',
        extra={
            'issue_id': ctx.get('issue_id'),
            'reference': reference,
            'corrected_balance': corrected,
        },
    )
    return bool(sent)


def notify_wallet_transfer(transfer) -> None:
    """Email + push for both parties after an instant wallet-to-wallet transfer."""
    cfg = _notif_cfg()
    site_name = _site_name()
    amount_display = _fmt_amount(transfer.amount)
    remarks = (transfer.remarks or '').strip() or '-'
    ref = transfer.reference or f'#{transfer.id}'
    sender = transfer.sender
    recipient = transfer.recipient
    sender_name = (
        f'{(sender.first_name or "").strip()} {(sender.last_name or "").strip()}'.strip()
        or sender.phone
    )
    recipient_name = (
        f'{(recipient.first_name or "").strip()} {(recipient.last_name or "").strip()}'.strip()
        or recipient.phone
    )

    sender_rows: List[Row] = [
        ('Type', 'Wallet transfer sent'),
        ('Sender', f'{sender_name} ({sender.phone})'),
        ('Receiver', f'{recipient_name} ({recipient.phone})'),
        ('Amount', amount_display),
        ('Charge', _fmt_amount(getattr(transfer, 'charge', 0) or 0)),
        ('Total debited', _fmt_amount(getattr(transfer, 'total_debited', None) or transfer.amount)),
        ('New balance', _fmt_amount(transfer.sender_balance_after)),
        ('Remarks', remarks),
        ('Reference', ref),
        ('Date', _format_when(getattr(transfer, 'created_at', None))),
        ('Status', 'Success'),
    ]
    sender_rows[4:4] = _charge_breakdown_rows(transfer)
    recipient_rows: List[Row] = [
        ('Type', 'Wallet transfer received'),
        ('Sender', f'{sender_name} ({sender.phone})'),
        ('Receiver', f'{recipient_name} ({recipient.phone})'),
        ('Amount', amount_display),
        ('New balance', _fmt_amount(transfer.recipient_balance_after)),
        ('Remarks', remarks),
        ('Reference', ref),
        ('Date', _format_when(getattr(transfer, 'created_at', None))),
        ('Status', 'Success'),
    ]

    if cfg.get('email_on_transfer', True) and _user_email(sender):
        _send_txn_email(
            recipients=[sender.email],
            subject=f'[{site_name}] Wallet transfer sent',
            text_intro=(
                f'{amount_display} was sent to {recipient_name} ({recipient.phone}).'
            ),
            title='Wallet transfer sent',
            subtitle=f'{amount_display} was transferred from your MySewa wallet.',
            amount_display=amount_display,
            status='success',
            status_label='Success',
            rows=sender_rows,
            greeting=f'Hi {getattr(sender, "first_name", "") or "there"},',
            copy_admin=False,
        )
    if _user_email(recipient) and (
        cfg.get('email_on_transfer', True) or cfg.get('email_on_wallet_credit', True)
    ):
        _send_txn_email(
            recipients=[recipient.email],
            subject=f'[{site_name}] Wallet transfer received',
            text_intro=(
                f'{amount_display} was received from {sender_name} ({sender.phone}).'
            ),
            title='Wallet transfer received',
            subtitle=f'{amount_display} was added to your MySewa wallet.',
            amount_display=amount_display,
            status='success',
            status_label='Success',
            rows=recipient_rows,
            greeting=f'Hi {getattr(recipient, "first_name", "") or "there"},',
            copy_admin=False,
        )

    _notify_assigned_dealer(
        sender,
        subject=f'[{site_name}] User wallet transfer sent',
        text_intro=(
            f'{amount_display} was sent from {sender.phone} to {recipient.phone}.'
        ),
        title='Customer wallet transfer',
        subtitle=f'{amount_display} transferred to {recipient_name} ({recipient.phone}).',
        rows=sender_rows,
        amount_display=amount_display,
        status_label='Success',
    )
    _send_admin_opposite_wallet_email(
        user=sender,
        customer_direction='debit',
        admin_direction='debit',
        amount=getattr(transfer, 'total_debited', None) or transfer.amount,
        balance_after=transfer.sender_balance_after,
        reason='Wallet transfer',
        ref=ref,
        context_label='Wallet transfer',
        extra_rows=[
            ('Receiver', f'{recipient_name} ({recipient.phone})'),
            ('Transfer amount', amount_display),
            *_charge_breakdown_rows(transfer),
        ],
    )

    _push(
        sender,
        f'{site_name}: Wallet transfer sent',
        f'{amount_display} sent to {recipient.phone}.',
        event='wallet_transfer',
        extra={'amount': transfer.amount, 'ref': ref, 'direction': 'sent'},
    )
    _push(
        recipient,
        f'{site_name}: Wallet transfer received',
        f'{amount_display} received from {sender.phone}.',
        event='wallet_transfer',
        extra={'amount': transfer.amount, 'ref': ref, 'direction': 'received'},
    )


def notify_remittance_success(remittance, balance_after=None) -> None:
    cfg = _notif_cfg()
    site_name = _site_name()
    credited = remittance.total_credited or remittance.amount
    if balance_after is None:
        balance_after = getattr(remittance, 'balance_after', None)
    if balance_after is None:
        balance_after = _wallet_balance(remittance.user)

    message = (
        f'{site_name}: Remittance {remittance.ref_no} of {_fmt_amount(credited)} '
        f'has been credited to your wallet.'
    )
    if balance_after is not None:
        message += f' New balance: {_fmt_amount(balance_after)}.'

    if cfg.get('sms_on_deposit_approved'):
        _send_sms(remittance.user.phone, message)

    if cfg.get('email_on_wallet_credit', True):
        charge = getattr(remittance, 'charge', 0) or 0
        cashback = getattr(remittance, 'cashback', 0) or 0
        rows: List[Row] = [
            ('Type', 'Remittance'),
            ('Reference no.', remittance.ref_no or '-'),
            ('Gross amount', _fmt_amount(remittance.amount)),
            ('Charge', _fmt_amount(charge)),
            ('Cashback', _fmt_amount(cashback)),
            ('Amount credited', _fmt_amount(credited)),
            ('Debit / Credit', 'Credited'),
            ('Sender', getattr(remittance, 'sender_name', None) or '-'),
            ('Receiver', getattr(remittance, 'receiver_name', None) or '-'),
            ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
            ('Transaction ID', str(remittance.id)),
            ('Merchant ref.', getattr(remittance, 'merchant_txn_id', None) or '-'),
            ('Date', _format_when(getattr(remittance, 'created_at', None))),
            ('Status', 'Credited'),
        ]
        rows[4:4] = _charge_breakdown_rows(remittance)
        if _user_email(remittance.user):
            _send_txn_email(
                recipients=[remittance.user.email],
                subject=f'[{site_name}] Remittance credited',
                text_intro=(
                    f'{_fmt_amount(credited)} was credited to your wallet.\n'
                    f'Updated wallet balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                title='Remittance credited',
                subtitle=(
                    f'{_fmt_amount(credited)} was added to your wallet '
                    f'(remittance {remittance.ref_no}). '
                    f'New balance: '
                    f'{_fmt_amount(balance_after) if balance_after is not None else "-"}.'
                ),
                amount_display=_fmt_amount(credited),
                amount_label='Amount credited',
                status='success',
                status_label='Credited',
                rows=rows,
                greeting=f'Hi {getattr(remittance.user, "first_name", "") or "there"},',
                copy_admin=False,
            )
        _send_admin_opposite_wallet_email(
            user=remittance.user,
            customer_direction='credit',
            admin_direction='debit',
            amount=credited,
            balance_after=balance_after,
            reason=f'Remittance {remittance.ref_no}',
            ref=getattr(remittance, 'merchant_txn_id', None) or str(remittance.id),
            context_label='Remittance payout',
            extra_rows=[
                ('Gross amount', _fmt_amount(remittance.amount)),
                ('Charge', _fmt_amount(charge)),
                ('Cashback', _fmt_amount(cashback)),
                ('Reference no.', remittance.ref_no or '-'),
                *_charge_breakdown_rows(remittance),
            ],
        )
        _notify_assigned_dealer(
            remittance.user,
            subject=f'[{site_name}] User remittance credited',
            text_intro=(
                f'Remittance {remittance.ref_no} credited {_fmt_amount(credited)} '
                f'to {getattr(remittance.user, "phone", "")}.'
            ),
            title='Customer remittance credited',
            subtitle=(
                f'{_fmt_amount(credited)} credited from remittance {remittance.ref_no}.'
            ),
            rows=rows,
            amount_display=_fmt_amount(credited),
            amount_label='Amount credited',
            status_label='Credited',
        )

    _push(
        remittance.user,
        f'{site_name}: Remittance credited',
        message,
        event='remittance',
        extra={
            'amount': credited,
            'ref_no': remittance.ref_no,
            'remittance_id': remittance.id,
        },
    )


def notify_statement_discrepancies(run, new_count: int) -> None:
    """Alert admins when a reconcile run finds new open mismatches."""
    admin_emails = _admin_alert_emails()
    if not admin_emails or new_count <= 0:
        return
    site_name = _site_name()
    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] HimalPay statement issues ({new_count} new)',
        text_intro=(
            f'Statement reconcile {run.from_date} → {run.to_date} found '
            f'{new_count} new issue(s). Open total: {run.issues_open}.'
        ),
        title='Statement reconcile alert',
        subtitle='HimalPay reseller statement does not fully match MySewa.',
        amount_display=str(new_count),
        amount_label='New issues',
        status='pending',
        status_label='Needs review',
        rows=[
            ('From', str(run.from_date)),
            ('To', str(run.to_date)),
            ('HP entries', str(run.hp_entries)),
            ('Matched', str(run.matched)),
            ('Open issues', str(run.issues_open)),
            ('New issues', str(new_count)),
            ('Triggered by', run.get_triggered_by_display()),
            ('Date', _format_when(getattr(run, 'finished_at', None) or timezone.now())),
        ],
        copy_admin=False,
    )


def notify_wallet_blocked(wallet, *, reason: str = '', merchant_txn_id: str = '') -> None:
    """Alert admins that a user wallet was locked after a HimalPay/MySewa mismatch."""
    admin_emails = _admin_alert_emails()
    if not admin_emails:
        return
    user = getattr(wallet, 'user', None)
    site_name = _site_name()
    phone = getattr(user, 'phone', '-') if user else '-'
    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] Wallet locked — HimalPay deducted, MySewa did not apply',
        text_intro=(
            f'User {phone} wallet was locked because HimalPay already took money '
            f'that was not applied on MySewa. Only an admin can unblock it.'
        ),
        title='Wallet locked',
        subtitle='HimalPay deducted funds that MySewa did not record on the user wallet.',
        amount_display=_fmt_amount(getattr(wallet, 'balance', 0)),
        amount_label='Wallet balance',
        status='pending',
        status_label='Locked',
        rows=[
            ('User', phone),
            ('Wallet ID', str(getattr(wallet, 'pk', '-') or '-')),
            ('Merchant txn', merchant_txn_id or '-'),
            ('Reason', (reason or '-')[:400]),
            ('Date', _format_when(getattr(wallet, 'blocked_at', None) or timezone.now())),
        ],
        copy_admin=False,
    )


def notify_low_balance_if_needed(wallet) -> None:
    cfg = _notif_cfg()
    if not cfg.get('notify_low_balance'):
        return
    threshold = cfg.get('low_balance_threshold', 100)
    try:
        threshold_val = float(threshold)
    except (TypeError, ValueError):
        threshold_val = 100.0
    if float(wallet.balance) > threshold_val:
        return
    admin_emails = _admin_alert_emails()
    if not admin_emails:
        return
    site_name = _site_name()
    _send_txn_email(
        recipients=admin_emails,
        subject=f'[{site_name}] Low wallet balance alert',
        text_intro='Wallet balance is at or below the configured threshold.',
        title='Low wallet balance',
        subtitle='A customer wallet is at or below the alert threshold.',
        amount_display=_fmt_amount(wallet.balance),
        amount_label='Current balance',
        status='pending',
        status_label='Low balance',
        rows=[
            ('User', getattr(wallet.user, 'phone', '-')),
            ('Balance', _fmt_amount(wallet.balance)),
            ('Threshold', _fmt_amount(threshold_val)),
            ('Date', _format_when()),
        ],
        copy_admin=False,
    )
    _push(
        wallet.user,
        f'{site_name}: Low balance',
        f'Your wallet balance is {_fmt_amount(wallet.balance)} '
        f'(threshold {_fmt_amount(threshold_val)}).',
        event='low_balance',
        extra={'balance': wallet.balance, 'threshold': threshold_val},
    )


def notify_kyc_approved(submission) -> None:
    """Notify user when KYC is approved (email + push)."""
    site_name = _site_name()
    user = submission.user
    message = (
        f'{site_name}: Your KYC verification (#{submission.id}) has been approved. '
        f'Your identity details are now verified.'
    )
    if _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] KYC approved',
            text_intro='Your KYC verification has been approved.',
            title='KYC approved',
            subtitle='Your identity verification was approved successfully.',
            amount_label='Status',
            amount_display='Verified',
            status='success',
            status_label='Approved',
            rows=[
                ('Submission ID', str(submission.id)),
                ('Citizenship number', submission.citizenship_number or '-'),
                ('Status', 'Approved'),
                ('Date', _format_when(getattr(submission, 'updated_at', None))),
            ],
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
        )
    _push(
        user,
        f'{site_name}: KYC approved',
        message,
        event='kyc',
        extra={'kyc_id': submission.id, 'subtype': 'approved'},
    )


def notify_kyc_rejected(submission) -> None:
    """Notify user when KYC is rejected (email + push), including reason."""
    site_name = _site_name()
    user = submission.user
    reason = (submission.rejection_reason or '').strip() or 'No reason provided'
    message = (
        f'{site_name}: Your KYC verification (#{submission.id}) was rejected. '
        f'Reason: {reason}'
    )
    if _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] KYC rejected',
            text_intro='Your KYC verification was rejected.',
            title='KYC rejected',
            subtitle='Please review the reason below and submit again if needed.',
            amount_label='Status',
            amount_display='Rejected',
            status='failed',
            status_label='Rejected',
            rows=[
                ('Submission ID', str(submission.id)),
                ('Reason', reason),
                ('Status', 'Rejected'),
                ('Date', _format_when(getattr(submission, 'updated_at', None))),
            ],
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
            footer_note='You may submit again after correcting the issues.',
        )
    _push(
        user,
        f'{site_name}: KYC rejected',
        message,
        event='kyc',
        extra={'kyc_id': submission.id, 'subtype': 'rejected'},
    )


def notify_support_chat_message(msg, thread, sender) -> None:
    """Deliver a Firebase notification for a new Support Chat message."""
    from .hierarchy import admin_actors_qs, is_admin_actor
    from .support_chat import message_preview_text, other_participant

    site_name = _site_name()
    sender_name = (
        f'{(getattr(sender, "first_name", None) or "").strip()} '
        f'{(getattr(sender, "last_name", None) or "").strip()}'.strip()
        or getattr(sender, 'phone', None)
        or site_name
    )
    kind = getattr(msg, 'kind', 'text') or 'text'
    filename = getattr(msg, 'attachment_name', None) or ''
    preview = (
        getattr(thread, 'last_message_preview', None)
        or message_preview_text(kind, getattr(msg, 'body', None) or '', filename)
        or getattr(msg, 'body', None)
        or 'New message'
    )
    preview = str(preview).strip()[:180] or 'New message'
    sender_is_admin = is_admin_actor(sender)
    title = f'{site_name} Support' if sender_is_admin else f'{site_name}: {sender_name}'
    extra = {
        'thread_id': getattr(thread, 'pk', ''),
        'message_id': getattr(msg, 'pk', ''),
        'kind': kind,
        'sound': 'default',
    }

    recipients = []
    if sender_is_admin:
        other = other_participant(thread, sender)
        if other is not None and getattr(other, 'pk', None) != getattr(sender, 'pk', None):
            recipients.append(other)
    else:
        recipients = list(admin_actors_qs())

    seen = set()
    for user in recipients:
        pk = getattr(user, 'pk', None)
        if pk is None or pk in seen or pk == getattr(sender, 'pk', None):
            continue
        seen.add(pk)
        try:
            sent = _push(user, title, preview, event='support_chat', extra=extra)
            logger.info(
                'Support chat push user=%s sent=%s title=%s',
                getattr(user, 'phone', pk),
                sent,
                title,
            )
        except Exception:
            logger.exception(
                'Support chat push failed user=%s',
                getattr(user, 'phone', pk),
            )
