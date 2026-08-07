"""
Security audit helpers for sensitive account actions (PIN, etc.).
"""
from typing import Any, Optional

from ..models import SecurityAuditLog


def client_ip(request) -> Optional[str]:
    """Best-effort client IP from request headers / META."""
    if request is None:
        return None
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').strip()
    if forwarded:
        return forwarded.split(',')[0].strip() or None
    return request.META.get('REMOTE_ADDR') or None


def client_user_agent(request) -> str:
    if request is None:
        return ''
    return (request.META.get('HTTP_USER_AGENT') or '')[:512]


def log_security_event(
    *,
    user,
    action: str,
    request=None,
    details: Optional[dict[str, Any]] = None,
) -> SecurityAuditLog:
    """Persist a security audit row and return it."""
    return SecurityAuditLog.objects.create(
        user=user,
        action=action,
        ip_address=client_ip(request),
        user_agent=client_user_agent(request),
        details=details or {},
    )
