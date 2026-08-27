"""
Dealer / Agent / Sub-Agent / Customer hierarchy helpers.

Super Admin (staff/superuser with a non-network role)
  → Dealer
  → Agent (optional middle layer) / Sub-Agent
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
DOWNLINE_ROLES = (ROLE_AGENT, ROLE_SUB_AGENT)


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
    return getattr(user, 'role', None) in NETWORK_ROLES


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


def resolve_assigned_sub_agent(user):
    """
    Agent or Sub-Agent in the chain for this user.
    Priority: self (if downline) → assigned_sub_agent → parent_agent.
    """
    if user is None:
        return None
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role in DOWNLINE_ROLES:
        return user
    sub = getattr(user, 'assigned_sub_agent', None)
    if sub is not None and getattr(sub, 'role', None) == ROLE_SUB_AGENT:
        return sub
    parent = getattr(user, 'parent_agent', None)
    if parent is not None and getattr(parent, 'role', None) == ROLE_AGENT:
        return parent
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
        return qs.filter(
            Q(pk=actor.pk)
            | Q(parent_agent=actor)
            | Q(assigned_sub_agent__parent_agent=actor)
        )
    if role == ROLE_SUB_AGENT:
        return qs.filter(Q(pk=actor.pk) | Q(assigned_sub_agent=actor))
    return qs.filter(pk=actor.pk)


def customers_in_scope(actor) -> QuerySet:
    qs = users_in_scope(actor).filter(role=ROLE_CUSTOMER)
    return qs


def downline_in_scope(actor) -> QuerySet:
    qs = users_in_scope(actor).filter(role__in=DOWNLINE_ROLES)
    if getattr(actor, 'role', None) == ROLE_SUB_AGENT and not is_admin_actor(actor):
        return qs.none()
    return qs.exclude(pk=actor.pk)


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
    Normalize parent/dealer/sub-agent links after role changes.

    Sub-Agents inherit the parent Agent's assigned Dealer when nested.
    Customers keep dealer + optional Sub-Agent/Agent mapping.
    """
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_DEALER:
        user.assigned_dealer = None
        user.parent_agent = None
        user.assigned_sub_agent = None
        return user
    if role == ROLE_AGENT:
        user.parent_agent = None
        user.assigned_sub_agent = None
        return user
    if role == ROLE_SUB_AGENT:
        parent = user.parent_agent
        if parent is not None:
            inherited = getattr(parent, 'assigned_dealer', None)
            if inherited is not None:
                user.assigned_dealer = inherited
        user.assigned_sub_agent = None
        return user
    if role == ROLE_CUSTOMER:
        sub = getattr(user, 'assigned_sub_agent', None)
        if sub is not None:
            inherited = getattr(sub, 'assigned_dealer', None)
            if inherited is not None:
                user.assigned_dealer = inherited
            parent = getattr(sub, 'parent_agent', None)
            if parent is not None:
                user.parent_agent = parent
        elif getattr(user, 'parent_agent', None) is not None:
            parent = user.parent_agent
            inherited = getattr(parent, 'assigned_dealer', None)
            if inherited is not None:
                user.assigned_dealer = inherited
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
    sub_agent = attrs.get(
        'assigned_sub_agent',
        getattr(instance, 'assigned_sub_agent', None) if instance else None,
    )
    if 'assigned_dealer' in attrs and dealer is not None and getattr(dealer, 'role', None) != ROLE_DEALER:
        errors['assigned_dealer'] = 'Assigned Dealer must have the Dealer role.'
    if 'parent_agent' in attrs and parent is not None and getattr(parent, 'role', None) != ROLE_AGENT:
        errors['parent_agent'] = 'Parent Agent must have the Agent role.'
    if 'assigned_sub_agent' in attrs and sub_agent is not None and getattr(sub_agent, 'role', None) != ROLE_SUB_AGENT:
        errors['assigned_sub_agent'] = 'Assigned Sub-Agent must have the Sub-Agent role.'

    target_pk = getattr(instance, 'pk', None)
    if dealer is not None and target_pk and dealer.pk == target_pk:
        errors['assigned_dealer'] = 'A user cannot be assigned to themselves.'
    if parent is not None and target_pk and parent.pk == target_pk:
        errors['parent_agent'] = 'A user cannot be their own parent Agent.'
    if sub_agent is not None and target_pk and sub_agent.pk == target_pk:
        errors['assigned_sub_agent'] = 'A user cannot be assigned to themselves.'

    if role == ROLE_DEALER:
        if dealer is not None:
            errors['assigned_dealer'] = 'A Dealer cannot be assigned to another Dealer.'
        if parent is not None:
            errors['parent_agent'] = 'A Dealer cannot have a parent Agent.'
        if sub_agent is not None:
            errors['assigned_sub_agent'] = 'A Dealer cannot belong to a Sub-Agent.'
    elif role == ROLE_AGENT:
        if parent is not None:
            errors['parent_agent'] = 'An Agent cannot have a parent Agent. Create a Sub-Agent instead.'
        if sub_agent is not None:
            errors['assigned_sub_agent'] = 'An Agent cannot belong to a Sub-Agent.'
    elif role == ROLE_SUB_AGENT:
        if parent is None and dealer is None:
            errors['assigned_dealer'] = 'A Sub-Agent must belong to a Dealer (or a parent Agent).'
        if actor is not None and getattr(actor, 'role', None) == ROLE_AGENT:
            if parent is None or parent.pk != actor.pk:
                errors['parent_agent'] = 'You can only create Sub-Agents under your own Agent account.'
        if actor is not None and getattr(actor, 'role', None) == ROLE_DEALER:
            if dealer is not None and dealer.pk != actor.pk:
                errors['assigned_dealer'] = 'You can only create Sub-Agents under your own Dealer account.'
            if parent is not None:
                errors['parent_agent'] = 'A Dealer cannot assign a Sub-Agent to another Dealer or Agent.'

    actor_role = getattr(actor, 'role', None) if actor is not None else None
    if actor is not None and not is_admin_actor(actor):
        if actor_role == ROLE_AGENT:
            if role not in (ROLE_SUB_AGENT, ROLE_CUSTOMER):
                errors['role'] = 'Agents can only create Sub-Agent or Customer accounts.'
            if role == ROLE_SUB_AGENT and parent is not None and parent.pk != actor.pk:
                errors['parent_agent'] = 'You can only create Sub-Agents under your own Agent account.'
            actor_dealer_id = getattr(actor, 'assigned_dealer_id', None)
            if dealer is not None and actor_dealer_id and dealer.pk != actor_dealer_id:
                errors['assigned_dealer'] = 'You cannot assign users to another Dealer.'
        elif actor_role == ROLE_DEALER:
            if role not in (ROLE_SUB_AGENT, ROLE_CUSTOMER, ROLE_AGENT):
                errors['role'] = 'Dealers can only create Sub-Agent, Agent, or Customer accounts.'
            if dealer is not None and dealer.pk != actor.pk:
                errors['assigned_dealer'] = 'You cannot assign users to another Dealer.'
            if role == ROLE_SUB_AGENT and parent is not None:
                errors['parent_agent'] = 'Sub-Agents you create belong to your Dealer account.'
        elif actor_role == ROLE_SUB_AGENT:
            if role != ROLE_CUSTOMER:
                errors['role'] = 'Sub-Agents can only create Customer accounts.'
            if sub_agent is not None and sub_agent.pk != actor.pk:
                errors['assigned_sub_agent'] = 'You can only assign customers to your own Sub-Agent account.'
            actor_dealer_id = getattr(actor, 'assigned_dealer_id', None)
            if dealer is not None and actor_dealer_id and dealer.pk != actor_dealer_id:
                errors['assigned_dealer'] = 'You cannot change the parent Dealer.'
        else:
            errors['role'] = 'This action is not allowed for your role.'

        # Non-admin actors cannot move a customer/sub-agent to another dealer.
        if instance is not None and 'assigned_dealer' in attrs:
            previous = getattr(instance, 'assigned_dealer_id', None)
            next_id = getattr(dealer, 'pk', None) if dealer is not None else None
            if previous and next_id and previous != next_id:
                errors['assigned_dealer'] = 'Only Super Admin can reassign a user to another Dealer.'

        if instance is not None and actor_role == ROLE_SUB_AGENT and 'assigned_dealer' in attrs:
            errors['assigned_dealer'] = 'A Sub-Agent cannot change its parent Dealer.'

    if sub_agent is not None and dealer is not None:
        sub_dealer_id = getattr(sub_agent, 'assigned_dealer_id', None)
        if sub_dealer_id and sub_dealer_id != dealer.pk:
            errors['assigned_sub_agent'] = 'The Sub-Agent must belong to the selected Dealer.'

    return errors or None


