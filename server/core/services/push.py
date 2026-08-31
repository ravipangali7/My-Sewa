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
MAX_RESULT_SAMPLES = 25

FCM_ERROR_HELP = {
    'UNREGISTERED': 'App was uninstalled or the token expired.',
    'NOT_FOUND': 'Token is no longer valid on Firebase.',
    'INVALID_ARGUMENT': 'Token is not a valid FCM registration token.',
    'SENDER_ID_MISMATCH': (
        'Token belongs to a different Firebase project than the server credentials.'
    ),
    'UNAUTHENTICATED': 'Firebase service-account credentials are invalid or expired.',
    'PERMISSION_DENIED': (
        'The service account cannot send FCM. Grant Firebase Cloud Messaging API access.'
    ),
    'THIRD_PARTY_AUTH_ERROR': 'APNs authentication failed for iOS.',
    'QUOTA_EXCEEDED': 'FCM quota exceeded. Try again later.',
    'UNAVAILABLE': 'FCM is temporarily unavailable.',
    'INTERNAL': 'Firebase internal error. Retry.',
    'REQUEST_FAILED': 'Could not reach Firebase (network or credentials).',
    '401': 'Firebase rejected the request (unauthorized). Check credentials.',
    '403': 'Firebase denied permission to send messages.',
    '404': 'Token or Firebase project was not found.',
}

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


def _token_skip_reason(token: str) -> Optional[str]:
    value = (token or '').strip()
    if not value:
        return 'empty'
    if len(value) < 20:
        return 'too_short'
    lowered = value.lower()
    for prefix in STUB_PREFIXES:
        if lowered.startswith(prefix):
            return f'placeholder:{prefix.rstrip(":")}'
    return None


def _skip_reason_help(reason: str) -> str:
    if reason == 'empty':
        return 'Empty device token.'
    if reason == 'too_short':
        return 'Token is too short to be a real FCM registration token.'
    if reason == 'not_configured':
        return 'Firebase is not configured on the server, so nothing was sent.'
    if reason.startswith('placeholder:'):
        kind = reason.split(':', 1)[-1]
        return (
            f'Placeholder token ({kind}) — not a real FCM registration token. '
            'The app must register the Firebase Messaging token from the native shell.'
        )
    return reason


