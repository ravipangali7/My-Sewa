"""
Shared helpers for user-facing list endpoints that return {items, stats}.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional, Sequence

from django.db.models import Q, QuerySet
from rest_framework.request import Request
from rest_framework.response import Response


def _parse_date(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.strptime(value.strip()[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def apply_list_filters(
    qs: QuerySet,
    request: Request,
    *,
    search_fields: Sequence[str] = (),
    status_aliases: Optional[dict] = None,
) -> QuerySet:
    """Apply q / status / start_date / end_date query params."""
    q = (request.query_params.get('q') or '').strip()
    status_raw = (request.query_params.get('status') or '').strip().lower()
    start = _parse_date(request.query_params.get('start_date'))
    end = _parse_date(request.query_params.get('end_date'))

    if q and search_fields:
        query = Q()
        for field in search_fields:
            query |= Q(**{f'{field}__icontains': q})
        # Allow searching by numeric id when q is digits
        if q.isdigit():
            query |= Q(id=int(q))
        qs = qs.filter(query)

    if status_raw and status_raw != 'all':
        aliases = status_aliases or {}
        mapped = aliases.get(status_raw, status_raw)
        if isinstance(mapped, (list, tuple)):
            qs = qs.filter(status__in=mapped)
        else:
            qs = qs.filter(status=mapped)

    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)

    return qs


def status_stats(
    qs: QuerySet,
    *,
    success: Iterable[str] = ('success',),
    pending: Iterable[str] = ('pending',),
    failed: Iterable[str] = ('failed',),
) -> dict:
    success = tuple(success)
    pending = tuple(pending)
    failed = tuple(failed)
    return {
        'total': qs.count(),
        'success': qs.filter(status__in=success).count() if success else 0,
        'pending': qs.filter(status__in=pending).count() if pending else 0,
        'failed': qs.filter(status__in=failed).count() if failed else 0,
    }


def items_with_stats_response(
    qs: QuerySet,
    serializer_class,
    request: Request,
    *,
    search_fields: Sequence[str] = (),
    success=('success',),
    pending=('pending',),
    failed=('failed',),
    status_aliases: Optional[dict] = None,
    serializer_context: Optional[dict] = None,
) -> Response:
    filtered = apply_list_filters(
        qs, request, search_fields=search_fields, status_aliases=status_aliases,
    )
    stats = status_stats(
        filtered, success=success, pending=pending, failed=failed,
    )
    context = {'request': request, **(serializer_context or {})}
    return Response({
        'items': serializer_class(filtered, many=True, context=context).data,
        'stats': stats,
    })
