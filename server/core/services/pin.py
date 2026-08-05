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


def transaction_pin_gate(user, pin) -> Optional[Response]:
    """
    Verify PIN and return a 400 Response on failure, or None on success.

    Convenient for ``@api_view`` handlers that prefer early returns.
    """
    try:
        require_transaction_pin(user, pin)
        return None
    except ValidationError as exc:
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
