"""Secure API key generation and enable/disable helpers.

Never log the raw API key.
"""
from __future__ import annotations

import secrets

from django.utils import timezone

API_KEY_PREFIX = 'msw_'
API_KEY_BYTES = 32


def generate_api_key() -> str:
    """Cryptographically secure, unique-looking credential (not a sequential id)."""
    return f'{API_KEY_PREFIX}{secrets.token_urlsafe(API_KEY_BYTES)}'


def generate_unique_api_key(user_model=None) -> str:
    from django.contrib.auth import get_user_model

    User = user_model or get_user_model()
    for _ in range(16):
        key = generate_api_key()
        if not User.objects.filter(api_key=key).exists():
            return key
    raise RuntimeError('Could not generate a unique API key')


def mask_api_key(key: str | None) -> str:
    value = (key or '').strip()
    if not value:
        return ''
    if len(value) <= 8:
        return '••••••••'
    return f'{value[:4]}{"•" * max(len(value) - 8, 4)}{value[-4:]}'


def assign_new_api_key(user, *, persist: bool = True) -> str:
    """Issue a new key and immediately invalidate any previous key."""
    now = timezone.now()
    user.api_key = generate_unique_api_key()
    if not user.api_key_created_at:
        user.api_key_created_at = now
    user.api_key_updated_at = now
    if persist:
        user.save(
            update_fields=['api_key', 'api_key_created_at', 'api_key_updated_at'],
        )
    return user.api_key


def enable_api_access(user, *, generate_if_missing: bool = True) -> str | None:
    """Turn on API access. Generate a key the first time (or if missing)."""
    user.is_api_user = True
    created = False
    if generate_if_missing and not (user.api_key or '').strip():
        assign_new_api_key(user, persist=False)
        created = True
    fields = ['is_api_user']
    if created:
        fields.extend(['api_key', 'api_key_created_at', 'api_key_updated_at'])
    user.save(update_fields=fields)
    return user.api_key


def disable_api_access(user) -> None:
    """Deny API fund-transfer access without deleting the stored key."""
    user.is_api_user = False
    user.save(update_fields=['is_api_user'])


def regenerate_api_key(user) -> str:
    user.is_api_user = True
    assign_new_api_key(user, persist=False)
    user.save(
        update_fields=['is_api_user', 'api_key', 'api_key_created_at', 'api_key_updated_at'],
    )
    return user.api_key


def sync_api_user_key(user, *, previous_is_api_user: bool | None = None) -> None:
    """When is_api_user flips false→true, generate a key if the user has none."""
    if not user.is_api_user:
        return
    if previous_is_api_user and (user.api_key or '').strip():
        return
    if (user.api_key or '').strip():
        return
    assign_new_api_key(user, persist=False)
