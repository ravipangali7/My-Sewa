"""
Notification helpers that respect Settings.config.notifications toggles.

Email uses Django's email backend. SMS has no provider configured yet, so when
enabled we log the outbound SMS and also email a copy when a user email exists.

Push uses core.services.push (FCM when configured, otherwise logged no-op).
One notify_* call can deliver email + SMS + push together.
"""
import logging
from decimal import Decimal
from typing import Optional

from django.conf import settings as django_settings
from django.core.mail import send_mail

from .app_config import get_app_config
from .push import send_push_to_user

logger = logging.getLogger(__name__)


def _from_email() -> str:
    return getattr(django_settings, 'DEFAULT_FROM_EMAIL', None) or 'noreply@mysewa.local'


def _site_name() -> str:
    site = get_app_config().get('site') or {}
    return site.get('site_name') or 'MySewa'


def _notif_cfg() -> dict:
    return get_app_config().get('notifications') or {}


def _user_email(user) -> Optional[str]:
    email = (getattr(user, 'email', None) or '').strip()
    return email or None


def _fmt_amount(amount) -> str:
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
        send_mail(
            subject,
            message,
            _from_email(),
            recipients,
            fail_silently=fail_silently,
            html_message=html_message,
        )
        logger.info('Email sent to %s: %s', recipients, subject)
        return True
    except Exception:
        logger.exception('Failed to send email: %s', subject)
        return False