def _fcm_error_help(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return FCM_ERROR_HELP.get(str(code).upper()) or FCM_ERROR_HELP.get(str(code))


def _token_preview(token: str) -> str:
    value = (token or '').strip()
    if len(value) <= 16:
        return value
    return f'{value[:10]}…{value[-6:]}'


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


def _parse_json_body(raw: str) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw[:2000]


def _extract_fcm_error(parsed: Any, http_status: Optional[int], raw: str) -> dict[str, Any]:
    error = parsed.get('error') if isinstance(parsed, dict) else None
    if not isinstance(error, dict):
        code = str(http_status) if http_status else 'REQUEST_FAILED'
        return {
            'error_code': code,
            'error_message': (raw or '')[:500] or f'HTTP {code}',
            'status': None,
        }
    details = error.get('details') or []
    error_code = None
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and item.get('errorCode'):
                error_code = item.get('errorCode')
                break
    return {
        'error_code': error_code or error.get('status') or (
            str(http_status) if http_status else 'UNKNOWN'
        ),
        'error_message': str(error.get('message') or '')[:500],
        'status': error.get('status'),
    }


def _delivery(
    *,
    ok: bool,
    http_status: Optional[int] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    status: Optional[str] = None,
    firebase: Any = None,
) -> dict[str, Any]:
    return {
        'ok': ok,
        'http_status': http_status,
        'error_code': error_code,
        'error_message': error_message,
        'status': status,
        'issue': _fcm_error_help(error_code) if not ok else None,
        'firebase': firebase,
    }


def _send_fcm_http_v1(
    token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> dict[str, Any]:
    """Send one HTTP v1 message. Returns a delivery dict with the Firebase body."""
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
                    'channel_id': 'mysewa_alerts',
                    'click_action': 'FLUTTER_NOTIFICATION_CLICK',
                    'notification_priority': 'PRIORITY_MAX',
                    'default_sound': True,
                    'default_vibrate_timings': True,
                },
            },
            'apns': {
                'headers': {
                    'apns-priority': '10',
                    'apns-push-type': 'alert',
                },
                'payload': {
                    'aps': {
                        'sound': 'default',
                        'badge': 1,
                        'content-available': 1,
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
            raw = resp.read().decode('utf-8', errors='replace')
            parsed = _parse_json_body(raw)
            logger.info('FCM HTTP v1 sent to …%s: %s', token[-8:], title)
            return _delivery(ok=True, http_status=getattr(resp, 'status', 200), firebase=parsed)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace') if exc.fp else ''
        parsed = _parse_json_body(detail)
        extracted = _extract_fcm_error(parsed, exc.code, detail)
        logger.warning(
            'FCM HTTP v1 %s for …%s: %s',
            exc.code, token[-8:], (detail or '')[:400],
        )
        return _delivery(
            ok=False,
            http_status=exc.code,
            error_code=extracted['error_code'],
            error_message=extracted['error_message'],
            status=extracted.get('status'),
            firebase=parsed if parsed is not None else {'raw': (detail or '')[:2000]},
        )
    except Exception as exc:
        logger.exception('FCM HTTP v1 request failed for …%s', token[-8:])
        return _delivery(
            ok=False,
            error_code='REQUEST_FAILED',
            error_message=str(exc)[:500],
        )


def _send_fcm_legacy(
    token: str, title: str, body: str, data: Optional[dict] = None,
) -> dict[str, Any]:
    server_key = _fcm_server_key()
    if not server_key:
        return _delivery(
            ok=False,
            error_code='NOT_CONFIGURED',
            error_message='FCM_SERVER_KEY is not set.',
        )

    payload: dict[str, Any] = {
        'to': token,
        'notification': {
            'title': title,
            'body': body,
            'sound': 'default',
            'android_channel_id': 'mysewa_alerts',
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
            result = _parse_json_body(raw) or {}
            if isinstance(result, dict) and result.get('failure'):
                results = result.get('results') or [{}]
                first = results[0] if isinstance(results, list) and results else {}
                error_code = (
                    first.get('error') if isinstance(first, dict) else None
                ) or 'LEGACY_FAILURE'
                logger.warning('FCM legacy failure for token …%s: %s', token[-8:], result)
                return _delivery(
                    ok=False,
                    http_status=getattr(resp, 'status', 200),
                    error_code=str(error_code),
                    error_message=str(error_code),
                    firebase=result,
                )
            logger.info('FCM legacy sent to …%s: %s', token[-8:], title)
            return _delivery(
                ok=True,
                http_status=getattr(resp, 'status', 200),
                firebase=result,
            )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace') if exc.fp else ''
        parsed = _parse_json_body(detail)
        logger.warning('FCM legacy HTTP %s for …%s: %s', exc.code, token[-8:], detail[:300])
        return _delivery(
            ok=False,
            http_status=exc.code,
            error_code=str(exc.code),
            error_message=(detail or f'HTTP {exc.code}')[:500],
            firebase=parsed if parsed is not None else {'raw': (detail or '')[:2000]},
        )
    except Exception as exc:
        logger.exception('FCM legacy request failed for …%s', token[-8:])
        return _delivery(
            ok=False,
            error_code='REQUEST_FAILED',
            error_message=str(exc)[:500],
        )


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


def _empty_send_result(mode: str, project_id: Optional[str] = None) -> dict[str, Any]:
    return {
        'sent': 0,
        'failed': 0,
        'skipped': 0,
        'mode': mode,
        'project_id': project_id,
        'firebase_called': False,
        'issues': [],
        'skip_reasons': [],
        'errors': [],
        'deliveries': [],
    }


def _group_counts(items: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for item in items:
        value = str(item.get(key) or 'unknown')
        if value not in counts:
            order.append(value)
            counts[value] = {
                key: value,
                'count': 0,
                'help': item.get('help') or item.get('issue'),
                'error_message': item.get('error_message'),
                'http_status': item.get('http_status'),
                'samples': [],
            }
        row = counts[value]
        row['count'] += 1
        if item.get('error_message') and not row.get('error_message'):
            row['error_message'] = item['error_message']
        preview = item.get('token_preview')
        if preview and preview not in row['samples'] and len(row['samples']) < 5:
            row['samples'].append(preview)
    return [counts[name] for name in order]


def _finalize_send_result(result: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = list(result.get('issues') or [])
    skip_reasons = result.get('skip_reasons') or []
    errors = result.get('errors') or []

    for row in skip_reasons:
        help_text = row.get('help') or _skip_reason_help(str(row.get('reason') or ''))
        issues.append(f"{row['count']} skipped: {help_text}")

    for row in errors:
        code = row.get('error_code') or 'UNKNOWN'
        help_text = row.get('help') or _fcm_error_help(code)
        message = row.get('error_message') or ''
        detail = help_text or message or code
        line = f"{row['count']} failed ({code}): {detail}"
        if message and help_text and message not in line:
            line = f'{line} Firebase: {message}'
        issues.append(line)

    if result['sent'] == 0 and result['failed'] == 0 and result['skipped'] > 0:
        if not result.get('firebase_called'):
            issues.insert(
                0,
                'Firebase was not contacted because none of the stored device tokens '
                'are real FCM registration tokens.',
            )

    # Dedupe while preserving order
    seen_issues: set[str] = set()
    unique_issues: list[str] = []
    for issue in issues:
        if issue and issue not in seen_issues:
            seen_issues.add(issue)
            unique_issues.append(issue)
    result['issues'] = unique_issues
    result['issue'] = unique_issues[0] if unique_issues else None
    return result


def send_push_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Deliver a notification to one or more device tokens.
    Returns sent/failed/skipped plus skip reasons and Firebase error details.
    """
    unique: list[str] = []
    seen: set[str] = set()
    for raw in tokens:
        token = (raw or '').strip()
        if not token or token in seen:
            continue
        seen.add(token)
        unique.append(token)

    mode = push_mode()
    project_id = None
    info = _load_service_account_info()
    if info:
        project_id = _project_id_from_info(info) or None

    result = _empty_send_result(mode, project_id)
    skipped_items: list[dict[str, Any]] = []
    deliverable: list[str] = []
    for token in unique:
        reason = _token_skip_reason(token)
        if reason:
            skipped_items.append({
                'reason': reason,
                'help': _skip_reason_help(reason),
                'token_preview': _token_preview(token),
                'token_length': len(token),
            })
        else:
            deliverable.append(token)

    result['skipped'] = len(skipped_items)
    result['skip_reasons'] = _group_counts(skipped_items, 'reason')

    if not deliverable:
        logger.info('Push skipped (no real FCM tokens): %s — %s', title, body)
        return _finalize_send_result(result)

    payload_preview = {
        'title': title,
        'body': body,
        'data': data or {},
        'token_count': len(deliverable),
        'tokens_suffix': [t[-12:] for t in deliverable[:8]],
    }

    if mode == 'none':
        logger.info('Push no-op (FCM not configured). Payload: %s', payload_preview)
        extra_skipped = [
            {
                'reason': 'not_configured',
                'help': _skip_reason_help('not_configured'),
                'token_preview': _token_preview(token),
                'token_length': len(token),
            }
            for token in deliverable
        ]
        skipped_items.extend(extra_skipped)
        result['skipped'] += len(deliverable)
        result['skip_reasons'] = _group_counts(skipped_items, 'reason')
        return _finalize_send_result(result)

    if mode == 'http_v1':
        try:
            _access_token, project_id = _access_token_and_project()
            result['project_id'] = project_id
        except Exception as exc:
            logger.exception('Firebase auth failed before send')
            result['failed'] = len(deliverable)
            result['firebase_called'] = False
            auth_error = {
                'error_code': 'UNAUTHENTICATED',
                'error_message': str(exc)[:500],
                'help': _fcm_error_help('UNAUTHENTICATED'),
                'http_status': 401,
                'count': len(deliverable),
                'samples': [_token_preview(t) for t in deliverable[:5]],
            }
            result['errors'] = [auth_error]
            result['issues'] = [
                f'Firebase authentication failed before any message was sent: {exc}',
            ]
            return _finalize_send_result(result)

    extra = dict(data or {})
    extra.setdefault('click_action', 'FLUTTER_NOTIFICATION_CLICK')
    result['firebase_called'] = True

    def _one(token: str) -> dict[str, Any]:
        try:
            if mode == 'http_v1':
                delivery = _send_fcm_http_v1(token, title, body, extra)
            else:
                delivery = _send_fcm_legacy(token, title, body, extra)
            delivery['token_preview'] = _token_preview(token)
            delivery['token_length'] = len(token)
            if not delivery.get('ok') and _should_drop_token(delivery.get('error_code')):
                _delete_invalid_token(token)
                delivery['token_removed'] = True
            return delivery
        except Exception as exc:
            logger.exception('Push worker failed for …%s', token[-8:])
            failed = _delivery(
                ok=False,
                error_code='REQUEST_FAILED',
                error_message=str(exc)[:500],
            )
            failed['token_preview'] = _token_preview(token)
            failed['token_length'] = len(token)
            return failed

    deliveries: list[dict[str, Any]] = []
    workers = min(8, max(1, len(deliverable)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_one, token) for token in deliverable]
        for future in as_completed(futures):
            try:
                delivery = future.result()
            except Exception:
                logger.exception('Push worker failed')
                delivery = _delivery(
                    ok=False,
                    error_code='REQUEST_FAILED',
                    error_message='Push worker raised an unexpected error.',
                )
            deliveries.append(delivery)
            if delivery.get('ok'):
                result['sent'] += 1
            else:
                result['failed'] += 1

    failed_deliveries = [d for d in deliveries if not d.get('ok')]
    result['errors'] = _group_counts(
        [
            {
                **row,
                'help': row.get('issue') or _fcm_error_help(row.get('error_code')),
            }
            for row in failed_deliveries
        ],
        'error_code',
    )
    # Prefer failures in the sample list so the admin UI shows why it broke.
    ordered = failed_deliveries + [d for d in deliveries if d.get('ok')]
    result['deliveries'] = ordered[:MAX_RESULT_SAMPLES]
    return _finalize_send_result(result)


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


def send_push_to_all(title: str, body: str, data: Optional[dict] = None) -> dict[str, Any]:
    from ..models import DeviceToken

    tokens = list(DeviceToken.objects.values_list('token', flat=True))
    return send_push_to_tokens(tokens, title, body, data)


def push_status() -> dict[str, Any]:
    from django.db.models import Count, Q
    from django.db.models.functions import Length

    from ..models import DeviceToken

    qs = DeviceToken.objects.annotate(token_len=Length('token'))
    stub_filter = Q(token_len__lt=20)
    for prefix in STUB_PREFIXES:
        stub_filter |= Q(token__istartswith=prefix)
    real_qs = qs.exclude(stub_filter)
    stub_qs = qs.filter(stub_filter)
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
        'stub_count': stub_qs.count(),
        'user_count': real_qs.values('user_id').distinct().count(),
        'platform_counts': list(
            real_qs.values('platform').annotate(count=Count('id')).order_by('platform')
        ),
    }
