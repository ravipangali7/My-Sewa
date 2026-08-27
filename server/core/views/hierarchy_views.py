"""
Agent Sub-Agent APIs and dealer network listing.

Kept for backward compatibility. Dealers should prefer /api/dealer/sub-agents/.
"""
from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from django.contrib.auth import get_user_model
from django.db.models import Q

from ..serializers import AdminUserSerializer, AdminUserWriteSerializer
from ..services.hierarchy import (
    ROLE_AGENT,
    ROLE_DEALER,
    ROLE_SUB_AGENT,
    is_admin_actor,
    require_role,
    scope_forbidden_response,
    user_in_scope,
)
from ..services.security import log_security_event

User = get_user_model()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def agent_sub_agents(request):
    """
    Agent: list and create Sub-Agents under their own account.
    Dealer: list and create Sub-Agents under their Dealer account.
    Admin: list/create any Sub-Agent.
    """
    denied = require_role(request.user, ROLE_AGENT, ROLE_DEALER)
    if denied:
        return denied

    if request.method == 'GET':
        if is_admin_actor(request.user):
            qs = User.objects.filter(role=ROLE_SUB_AGENT).select_related(
                'wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
                'dealer_commission_config',
            )
        elif request.user.role == ROLE_DEALER:
            qs = User.objects.filter(
                role=ROLE_SUB_AGENT, assigned_dealer=request.user,
            ).select_related('wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent')
        else:
            qs = User.objects.filter(
                role=ROLE_SUB_AGENT, parent_agent=request.user,
            ).select_related('wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent')
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(phone__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(email__icontains=q)
            )
        qs = qs.order_by('-date_joined')
        return Response({
            'items': AdminUserSerializer(qs, many=True, context={'request': request}).data,
        })

    data = dict(request.data)
    if not is_admin_actor(request.user):
        data['role'] = ROLE_SUB_AGENT
        data['is_staff'] = False
        data['is_superuser'] = False
        if request.user.role == ROLE_DEALER:
            data['assigned_dealer'] = request.user.pk
            data['parent_agent'] = None
        else:
            data['parent_agent'] = request.user.pk
            data['assigned_dealer'] = getattr(request.user, 'assigned_dealer_id', None)
    serializer = AdminUserWriteSerializer(data=data, context={'request': request})
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = serializer.save()
    user = User.objects.select_related(
        'wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
    ).get(pk=user.pk)
    try:
        log_security_event(
            user=request.user,
            action='sub_agent_created',
            request=request,
            details={'sub_agent_id': user.pk, 'phone': user.phone},
        )
    except Exception:
        pass
    return Response(
        {
            'message': 'Sub-Agent created successfully',
            'data': AdminUserSerializer(user, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def agent_sub_agent_detail(request, user_id):
    denied = require_role(request.user, ROLE_AGENT, ROLE_DEALER)
    if denied:
        return denied
    try:
        user = User.objects.select_related(
            'wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
        ).get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if user.role != ROLE_SUB_AGENT:
        return Response(
            {'error': 'Not a Sub-Agent', 'message': 'This account is not a Sub-Agent.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user_in_scope(request.user, user):
        return scope_forbidden_response()

    if request.method == 'GET':
        return Response(AdminUserSerializer(user, context={'request': request}).data)

    data = dict(request.data)
    if not is_admin_actor(request.user):
        data['role'] = ROLE_SUB_AGENT
        data.pop('is_staff', None)
        data.pop('is_superuser', None)
        data.pop('assigned_dealer', None)
        if request.user.role == ROLE_AGENT:
            data['parent_agent'] = request.user.pk
        else:
            data.pop('parent_agent', None)
    serializer = AdminUserWriteSerializer(
        user, data=data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = serializer.save()
    user = User.objects.select_related(
        'wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
    ).get(pk=user.pk)
    return Response({
        'message': 'Sub-Agent updated successfully',
        'data': AdminUserSerializer(user, context={'request': request}).data,
    })
