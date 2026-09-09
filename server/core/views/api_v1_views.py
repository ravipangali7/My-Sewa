"""Versioned Fund Transfer API and API-user developer endpoints."""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta

from django.db.models import Q
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from django.utils.timezone import get_current_timezone, make_aware
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.exceptions import APIException, AuthenticationFailed, NotAuthenticated, Throttled
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from ..authentication import ApiKeyAuthentication, TokenAuthentication
from ..models import ApiFundTransferLog, _ensure_api_fund_transfer
from ..services.api_docs import (
    documentation_payload,
    fund_transfer_url,
    html_documentation,
    markdown_documentation,
    pdf_documentation,
)
from ..services.api_fund_transfer import api_error, execute_api_fund_transfer
from ..services.api_keys import mask_api_key, regenerate_api_key
from ..services.security import log_security_event

logger = logging.getLogger(__name__)


class FundTransferApiThrottle(SimpleRateThrottle):
    scope = 'fund_transfer_api'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = f'user:{request.user.pk}'
        else:
            ident = self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


def _require_api_user(user):
    if not getattr(user, 'is_api_user', False):
        return api_error(
            'API access disabled',
            'API fund-transfer access is not enabled for this account.',
            'api_access_disabled',
            status.HTTP_403_FORBIDDEN,
        )
    if not user.is_active:
        return api_error(
            'User inactive',
            'This account is inactive.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )
    return None


def _developer_payload(request):
    user = request.user
    _ensure_api_fund_transfer()
    docs = documentation_payload(request)
    return {
        'is_api_user': True,
        'status': 'enabled',
        'api_key': user.api_key or '',
        'api_key_masked': mask_api_key(user.api_key),
        'api_key_created_at': user.api_key_created_at,
        'api_key_updated_at': user.api_key_updated_at,
        'api_last_used_at': user.api_last_used_at,
        'endpoint': fund_transfer_url(request),
        'documentation': docs,
    }


def _auth_error_response(exc) -> Response:
    detail = str(getattr(exc, 'detail', '') or exc)
    lowered = detail.lower()
    if 'disabled' in lowered:
        return api_error(
            'API access disabled',
            'API fund-transfer access is disabled for this account.',
            'api_access_disabled',
            status.HTTP_403_FORBIDDEN,
        )
    if 'inactive' in lowered:
        return api_error(
            'User inactive',
            'This account is inactive and cannot perform transfers.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )
    if 'too many' in lowered or isinstance(exc, Throttled):
        return api_error(
            'Too many requests',
            'Too many requests. Please slow down and try again.',
            'throttled',
            status.HTTP_429_TOO_MANY_REQUESTS,
        )
    return api_error(
        'Invalid API key',
        'The API key is missing, invalid, or has been revoked.',
        'invalid_api_key',
        status.HTTP_401_UNAUTHORIZED,
    )


class FundTransferView(APIView):
    authentication_classes = [ApiKeyAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [FundTransferApiThrottle]

    def handle_exception(self, exc):
        if isinstance(exc, (AuthenticationFailed, NotAuthenticated, Throttled)):
            return _auth_error_response(exc)
        if isinstance(exc, APIException):
            return super().handle_exception(exc)
        logger.exception('Unhandled Fund Transfer API error')
        return api_error(
            'Server/internal error',
            'The transfer could not be completed. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    def post(self, request):
        return execute_api_fund_transfer(request)


@api_view(['GET'])
@authentication_classes([TokenAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
def developer_profile(request):
    denied = _require_api_user(request.user)
    if denied:
        return denied
    return Response(_developer_payload(request))


@api_view(['POST'])
@authentication_classes([TokenAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
def developer_regenerate_key(request):
    denied = _require_api_user(request.user)
    if denied:
        return denied
    regenerate_api_key(request.user)
    request.user.refresh_from_db()
    try:
        log_security_event(
            user=request.user,
            action='api_key_regenerated',
            request=request,
            details={'actor': 'self'},
        )
    except Exception:
        pass
    payload = _developer_payload(request)
    payload['message'] = 'A new API key was generated. The previous key no longer works.'
    return Response(payload)


@api_view(['GET'])
@authentication_classes([TokenAuthentication, SessionAuthentication, ApiKeyAuthentication])
@permission_classes([IsAuthenticated])
def developer_documentation(request):
    denied = _require_api_user(request.user)
    if denied:
        return denied
    return Response(documentation_payload(request))


@api_view(['GET'])
@authentication_classes([TokenAuthentication, SessionAuthentication, ApiKeyAuthentication])
@permission_classes([IsAuthenticated])
def developer_documentation_download(request):
    denied = _require_api_user(request.user)
    if denied:
        return denied
    fmt = (request.query_params.get('doc_format') or request.query_params.get('type') or 'markdown').strip().lower()
    if fmt in ('md', 'markdown'):
        content = markdown_documentation(request)
        response = HttpResponse(content, content_type='text/markdown; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="mysewa-fund-transfer-api.md"'
        return response
    if fmt in ('html', 'htm'):
        content = html_documentation(request)
        response = HttpResponse(content, content_type='text/html; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="mysewa-fund-transfer-api.html"'
        return response
    if fmt == 'pdf':
        content = pdf_documentation(request)
        response = HttpResponse(content, content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="mysewa-fund-transfer-api.pdf"'
        return response
    return api_error(
        'Invalid request',
        'Unsupported documentation format. Use markdown, html, or pdf.',
        'invalid_request',
        status.HTTP_400_BAD_REQUEST,
    )


@api_view(['GET'])
@authentication_classes([TokenAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
def developer_transfer_history(request):
    denied = _require_api_user(request.user)
    if denied:
        return denied
    _ensure_api_fund_transfer()
    qs = (
        ApiFundTransferLog.objects.filter(user=request.user)
        .select_related('wallet_transfer', 'wallet_transfer__recipient')
        .order_by('-created_at', '-id')
    )
    q = (request.query_params.get('q') or '').strip()
    if q:
        qs = qs.filter(
            Q(reference__icontains=q)
            | Q(receiver__icontains=q)
            | Q(transaction_id__icontains=q)
            | Q(error_code__icontains=q)
            | Q(error_message__icontains=q)
        )
    status_filter = (request.query_params.get('status') or '').strip().lower()
    if status_filter in ('success', 'failed'):
        qs = qs.filter(status=status_filter)
    tz = get_current_timezone()
    start = parse_date(request.query_params.get('start_date') or '')
    end = parse_date(request.query_params.get('end_date') or '')
    if start:
        qs = qs.filter(created_at__gte=make_aware(datetime.combine(start, time.min), tz))
    if end:
        qs = qs.filter(
            created_at__lt=make_aware(datetime.combine(end + timedelta(days=1), time.min), tz)
        )
    try:
        page = max(int(request.query_params.get('page') or 1), 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.query_params.get('page_size') or 20)
    except (TypeError, ValueError):
        page_size = 20
    page_size = min(max(page_size, 1), 50)
    count = qs.count()
    offset = (page - 1) * page_size
    rows = list(qs[offset:offset + page_size])
    items = [_serialize_api_transfer_log(row, request.user) for row in rows]
    return Response({
        'items': items,
        'count': count,
        'page': page,
        'page_size': page_size,
        'has_next': offset + len(rows) < count,
        'has_previous': page > 1,
    })


def _serialize_api_transfer_log(row: ApiFundTransferLog, user) -> dict:
    transfer = row.wallet_transfer
    receiver = row.receiver
    if transfer and getattr(transfer, 'recipient', None):
        receiver = transfer.recipient.phone or receiver
    status_value = 'SUCCESS' if row.status == ApiFundTransferLog.STATUS_SUCCESS else 'FAILED'
    return {
        'id': row.id,
        'transaction_id': row.transaction_id or (getattr(transfer, 'reference', '') or ''),
        'sender': getattr(user, 'phone', '') or '',
        'receiver': receiver,
        'amount': str(row.amount) if row.amount is not None else (
            str(transfer.amount) if transfer else None
        ),
        'reference': row.reference,
        'status': status_value,
        'method': 'API',
        'created_at': row.created_at,
        'error_code': row.error_code,
        'error_message': row.error_message,
        'wallet_transfer_id': transfer.id if transfer else None,
    }
