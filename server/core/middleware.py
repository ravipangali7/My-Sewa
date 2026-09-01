"""
App-level middleware for maintenance mode and token session timeout.
"""
import time

from django.core.cache import cache
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin

from .services.app_config import get_app_config


# Paths that remain available during maintenance (auth + public settings + media)
MAINTENANCE_ALLOW_PREFIXES = (
    '/api/auth/login/',
    '/api/auth/logout/',
    '/api/auth/device-token/',
    '/api/notifications/fcm-token/',
    '/api/settings/',
    '/admin/',  # Django admin
    '/media/',
    '/static/',
)


def _is_allowed_during_maintenance(path: str) -> bool:
    if path.startswith('/api/admin/'):
        return True  # staff APIs still need auth; view checks staff
    return any(path.startswith(p) for p in MAINTENANCE_ALLOW_PREFIXES)


def _parse_token(request) -> str | None:
    auth = request.META.get('HTTP_AUTHORIZATION') or ''
    if auth.lower().startswith('token '):
        return auth[6:].strip() or None
    return None


class AppSettingsMiddleware(MiddlewareMixin):
    """Enforce maintenance mode and sliding session timeout from Settings.config."""

    def process_request(self, request):
        path = request.path
        if not path.startswith('/api/'):
            return None

        try:
            from .models import _ensure_authtoken_table
            _ensure_authtoken_table()
        except Exception:
            pass

        try:
            config = get_app_config()
        except Exception:
            return None

        security = config.get('security') or {}

        # --- Session timeout (token-based sliding window) ---
        timeout_minutes = int(security.get('session_timeout_minutes') or 0)
        token = _parse_token(request)
        if token and timeout_minutes > 0 and path.startswith('/api/'):
            cache_key = f'session_activity:{token}'
            last = cache.get(cache_key)
            now = time.time()
            if last is not None and (now - float(last)) > timeout_minutes * 60:
                cache.delete(cache_key)
                # Delete DRF token so login is required again
                try:
                    from rest_framework.authtoken.models import Token
                    Token.objects.filter(key=token).delete()
                except Exception:
                    pass
                return JsonResponse(
                    {
                        'error': 'session_expired',
                        'message': 'Your session has expired. Please sign in again.',
                        'code': 'session_expired',
                    },
                    status=401,
                )
            cache.set(cache_key, now, timeout=timeout_minutes * 60 + 300)

        # --- Maintenance mode ---
        if not security.get('maintenance_mode'):
            return None

        if _is_allowed_during_maintenance(path):
            return None

        # Allow staff users through (need to resolve user from token lightly)
        user = getattr(request, 'user', None)
        if user is not None and getattr(user, 'is_authenticated', False):
            if user.is_staff or user.is_superuser:
                return None

        if token:
            try:
                from rest_framework.authtoken.models import Token
                tok = Token.objects.select_related('user').filter(key=token).first()
                if tok and (tok.user.is_staff or tok.user.is_superuser):
                    return None
            except Exception:
                pass

        message = (
            security.get('maintenance_message')
            or 'MySewa is under maintenance. Please try again later.'
        )
        return JsonResponse(
            {
                'error': 'maintenance_mode',
                'message': message,
                'code': 'maintenance_mode',
            },
            status=503,
        )