def send_password_reset_otp(email: str, otp: str) -> bool:
    """Send a password-reset OTP to the user's registered email."""
    subject = 'MySewa Password Reset OTP'
    text = (
        f'Your MySewa password reset code is: {otp}\n\n'
        'This code expires in 15 minutes.\n'
        'If you did not request a password reset, you can ignore this email.'
    )
    html = (
        '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">'
        '<h2 style="color: #0f766e;">MySewa Password Reset</h2>'
        '<p>Your verification code is:</p>'
        f'<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">{otp}</p>'
        '<p style="color: #64748b;">This code expires in 15 minutes.</p>'
        '<p style="color: #64748b; font-size: 13px;">'
        'If you did not request a password reset, you can ignore this email.'
        '</p>'
        '</div>'
    )
    return _send_email(
        subject,
        text,
        [email],
        html_message=html,
        fail_silently=False,
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

    title = f'{site_name}: Wallet credited'
    short = f'{_fmt_amount(amount)} credited to your wallet. {reason or ""}'.strip()
    email_body = (
        f'Your wallet has been credited.\n\n'
        f'Type: Credit\n'
        f'Amount: {_fmt_amount(amount)}\n'
        f'{_balance_line(balance_after)}'
        f'Reason: {reason or "-"}\n'
        f'Reference: {ref or "-"}\n'
    )

    if cfg.get('email_on_wallet_credit') and _user_email(user):
        _send_email(f'[{site_name}] Wallet credited', email_body, [user.email])

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
    email_body = (
        f'Your wallet has been debited.\n\n'
        f'Type: Debit\n'
        f'Amount: {_fmt_amount(amount)}\n'
        f'{_balance_line(balance_after)}'
        f'Reason: {reason or "-"}\n'
        f'Reference: {ref or "-"}\n'
    )

    if cfg.get('email_on_wallet_debit') and _user_email(user):
        _send_email(f'[{site_name}] Wallet debited', email_body, [user.email])

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
        subject = f'[{site_name}] New deposit request #{deposit.id}'
        body = (
            f'A new deposit request was submitted.\n\n'
            f'Deposit ID: {deposit.id}\n'
            f'User: {deposit.user.phone}\n'
            f'Amount: {_fmt_amount(deposit.amount)}\n'
            f'Note: {deposit.note or "-"}\n'
            f'Status: {deposit.status}\n'
        )
        _send_email(subject, body, [admin_email])

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
        body = (
            f'Your deposit has been approved and credited.\n\n'
            f'Type: Deposit credit\n'
            f'Deposit ID: {deposit.id}\n'
            f'Amount: {_fmt_amount(deposit.amount)}\n'
            f'{_balance_line(balance_after)}'
            f'Status: approved\n'
        )
        _send_email(f'[{site_name}] Deposit approved', body, [deposit.user.email])

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
    subject = f'[{site_name}] {product} top-up successful'
    body = (
        f'Your {product} top-up was successful.\n\n'
        f'Type: Top-up debit\n'
        f'Mobile: {topup.mobile_number}\n'
        f'Amount: {_fmt_amount(topup.amount)}\n'
        f'Total debited: {_fmt_amount(topup.total_debited)}\n'
        f'{_balance_line(balance_after)}'
        f'Reference: {topup.merchant_txn_id}\n'
    )
    push_body = (
        f'{product} top-up of {_fmt_amount(topup.amount)} to {topup.mobile_number} succeeded. '
        f'Debited {_fmt_amount(topup.total_debited)}.'
    )
    if cfg.get('email_on_topup') and _user_email(topup.user):
        _send_email(subject, body, [topup.user.email])
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
    email_body = (
        f'Your bank transfer was successful.\n\n'
        f'Type: Bank transfer debit\n'
        f'Amount: {_fmt_amount(transfer.amount)}\n'
        f'Total debited: {_fmt_amount(debited)}\n'
        f'{_balance_line(balance_after)}'
        f'Destination: {dest}\n'
        f'Bank: {bank or "-"}\n'
        f'Reference: {transfer.merchant_txn_id}\n'
    )

    if (cfg.get('email_on_transfer') or cfg.get('email_on_wallet_debit')) and _user_email(
        transfer.user
    ):
        _send_email(f'[{site_name}] Bank transfer successful', email_body, [transfer.user.email])

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
    email_body = (
        f'Your withdrawal has been processed.\n\n'
        f'Type: Withdrawal debit\n'
        f'Amount: {_fmt_amount(amount)}\n'
        f'{_balance_line(balance_after)}'
        f'Reason: {reason or "-"}\n'
        f'Reference: {ref or "-"}\n'
    )
    if cfg.get('email_on_wallet_debit') and _user_email(user):
        _send_email(f'[{site_name}] Withdrawal processed', email_body, [user.email])
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
    email_body = (
        f'Your wallet balance was adjusted by an administrator.\n\n'
        f'Type: Wallet adjustment ({adj_type})\n'
        f'Adjustment: {_fmt_amount(delta)}\n'
    )
    if before_val is not None:
        email_body += f'Previous balance: {_fmt_amount(before_val)}\n'
    email_body += _balance_line(after_val)
    email_body += (
        f'Reason: {reason or "Admin balance update"}\n'
        f'Reference: {ref or "-"}\n'
    )

    if cfg.get('email_on_wallet_adjustment') and _user_email(user):
        _send_email(f'[{site_name}] Wallet balance adjusted', email_body, [user.email])

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
        body = (
            f'Your remittance has been credited to your wallet.\n\n'
            f'Type: Remittance credit\n'
            f'Ref: {remittance.ref_no}\n'
            f'Amount: {_fmt_amount(credited)}\n'
            f'{_balance_line(balance_after)}'
            f'ID: {remittance.id}\n'
        )
        _send_email(f'[{site_name}] Remittance credited', body, [remittance.user.email])

    admin_email = (cfg.get('admin_alert_email') or '').strip()
    if admin_email and cfg.get('email_on_deposit'):
        _send_email(
            f'[{site_name}] Remittance received #{remittance.id}',
            (
                f'Remittance payout completed.\n\n'
                f'ID: {remittance.id}\n'
                f'User: {remittance.user.phone}\n'
                f'Ref: {remittance.ref_no}\n'
                f'Amount: {_fmt_amount(credited)}\n'
            ),
            [admin_email],
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
    subject = f'[{site_name}] Low wallet balance alert'
    body = (
        f'Wallet balance is at or below the configured threshold.\n\n'
        f'User: {wallet.user.phone}\n'
        f'Balance: {_fmt_amount(wallet.balance)}\n'
        f'Threshold: {_fmt_amount(threshold_val)}\n'
    )
    _send_email(subject, body, [admin_email])
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
        body = (
            f'Your KYC verification has been approved.\n\n'
            f'Submission ID: {submission.id}\n'
            f'Citizenship number: {submission.citizenship_number}\n'
            f'Status: approved\n'
        )
        _send_email(f'[{site_name}] KYC approved', body, [user.email])
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
        body = (
            f'Your KYC verification was rejected.\n\n'
            f'Submission ID: {submission.id}\n'
            f'Reason: {reason}\n'
            f'Status: rejected\n\n'
            f'You may submit again after correcting the issues.\n'
        )
        _send_email(f'[{site_name}] KYC rejected', body, [user.email])
    _push(
        user,
        f'{site_name}: KYC rejected',
        message,
        event='kyc',
        extra={'kyc_id': submission.id, 'subtype': 'rejected'},
    )
