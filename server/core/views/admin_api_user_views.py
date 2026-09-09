"""Admin console endpoints for API users and fund-transfer audit logs."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import ApiFundTransferLog, WalletTransfer, _ensure_api_fund_transfer
from ..serializers import AdminUserSerializer
from ..services.api_keys import (
    disable_api_access,
    enable_api_access,
    mask_api_key,
    regenerate_api_key,
)
from ..services.hierarchy import scope_forbidden_response, users_in_scope
from ..services.security import log_security_event
from .admin_views import IsStaffUser

User = get_user_model()


def _api_user_payload(user, request, *, reveal_key=False):
    data = AdminUserSerializer(user, context={'request': request}).data
    data['is_api_user'] = bool(user.is_api_user)
    data['api_key_masked'] = mask_api_key(user.api_key)
    data['has_api_key'] = bool(user.api_key)
    data['api_key_created_at'] = user.api_key_created_at
    data['api_key_updated_at'] = user.api_key_updated_at
    data['api_last_used_at'] = user.api_last_used_at
    if reveal_key:
        data['api_key'] = user.api_key or ''
    return data


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_api_users(request):
    _ensure_api_fund_transfer()
    users = users_in_scope(request.user).select_related('wallet').order_by('-date_joined')
    only_api = (request.query_params.get('api_only') or '1').strip() not in ('0', 'false', 'no')
    if only_api:
        users = users.filter(is_api_user=True)
    q = (request.query_params.get('q') or '').strip()
    if q:
        users = users.filter(
            Q(phone__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(email__icontains=q)
        )
    items = [_api_user_payload(u, request) for u in users]
    return Response({
        'items': items,
        'stats': {
            'total': users.count(),
            'enabled': users.filter(is_api_user=True).count(),
        },
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_detail(request, user_id):
    _ensure_api_fund_transfer()
    qs = users_in_scope(request.user).select_related('wallet')
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(_api_user_payload(user, request))

    was_api_user = bool(user.is_api_user)
    enable = request.data.get('is_api_user')
    if enable is None:
        return Response(
            {'error': 'Validation failed', 'errors': {'is_api_user': 'This field is required.'}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    enabled = bool(enable)
    if enabled:
        enable_api_access(user, generate_if_missing=True)
        if not was_api_user:
            try:
                log_security_event(
                    user=request.user,
                    action='api_access_enabled',
                    request=request,
                    details={'target_id': user.pk, 'target_phone': user.phone},
                )
            except Exception:
                pass
    else:
        disable_api_access(user)
        try:
            log_security_event(
                user=request.user,
                action='api_access_disabled',
                request=request,
                details={'target_id': user.pk, 'target_phone': user.phone},
            )
        except Exception:
            pass
    user.refresh_from_db()
    return Response({
        'message': 'API access updated',
        'data': _api_user_payload(user, request),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_regenerate_key(request, user_id):
    _ensure_api_fund_transfer()
    qs = users_in_scope(request.user)
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    regenerate_api_key(user)
    user.refresh_from_db()
    try:
        log_security_event(
            user=request.user,
            action='api_key_regenerated',
            request=request,
            details={'target_id': user.pk, 'target_phone': user.phone},
        )
    except Exception:
        pass
    payload = _api_user_payload(user, request, reveal_key=True)
    return Response({
        'message': 'A new API key was generated. The previous key no longer works.',
        'data': payload,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_reveal_key(request, user_id):
    _ensure_api_fund_transfer()
    qs = users_in_scope(request.user)
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    try:
        log_security_event(
            user=request.user,
            action='api_key_viewed',
            request=request,
            details={'target_id': user.pk, 'target_phone': user.phone},
        )
    except Exception:
        pass
    return Response(_api_user_payload(user, request, reveal_key=True))


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_logs(request, user_id):
    _ensure_api_fund_transfer()
    qs = users_in_scope(request.user)
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    logs = (
        ApiFundTransferLog.objects.filter(user=user)
        .select_related('wallet_transfer')
        .order_by('-created_at')[:200]
    )
    transfers = (
        WalletTransfer.objects.filter(sender=user, source=WalletTransfer.SOURCE_API)
        .select_related('recipient')
        .order_by('-created_at')[:200]
    )
    return Response({
        'items': [
            {
                'id': row.id,
                'reference': row.reference,
                'receiver': row.receiver,
                'amount': str(row.amount) if row.amount is not None else None,
                'status': row.status,
                'error_code': row.error_code,
                'error_message': row.error_message,
                'transaction_id': row.transaction_id,
                'ip_address': row.ip_address,
                'created_at': row.created_at,
            }
            for row in logs
        ],
        'transfers': [
            {
                'id': row.id,
                'transaction_id': row.reference,
                'reference': row.client_reference,
                'receiver_phone': row.recipient.phone,
                'amount': str(row.amount),
                'status': row.status,
                'created_at': row.created_at,
            }
            for row in transfers
        ],
    })
