"""
FCM push delivery for registered DeviceToken rows.

Uses the legacy FCM HTTP API when FCM_SERVER_KEY is set. When Firebase
credentials are present but no server key, logs that HTTP v1 is not wired yet
and still records the payload. With neither configured, logs the payload
(graceful no-op) so notification hooks stay observable in development.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Optional

from django.conf import settings as django_settings

logger = logging.getLogger(__name__)

FCM_LEGACY_URL = 'https://fcm.googleapis.com/fcm/send'


def _fcm_server_key() -> str:
    return (
        getattr(django_settings, 'FCM_SERVER_KEY', None)
        or os.environ.get('FCM_SERVER_KEY', '')
    ).strip()


def _firebase_credentials_configured() -> bool:
    """True when env suggests Firebase Admin / service-account credentials exist."""
    if getattr(django_settings, 'FIREBASE_CREDENTIALS_JSON', None):
        return True
    if os.environ.get('FIREBASE_CREDENTIALS_JSON', '').strip():
        return True
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '').strip():
        return True
    path = (
        getattr(django_settings, 'FIREBASE_CREDENTIALS_PATH', None)
        or os.environ.get('FIREBASE_CREDENTIALS_PATH', '')
    ).strip()
    return bool(path and os.path.isfile(path))


def is_push_configured() -> bool:
    return bool(_fcm_server_key()) or _firebase_credentials_configured()


def _send_fcm_legacy(token: str, title: str, body: str, data: Optional[dict] = None) -> bool:
    server_key = _fcm_server_key()
    if not server_key:
        return False

    payload: dict[str, Any] = {
        'to': token,
        'notification': {
            'title': title,
            'body': body,
            'sound': 'default',
        },
        'priority': 'high',
    }
    if data:
        # FCM data values must be strings
        payload['data'] = {str(k): str(v) for k, v in data.items()}

    req = urllib.request.Request(
        FCM_LEGACY_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'key={server_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            result = json.loads(raw) if raw else {}
            if result.get('failure'):
                logger.warning('FCM failure for token …%s: %s', token[-8:], result)
                return False
            logger.info('FCM sent to …%s: %s', token[-8:], title)
            return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace') if exc.fp else ''
        logger.warning('FCM HTTP %s for …%s: %s', exc.code, token[-8:], detail[:300])
        return False
    except Exception:
        logger.exception('FCM request failed for …%s', token[-8:])
        return False


def send_push_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> int:
    """
    Deliver a notification to one or more device tokens.
    Returns the number of successful sends (0 when logging only).
    """
    tokens = [t.strip() for t in tokens if t and str(t).strip()]
    if not tokens:
        logger.info('Push skipped (no tokens): %s — %s', title, body)
        return 0

    payload_preview = {
        'title': title,
        'body': body,
        'data': data or {},
        'token_count': len(tokens),
        'tokens_suffix': [t[-12:] for t in tokens],
    }

    server_key = _fcm_server_key()
    if not server_key:
        if _firebase_credentials_configured():
            logger.info(
                'Push not sent (FIREBASE credentials present but FCM_SERVER_KEY '
                'missing; HTTP v1 not configured). Payload: %s',
                payload_preview,
            )
        else:
            logger.info('Push no-op (FCM not configured). Payload: %s', payload_preview)
        return 0

    sent = 0
    for token in tokens:
        if _send_fcm_legacy(token, title, body, data):
            sent += 1
    return sent


def send_push_to_user(
    user,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> int:
    """Send push to all DeviceToken rows for the user."""
    if user is None:
        return 0
    from ..models import DeviceToken

    tokens = list(
        DeviceToken.objects.filter(user=user).values_list('token', flat=True)
    )
    if not tokens:
        logger.info(
            'Push skipped (no device tokens) user=%s: %s',
            getattr(user, 'phone', user),
            title,
        )
        return 0
    return send_push_to_tokens(tokens, title, body, data)
