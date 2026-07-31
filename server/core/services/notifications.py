"""
Notification helpers that respect Settings.config.notifications toggles.

Email uses Django's email backend. SMS has no provider configured yet, so when
enabled we log the outbound SMS and also email a copy when a user email exists.
"""
import logging
from typing import Optional

from django.conf import settings as django_settings
from django.core.mail import send_mail

from .app_config import get_app_config

logger = logging.getLogger(__name__)


def _from_email() -> str:
    return getattr(django_settings, 'DEFAULT_FROM_EMAIL', None) or 'noreply@mysewa.local'


def _send_email(subject: str, message: str, recipients: list) -> bool:
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
            fail_silently=True,
        )
        logger.info('Email sent to %s: %s', recipients, subject)
        return True
    except Exception:
        logger.exception('Failed to send email: %s', subject)
        return False


def _send_sms(phone: str, message: str) -> bool:
    """
    Placeholder SMS sender. Logs the message so the toggle is observable.
    Replace with a real SMS gateway when available.
    """
    if not phone:
        return False
    logger.info('SMS to %s: %s', phone, message)
    return True


def notify_deposit_submitted(deposit) -> None:
    cfg = get_app_config().get('notifications') or {}
    if not cfg.get('email_on_deposit'):
        return
    admin_email = (cfg.get('admin_alert_email') or '').strip()
    site = get_app_config().get('site') or {}
    site_name = site.get('site_name') or 'MySewa'
    subject = f'[{site_name}] New deposit request #{deposit.id}'
    body = (
        f'A new deposit request was submitted.\n\n'
        f'Deposit ID: {deposit.id}\n'
        f'User: {deposit.user.phone}\n'
        f'Amount: Rs. {deposit.amount}\n'
        f'Note: {deposit.note or "-"}\n'
        f'Status: {deposit.status}\n'
    )
    _send_email(subject, body, [admin_email])


def notify_deposit_approved(deposit) -> None:
    cfg = get_app_config().get('notifications') or {}
    if not cfg.get('sms_on_deposit_approved'):
        return
    site = get_app_config().get('site') or {}
    site_name = site.get('site_name') or 'MySewa'
    message = (
        f'{site_name}: Your deposit of Rs. {deposit.amount} '
        f'(#{deposit.id}) has been approved and credited to your wallet.'
    )
    _send_sms(deposit.user.phone, message)
    if deposit.user.email:
        _send_email(
            f'[{site_name}] Deposit approved',
            message,
            [deposit.user.email],
        )


def notify_topup_success(topup) -> None:
    cfg = get_app_config().get('notifications') or {}
    if not cfg.get('email_on_topup'):
        return
    if not topup.user.email:
        return
    site = get_app_config().get('site') or {}
    site_name = site.get('site_name') or 'MySewa'
    product = 'NTC' if topup.product_id == 1 else 'NCELL'
    subject = f'[{site_name}] {product} top-up successful'
    body = (
        f'Your {product} top-up was successful.\n\n'
        f'Mobile: {topup.mobile_number}\n'
        f'Amount: Rs. {topup.amount}\n'
        f'Total debited: Rs. {topup.total_debited}\n'
        f'Reference: {topup.merchant_txn_id}\n'
    )
    _send_email(subject, body, [topup.user.email])


def notify_low_balance_if_needed(wallet) -> None:
    cfg = get_app_config().get('notifications') or {}
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
    site = get_app_config().get('site') or {}
    site_name = site.get('site_name') or 'MySewa'
    subject = f'[{site_name}] Low wallet balance alert'
    body = (
        f'Wallet balance is at or below the configured threshold.\n\n'
        f'User: {wallet.user.phone}\n'
        f'Balance: Rs. {wallet.balance}\n'
        f'Threshold: Rs. {threshold_val}\n'
    )
    _send_email(subject, body, [admin_email])
