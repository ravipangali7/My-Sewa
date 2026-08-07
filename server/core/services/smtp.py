"""
SMTP settings helpers — read credentials from Settings.config.smtp
with Django EMAIL_* / hardcoded Gmail fallbacks, and build a mail connection.

Supported config keys (aliases accepted):
  smtp_email / username
  smtp_password / password
  smtp_email_from / from_email
  smtp_name / from_name
  host, port, encryption (tls|ssl|none), enabled
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from django.conf import settings as django_settings
from django.core.mail import EmailMultiAlternatives, get_connection

from .app_config import get_app_config

PASSWORD_MASK = '••••••••'

# Built-in Gmail fallbacks (overridable via Settings / env)
FALLBACK_SMTP = {
    'host': 'smtp.gmail.com',
    'port': 587,
    'encryption': 'tls',
    'use_tls': True,
    'use_ssl': False,
    'smtp_email': 'jhalakravi7@gmail.com',
    'smtp_password': 'ibidizfnxgtdpywm',
    'smtp_email_from': 'jhalakravi7@gmail.com',
    'smtp_name': 'ATOZ Store',
}


def default_smtp_config() -> Dict[str, Any]:
    return {
        'enabled': True,
        'host': FALLBACK_SMTP['host'],
        'port': FALLBACK_SMTP['port'],
        'encryption': FALLBACK_SMTP['encryption'],
        'smtp_email': FALLBACK_SMTP['smtp_email'],
        'smtp_password': FALLBACK_SMTP['smtp_password'],
        'smtp_email_from': FALLBACK_SMTP['smtp_email_from'],
        'smtp_name': FALLBACK_SMTP['smtp_name'],
        # Aliases kept in sync for older callers / UI
        'username': FALLBACK_SMTP['smtp_email'],
        'password': FALLBACK_SMTP['smtp_password'],
        'from_email': FALLBACK_SMTP['smtp_email_from'],
        'from_name': FALLBACK_SMTP['smtp_name'],
    }


def _first_nonempty(*values) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text and text != PASSWORD_MASK:
            return text
    return ''


def normalize_smtp_dict(raw: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Normalize alias keys onto the canonical smtp_* + legacy fields."""
    data = dict(default_smtp_config())
    if isinstance(raw, dict):
        data.update(raw)

    smtp_email = _first_nonempty(data.get('smtp_email'), data.get('username'))
    smtp_password = _first_nonempty(data.get('smtp_password'), data.get('password'))
    smtp_email_from = _first_nonempty(
        data.get('smtp_email_from'),
        data.get('from_email'),
        smtp_email,
    )
    smtp_name = _first_nonempty(data.get('smtp_name'), data.get('from_name'), 'MySewa')

    encryption = str(data.get('encryption') or '').strip().lower()
    if encryption not in ('tls', 'ssl', 'none'):
        if data.get('use_ssl'):
            encryption = 'ssl'
        elif data.get('use_tls', True):
            encryption = 'tls'
        else:
            encryption = 'none'

    try:
        port = int(data.get('port') or 587)
    except (TypeError, ValueError):
        port = 587

    host = _first_nonempty(data.get('host')) or FALLBACK_SMTP['host']

    normalized = {
        'enabled': bool(data.get('enabled', True)),
        'host': host,
        'port': port,
        'encryption': encryption,
        'smtp_email': smtp_email or FALLBACK_SMTP['smtp_email'],
        'smtp_password': smtp_password or FALLBACK_SMTP['smtp_password'],
        'smtp_email_from': smtp_email_from or FALLBACK_SMTP['smtp_email_from'],
        'smtp_name': smtp_name or FALLBACK_SMTP['smtp_name'],
    }
    # Keep aliases mirrored
    normalized['username'] = normalized['smtp_email']
    normalized['password'] = normalized['smtp_password']
    normalized['from_email'] = normalized['smtp_email_from']
    normalized['from_name'] = normalized['smtp_name']
    return normalized


def _env_smtp_overlay() -> Dict[str, Any]:
    """Values from Django settings / environment (may be empty)."""
    env_host = (getattr(django_settings, 'EMAIL_HOST', '') or '').strip()
    env_user = (getattr(django_settings, 'EMAIL_HOST_USER', '') or '').strip()
    env_pass = (getattr(django_settings, 'EMAIL_HOST_PASSWORD', '') or '').strip()
    env_port = int(getattr(django_settings, 'EMAIL_PORT', 587) or 587)
    env_tls = bool(getattr(django_settings, 'EMAIL_USE_TLS', True))
    env_ssl = bool(getattr(django_settings, 'EMAIL_USE_SSL', False))
    env_from = (getattr(django_settings, 'DEFAULT_FROM_EMAIL', '') or '').strip()
    env_name = (getattr(django_settings, 'EMAIL_FROM_NAME', '') or '').strip()

    from_email = ''
    from_name = env_name
    if env_from:
        if '<' in env_from and '>' in env_from:
            name_part, _, rest = env_from.partition('<')
            from_email = rest.rstrip('>').strip()
            if name_part.strip() and not from_name:
                from_name = name_part.strip().strip('"')
        else:
            from_email = env_from

    return {
        'host': env_host,
        'port': env_port,
        'encryption': 'ssl' if env_ssl else ('tls' if env_tls else 'none'),
        'smtp_email': env_user,
        'smtp_password': env_pass,
        'smtp_email_from': from_email,
        'smtp_name': from_name,
        'username': env_user,
        'password': env_pass,
        'from_email': from_email,
        'from_name': from_name,
    }


