"""
SMTP settings helpers — read credentials from Settings.config.smtp
with Django EMAIL_* / built-in Gmail fallbacks, and build a mail connection.

Supported config keys (aliases accepted):
  smtp_email / username
  smtp_password / password
  smtp_email_from / from_email
  smtp_name / from_name
  host, port, encryption (tls|ssl|none), enabled
"""
from __future__ import annotations

import logging
import smtplib
from typing import Any, Dict, Optional

from django.conf import settings as django_settings
from django.core.mail import EmailMultiAlternatives, get_connection

from .app_config import get_app_config

logger = logging.getLogger(__name__)

PASSWORD_MASK = '••••••••'

# Built-in Gmail fallbacks (overridable via Settings / env)
FALLBACK_SMTP = {
    'host': 'smtp.gmail.com',
    'port': 587,
    'encryption': 'tls',
    'use_tls': True,
    'use_ssl': False,
    'smtp_email': 'targetdubai2026@gmail.com',
    'smtp_password': 'kzti fxem jltr wakm',
    'smtp_email_from': 'targetdubai2026@gmail.com',
    'smtp_name': 'MySewa',
}

# Revoked / blocked app passwords that must not be preferred over FALLBACK_SMTP
_REVOKED_SMTP_PASSWORDS = frozenset({
    'ibidizfnxgtdpywm',
})

# Accounts known to use revoked credentials — never prefer over FALLBACK / env
_REVOKED_SMTP_USERS = frozenset({
    'jhalakravi7@gmail.com',
})


def _smtp_timeout() -> int:
    try:
        return int(getattr(django_settings, 'EMAIL_TIMEOUT', 30) or 30)
    except (TypeError, ValueError):
        return 30


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


def _normalize_password(value) -> str:
    """Strip spaces (Gmail app passwords are often copied with spaces)."""
    return ''.join(str(value or '').split())


def _is_usable_smtp_password(value) -> bool:
    text = _normalize_password(value)
    if not text or text == PASSWORD_MASK:
        return False
    return text not in _REVOKED_SMTP_PASSWORDS


def _is_revoked_smtp_user(email: str) -> bool:
    return (email or '').strip().lower() in _REVOKED_SMTP_USERS


def _credential_fingerprint(cfg: Dict[str, Any]) -> tuple:
    email = (cfg.get('smtp_email') or cfg.get('username') or '').strip().lower()
    password = _normalize_password(cfg.get('smtp_password') or cfg.get('password'))
    host = (cfg.get('host') or '').strip().lower()
    return (host, email, password)


