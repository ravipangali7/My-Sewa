"""
Device-bound biometric enrollment and short-lived transaction assertions.

The OS never sends fingerprint / Face templates to this server. Flutter stores
a random device secret in the platform keystore and this module stores only the
hash plus user preference flags.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from ..models import BiometricAssertion, BiometricDevice, CustomUser, SecurityAuditLog
from .security import log_security_event

ASSERTION_TTL_SECONDS = 60
PURPOSE_LOGIN = 'login'
PURPOSE_TRANSACTION_PIN = 'transaction_pin'


def _parse_device_id(raw) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw or '').strip())
    except (ValueError, TypeError, AttributeError):
        return None


def _secret_ok(raw) -> bool:
    secret = (raw or '').strip() if isinstance(raw, str) else str(raw or '').strip()
    return 32 <= len(secret) <= 128


def _sync_user_flags(user: CustomUser) -> None:
    qs = BiometricDevice.objects.filter(user=user)
    login_enabled = qs.filter(login_enabled=True).exists()
    pin_enabled = qs.filter(pin_enabled=True).exists()
    update = []
    if user.login_biometric_enabled != login_enabled:
        user.login_biometric_enabled = login_enabled
        update.append('login_biometric_enabled')
    if user.transaction_pin_biometric_enabled != pin_enabled:
        user.transaction_pin_biometric_enabled = pin_enabled
        update.append('transaction_pin_biometric_enabled')
    if update:
        user.save(update_fields=update)


def disable_login_biometrics(user: CustomUser, *, request=None, reason: str = '') -> None:
    BiometricDevice.objects.filter(user=user, login_enabled=True).update(login_enabled=False)
    user.login_biometric_enabled = False
    user.save(update_fields=['login_biometric_enabled'])
    if request is not None:
        log_security_event(
            user=user,
            action=SecurityAuditLog.ACTION_BIOMETRIC_LOGIN_DISABLED,
            request=request,
            details={'reason': reason} if reason else {},
        )


def authenticate_device(device_id, secret) -> BiometricDevice | None:
    parsed = _parse_device_id(device_id)
    secret_value = (secret or '').strip() if isinstance(secret, str) else str(secret or '').strip()
    if parsed is None or not _secret_ok(secret_value):
        return None
    device = BiometricDevice.objects.select_related('user').filter(device_id=parsed).first()
    if device is None:
        return None
    if not check_password(secret_value, device.secret_hash):
        return None
    return device


@transaction.atomic
def enroll_or_update_device(user: CustomUser, *, device_id, secret, purpose: str, request=None):
    parsed = _parse_device_id(device_id)
    secret_value = (secret or '').strip() if isinstance(secret, str) else str(secret or '').strip()
    if parsed is None:
        return Response(
            {
                'success': False,
                'message': 'A valid device identifier is required.',
                'reason': 'invalid_device',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not _secret_ok(secret_value):
        return Response(
            {
                'success': False,
                'message': 'Invalid biometric enrollment payload.',
                'reason': 'invalid_secret',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if purpose not in (PURPOSE_LOGIN, PURPOSE_TRANSACTION_PIN):
        return Response(
            {
                'success': False,
                'message': 'Unknown biometric purpose.',
                'reason': 'invalid_purpose',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if purpose == PURPOSE_TRANSACTION_PIN and not (user.transaction_pin or '').strip():
        return Response(
            {
                'success': False,
                'message': 'Set a transaction PIN before enabling biometric confirmation.',
                'reason': 'pin_not_set',
                'code': 'pin_not_set',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    device = BiometricDevice.objects.select_for_update().filter(device_id=parsed).first()
    if device and device.user_id != user.pk:
        return Response(
            {
                'success': False,
                'message': 'This device is already enrolled for another account.',
                'reason': 'device_conflict',
            },
            status=status.HTTP_409_CONFLICT,
        )

    secret_hash = make_password(secret_value)
    if device is None:
        device = BiometricDevice(
            user=user,
            device_id=parsed,
            secret_hash=secret_hash,
        )
    else:
        device.secret_hash = secret_hash

    if purpose == PURPOSE_LOGIN:
        device.login_enabled = True
        action = SecurityAuditLog.ACTION_BIOMETRIC_LOGIN_ENABLED
    else:
        device.pin_enabled = True
        action = SecurityAuditLog.ACTION_BIOMETRIC_PIN_ENABLED

    device.save()
    _sync_user_flags(user)
    log_security_event(
        user=user,
        action=action,
        request=request,
        details={'device_id': str(parsed), 'purpose': purpose},
    )
    return None


@transaction.atomic
def disable_purpose(user: CustomUser, *, purpose: str, device_id=None, request=None):
    if purpose not in (PURPOSE_LOGIN, PURPOSE_TRANSACTION_PIN):
        return Response(
            {
                'success': False,
                'message': 'Unknown biometric purpose.',
                'reason': 'invalid_purpose',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    qs = BiometricDevice.objects.select_for_update().filter(user=user)
    parsed = _parse_device_id(device_id)
    if parsed is not None:
        qs = qs.filter(device_id=parsed)

    if purpose == PURPOSE_LOGIN:
        qs.update(login_enabled=False)
        action = SecurityAuditLog.ACTION_BIOMETRIC_LOGIN_DISABLED
        field = 'login_enabled'
    else:
        qs.update(pin_enabled=False)
        action = SecurityAuditLog.ACTION_BIOMETRIC_PIN_DISABLED
        field = 'pin_enabled'

    leftover = BiometricDevice.objects.filter(user=user, **{field: True}).exists()
    if purpose == PURPOSE_LOGIN:
        user.login_biometric_enabled = leftover
        user.save(update_fields=['login_biometric_enabled'])
    else:
        user.transaction_pin_biometric_enabled = leftover
        user.save(update_fields=['transaction_pin_biometric_enabled'])

    log_security_event(
        user=user,
        action=action,
        request=request,
        details={'purpose': purpose, 'device_id': str(parsed) if parsed else None},
    )
    return None


def issue_transaction_assertion(user: CustomUser, *, device: BiometricDevice) -> BiometricAssertion:
    now = timezone.now()
    BiometricAssertion.objects.filter(
        user=user,
        purpose=BiometricAssertion.PURPOSE_TRANSACTION_PIN,
        used_at__isnull=True,
    ).update(used_at=now)
    assertion = BiometricAssertion.objects.create(
        user=user,
        purpose=BiometricAssertion.PURPOSE_TRANSACTION_PIN,
        expires_at=now + timedelta(seconds=ASSERTION_TTL_SECONDS),
    )
    device.last_used_at = now
    device.save(update_fields=['last_used_at'])
    return assertion


def consume_transaction_assertion(user) -> Response | None:
    """Consume a valid unused assertion. Return an error Response or None on success."""
    now = timezone.now()
    with transaction.atomic():
        assertion = (
            BiometricAssertion.objects.select_for_update()
            .filter(
                user=user,
                purpose=BiometricAssertion.PURPOSE_TRANSACTION_PIN,
                used_at__isnull=True,
                expires_at__gt=now,
            )
            .order_by('-created_at')
            .first()
        )
        if assertion is None:
            return Response(
                {
                    'message': 'Biometric confirmation expired or was not completed. Please try again.',
                    'errors': {'use_biometric': ['Biometric confirmation is required.']},
                    'error': 'biometric_assertion_missing',
                    'reason': 'assertion_missing',
                    'code': 'biometric_failed',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user.transaction_pin_biometric_enabled:
            return Response(
                {
                    'message': 'Biometric confirmation is not enabled for this account.',
                    'errors': {'use_biometric': ['Biometric confirmation is not enabled.']},
                    'error': 'biometric_disabled',
                    'reason': 'not_enabled',
                    'code': 'biometric_disabled',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        assertion.used_at = now
        assertion.save(update_fields=['used_at'])
    return None


def new_device_secret() -> str:
    return secrets.token_urlsafe(48)