def get_smtp_config() -> Dict[str, Any]:
    """
    Resolve SMTP settings.

    Priority:
      1. Settings.config.smtp (admin portal) when enabled / has credentials
      2. Django EMAIL_* env
      3. Built-in Gmail fallbacks
    """
    stored_raw: Dict[str, Any] = {}
    try:
        stored_raw = dict(get_app_config().get('smtp') or {})
    except Exception:
        stored_raw = {}

    stored = normalize_smtp_dict(stored_raw)
    env = _env_smtp_overlay()

    # Prefer admin-stored values when enabled (or when email/password are set)
    use_stored = bool(stored.get('enabled')) or bool(
        _first_nonempty(stored_raw.get('smtp_email'), stored_raw.get('username'))
    )

    if use_stored:
        return stored

    # Merge env over fallbacks
    merged = dict(FALLBACK_SMTP)
    for key, value in env.items():
        if _first_nonempty(value):
            merged[key] = value
    return normalize_smtp_dict(merged)


def format_from_address(smtp: Optional[Dict[str, Any]] = None) -> str:
    cfg = normalize_smtp_dict(smtp or get_smtp_config())
    email = cfg.get('smtp_email_from') or cfg.get('from_email') or 'noreply@mysewa.local'
    name = cfg.get('smtp_name') or cfg.get('from_name') or 'MySewa'
    return f'{name} <{email}>'


def merge_smtp_override(override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Build SMTP config from saved settings, optionally overridden by request body."""
    base = get_smtp_config()
    if not override or not isinstance(override, dict):
        return base

    # Accept both alias sets from the Test Mail form
    patched = dict(override)
    if 'smtp_email' in patched and 'username' not in patched:
        patched['username'] = patched['smtp_email']
    if 'smtp_password' in patched and 'password' not in patched:
        patched['password'] = patched['smtp_password']
    if 'smtp_email_from' in patched and 'from_email' not in patched:
        patched['from_email'] = patched['smtp_email_from']
    if 'smtp_name' in patched and 'from_name' not in patched:
        patched['from_name'] = patched['smtp_name']

    merged = dict(base)
    for key in (
        'enabled', 'host', 'port', 'encryption',
        'username', 'password', 'from_name', 'from_email',
        'smtp_email', 'smtp_password', 'smtp_email_from', 'smtp_name',
        'use_tls', 'use_ssl',
    ):
        if key not in patched:
            continue
        value = patched[key]
        if key in ('password', 'smtp_password') and (
            value is None
            or str(value).strip() == ''
            or str(value).strip() == PASSWORD_MASK
        ):
            continue
        merged[key] = value

    if 'encryption' not in patched:
        if patched.get('use_ssl'):
            merged['encryption'] = 'ssl'
        elif 'use_tls' in patched:
            merged['encryption'] = 'tls' if patched.get('use_tls') else 'none'

    return normalize_smtp_dict(merged)


def get_email_connection(smtp: Optional[Dict[str, Any]] = None, *, fail_silently: bool = False):
    """Return a Django SMTP connection from resolved config."""
    cfg = normalize_smtp_dict(smtp or get_smtp_config())
    host = (cfg.get('host') or '').strip() or FALLBACK_SMTP['host']
    encryption = str(cfg.get('encryption') or 'tls').lower()
    use_ssl = encryption == 'ssl'
    use_tls = encryption == 'tls'
    port = int(cfg.get('port') or (465 if use_ssl else 587))

    return get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=host,
        port=port,
        username=(cfg.get('smtp_email') or cfg.get('username') or '').strip() or None,
        password=cfg.get('smtp_password') or cfg.get('password') or None,
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
    cfg = normalize_smtp_dict(smtp or get_smtp_config())
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

    base = normalize_smtp_dict(raw if isinstance(raw, dict) else {})
    password = str(base.get('smtp_password') or base.get('password') or '')
    # If password equals the known fallback and was never customized, still report set
    password_set = bool(password)
    base['smtp_password'] = PASSWORD_MASK if password_set else ''
    base['password'] = base['smtp_password']
    base['password_set'] = password_set
    return base


def preserve_smtp_password_on_merge(current: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Keep existing password when incoming password is blank or masked."""
    incoming = dict(incoming or {})
    # Mirror aliases into both key sets before merge
    if 'smtp_email' in incoming and 'username' not in incoming:
        incoming['username'] = incoming['smtp_email']
    if 'username' in incoming and 'smtp_email' not in incoming:
        incoming['smtp_email'] = incoming['username']
    if 'smtp_email_from' in incoming and 'from_email' not in incoming:
        incoming['from_email'] = incoming['smtp_email_from']
    if 'from_email' in incoming and 'smtp_email_from' not in incoming:
        incoming['smtp_email_from'] = incoming['from_email']
    if 'smtp_name' in incoming and 'from_name' not in incoming:
        incoming['from_name'] = incoming['smtp_name']
    if 'from_name' in incoming and 'smtp_name' not in incoming:
        incoming['smtp_name'] = incoming['from_name']
    if 'smtp_password' in incoming and 'password' not in incoming:
        incoming['password'] = incoming['smtp_password']
    if 'password' in incoming and 'smtp_password' not in incoming:
        incoming['smtp_password'] = incoming['password']

    merged = {**(current or {}), **incoming}
    new_password = _first_nonempty(
        incoming.get('smtp_password'),
        incoming.get('password'),
    )
    if not new_password:
        old_password = _first_nonempty(
            (current or {}).get('smtp_password'),
            (current or {}).get('password'),
        )
        merged['smtp_password'] = old_password
        merged['password'] = old_password
    return normalize_smtp_dict(merged)