def normalize_smtp_dict(raw: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Normalize alias keys onto the canonical smtp_* + legacy fields."""
    data = dict(default_smtp_config())
    if isinstance(raw, dict):
        data.update(raw)

    smtp_email = _first_nonempty(data.get('smtp_email'), data.get('username'))
    raw_password = _first_nonempty(data.get('smtp_password'), data.get('password'))
    # Drop revoked app passwords so FALLBACK_SMTP takes over
    smtp_password = raw_password if _is_usable_smtp_password(raw_password) else ''
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

    # Drop revoked Gmail identities so FALLBACK / env credentials are used
    if _is_revoked_smtp_user(smtp_email):
        smtp_email = ''
        smtp_email_from = ''
        smtp_password = ''

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


def _stored_smtp_is_preferable(stored_raw: Dict[str, Any]) -> bool:
    """
    Prefer admin-stored SMTP only when explicitly enabled and credentials look usable.
    Revoked accounts/passwords must not block env / FALLBACK.
    """
    if not isinstance(stored_raw, dict) or not stored_raw:
        return False
    if stored_raw.get('enabled') is False:
        return False

    email = _first_nonempty(stored_raw.get('smtp_email'), stored_raw.get('username'))
    password = _first_nonempty(stored_raw.get('smtp_password'), stored_raw.get('password'))

    if _is_revoked_smtp_user(email):
        return False
    if password and not _is_usable_smtp_password(password):
        return False

    # Prefer stored when enabled (default) and either has a usable password or a custom host
    enabled = bool(stored_raw.get('enabled', True))
    if not enabled:
        return False
    if _is_usable_smtp_password(password):
        return True
    # Email set without password still preferred only if it is not a revoked identity;
    # normalize will fill FALLBACK password for that email which may mismatch — avoid.
    return False


def _ensure_usable_stored_smtp(stored_raw: Dict[str, Any]) -> None:
    """
    Persist working FALLBACK credentials into Settings when stored SMTP is
    missing, revoked, or otherwise unusable — so admin UI matches runtime.
    Respects explicit enabled=False (env/fallback used without overwriting).
    """
    if not isinstance(stored_raw, dict):
        stored_raw = {}
    if stored_raw.get('enabled') is False:
        return
    if _stored_smtp_is_preferable(stored_raw):
        return

    email = _first_nonempty(stored_raw.get('smtp_email'), stored_raw.get('username'))
    password = _first_nonempty(stored_raw.get('smtp_password'), stored_raw.get('password'))
    # Only auto-write when credentials are absent/revoked — not when a custom
    # non-revoked password exists (even if it might be wrong; send-time retry handles that).
    if (
        password
        and _is_usable_smtp_password(password)
        and not _is_revoked_smtp_user(email)
    ):
        return

    try:
        from ..models import Settings

        settings_obj = Settings.load()
        cfg = dict(settings_obj.get_config() or {})
        healed = normalize_smtp_dict(FALLBACK_SMTP)
        healed['enabled'] = True
        cfg['smtp'] = healed
        settings_obj.config = cfg
        settings_obj.save(update_fields=['config', 'updated_at'])
        logger.warning(
            'Bootstrapped Settings SMTP → %s (previous was missing/revoked)',
            healed.get('smtp_email'),
        )
    except Exception:
        logger.debug('Could not persist bootstrapped SMTP settings', exc_info=True)


def get_smtp_config() -> Dict[str, Any]:
    """
    Resolve SMTP settings.

    Priority:
      1. Settings.config.smtp when enabled with usable credentials
      2. Django EMAIL_* env (when username + password set)
      3. Built-in Gmail fallbacks
    """
    stored_raw: Dict[str, Any] = {}
    try:
        stored_raw = dict(get_app_config().get('smtp') or {})
    except Exception:
        stored_raw = {}

    _ensure_usable_stored_smtp(stored_raw)

    # Re-read after possible bootstrap/heal
    try:
        stored_raw = dict(get_app_config().get('smtp') or {})
    except Exception:
        pass

    env = _env_smtp_overlay()

    if _stored_smtp_is_preferable(stored_raw):
        return normalize_smtp_dict(stored_raw)

    # Prefer env when it has usable credentials
    if _is_usable_smtp_password(env.get('smtp_password')) and _first_nonempty(
        env.get('smtp_email')
    ):
        merged = dict(FALLBACK_SMTP)
        for key, value in env.items():
            if _first_nonempty(value) or key in ('port', 'encryption'):
                if value is not None and str(value).strip() != '':
                    merged[key] = value
        return normalize_smtp_dict(merged)

    # Merge any partial env over fallbacks
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
        password=_normalize_password(cfg.get('smtp_password') or cfg.get('password')) or None,
        use_tls=use_tls,
        use_ssl=use_ssl,
        timeout=_smtp_timeout(),
        fail_silently=fail_silently,
    )


def _send_with_config(
    *,
    subject: str,
    text_body: str,
    recipients: list,
    html_body: Optional[str],
    cfg: Dict[str, Any],
    fail_silently: bool,
    bcc: Optional[list],
) -> bool:
    connection = get_email_connection(cfg, fail_silently=fail_silently)
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=format_from_address(cfg),
        to=recipients,
        bcc=bcc or None,
        connection=connection,
    )
    if html_body:
        message.attach_alternative(html_body, 'text/html')
    # Help inbox providers treat transactional OTP mail correctly
    message.extra_headers = {
        **(message.extra_headers or {}),
        'X-Mailer': 'MySewa',
        'Auto-Submitted': 'auto-generated',
    }
    sent_count = message.send(fail_silently=fail_silently)
    return bool(sent_count)


def send_smtp_email(
    subject: str,
    text_body: str,
    recipients: list,
    *,
    html_body: Optional[str] = None,
    smtp: Optional[Dict[str, Any]] = None,
    fail_silently: bool = True,
    bcc: Optional[list] = None,
) -> bool:
    """Send an email using the configured (or overridden) SMTP connection.

    If the primary SMTP account rejects the message (auth / policy), automatically
    retries once with FALLBACK_SMTP so OTP and receipts keep flowing.
    """
    recipients = [r for r in recipients if r]
    bcc_list = [r for r in (bcc or []) if r]
    if not recipients:
        return False

    cfg = normalize_smtp_dict(smtp or get_smtp_config())
    fallback = normalize_smtp_dict(FALLBACK_SMTP)
    try_fallback = _credential_fingerprint(cfg) != _credential_fingerprint(fallback)

    try:
        sent = _send_with_config(
            subject=subject,
            text_body=text_body,
            recipients=recipients,
            html_body=html_body,
            cfg=cfg,
            fail_silently=fail_silently,
            bcc=bcc_list,
        )
        if sent:
            logger.info(
                'SMTP accepted mail via %s → %s (%s)',
                cfg.get('smtp_email'),
                recipients,
                subject,
            )
            return True
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        logger.error(
            'SMTP send failed via %s for %s: %s',
            cfg.get('smtp_email'),
            recipients,
            exc,
        )
        if not try_fallback:
            if not fail_silently:
                raise
            return False
        # Fall through to fallback retry
        sent = False
    except Exception:
        logger.exception(
            'Unexpected SMTP error via %s for %s',
            cfg.get('smtp_email'),
            recipients,
        )
        if not try_fallback:
            if not fail_silently:
                raise
            return False
        sent = False

    if not try_fallback:
        return False

    logger.warning(
        'Retrying email via fallback SMTP (%s) after primary failure (%s)',
        fallback.get('smtp_email'),
        cfg.get('smtp_email'),
    )
    try:
        sent = _send_with_config(
            subject=subject,
            text_body=text_body,
            recipients=recipients,
            html_body=html_body,
            cfg=fallback,
            fail_silently=fail_silently,
            bcc=bcc_list,
        )
        if sent:
            logger.info(
                'Fallback SMTP accepted mail via %s → %s (%s)',
                fallback.get('smtp_email'),
                recipients,
                subject,
            )
        return bool(sent)
    except Exception:
        logger.exception(
            'Fallback SMTP also failed for %s: %s',
            recipients,
            subject,
        )
        if not fail_silently:
            raise
        return False


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
        # Do not preserve a revoked password onto a healed account
        if _is_usable_smtp_password(old_password) and not _is_revoked_smtp_user(
            _first_nonempty(merged.get('smtp_email'), merged.get('username'))
        ):
            merged['smtp_password'] = old_password
            merged['password'] = old_password
        else:
            # Prefer fallback password when healing away from revoked identity
            merged['smtp_password'] = FALLBACK_SMTP['smtp_password']
            merged['password'] = FALLBACK_SMTP['smtp_password']
            if _is_revoked_smtp_user(
                _first_nonempty(merged.get('smtp_email'), merged.get('username'))
            ):
                merged['smtp_email'] = FALLBACK_SMTP['smtp_email']
                merged['username'] = FALLBACK_SMTP['smtp_email']
                merged['smtp_email_from'] = FALLBACK_SMTP['smtp_email_from']
                merged['from_email'] = FALLBACK_SMTP['smtp_email_from']
    return normalize_smtp_dict(merged)
