"""
Transaction PIN verification helpers for sensitive financial operations.
"""
import re
from typing import Optional

from django.contrib.auth.hashers import check_password
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

_TRANSACTION_PIN_RE = re.compile(r'^\d{4}$')


def verify_transaction_pin(user, pin) -> bool:
    """Return True if ``pin`` matches the user's hashed transaction PIN."""
    stored = getattr(user, 'transaction_pin', None) or ''
    if not stored:
        return False
    raw = (pin or '').strip() if isinstance(pin, str) else str(pin or '').strip()
    if not _TRANSACTION_PIN_RE.match(raw):
        return False
    return check_password(raw, stored)


def require_transaction_pin(user, pin) -> None:
    """
    Raise ``ValidationError`` when the PIN is missing, unset, or incorrect.

    Call this before debiting (or otherwise mutating) wallet funds.
    """
    stored = getattr(user, 'transaction_pin', None) or ''
    if not stored:
        raise ValidationError(
            {
                'transaction_pin': [
                    'Transaction PIN is not set. Please set a PIN in Profile first.',
                ],
                'code': 'pin_not_set',
            }
        )

    raw = (pin or '').strip() if isinstance(pin, str) else str(pin or '').strip()
    if not raw:
        raise ValidationError(
            {'transaction_pin': ['Transaction PIN is required.']}
        )

    if not _TRANSACTION_PIN_RE.match(raw):
        raise ValidationError(
            {'transaction_pin': ['Transaction PIN must be exactly 4 digits.']}
        )

    if not verify_transaction_pin(user, raw):
        raise ValidationError(
            {'transaction_pin': ['Incorrect transaction PIN.']}
        )


def _wants_biometric(request) -> bool:
    if request is None:
        return False
    data = getattr(request, 'data', None)
    if data is None:
        return False
    try:
        value = data.get('use_biometric')
    except (AttributeError, TypeError):
        return False
    if value is True or value == 1:
        return True
    if isinstance(value, str) and value.strip().lower() in ('1', 'true', 'yes'):
        return True
    return False


def _pin_error_response(exc: ValidationError) -> Response:
    detail = exc.detail
    errors = {}
    code = None
    if isinstance(detail, dict):
        for key, value in detail.items():
            if key == 'code':
                code = value[0] if isinstance(value, list) else value
                continue
            if isinstance(value, list):
                errors[key] = [str(item) for item in value]
            else:
                errors[key] = [str(value)]
    else:
        errors['transaction_pin'] = [str(detail)]

    first = next(iter(errors.values()), ['Invalid transaction PIN.'])[0]
    body = {
        'message': first,
        'errors': errors,
        'error': 'Invalid transaction PIN',
    }
    if code:
        body['code'] = str(code)
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def transaction_pin_gate(user, pin, request=None) -> Optional[Response]:
    """
    Verify PIN or a server-side biometric assertion.

    Native biometric success is proven by a short-lived assertion that Flutter
    created over an authenticated API call. A frontend ``use_biometric``
    flag alone is never enough.
    """
    raw = (pin or '').strip() if isinstance(pin, str) else str(pin or '').strip()
    if raw:
        try:
            require_transaction_pin(user, raw)
            return None
        except ValidationError as exc:
            return _pin_error_response(exc)

    if _wants_biometric(request):
        from .biometric import consume_transaction_assertion

        return consume_transaction_assertion(user)

    try:
        require_transaction_pin(user, pin)
        return None
    except ValidationError as exc:
        return _pin_error_response(exc)
