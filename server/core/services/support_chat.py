"""Get-or-create helpers for 1:1 Support Chat threads."""
from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from ..models import SupportChatMessage, SupportChatReadState, SupportChatThread


def ordered_users(a, b):
    if a.pk < b.pk:
        return a, b
    return b, a


def threads_for(user):
    return SupportChatThread.objects.filter(Q(user_low=user) | Q(user_high=user))


def other_participant(thread, user):
    if thread.user_low_id == user.pk:
        return thread.user_high
    return thread.user_low


def user_in_thread(thread, user) -> bool:
    return user.pk in (thread.user_low_id, thread.user_high_id)


def get_or_create_thread(a, b) -> SupportChatThread:
    low, high = ordered_users(a, b)
    thread, _created = SupportChatThread.objects.get_or_create(user_low=low, user_high=high)
    return thread


def mark_thread_read(thread, user):
    SupportChatReadState.objects.update_or_create(
        thread=thread,
        user=user,
        defaults={'last_read_at': timezone.now()},
    )


def unread_count_for(user) -> int:
    threads = list(threads_for(user).values_list('id', flat=True))
    if not threads:
        return 0
    reads = {
        row.thread_id: row.last_read_at
        for row in SupportChatReadState.objects.filter(user=user, thread_id__in=threads)
    }
    total = 0
    for thread_id in threads:
        qs = SupportChatMessage.objects.filter(thread_id=thread_id).exclude(sender=user)
        last_read = reads.get(thread_id)
        if last_read:
            qs = qs.filter(created_at__gt=last_read)
        total += qs.count()
    return total