def assigned_support_user_id(user) -> int | None:
    """
    Direct upline a Sub-Agent or Customer may message:
    parent Agent when set, otherwise assigned Dealer.
    """
    if user is None:
        return None
    role = getattr(user, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role in (ROLE_SUB_AGENT, ROLE_CUSTOMER):
        return getattr(user, 'parent_agent_id', None) or getattr(user, 'assigned_dealer_id', None)
    return None


def admin_actors_qs() -> QuerySet:
    return User.objects.filter(
        Q(is_superuser=True) | (Q(is_staff=True) & ~Q(role__in=NETWORK_ROLES))
    )


def can_initiate_support_chat(actor, target) -> bool:
    """True when actor may start a conversation with target."""
    if actor is None or target is None:
        return False
    if getattr(actor, 'pk', None) == getattr(target, 'pk', None):
        return False
    if is_admin_actor(actor):
        return True
    if is_admin_actor(target):
        return getattr(actor, 'role', None) in (ROLE_DEALER, ROLE_AGENT)
    role = getattr(actor, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
    if role == ROLE_AGENT:
        return getattr(target, 'parent_agent_id', None) == actor.pk
    if role == ROLE_DEALER:
        target_role = getattr(target, 'role', None)
        if target_role not in (ROLE_SUB_AGENT, ROLE_CUSTOMER):
            return False
        if getattr(target, 'assigned_dealer_id', None) != actor.pk:
            return False
        return getattr(target, 'parent_agent_id', None) is None
    if role in (ROLE_SUB_AGENT, ROLE_CUSTOMER):
        return assigned_support_user_id(actor) == getattr(target, 'pk', None)
    return False


def can_send_support_chat(actor, target) -> bool:
    """Either party may continue a thread if either may initiate it."""
    return can_initiate_support_chat(actor, target) or can_initiate_support_chat(target, actor)


def support_contacts_qs(actor, q: str = '') -> QuerySet:
    """Users the actor may search for and start a Support Chat with."""
    qs = User.objects.exclude(pk=getattr(actor, 'pk', None) or 0).filter(is_active=True)
    if is_admin_actor(actor):
        pass
    else:
        role = getattr(actor, 'role', ROLE_CUSTOMER) or ROLE_CUSTOMER
        if role == ROLE_AGENT:
            qs = qs.filter(
                Q(pk__in=admin_actors_qs().values('pk'))
                | Q(parent_agent=actor)
            )
        elif role == ROLE_DEALER:
            qs = qs.filter(
                Q(pk__in=admin_actors_qs().values('pk'))
                | (
                    Q(assigned_dealer=actor)
                    & Q(parent_agent__isnull=True)
                    & Q(role__in=(ROLE_SUB_AGENT, ROLE_CUSTOMER))
                )
            )
        elif role in (ROLE_SUB_AGENT, ROLE_CUSTOMER):
            upline_id = assigned_support_user_id(actor)
            qs = qs.filter(pk=upline_id) if upline_id else qs.none()
        else:
            qs = qs.none()

    q = (q or '').strip()
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
