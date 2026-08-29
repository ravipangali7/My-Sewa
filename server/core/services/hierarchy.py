"""
Admin / Dealer / User hierarchy helpers.

Admin (staff/superuser with a non-dealer role)
  → Dealer
  → User (optional assigned_dealer)
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q, QuerySet
from rest_framework import status
from rest_framework.response import Response

User = get_user_model()

ROLE_CUSTOMER = 'customer'
ROLE_USER = 'customer'
ROLE_DEALER = 'dealer'
# Legacy constants kept so older imports do not crash. No longer assigned.
ROLE_AGENT = 'agent'
ROLE_SUB_AGENT = 'sub_agent'
NETWORK_ROLES = (ROLE_DEALER,)
DOWNLINE_ROLES = ()


def is_admin_actor(user) -> bool:
    if user is None:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    if getattr(user, 'is_staff', False) and getattr(user, 'role', ROLE_CUSTOMER) not in NETWORK_ROLES:
        return True
    return False


def is_network_operator(user) -> bool:
    if user is None:
        return False
    if is_admin_actor(user):
        return True
    return getattr(user, 'role', None) == ROLE_DEALER


def resolve_assigned_dealer(user):
    """Return the Dealer this user maps to (self if the user is a Dealer)."""
    if user is None:
        return None
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_DEALER:
        return user
    dealer = getattr(user, 'assigned_dealer', None)
    if dealer is not None and getattr(dealer, 'role', None) == ROLE_DEALER:
        return dealer
    return None


def customer_assigned_dealer(user):
    """Dealer a User belongs to for payout / manual-deposit visibility.

    Super Admin-created users, self-registered users, and Dealers themselves
    return None so they only see Super Admin deposit accounts.
    """
    if user is None:
        return None
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role != ROLE_CUSTOMER:
        return None
    dealer = getattr(user, 'assigned_dealer', None)
    if dealer is not None and getattr(dealer, 'role', None) == ROLE_DEALER:
        return dealer
    return None


def resolve_assigned_sub_agent(user):
    """Removed. Kept as a no-op so older call sites still import cleanly."""
    return None


def users_in_scope(actor) -> QuerySet:
    """Users the actor is allowed to view or modify."""
    qs = User.objects.all()
    if is_admin_actor(actor):
        return qs
    role = getattr(actor, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_DEALER:
        return qs.filter(Q(pk=actor.pk) | Q(assigned_dealer=actor))
    return qs.filter(pk=actor.pk)


def customers_in_scope(actor) -> QuerySet:
    return users_in_scope(actor).filter(role=ROLE_CUSTOMER)


def downline_in_scope(actor) -> QuerySet:
    return User.objects.none()


def user_in_scope(actor, target) -> bool:
    if actor is None or target is None:
        return False
    if is_admin_actor(actor):
        return True
    if getattr(actor, 'pk', None) == getattr(target, 'pk', None):
        return True
    return users_in_scope(actor).filter(pk=target.pk).exists()


def scope_forbidden_response():
    return Response(
        {
            'error': 'You are not allowed to view or modify this user.',
            'message': 'You are not allowed to view or modify users outside your Dealer scope.',
            'code': 'hierarchy_scope_forbidden',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def require_role(user, *roles) -> Response | None:
    if user is None:
        return Response(
            {
                'error': 'authentication_required',
                'message': 'Authentication required.',
                'code': 'authentication_required',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if is_admin_actor(user):
        return None
    if getattr(user, 'role', None) in roles:
        return None
    return Response(
        {
            'error': 'Permission denied',
            'message': 'This action is not allowed for your role.',
            'code': 'role_forbidden',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def apply_hierarchy_defaults(user, *, actor=None):
    """Normalize dealer links after role changes. Dealer assignment is optional for Users."""
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    user.parent_agent = None
    user.assigned_sub_agent = None
    if role == ROLE_DEALER:
        user.assigned_dealer = None
        return user
    if role not in (ROLE_CUSTOMER, ROLE_DEALER):
        user.role = ROLE_CUSTOMER
    return user


def validate_hierarchy_links(attrs, *, instance=None, actor=None):
    """Return a dict of field errors, or None."""
    errors = {}
    role = attrs.get('role', getattr(instance, 'role', ROLE_CUSTOMER) if instance else ROLE_CUSTOMER)
    if role in (ROLE_AGENT, ROLE_SUB_AGENT):
        errors['role'] = 'The only roles are Admin, Dealer, and User.'
        role = ROLE_CUSTOMER
        attrs['role'] = ROLE_CUSTOMER

    dealer = attrs.get(
        'assigned_dealer',
        getattr(instance, 'assigned_dealer', None) if instance else None,
    )
    if 'assigned_dealer' in attrs and dealer is not None and getattr(dealer, 'role', None) != ROLE_DEALER:
        errors['assigned_dealer'] = 'Assigned Dealer must have the Dealer role.'

    target_pk = getattr(instance, 'pk', None)
    if dealer is not None and target_pk and dealer.pk == target_pk:
        errors['assigned_dealer'] = 'A user cannot be assigned to themselves.'

    if role == ROLE_DEALER and dealer is not None:
        errors['assigned_dealer'] = 'A Dealer cannot be assigned to another Dealer.'

    attrs['parent_agent'] = None
    attrs['assigned_sub_agent'] = None

    actor_role = getattr(actor, 'role', None) if actor is not None else None
    if actor is not None and not is_admin_actor(actor):
        if actor_role == ROLE_DEALER:
            if role not in (ROLE_CUSTOMER,):
                errors['role'] = 'Dealers can only create User accounts.'
            if dealer is not None and dealer.pk != actor.pk:
                errors['assigned_dealer'] = 'You cannot assign users to another Dealer.'
        else:
            errors['role'] = 'This action is not allowed for your role.'

        if instance is not None and 'assigned_dealer' in attrs:
            previous = getattr(instance, 'assigned_dealer_id', None)
            next_id = getattr(dealer, 'pk', None) if dealer is not None else None
            if previous and next_id and previous != next_id:
                errors['assigned_dealer'] = 'Only Admin can reassign a user to another Dealer.'

    return errors or None


def assigned_support_user_id(user) -> int | None:
    """Direct upline a User may message: assigned Dealer, if any."""
    if user is None:
        return None
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_CUSTOMER:
        return getattr(user, 'assigned_dealer_id', None)
    return None


def admin_actors_qs() -> QuerySet:
    return User.objects.filter(
        Q(is_superuser=True) | (Q(is_staff=True) & ~Q(role__in=NETWORK_ROLES))
    )


def canonical_support_admin():
    """Stable Super Admin identity used for User/Dealer Support Chat."""
    return admin_actors_qs().order_by('-is_superuser', 'pk').first()


_ADMIN_PUBLIC_SEARCH_TOKENS = (
    'super admin',
    'superadmin',
    'admin',
    'support',
    'mysewa',
    'my sewa',
)


def _matches_public_admin_search(q: str) -> bool:
    """Users may search Super Admin by public label only — never by personal name/phone."""
    needle = (q or '').strip().lower()
    if not needle:
        return True
    if any(needle in token or token.startswith(needle) for token in _ADMIN_PUBLIC_SEARCH_TOKENS):
        return True
    return any(word.startswith(needle) for word in 'super admin support mysewa'.split())


def can_initiate_support_chat(actor, target) -> bool:
    """Support Chat is strictly Super Admin ↔ User/Dealer. Never peer-to-peer."""
    if actor is None or target is None:
        return False
    if getattr(actor, 'pk', None) == getattr(target, 'pk', None):
        return False
    actor_is_admin = is_admin_actor(actor)
    target_is_admin = is_admin_actor(target)
    if actor_is_admin and not target_is_admin:
        return True
    if target_is_admin and not actor_is_admin:
        return True
    return False


def can_send_support_chat(actor, target) -> bool:
    return can_initiate_support_chat(actor, target) or can_initiate_support_chat(target, actor)


def support_contacts_qs(actor, q: str = '') -> QuerySet:
    q = (q or '').strip()
    if is_admin_actor(actor):
        qs = (
            User.objects.exclude(pk=getattr(actor, 'pk', None) or 0)
            .exclude(pk__in=admin_actors_qs().values('pk'))
            .filter(is_active=True)
        )
        if q:
            qs = qs.filter(
                Q(phone__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(email__icontains=q)
                | Q(nickname__icontains=q)
                | Q(business_name__icontains=q)
            )
        return qs.order_by('first_name', 'last_name', 'phone')

    admin = canonical_support_admin()
    if admin is None or not _matches_public_admin_search(q):
        return User.objects.none()
    return User.objects.filter(pk=admin.pk)
