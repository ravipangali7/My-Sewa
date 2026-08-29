"""Get-or-create helpers for 1:1 Support Chat threads."""
from __future__ import annotations

from django.db.models import Q
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone

from ..models import (
    SupportChatMessage,
    SupportChatReadState,
    SupportChatThread,
    _ensure_support_chat_tables,
)
from .hierarchy import admin_actors_qs, canonical_support_admin, is_admin_actor


def _is_missing_support_chat_table(exc) -> bool:
    msg = str(exc).lower()
    return (
        'core_supportchat' in msg
        or 'no such table' in msg
        or "doesn't exist" in msg
    )


def ordered_users(a, b):
    if a.pk < b.pk:
        return a, b
    return b, a


def _admin_ids():
    return list(admin_actors_qs().values_list('pk', flat=True))


def _admin_support_threads():
    """Threads that pair an Admin with a User/Dealer (not Admin–Admin)."""
    admin_ids = _admin_ids()
    if not admin_ids:
        return SupportChatThread.objects.none()
    return SupportChatThread.objects.filter(
        Q(user_low_id__in=admin_ids) | Q(user_high_id__in=admin_ids)
    ).exclude(
        Q(user_low_id__in=admin_ids) & Q(user_high_id__in=admin_ids)
    )


def threads_for(user):
    """List Support Chat threads this actor may see.

    Users and Dealers only see threads with Admin. Any Admin can see every
    Admin ↔ User/Dealer thread so the inbox is shared.
    """
    _ensure_support_chat_tables()
    if is_admin_actor(user):
        return _admin_support_threads()
    admin_ids = _admin_ids()
    if not admin_ids:
        return SupportChatThread.objects.none()
    return SupportChatThread.objects.filter(
        Q(user_low=user, user_high_id__in=admin_ids)
        | Q(user_high=user, user_low_id__in=admin_ids)
    )


def other_participant(thread, user):
    if thread.user_low_id == user.pk:
        return thread.user_high
    if thread.user_high_id == user.pk:
        return thread.user_low
    # Shared admin inbox: show the User/Dealer, not the original Admin.
    if is_admin_actor(thread.user_low) and not is_admin_actor(thread.user_high):
        return thread.user_high
    if is_admin_actor(thread.user_high) and not is_admin_actor(thread.user_low):
        return thread.user_low
    return thread.user_high


def user_in_thread(thread, user) -> bool:
    if user.pk in (thread.user_low_id, thread.user_high_id):
        return True
    if not is_admin_actor(user):
        return False
    return is_admin_actor(thread.user_low) != is_admin_actor(thread.user_high)


def get_or_create_thread(a, b) -> SupportChatThread:
    _ensure_support_chat_tables()
    low, high = ordered_users(a, b)
    try:
        thread, _created = SupportChatThread.objects.get_or_create(user_low=low, user_high=high)
    except (OperationalError, ProgrammingError) as exc:
        if not _is_missing_support_chat_table(exc):
            raise
        _ensure_support_chat_tables()
        thread, _created = SupportChatThread.objects.get_or_create(user_low=low, user_high=high)
    return thread


def existing_admin_thread_for(user):
    """One Support Chat per User/Dealer with Super Admin, regardless of which admin account."""
    if user is None:
        return None
    qs = threads_for(user).order_by('-last_message_at', '-id')
    return qs.first()


def get_or_create_admin_thread(non_admin, admin=None) -> SupportChatThread:
    """Reuse the existing Super Admin conversation so users never get a second inbox."""
    existing = existing_admin_thread_for(non_admin)
    if existing is not None:
        return existing
    partner = admin if is_admin_actor(admin) else canonical_support_admin()
    if partner is None:
        raise ValueError('No Super Admin account is available for Support Chat.')
    return get_or_create_thread(non_admin, partner)


def unread_messages_qs(thread_id, user):
    """Incoming messages for unread counts. Admins ignore other Super Admin replies."""
    qs = SupportChatMessage.objects.filter(thread_id=thread_id)
    if is_admin_actor(user):
        admin_ids = _admin_ids()
        if admin_ids:
            qs = qs.exclude(sender_id__in=admin_ids)
        else:
            qs = qs.exclude(sender=user)
    else:
        qs = qs.exclude(sender=user)
    return qs


def message_preview_text(kind: str, body: str, filename: str = '') -> str:
    kind = (kind or 'text').lower()
    body = (body or '').strip()
    filename = (filename or '').strip()
    if kind == 'image':
        return body or '📷 Photo'
    if kind == 'video':
        return body or '🎥 Video'
    if kind == 'file':
        return body or (f'📎 {filename}' if filename else '📎 File')
    if len(body) <= 240:
        return body
    return f'{body[:237]}...'


def mark_thread_read(thread, user):
    _ensure_support_chat_tables()
    try:
        SupportChatReadState.objects.update_or_create(
            thread=thread,
            user=user,
            defaults={'last_read_at': timezone.now()},
        )
    except (OperationalError, ProgrammingError) as exc:
        if not _is_missing_support_chat_table(exc):
            raise
        _ensure_support_chat_tables()
        SupportChatReadState.objects.update_or_create(
            thread=thread,
            user=user,
            defaults={'last_read_at': timezone.now()},
        )


def unread_count_for(user) -> int:
    _ensure_support_chat_tables()
    try:
        threads = list(threads_for(user).values_list('id', flat=True))
    except (OperationalError, ProgrammingError) as exc:
        if not _is_missing_support_chat_table(exc):
            raise
        _ensure_support_chat_tables()
        try:
            threads = list(threads_for(user).values_list('id', flat=True))
        except (OperationalError, ProgrammingError):
            return 0
    if not threads:
        return 0
    reads = {
        row.thread_id: row.last_read_at
        for row in SupportChatReadState.objects.filter(user=user, thread_id__in=threads)
    }
    total = 0
    for thread_id in threads:
        qs = unread_messages_qs(thread_id, user)
        last_read = reads.get(thread_id)
        if last_read:
            qs = qs.filter(created_at__gt=last_read)
        total += qs.count()
    return total
