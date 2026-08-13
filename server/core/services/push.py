"""
FCM push delivery for registered DeviceToken rows.

Prefers Firebase Cloud Messaging HTTP v1 (service-account credentials).
Falls back to the legacy FCM HTTP API when only FCM_SERVER_KEY is set.
Without credentials, payloads are logged so notification hooks stay observable.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from django.conf import settings as django_settings

logger = logging.getLogger(__name__)

FCM_LEGACY_URL = 'https://fcm.googleapis.com/fcm/send'
FCM_HTTP_V1_URL = 'https://fcm.googleapis.com/v1/projects/{project_id}/messages:send'
FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
STUB_PREFIXES = ('flutter-stub', 'web:', 'stub:')

_token_lock = threading.Lock()
_cached_access_token: Optional[str] = None
_cached_token_expiry: float = 0.0
_cached_project_id: Optional[str] = None


def is_real_fcm_token(token: str) -> bool:
    value = (token or '').strip()
    if len(value) < 20:
        return False
    lowered = value.lower()
    return not any(lowered.startswith(prefix) for prefix in STUB_PREFIXES)


def _fcm_server_key() -> str:
    return (
        getattr(django_settings, 'FCM_SERVER_KEY', None)
        or os.environ.get('FCM_SERVER_KEY', '')
    ).strip()


def _credentials_path() -> str:
    return (
        getattr(django_settings, 'FIREBASE_CREDENTIALS_PATH', None)
        or os.environ.get('FIREBASE_CREDENTIALS_PATH', '')
        or os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '')
    ).strip()


def _credentials_json_raw() -> str:
    return (
        getattr(django_settings, 'FIREBASE_CREDENTIALS_JSON', None)
        or os.environ.get('FIREBASE_CREDENTIALS_JSON', '')
    ).strip()


def _default_credentials_file() -> str:
    base = getattr(django_settings, 'BASE_DIR', None)
    if not base:
        return ''
    path = os.path.join(str(base), 'firebase-service-account.json')
    return path if os.path.isfile(path) else ''


def _load_service_account_info() -> Optional[dict]:
    raw = _credentials_json_raw()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data.get('private_key'):
                return data
        except json.JSONDecodeError:
            logger.warning('FIREBASE_CREDENTIALS_JSON is not valid JSON')

    path = _credentials_path() or _default_credentials_file()
    if path and os.path.isfile(path):
        try:
            with open(path, encoding='utf-8') as fh:
                data = json.load(fh)
            if isinstance(data, dict) and data.get('private_key'):
                return data
        except Exception:
            logger.exception('Failed to read Firebase service account file: %s', path)
    return None


def _firebase_credentials_configured() -> bool:
    return _load_service_account_info() is not None


def push_mode() -> str:
    if _firebase_credentials_configured():
        return 'http_v1'
    if _fcm_server_key():
        return 'legacy'
    return 'none'


def is_push_configured() -> bool:
    return push_mode() != 'none'


def _project_id_from_info(info: dict) -> str:
    return (
        getattr(django_settings, 'FIREBASE_PROJECT_ID', None)
        or os.environ.get('FIREBASE_PROJECT_ID', '')
        or info.get('project_id')
        or ''
    ).strip()


def _access_token_and_project() -> tuple[str, str]:
    """Return (oauth_access_token, firebase_project_id) for HTTP v1."""
    import time

    global _cached_access_token, _cached_token_expiry, _cached_project_id

    now = time.time()
    with _token_lock:
        if (
            _cached_access_token
            and _cached_project_id
            and now < (_cached_token_expiry - 60)
        ):
            return _cached_access_token, _cached_project_id

    info = _load_service_account_info()
    if not info:
        raise RuntimeError('Firebase service account credentials are not configured')

    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request as GoogleAuthRequest
    except ImportError as exc:
        raise RuntimeError(
            'google-auth is required for FCM HTTP v1. pip install google-auth'
        ) from exc

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=[FCM_SCOPE],
    )
    creds.refresh(GoogleAuthRequest())
    project_id = _project_id_from_info(info)
    if not project_id:
        raise RuntimeError('Firebase project_id is missing from the service account')

    expiry = now + 3500
    if getattr(creds, 'expiry', None) is not None:
        try:
            expiry = creds.expiry.timestamp()
        except Exception:
            pass

    with _token_lock:
        _cached_access_token = creds.token
        _cached_token_expiry = expiry
        _cached_project_id = project_id
    return creds.token, project_id


def _stringify_data(data: Optional[dict]) -> dict[str, str]:
    if not data:
        return {}
    out: dict[str, str] = {}
    for key, value in data.items():
        if value is None:
            continue
        out[str(key)] = str(value)
    return out


def _send_fcm_http_v1(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> tuple[bool, Optional[str]]:
    """
    Send one HTTP v1 message.
    Returns (ok, error_code). error_code is set on FCM failures for token cleanup.
    """
    access_token, project_id = _access_token_and_project()
    payload = {
        'message': {
            'token': token,
            'notification': {
                'title': title,
                'body': body,
            },
            'data': _stringify_data(data),
            'android': {
                'priority': 'HIGH',
                'notification': {
                    'sound': 'default',
                    'channel_id': 'mysewa_default',
                    'click_action': 'FLUTTER_NOTIFICATION_CLICK',
                },
            },
            'apns': {
                'payload': {
                    'aps': {
                        'sound': 'default',
                        'badge': 1,
                    },
                },
            },
        },
    }
    req = urllib.request.Request(
        FCM_HTTP_V1_URL.format(project_id=project_id),
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json; charset=UTF-8',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
            logger.info('FCM HTTP v1 sent to …%s: %s', token[-8:], title)
            return True, None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace') if exc.fp else ''
        error_code = None
        try:
            parsed = json.loads(detail) if detail else {}
            error_code = (
                ((parsed.get('error') or {}).get('details') or [{}])[0].get('errorCode')
                or (parsed.get('error') or {}).get('status')
            )
        except Exception:
            error_code = None
        logger.warning(
            'FCM HTTP v1 %s for …%s: %s',
            exc.code, token[-8:], (detail or '')[:400],
        )
        return False, error_code or str(exc.code)
    except Exception:
        logger.exception('FCM HTTP v1 request failed for …%s', token[-8:])
        return False, 'REQUEST_FAILED'


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
            'android_channel_id': 'mysewa_default',
        },
        'priority': 'high',
    }
    extra = _stringify_data(data)
    if extra:
        payload['data'] = extra

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
                logger.warning('FCM legacy failure for token …%s: %s', token[-8:], result)
                return False
            logger.info('FCM legacy sent to …%s: %s', token[-8:], title)
            return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace') if exc.fp else ''
        logger.warning('FCM legacy HTTP %s for …%s: %s', exc.code, token[-8:], detail[:300])
        return False
    except Exception:
        logger.exception('FCM legacy request failed for …%s', token[-8:])
        return False


def _delete_invalid_token(token: str) -> None:
    try:
        from ..models import DeviceToken

        deleted, _ = DeviceToken.objects.filter(token=token).delete()
        if deleted:
            logger.info('Removed invalid FCM token …%s', token[-8:])
    except Exception:
        logger.exception('Failed to delete invalid FCM token …%s', token[-8:])


def _should_drop_token(error_code: Optional[str]) -> bool:
    if not error_code:
        return False
    code = str(error_code).upper()
    return code in {
        'UNREGISTERED',
        'NOT_FOUND',
        '404',
    }


def send_push_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> dict[str, int]:
    """
    Deliver a notification to one or more device tokens.
    Returns {sent, failed, skipped}.
    """
    unique: list[str] = []
    seen: set[str] = set()
    for raw in tokens:
        token = (raw or '').strip()
        if not token or token in seen:
            continue
        seen.add(token)
        unique.append(token)

    skipped = sum(1 for token in unique if not is_real_fcm_token(token))
    unique = [token for token in unique if is_real_fcm_token(token)]

    result = {'sent': 0, 'failed': 0, 'skipped': skipped}
    if not unique:
        logger.info('Push skipped (no real FCM tokens): %s — %s', title, body)
        return result

    payload_preview = {
        'title': title,
        'body': body,
        'data': data or {},
        'token_count': len(unique),
        'tokens_suffix': [t[-12:] for t in unique[:8]],
    }

    mode = push_mode()
    if mode == 'none':
        logger.info('Push no-op (FCM not configured). Payload: %s', payload_preview)
        result['skipped'] += len(unique)
        return result

    extra = dict(data or {})
    extra.setdefault('click_action', 'FLUTTER_NOTIFICATION_CLICK')

    def _one(token: str) -> bool:
        if mode == 'http_v1':
            ok, error_code = _send_fcm_http_v1(token, title, body, extra)
            if not ok and _should_drop_token(error_code):
                _delete_invalid_token(token)
            return ok
        return _send_fcm_legacy(token, title, body, extra)

    workers = min(8, max(1, len(unique)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_one, token) for token in unique]
        for future in as_completed(futures):
            try:
                if future.result():
                    result['sent'] += 1
                else:
                    result['failed'] += 1
            except Exception:
                logger.exception('Push worker failed')
                result['failed'] += 1
    return result


def send_push_to_user(
    user,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> int:
    """Send push to all DeviceToken rows for the user. Returns successful send count."""
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
    return send_push_to_tokens(tokens, title, body, data)['sent']


def send_push_to_all(title: str, body: str, data: Optional[dict] = None) -> dict[str, int]:
    from ..models import DeviceToken

    tokens = list(DeviceToken.objects.values_list('token', flat=True))
    return send_push_to_tokens(tokens, title, body, data)


def push_status() -> dict[str, Any]:
    from django.db.models import Count

    from ..models import DeviceToken

    qs = DeviceToken.objects.all()
    real_qs = qs.exclude(token__istartswith='flutter-stub').exclude(token__istartswith='web:')
    mode = push_mode()
    project_id = None
    info = _load_service_account_info()
    if info:
        project_id = _project_id_from_info(info) or None
    return {
        'configured': mode != 'none',
        'mode': mode,
        'project_id': project_id,
        'device_count': real_qs.count(),
        'user_count': real_qs.values('user_id').distinct().count(),
        'platform_counts': list(
            real_qs.values('platform').annotate(count=Count('id')).order_by('platform')
        ),
    }
