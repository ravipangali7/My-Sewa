"""
Dealer / Agent / Sub-Agent / Customer hierarchy helpers.

Admin (staff/superuser with a non-network role)
  → Dealer
  → Agent
  → Sub-Agent
  → Customer
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q, QuerySet
from rest_framework import status
from rest_framework.response import Response

User = get_user_model()

ROLE_CUSTOMER = 'customer'
ROLE_DEALER = 'dealer'
ROLE_AGENT = 'agent'
ROLE_SUB_AGENT = 'sub_agent'
NETWORK_ROLES = (ROLE_DEALER, ROLE_AGENT, ROLE_SUB_AGENT)


def is_admin_actor(user) -> bool:
    if user is None:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    if getattr(user, 'is_staff', False) and getattr(user, 'role', ROLE_CUSTOMER) not in NETWORK_ROLES:
        return True
    return False


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


def users_in_scope(actor) -> QuerySet:
    """Users the actor is allowed to view or modify."""
    qs = User.objects.all()
    if is_admin_actor(actor):
        return qs
    role = getattr(actor, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_DEALER:
        return qs.filter(Q(pk=actor.pk) | Q(assigned_dealer=actor))
    if role == ROLE_AGENT:
        return qs.filter(Q(pk=actor.pk) | Q(parent_agent=actor))
    return qs.filter(pk=actor.pk)


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
            'message': 'You are not allowed to view or modify users outside your Dealer / Agent scope.',
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
    """
    Normalize parent/dealer links after role changes.
    Sub-Agents inherit the parent Agent's assigned Dealer.
    """
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_DEALER:
        user.assigned_dealer = None
        user.parent_agent = None
        return user
    if role == ROLE_AGENT:
        user.parent_agent = None
        return user
    if role == ROLE_SUB_AGENT:
        parent = user.parent_agent
        if parent is not None:
            user.assigned_dealer = getattr(parent, 'assigned_dealer', None)
        return user
    if role == ROLE_CUSTOMER:
        user.parent_agent = None
        return user
    return user


def validate_hierarchy_links(attrs, *, instance=None, actor=None):
    """
    Raise serializers.ValidationError-style dict of field errors, or return None.
    """
    errors = {}
    role = attrs.get('role', getattr(instance, 'role', ROLE_CUSTOMER) if instance else ROLE_CUSTOMER)
    dealer = attrs.get(
        'assigned_dealer',
        getattr(instance, 'assigned_dealer', None) if instance else None,
    )
    parent = attrs.get(
        'parent_agent',
        getattr(instance, 'parent_agent', None) if instance else None,
    )
    if 'assigned_dealer' in attrs and dealer is not None and getattr(dealer, 'role', None) != ROLE_DEALER:
        errors['assigned_dealer'] = 'Assigned Dealer must have the Dealer role.'
    if 'parent_agent' in attrs and parent is not None and getattr(parent, 'role', None) != ROLE_AGENT:
        errors['parent_agent'] = 'Parent Agent must have the Agent role.'

    target_pk = getattr(instance, 'pk', None)
    if dealer is not None and target_pk and dealer.pk == target_pk:
        errors['assigned_dealer'] = 'A user cannot be assigned to themselves.'
    if parent is not None and target_pk and parent.pk == target_pk:
        errors['parent_agent'] = 'A user cannot be their own parent Agent.'

    if role == ROLE_DEALER:
        if dealer is not None:
            errors['assigned_dealer'] = 'A Dealer cannot be assigned to another Dealer.'
        if parent is not None:
            errors['parent_agent'] = 'A Dealer cannot have a parent Agent.'
    elif role == ROLE_AGENT:
        if parent is not None:
            errors['parent_agent'] = 'An Agent cannot have a parent Agent. Create a Sub-Agent instead.'
    elif role == ROLE_SUB_AGENT:
        if parent is None:
            errors['parent_agent'] = 'A Sub-Agent must reference a parent Agent.'
        elif actor is not None and getattr(actor, 'role', None) == ROLE_AGENT:
            if parent.pk != actor.pk:
                errors['parent_agent'] = 'You can only create Sub-Agents under your own Agent account.'

    if actor is not None and getattr(actor, 'role', None) == ROLE_AGENT and not is_admin_actor(actor):
        if role != ROLE_SUB_AGENT:
            errors['role'] = 'Agents can only create Sub-Agent accounts.'
        if parent is not None and parent.pk != actor.pk:
            errors['parent_agent'] = 'You can only create Sub-Agents under your own Agent account.'

    return errors or None
