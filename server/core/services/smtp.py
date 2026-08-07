"""
SMTP settings helpers — read credentials from Settings.config.smtp
(with Django EMAIL_* env fallbacks) and build a mail connection.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from django.conf import settings as django_settings
from django.core.mail import EmailMultiAlternatives, get_connection

from .app_config import get_app_config

PASSWORD_MASK = '••••••••'


def default_smtp_config() -> Dict[str, Any]:
    return {
        'enabled': False,
        'host': '',
        'port': 587,
        'encryption': 'tls',  # 'tls' | 'ssl' | 'none'
        'username': '',
        'password': '',
        'from_name': 'MySewa',
        'from_email': '',
    }


def get_smtp_config() -> Dict[str, Any]:
    """
    Resolve SMTP settings.

    When admin SMTP is enabled with a host, prefer Settings.config.smtp.
    Otherwise fall back to Django EMAIL_* environment settings.
    """
    stored = dict(default_smtp_config())
    try:
        stored.update(get_app_config().get('smtp') or {})
    except Exception:
        pass

    env_host = (getattr(django_settings, 'EMAIL_HOST', '') or '').strip()
    env_user = (getattr(django_settings, 'EMAIL_HOST_USER', '') or '').strip()
    env_pass = (getattr(django_settings, 'EMAIL_HOST_PASSWORD', '') or '').strip()
    env_port = int(getattr(django_settings, 'EMAIL_PORT', 587) or 587)
    env_tls = bool(getattr(django_settings, 'EMAIL_USE_TLS', True))
    env_ssl = bool(getattr(django_settings, 'EMAIL_USE_SSL', False))
    env_from = (getattr(django_settings, 'DEFAULT_FROM_EMAIL', '') or '').strip()

    db_enabled = bool(stored.get('enabled'))
    db_host = str(stored.get('host') or '').strip()

    if db_enabled and db_host:
        host = db_host
        username = str(stored.get('username') or '').strip()
        password = str(stored.get('password') or '')
        port = stored.get('port', 587)
        encryption = str(stored.get('encryption') or '').strip().lower()
        from_email = str(stored.get('from_email') or '').strip()
        from_name = str(stored.get('from_name') or '').strip() or 'MySewa'
        enabled = True
    else:
        host = env_host
        username = env_user
        password = env_pass
        port = env_port
        encryption = 'ssl' if env_ssl else ('tls' if env_tls else 'none')
        from_email = ''
        from_name = str(stored.get('from_name') or '').strip() or 'MySewa'
        enabled = bool(env_host)
        if env_from:
            if '<' in env_from and '>' in env_from:
                name_part, _, rest = env_from.partition('<')
                from_email = rest.rstrip('>').strip()
                if name_part.strip():
                    from_name = name_part.strip().strip('"')
            else:
                from_email = env_from

    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 587

    if encryption not in ('tls', 'ssl', 'none'):
        if stored.get('use_ssl'):
            encryption = 'ssl'
        elif stored.get('use_tls', True):
            encryption = 'tls'
        else:
            encryption = 'none'

    return {
        'enabled': enabled,
        'host': host,
        'port': port,
        'encryption': encryption,
        'username': username,
        'password': password,
        'from_name': from_name,
        'from_email': from_email,
    }


def format_from_address(smtp: Optional[Dict[str, Any]] = None) -> str:
    cfg = smtp or get_smtp_config()
    email = (cfg.get('from_email') or '').strip() or 'noreply@mysewa.local'
    name = (cfg.get('from_name') or '').strip() or 'MySewa'
    return f'{name} <{email}>'


def merge_smtp_override(override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Build SMTP config from saved settings, optionally overridden by request body."""
    base = get_smtp_config()
    if not override or not isinstance(override, dict):
        return base
    merged = dict(base)
    for key in (
        'enabled', 'host', 'port', 'encryption', 'username',
        'password', 'from_name', 'from_email', 'use_tls', 'use_ssl',
    ):
        if key not in override:
            continue
        value = override[key]
        if key == 'password' and (
            value is None
            or str(value).strip() == ''
            or str(value).strip() == PASSWORD_MASK
        ):
            continue
        merged[key] = value
    if 'encryption' not in override:
        if override.get('use_ssl'):
            merged['encryption'] = 'ssl'
        elif 'use_tls' in override:
            merged['encryption'] = 'tls' if override.get('use_tls') else 'none'
    try:
        merged['port'] = int(merged.get('port') or 587)
    except (TypeError, ValueError):
        merged['port'] = 587
    enc = str(merged.get('encryption') or 'tls').lower()
    merged['encryption'] = enc if enc in ('tls', 'ssl', 'none') else 'tls'
    return merged


def get_email_connection(smtp: Optional[Dict[str, Any]] = None, *, fail_silently: bool = False):
    """
    Return a Django email backend connection using admin SMTP settings when
    a host is configured; otherwise fall back to Django's default EMAIL_* setup.
    """
    cfg = smtp or get_smtp_config()
    host = (cfg.get('host') or '').strip()
    if not host:
        return get_connection(fail_silently=fail_silently)

    encryption = str(cfg.get('encryption') or 'tls').lower()
    use_ssl = encryption == 'ssl'
    use_tls = encryption == 'tls'
    port = int(cfg.get('port') or (465 if use_ssl else 587))

    return get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=host,
        port=port,
        username=(cfg.get('username') or '').strip() or None,
        password=cfg.get('password') or None,
        use_tls=use_tls,
        use_ssl=use_ssl,
        fail_silently=fail_silently,
    )


def send_smtp_email(
    subject: str,
    text_body: str,
    recipients: list,
    *,
    html_body: Optional[str] = None,
    smtp: Optional[Dict[str, Any]] = None,
    fail_silently: bool = True,
) -> bool:
    """Send an email using the configured (or overridden) SMTP connection."""
    recipients = [r for r in recipients if r]
    if not recipients:
        return False
    cfg = smtp or get_smtp_config()
    connection = get_email_connection(cfg, fail_silently=fail_silently)
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=format_from_address(cfg),
        to=recipients,
        connection=connection,
    )
    if html_body:
        message.attach_alternative(html_body, 'text/html')
    message.send(fail_silently=fail_silently)
    return True


def smtp_config_for_admin(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """SMTP section safe to return to admin UI (password masked)."""
    if config is None:
        try:
            raw = (get_app_config().get('smtp') or {})
        except Exception:
            raw = {}
    else:
        raw = config.get('smtp') if isinstance(config, dict) and 'smtp' in config else (config or {})
    base = default_smtp_config()
    if isinstance(raw, dict):
        base.update(raw)
    password = str(base.get('password') or '')
    base['password'] = PASSWORD_MASK if password else ''
    base['password_set'] = bool(password)
    enc = str(base.get('encryption') or 'tls').lower()
    if enc not in ('tls', 'ssl', 'none'):
        if base.get('use_ssl'):
            enc = 'ssl'
        elif base.get('use_tls', True):
            enc = 'tls'
        else:
            enc = 'none'
    base['encryption'] = enc
    try:
        base['port'] = int(base.get('port') or 587)
    except (TypeError, ValueError):
        base['port'] = 587
    return base


def preserve_smtp_password_on_merge(current: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Keep existing password when incoming password is blank or masked."""
    merged = {**(current or {}), **(incoming or {})}
    new_password = incoming.get('password') if isinstance(incoming, dict) else None
    if (
        new_password is None
        or str(new_password).strip() == ''
        or str(new_password).strip() == PASSWORD_MASK
    ):
        if isinstance(current, dict) and current.get('password'):
            merged['password'] = current['password']
        else:
            merged['password'] = ''
    return merged
