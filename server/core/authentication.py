import hmac
import logging

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication as DRFTokenAuthentication
from rest_framework.exceptions import AuthenticationFailed, Throttled

from .models import _ensure_api_fund_transfer, _ensure_authtoken_table

logger = logging.getLogger(__name__)
User = get_user_model()

_API_KEY_FAIL_PREFIX = 'api_key_auth_fail:'
_API_KEY_FAIL_LIMIT = 20
_API_KEY_FAIL_WINDOW = 600


class TokenAuthentication(DRFTokenAuthentication):
    """DRF token auth that creates authtoken_token if migrate was skipped."""

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except (OperationalError, ProgrammingError) as exc:
            if 'no such table' not in str(exc).lower():
                raise
            _ensure_authtoken_table()
            return super().authenticate(request)

    def authenticate_credentials(self, key):
        try:
            return super().authenticate_credentials(key)
        except (OperationalError, ProgrammingError) as exc:
            if 'no such table' not in str(exc).lower():
                raise
            _ensure_authtoken_table()
            return super().authenticate_credentials(key)


class ApiKeyAuthentication:
    """Bearer API-key authentication for Fund Transfer API users only."""

    keyword = 'bearer'

    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION') or ''
        parts = header.split()
        if len(parts) != 2 or parts[0].lower() != self.keyword:
            return None
        return self.authenticate_credentials(parts[1], request)

    def authenticate_header(self, request):
        return 'Bearer'

    def authenticate_credentials(self, key, request=None):
        ident = 'unknown'
        if request is not None:
            ident = request.META.get('REMOTE_ADDR') or 'unknown'
        fail_key = f'{_API_KEY_FAIL_PREFIX}{ident}'
        failures = cache.get(fail_key) or 0
        if failures >= _API_KEY_FAIL_LIMIT:
            raise Throttled(detail='Too many failed authentication attempts. Try again later.')

        key = (key or '').strip()
        if not key:
            self._register_failure(fail_key, failures)
            raise AuthenticationFailed('Invalid API key')

        _ensure_api_fund_transfer()
        user = User.objects.filter(api_key=key).select_related('wallet').first()
        if user is None or not user.api_key or not hmac.compare_digest(user.api_key, key):
            self._register_failure(fail_key, failures)
            logger.warning('API key authentication failed from %s', ident)
            raise AuthenticationFailed('Invalid API key')

        if not user.is_api_user:
            raise AuthenticationFailed('API access disabled')
        if not user.is_active:
            raise AuthenticationFailed('User inactive')
        if not getattr(user, 'is_account_approved', True):
            raise AuthenticationFailed('User inactive')

        try:
            User.objects.filter(pk=user.pk).update(api_last_used_at=timezone.now())
        except Exception:
            logger.exception('Failed to record API last-used timestamp user_id=%s', user.pk)

        cache.delete(fail_key)
        return (user, key)

    def _register_failure(self, fail_key, failures):
        cache.set(fail_key, int(failures) + 1, timeout=_API_KEY_FAIL_WINDOW)
