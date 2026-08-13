from django.db.utils import OperationalError, ProgrammingError
from rest_framework.authentication import TokenAuthentication as DRFTokenAuthentication

from .models import _ensure_authtoken_table


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
