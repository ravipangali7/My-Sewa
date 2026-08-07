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


def _send_email(
    subject: str,
    message: str,
    recipients: list,
    html_message: Optional[str] = None,
    *,
    fail_silently: bool = True,
) -> bool:
    recipients = [r for r in recipients if r]
    if not recipients:
        logger.info('Email skipped (no recipients): %s', subject)
        return False
    try:
        send_smtp_email(
            subject,
            message,
            recipients,
            html_body=html_message,
            fail_silently=fail_silently,
        )
        logger.info('Email sent to %s: %s', recipients, subject)
        return True
    except Exception:
        logger.exception('Failed to send email: %s', subject)
        if not fail_silently:
            raise
        return False


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
    return _send_email(subject, text, recipients, html_message=html, fail_silently=fail_silently)


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
    return _send_email(subject, text, [email], html_message=html, fail_silently=False)


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
    return _send_email(subject, text, [email], html_message=html, fail_silently=False)


def send_phone_change_otp(email: str, otp: str, new_phone: str) -> bool:
    """Send OTP to current email before changing the registered phone."""
    site_name = _site_name()
    subject = f'{site_name} Phone Change OTP'
    text = (
        f'Your {site_name} phone change verification code is: {otp}\n\n'
        f'You requested to change your phone number to {new_phone}.\n'
        'This code expires in 15 minutes.\n'
        'If you did not request this change, secure your account immediately.'
    )
    html = render_transaction_email(
        title='Phone change verification',
        subtitle=f'Confirm changing your phone number to {new_phone}.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 15 minutes',
        rows=[
            ('New phone', new_phone),
            ('Expires', '15 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note=(
            'If you did not request this change, secure your account immediately.'
        ),
    )
    return _send_email(subject, text, [email], html_message=html, fail_silently=False)


def send_email_change_otp(new_email: str, otp: str) -> bool:
    """Send OTP to the new email address to confirm ownership."""
    site_name = _site_name()
    subject = f'{site_name} Email Change OTP'
    text = (
        f'Your {site_name} email change verification code is: {otp}\n\n'
        'Enter this code in the MySewa app to confirm your new email address.\n'
        'This code expires in 15 minutes.\n'
        'If you did not request this change, you can ignore this email.'
    )
    html = render_transaction_email(
        title='Confirm your new email',
        subtitle='Use this one-time code to finish changing your MySewa email.',
        amount_label='Verification code',
        amount_display=otp,
        status='success',
        status_label='Valid 15 minutes',
        rows=[
            ('Expires', '15 minutes'),
            ('Security tip', 'Never share this code with anyone.'),
        ],
        footer_note=(
            'If you did not request this change, you can ignore this email.'
        ),
    )
    return _send_email(subject, text, [new_email], html_message=html, fail_silently=False)


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

    title = f'{site_name}: Wallet credited'
    short = f'{_fmt_amount(amount)} credited to your wallet. {reason or ""}'.strip()
    rows: List[Row] = [
        ('Type', 'Wallet credit'),
        ('Amount', _fmt_amount(amount)),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Success'),
    ]

    if cfg.get('email_on_wallet_credit') and _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Wallet credited',
            text_intro='Your wallet has been credited.',
            title='Wallet credited',
            subtitle='Funds were added to your MySewa wallet.',
            amount_display=_fmt_amount(amount),
            status='success',
            status_label='Credited',
            rows=rows,
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
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

    title = f'{site_name}: Wallet debited'
    short = f'{_fmt_amount(amount)} debited from your wallet. {reason or ""}'.strip()
    rows: List[Row] = [
        ('Type', 'Wallet debit'),
        ('Amount', _fmt_amount(amount)),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reason', reason or '-'),
        ('Reference', ref or '-'),
        ('Date', _format_when()),
        ('Status', 'Success'),
    ]

    if cfg.get('email_on_wallet_debit') and _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Wallet debited',
            text_intro='Your wallet has been debited.',
            title='Wallet debited',
            subtitle='An amount was deducted from your MySewa wallet.',
            amount_display=_fmt_amount(amount),
            status='success',
            status_label='Debited',
            rows=rows,
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
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
    cfg = _notif_cfg()
    site_name = _site_name()
    if cfg.get('email_on_deposit'):
        admin_email = (cfg.get('admin_alert_email') or '').strip()
        rows: List[Row] = [
            ('Deposit ID', str(deposit.id)),
            ('User', getattr(deposit.user, 'phone', '-')),
            ('Amount', _fmt_amount(deposit.amount)),
            ('Note', deposit.note or '-'),
            ('Status', deposit.status),
            ('Date', _format_when(getattr(deposit, 'created_at', None))),
        ]
        _send_txn_email(
            recipients=[admin_email],
            subject=f'[{site_name}] New deposit request #{deposit.id}',
            text_intro='A new deposit request was submitted.',
            title='New deposit request',
            subtitle='A customer submitted a wallet load request for review.',
            amount_display=_fmt_amount(deposit.amount),
            status='pending',
            status_label=str(deposit.status or 'Pending').title(),
            rows=rows,
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

    send_email = cfg.get('email_on_wallet_credit') or cfg.get('sms_on_deposit_approved')
    if send_email and _user_email(deposit.user):
        rows: List[Row] = [
            ('Type', 'Add fund / Manual load'),
            ('Deposit ID', str(deposit.id)),
            ('Amount', _fmt_amount(deposit.amount)),
            ('Bank', getattr(deposit, 'bank_name', None) or '-'),
            ('Transaction ID', getattr(deposit, 'transaction_id', None) or '-'),
            ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
            ('Date', _format_when(getattr(deposit, 'updated_at', None) or getattr(deposit, 'created_at', None))),
            ('Status', 'Approved'),
        ]
        _send_txn_email(
            recipients=[deposit.user.email],
            subject=f'[{site_name}] Deposit approved',
            text_intro='Your deposit has been approved and credited.',
            title='Deposit approved',
            subtitle='Your wallet load was approved and credited successfully.',
            amount_display=_fmt_amount(deposit.amount),
            status='success',
            status_label='Approved',
            rows=rows,
            greeting=f'Hi {getattr(deposit.user, "first_name", "") or "there"},',
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
    push_body = (
        f'{product} top-up of {_fmt_amount(topup.amount)} to {topup.mobile_number} succeeded. '
        f'Debited {_fmt_amount(topup.total_debited)}.'
    )
    rows: List[Row] = [
        ('Type', 'Mobile top-up'),
        ('Operator', product),
        ('Mobile', topup.mobile_number),
        ('Amount', _fmt_amount(topup.amount)),
        ('Charge', _fmt_amount(getattr(topup, 'charge', 0) or 0)),
        ('Cashback', _fmt_amount(getattr(topup, 'cashback', 0) or 0)),
        ('Total debited', _fmt_amount(topup.total_debited)),
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reference', topup.merchant_txn_id or '-'),
        ('Date', _format_when(getattr(topup, 'created_at', None))),
        ('Status', 'Success'),
    ]
    if cfg.get('email_on_topup') and _user_email(topup.user):
        _send_txn_email(
            recipients=[topup.user.email],
            subject=f'[{site_name}] {product} top-up successful',
            text_intro=f'Your {product} top-up was successful.',
            title=f'{product} top-up successful',
            subtitle=f'Recharge of {_fmt_amount(topup.amount)} to {topup.mobile_number} is complete.',
            amount_display=_fmt_amount(topup.amount),
            status='success',
            status_label='Success',
            rows=rows,
            greeting=f'Hi {getattr(topup.user, "first_name", "") or "there"},',
        )
    _push(
        topup.user,
        f'{site_name}: Top-up successful',
        push_body,
        event='topup',
        extra={
            'amount': topup.amount,
            'total_debited': topup.total_debited,
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
        ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
        ('Reference', transfer.merchant_txn_id or '-'),
        ('Date', _format_when(getattr(transfer, 'created_at', None))),
        ('Status', 'Success'),
    ]

    if (cfg.get('email_on_transfer') or cfg.get('email_on_wallet_debit')) and _user_email(
        transfer.user
    ):
        _send_txn_email(
            recipients=[transfer.user.email],
            subject=f'[{site_name}] Bank transfer successful',
            text_intro='Your bank transfer was successful.',
            title='Bank transfer successful',
            subtitle=f'Transfer of {_fmt_amount(transfer.amount)} was completed successfully.',
            amount_display=_fmt_amount(transfer.amount),
            status='success',
            status_label='Success',
            rows=rows,
            greeting=f'Hi {getattr(transfer.user, "first_name", "") or "there"},',
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
    if cfg.get('email_on_wallet_debit') and _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Withdrawal processed',
            text_intro='Your withdrawal has been processed.',
            title='Withdrawal processed',
            subtitle='Your withdrawal request was completed.',
            amount_display=_fmt_amount(amount),
            status='success',
            status_label='Processed',
            rows=rows,
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
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

    if cfg.get('email_on_wallet_adjustment') and _user_email(user):
        _send_txn_email(
            recipients=[user.email],
            subject=f'[{site_name}] Wallet balance adjusted',
            text_intro='Your wallet balance was adjusted by an administrator.',
            title=f'Wallet {adj_type}',
            subtitle='An administrator updated your MySewa wallet balance.',
            amount_display=f'{"+" if delta > 0 else ""}{_fmt_amount(delta)}',
            status='success',
            status_label=adj_type.title(),
            rows=rows,
            greeting=f'Hi {getattr(user, "first_name", "") or "there"},',
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

    if cfg.get('email_on_wallet_credit') and _user_email(remittance.user):
        rows: List[Row] = [
            ('Type', 'Remittance'),
            ('Reference no.', remittance.ref_no or '-'),
            ('Amount credited', _fmt_amount(credited)),
            ('Sender', getattr(remittance, 'sender_name', None) or '-'),
            ('Receiver', getattr(remittance, 'receiver_name', None) or '-'),
            ('New balance', _fmt_amount(balance_after) if balance_after is not None else '-'),
            ('Transaction ID', str(remittance.id)),
            ('Merchant ref.', getattr(remittance, 'merchant_txn_id', None) or '-'),
            ('Date', _format_when(getattr(remittance, 'created_at', None))),
            ('Status', 'Success'),
        ]
        _send_txn_email(
            recipients=[remittance.user.email],
            subject=f'[{site_name}] Remittance credited',
            text_intro='Your remittance has been credited to your wallet.',
            title='Remittance credited',
            subtitle=f'Remittance {remittance.ref_no} was credited to your wallet.',
            amount_display=_fmt_amount(credited),
            status='success',
            status_label='Credited',
            rows=rows,
            greeting=f'Hi {getattr(remittance.user, "first_name", "") or "there"},',
        )

    admin_email = (cfg.get('admin_alert_email') or '').strip()
    if admin_email and cfg.get('email_on_deposit'):
        _send_txn_email(
            recipients=[admin_email],
            subject=f'[{site_name}] Remittance received #{remittance.id}',
            text_intro='Remittance payout completed.',
            title='Remittance received',
            subtitle='A remittance payout was credited to a customer wallet.',
            amount_display=_fmt_amount(credited),
            status='success',
            status_label='Credited',
            rows=[
                ('ID', str(remittance.id)),
                ('User', getattr(remittance.user, 'phone', '-')),
                ('Ref', remittance.ref_no or '-'),
                ('Amount', _fmt_amount(credited)),
                ('Date', _format_when(getattr(remittance, 'created_at', None))),
            ],
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
    admin_email = (cfg.get('admin_alert_email') or '').strip()
    site_name = _site_name()
    _send_txn_email(
        recipients=[admin_email],
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
