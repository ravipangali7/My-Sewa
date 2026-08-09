"""Per-user home popup eligibility and impression tracking."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import HomePopup, HomePopupImpression

POPUP_WINDOW = timedelta(hours=24)


def _window_expired(window_started_at, now):
    return window_started_at + POPUP_WINDOW <= now


def user_can_see_popup(popup: HomePopup, user, now=None) -> bool:
    """Return True if the user is still under the popup's 24-hour view cap."""
    if not popup or not popup.is_active:
        return False
    now = now or timezone.now()
    try:
        state = HomePopupImpression.objects.get(popup=popup, user=user)
    except HomePopupImpression.DoesNotExist:
        return True
    if _window_expired(state.window_started_at, now):
        return True
    return state.view_count < popup.max_per_24h


def get_active_popup_for_user(user, now=None):
    """Return the highest-priority active popup the user is eligible to see."""
    now = now or timezone.now()
    for popup in HomePopup.objects.filter(is_active=True).order_by('sort_order', '-id'):
        if not popup.has_content():
            continue
        if user_can_see_popup(popup, user, now=now):
            return popup
    return None


def record_popup_shown(popup: HomePopup, user, now=None) -> bool:
    """
    Record one display for this user.

    Resets the 24-hour window when expired. Returns False if the user already
    hit the cap for the current window (no increment).
    """
    if not popup or not popup.is_active:
        return False
    now = now or timezone.now()
    with transaction.atomic():
        state, _created = HomePopupImpression.objects.select_for_update().get_or_create(
            popup=popup,
            user=user,
            defaults={
                'window_started_at': now,
                'view_count': 0,
            },
        )
        if _window_expired(state.window_started_at, now):
            state.window_started_at = now
            state.view_count = 0
        if state.view_count >= popup.max_per_24h:
            return False
        state.view_count += 1
        state.last_shown_at = now
        state.save(update_fields=[
            'window_started_at', 'view_count', 'last_shown_at', 'updated_at',
        ])
        return True
