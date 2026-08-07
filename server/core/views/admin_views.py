"""
Staff / superuser admin API endpoints for the web console.
"""
import csv
import json
from datetime import timedelta
from datetime import date as date_type
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Sum, Q
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Wallet,
    WalletAdjustment,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    WaterBillTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    UserFeeConfig,
    KYCSubmission,
    merge_app_config,
)
from ..serializers import (
    AdminUserSerializer,
    AdminUserWriteSerializer,
    AdminWalletSerializer,
    WalletAdjustmentSerializer,
    WalletAdjustmentWriteSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    AdminTopupSerializer,
    BankTransferTransactionSerializer,
    RemittanceTransactionSerializer,
    AdminRemittanceSerializer,
    InternetBillTransactionSerializer,
    AdminInternetBillSerializer,
    WaterBillTransactionSerializer,
    AdminWaterBillSerializer,
    CommunityElectricityTransactionSerializer,
    AdminCommunityElectricitySerializer,
    DataPackTransactionSerializer,
    AdminDataPackSerializer,
    SettingsSerializer,
    UserFeeConfigSerializer,
    KYCSubmissionSerializer,
)
from ..services.kyc import mark_submission_reviewed
from ..services.himalpay import (
    HimalPayAPI,
    HimalPayError,
    admin_himalpay_ip_hint,
    get_outbound_public_ip,
)
from ..services.app_config import get_app_config
from ..services.txn_status import apply_outbound_status_change, apply_inbound_status_change

User = get_user_model()


def _parse_date_range(request):
    start_raw = (request.query_params.get('start_date') or '').strip()
    end_raw = (request.query_params.get('end_date') or '').strip()
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    if start and end and start > end:
        start, end = end, start
    return start, end


def _apply_created_range(qs, start: date_type | None, end: date_type | None):
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    return qs


def _is_csv_export(request):
    return (request.query_params.get('export') or '').strip().lower() == 'csv'


def _csv_response(filename, headers, rows):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    response = HttpResponse(output.getvalue(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _maybe_id_query(value, *fields):
    if not value.isdigit():
        return Q()
    parsed = int(value)
    query = Q()
    for field in fields:
        query |= Q(**{field: parsed})
    return query


class IsStaffUser(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_staff or request.user.is_superuser)
        )


def _money(value):
    return float(value or 0)


def _sum_amount(qs, amount_field='amount'):
    return qs.aggregate(t=Sum(amount_field))['t'] or Decimal('0')


def _amount_summary(qs, *, success_status='success', amount_field='amount', direction=None):
    """
    Amount-related rollups for admin list pages.

    - total_volume: sum of amounts across the filtered queryset (all statuses)
    - total_amount: sum of successful / approved amounts
    - today_amount / monthly_amount: successful amounts for today / current calendar month
    - total_credit / total_debit: set when direction is 'credit' or 'debit'
    """
    today = timezone.localdate()
    month_start = today.replace(day=1)
    success_qs = qs.filter(status=success_status)
    today_qs = success_qs.filter(created_at__date=today)
    month_qs = success_qs.filter(created_at__date__gte=month_start)

    total_amount = _money(_sum_amount(success_qs, amount_field))
    summary = {
        'total_volume': _money(_sum_amount(qs, amount_field)),
        'total_amount': total_amount,
        'today_amount': _money(_sum_amount(today_qs, amount_field)),
        'monthly_amount': _money(_sum_amount(month_qs, amount_field)),
    }
    if direction == 'credit':
        summary['total_credit'] = total_amount
        summary['total_debit'] = 0.0
    elif direction == 'debit':
        summary['total_debit'] = total_amount
        summary['total_credit'] = 0.0
    return summary


def _status_bucket(qs, success_status='success'):
    """Return count/volume totals split by pending / success / failed (or rejected)."""
    total = qs.count()
    success_qs = qs.filter(status=success_status)
    pending_qs = qs.filter(status='pending')
    failed_statuses = ['failed', 'rejected']
    failed_qs = qs.filter(status__in=failed_statuses)

    success_count = success_qs.count()
    pending_count = pending_qs.count()
    failed_count = failed_qs.count()

    return {
        'count': total,
        'volume': _money(qs.aggregate(t=Sum('amount'))['t']),
        'success_count': success_count,
        'success_volume': _money(success_qs.aggregate(t=Sum('amount'))['t']),
        'pending_count': pending_count,
        'pending_volume': _money(pending_qs.aggregate(t=Sum('amount'))['t']),
        'failed_count': failed_count,
        'failed_volume': _money(failed_qs.aggregate(t=Sum('amount'))['t']),
        'success_rate': round((success_count / total) * 100, 1) if total else 0.0,
    }


def _daily_volume(qs, start, end, success_status='success'):
    filtered = qs.filter(status=success_status)
    filtered = _apply_created_range(filtered, start, end)
    by_day = {
        row['day']: row['total'] or Decimal('0')
        for row in filtered.annotate(day=TruncDate('created_at'))
        .values('day')
        .annotate(total=Sum('amount'))
    }
    days = []
    cursor = start
    while cursor <= end:
        days.append(cursor)
        cursor += timedelta(days=1)
    return {d: _money(by_day.get(d, 0)) for d in days}


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_reports(request):
    """Aggregated analytics for the Super Admin Reports module."""
    today = timezone.localdate()
    start, end = _parse_date_range(request)
    if not end:
        end = today
    if not start:
        start = end - timedelta(days=29)

    # Inclusive day span for series
    day_count = (end - start).days + 1
    if day_count > 366:
        start = end - timedelta(days=365)
        day_count = 366

    deposits_qs = _apply_created_range(Deposit.objects.all(), start, end)
    topups_qs = _apply_created_range(TopupTransaction.objects.all(), start, end)
    transfers_qs = _apply_created_range(BankTransferTransaction.objects.all(), start, end)
    remittances_qs = _apply_created_range(RemittanceTransaction.objects.all(), start, end)
    internet_qs = _apply_created_range(InternetBillTransaction.objects.all(), start, end)
    datapack_qs = _apply_created_range(DataPackTransaction.objects.all(), start, end)
    users_qs = User.objects.filter(date_joined__date__gte=start, date_joined__date__lte=end)

    categories = {
        'deposits': {
            'label': 'Deposits',
            **_status_bucket(deposits_qs, success_status='approved'),
        },
        'topups': {
            'label': 'Mobile top-ups',
            **_status_bucket(topups_qs),
        },
        'transfers': {
            'label': 'Bank transfers',
            **_status_bucket(transfers_qs),
        },
        'remittances': {
            'label': 'Remittances',
            **_status_bucket(remittances_qs),
        },
        'internet_bills': {
            'label': 'Internet bills',
            **_status_bucket(internet_qs),
        },
        'data_packs': {
            'label': 'Data packs',
            **_status_bucket(datapack_qs),
        },
    }

    total_txn_count = sum(c['count'] for c in categories.values())
    total_success_volume = sum(c['success_volume'] for c in categories.values())
    total_pending_count = sum(c['pending_count'] for c in categories.values())
    total_failed_count = sum(c['failed_count'] for c in categories.values())
    total_success_count = sum(c['success_count'] for c in categories.values())
    total_credit = (
        categories['deposits']['success_volume']
        + categories['remittances']['success_volume']
    )
    total_debit = (
        categories['topups']['success_volume']
        + categories['transfers']['success_volume']
        + categories['internet_bills']['success_volume']
        + categories['data_packs']['success_volume']
    )

    wallet_float = Wallet.objects.aggregate(total=Sum('balance'))['total'] or Decimal('0.00')

    # Daily volume series (successful amounts)
    dep_daily = _daily_volume(Deposit.objects.all(), start, end, 'approved')
    top_daily = _daily_volume(TopupTransaction.objects.all(), start, end)
    xfer_daily = _daily_volume(BankTransferTransaction.objects.all(), start, end)
    rem_daily = _daily_volume(RemittanceTransaction.objects.all(), start, end)
    net_daily = _daily_volume(InternetBillTransaction.objects.all(), start, end)
    pack_daily = _daily_volume(DataPackTransaction.objects.all(), start, end)

    volume_series = []
    cursor = start
    while cursor <= end:
        volume_series.append({
            'date': cursor.isoformat(),
            'label': cursor.strftime('%d %b'),
            'deposits': dep_daily.get(cursor, 0),
            'topups': top_daily.get(cursor, 0),
            'transfers': xfer_daily.get(cursor, 0),
            'remittances': rem_daily.get(cursor, 0),
            'internet_bills': net_daily.get(cursor, 0),
            'data_packs': pack_daily.get(cursor, 0),
            'total': (
                dep_daily.get(cursor, 0)
                + top_daily.get(cursor, 0)
                + xfer_daily.get(cursor, 0)
                + rem_daily.get(cursor, 0)
                + net_daily.get(cursor, 0)
                + pack_daily.get(cursor, 0)
            ),
        })
        cursor += timedelta(days=1)

    service_mix = [
        {'key': key, 'name': data['label'], 'value': data['success_volume'], 'count': data['success_count']}
        for key, data in categories.items()
        if data['success_volume'] > 0 or data['success_count'] > 0
    ]

    status_mix = [
        {
            'name': 'Success',
            'value': total_success_count,
            'volume': total_success_volume,
        },
        {
            'name': 'Pending',
            'value': total_pending_count,
            'volume': sum(c['pending_volume'] for c in categories.values()),
        },
        {
            'name': 'Failed',
            'value': total_failed_count,
            'volume': sum(c['failed_volume'] for c in categories.values()),
        },
    ]

    operator_qs = (
        topups_qs.filter(status='success')
        .values('product_id')
        .annotate(value=Sum('amount'), count=Count('id'))
    )
    operator_split = []
    for row in operator_qs:
        name = 'NTC' if row['product_id'] == 1 else 'NCELL'
        operator_split.append({
            'name': name,
            'value': _money(row['value']),
            'count': row['count'] or 0,
        })

    # Top ISPs by successful internet bill volume
    isp_qs = (
        internet_qs.filter(status='success')
        .values('isp_name')
        .annotate(value=Sum('amount'), count=Count('id'))
        .order_by('-value')[:8]
    )
    isp_split = [
        {
            'name': row['isp_name'] or 'Unknown',
            'value': _money(row['value']),
            'count': row['count'] or 0,
        }
        for row in isp_qs
    ]

    # New users by day
    user_by_day = {
        row['day']: row['count']
        for row in users_qs.annotate(day=TruncDate('date_joined'))
        .values('day')
        .annotate(count=Count('id'))
    }
    user_series = []
    cursor = start
    while cursor <= end:
        user_series.append({
            'date': cursor.isoformat(),
            'label': cursor.strftime('%d %b'),
            'users': user_by_day.get(cursor, 0),
        })
        cursor += timedelta(days=1)

    # Recent activity snapshots (latest 10 per category in range)
    def recent_rows(qs, serializer_cls, limit=8):
        items = qs.select_related('user').order_by('-created_at')[:limit]
        return serializer_cls(items, many=True, context={'request': request}).data

    return Response({
        'range': {
            'start_date': start.isoformat(),
            'end_date': end.isoformat(),
            'days': day_count,
        },
        'summary': {
            'total_users': User.objects.count(),
            'new_users': users_qs.count(),
            'wallet_float': str(wallet_float),
            'total_transactions': total_txn_count,
            'success_volume': total_success_volume,
            'success_count': total_success_count,
            'pending_count': total_pending_count,
            'failed_count': total_failed_count,
            'success_rate': (
                round((total_success_count / total_txn_count) * 100, 1)
                if total_txn_count else 0.0
            ),
            'total_volume': sum(c['volume'] for c in categories.values()),
            'total_amount': total_success_volume,
            'total_credit': total_credit,
            'total_debit': total_debit,
            'today_amount': next(
                (row['total'] for row in volume_series if row['date'] == today.isoformat()),
                0.0,
            ),
            'monthly_amount': sum(
                row['total']
                for row in volume_series
                if row['date'] >= today.replace(day=1).isoformat()
            ),
        },
        'categories': categories,
        'volume_series': volume_series,
        'service_mix': service_mix,
        'status_mix': status_mix,
        'operator_split': operator_split,
        'isp_split': isp_split,
        'user_series': user_series,
        'recent': {
            'deposits': recent_rows(deposits_qs, DepositSerializer),
            'topups': recent_rows(topups_qs, TopupTransactionSerializer),
            'transfers': recent_rows(transfers_qs, BankTransferTransactionSerializer),
            'remittances': recent_rows(remittances_qs, RemittanceTransactionSerializer),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_dashboard(request):
    today = timezone.localdate()
    week_start = today - timedelta(days=6)
    month_start = today.replace(day=1)

    total_users = User.objects.count()
    wallet_float = Wallet.objects.aggregate(total=Sum('balance'))['total'] or Decimal('0.00')
    pending_count = Deposit.objects.filter(status='pending').count()
    topups_today = TopupTransaction.objects.filter(created_at__date=today).count()
    transfers_today = BankTransferTransaction.objects.filter(created_at__date=today).count()

    dep_approved = Deposit.objects.filter(status='approved')
    rem_success = RemittanceTransaction.objects.filter(status='success')
    top_success = TopupTransaction.objects.filter(status='success')
    xfer_success = BankTransferTransaction.objects.filter(status='success')
    net_success = InternetBillTransaction.objects.filter(status='success')
    pack_success = DataPackTransaction.objects.filter(status='success')

    total_credit = _money(_sum_amount(dep_approved) + _sum_amount(rem_success))
    total_debit = _money(
        _sum_amount(top_success)
        + _sum_amount(xfer_success)
        + _sum_amount(net_success)
        + _sum_amount(pack_success)
    )
    today_credit = _money(
        _sum_amount(dep_approved.filter(created_at__date=today))
        + _sum_amount(rem_success.filter(created_at__date=today))
    )
    today_debit = _money(
        _sum_amount(top_success.filter(created_at__date=today))
        + _sum_amount(xfer_success.filter(created_at__date=today))
        + _sum_amount(net_success.filter(created_at__date=today))
        + _sum_amount(pack_success.filter(created_at__date=today))
    )
    month_credit = _money(
        _sum_amount(dep_approved.filter(created_at__date__gte=month_start))
        + _sum_amount(rem_success.filter(created_at__date__gte=month_start))
    )
    month_debit = _money(
        _sum_amount(top_success.filter(created_at__date__gte=month_start))
        + _sum_amount(xfer_success.filter(created_at__date__gte=month_start))
        + _sum_amount(net_success.filter(created_at__date__gte=month_start))
        + _sum_amount(pack_success.filter(created_at__date__gte=month_start))
    )

    # Build 7-day volume series
    days = [week_start + timedelta(days=i) for i in range(7)]
    day_labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    dep_by_day = {
        row['day']: row['total'] or Decimal('0')
        for row in Deposit.objects.filter(
            created_at__date__gte=week_start, status='approved'
        ).annotate(day=TruncDate('created_at')).values('day').annotate(total=Sum('amount'))
    }
    top_by_day = {
        row['day']: row['total'] or Decimal('0')
        for row in TopupTransaction.objects.filter(
            created_at__date__gte=week_start, status='success'
        ).annotate(day=TruncDate('created_at')).values('day').annotate(total=Sum('amount'))
    }
    xfer_by_day = {
        row['day']: row['total'] or Decimal('0')
        for row in BankTransferTransaction.objects.filter(
            created_at__date__gte=week_start, status='success'
        ).annotate(day=TruncDate('created_at')).values('day').annotate(total=Sum('amount'))
    }

    volume_series = []
    for d in days:
        volume_series.append({
            'day': day_labels[d.weekday()],
            'date': d.isoformat(),
            'deposits': float(dep_by_day.get(d, 0)),
            'topups': float(top_by_day.get(d, 0)),
            'transfers': float(xfer_by_day.get(d, 0)),
        })

    operator_qs = (
        TopupTransaction.objects.filter(status='success')
        .values('product_id')
        .annotate(value=Sum('amount'))
    )
    operator_split = []
    for row in operator_qs:
        name = 'NTC' if row['product_id'] == 1 else 'NCELL'
        operator_split.append({'name': name, 'value': float(row['value'] or 0)})

    pending = Deposit.objects.filter(status='pending').select_related('user').order_by('-created_at')[:20]

    return Response({
        'kpis': {
            'total_users': total_users,
            'wallet_float': str(wallet_float),
            'pending_deposits': pending_count,
            'topups_today': topups_today,
            'transfers_today': transfers_today,
        },
        'summary': {
            'total_volume': total_credit + total_debit,
            'total_amount': total_credit + total_debit,
            'total_credit': total_credit,
            'total_debit': total_debit,
            'today_amount': today_credit + today_debit,
            'monthly_amount': month_credit + month_debit,
        },
        'volume_series': volume_series,
        'operator_split': operator_split,
        'pending_deposits': DepositSerializer(pending, many=True, context={'request': request}).data,
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_users(request):
    if request.method == 'POST':
        serializer = AdminUserWriteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': 'Validation failed', 'errors': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = serializer.save()
        user = User.objects.select_related('wallet').get(pk=user.pk)
        return Response(
            {
                'message': 'User created successfully',
                'data': AdminUserSerializer(user, context={'request': request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    users = User.objects.select_related('wallet').order_by('-date_joined')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)

    if q:
        users = users.filter(
            Q(phone__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(email__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    if start:
        users = users.filter(date_joined__date__gte=start)
    if end:
        users = users.filter(date_joined__date__lte=end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-users.csv',
            [
                'id', 'phone', 'first_name', 'last_name', 'email',
                'account_status', 'is_active', 'is_staff', 'is_superuser',
                'wallet_balance', 'date_joined', 'last_login',
            ],
            [
                [
                    u.id,
                    u.phone,
                    u.first_name,
                    u.last_name,
                    u.email or '',
                    u.account_status,
                    u.is_active,
                    u.is_staff,
                    u.is_superuser,
                    (u.wallet.balance if hasattr(u, 'wallet') and u.wallet else Decimal('0.00')),
                    u.date_joined.isoformat() if u.date_joined else '',
                    u.last_login.isoformat() if u.last_login else '',
                ]
                for u in users
            ],
        )

    total = users.count()
    success = users.filter(account_status='approved').count()
    pending = users.filter(account_status='pending').count()
    failed = users.filter(is_active=False).count()
    wallet_total = (
        Wallet.objects.filter(user_id__in=users.values_list('id', flat=True))
        .aggregate(total=Sum('balance'))['total']
        or Decimal('0.00')
    )
    return Response({
        'items': AdminUserSerializer(users, many=True, context={'request': request}).data,
        'stats': {
            'total': total,
            'success': success,
            'pending': pending,
            'failed': failed,
            'wallet_float': str(wallet_total),
        },
        'summary': {
            'total_volume': _money(wallet_total),
            'total_amount': _money(wallet_total),
            'today_amount': 0.0,
            'monthly_amount': 0.0,
            'total_credit': _money(wallet_total),
            'total_debit': 0.0,
        },
    })


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_user_detail(request, user_id):
    try:
        user = User.objects.select_related('wallet').get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(AdminUserSerializer(user, context={'request': request}).data)

    if request.method == 'DELETE':
        if user.pk == request.user.pk:
            return Response(
                {'error': 'You cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.delete()
        return Response({'message': 'User deleted successfully'}, status=status.HTTP_200_OK)

    serializer = AdminUserWriteSerializer(
        user, data=request.data, partial=(request.method == 'PATCH'),
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = serializer.save()
    user = User.objects.select_related('wallet').get(pk=user.pk)
    return Response({
        'message': 'User updated successfully',
        'data': AdminUserSerializer(user, context={'request': request}).data,
    })


def _sum_field(qs, field='amount'):
    return qs.aggregate(t=Sum(field))['t'] or Decimal('0.00')


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_user_report(request, user_id):
    """Per-user aggregate report for the Super Admin console."""
    try:
        user = User.objects.select_related('wallet').get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    today = timezone.localdate()
    start, end = _parse_date_range(request)
    if not end:
        end = today
    if not start:
        start = end - timedelta(days=29)

    day_count = (end - start).days + 1
    if day_count > 366:
        start = end - timedelta(days=365)
        day_count = 366

    deposits_qs = _apply_created_range(Deposit.objects.filter(user=user), start, end)
    topups_qs = _apply_created_range(TopupTransaction.objects.filter(user=user), start, end)
    transfers_qs = _apply_created_range(
        BankTransferTransaction.objects.filter(user=user), start, end,
    )
    remittances_qs = _apply_created_range(
        RemittanceTransaction.objects.filter(user=user), start, end,
    )
    internet_qs = _apply_created_range(
        InternetBillTransaction.objects.filter(user=user), start, end,
    )
    datapack_qs = _apply_created_range(
        DataPackTransaction.objects.filter(user=user), start, end,
    )

    categories = {
        'deposits': {
            'label': 'Deposits',
            **_status_bucket(deposits_qs, success_status='approved'),
        },
        'topups': {
            'label': 'Mobile top-ups',
            **_status_bucket(topups_qs),
        },
        'transfers': {
            'label': 'Bank transfers',
            **_status_bucket(transfers_qs),
        },
        'remittances': {
            'label': 'Remittances',
            **_status_bucket(remittances_qs),
        },
        'internet_bills': {
            'label': 'Internet bills',
            **_status_bucket(internet_qs),
        },
        'data_packs': {
            'label': 'Data packs',
            **_status_bucket(datapack_qs),
        },
    }

    approved_deposits = deposits_qs.filter(status='approved')
    success_topups = topups_qs.filter(status='success')
    success_transfers = transfers_qs.filter(status='success')
    success_remittances = remittances_qs.filter(status='success')
    success_internet = internet_qs.filter(status='success')
    success_datapacks = datapack_qs.filter(status='success')

    total_deposits = _sum_field(approved_deposits)
    total_transfers = _sum_field(success_transfers)
    total_topups = _sum_field(success_topups)
    total_remittances = _sum_field(success_remittances)
    total_internet = _sum_field(success_internet)
    total_datapacks = _sum_field(success_datapacks)

    # Wallet credits: deposits + remittance credits (+ optional adjustments)
    deposit_credits = total_deposits
    remittance_credits = _sum_field(success_remittances, 'total_credited')
    if remittance_credits == 0:
        remittance_credits = total_remittances

    # Wallet debits: net amounts removed from wallet on successful outbound services
    topup_debits = _sum_field(success_topups, 'total_debited')
    if topup_debits == 0:
        topup_debits = total_topups
    transfer_debits = _sum_field(success_transfers, 'total_debited')
    if transfer_debits == 0:
        transfer_debits = total_transfers
    internet_debits = _sum_field(success_internet, 'total_debited')
    if internet_debits == 0:
        internet_debits = total_internet
    datapack_debits = _sum_field(success_datapacks, 'total_debited')
    if datapack_debits == 0:
        datapack_debits = total_datapacks

    adjustment_credits = Decimal('0.00')
    adjustment_debits = Decimal('0.00')
    adj_qs = _apply_created_range(
        WalletAdjustment.objects.filter(user=user), start, end,
    )
    credit_adj = adj_qs.filter(adjustment_type='credit')
    debit_adj = adj_qs.filter(adjustment_type='debit')
    adjustment_credits = _sum_field(credit_adj)
    # Debits are stored as negative signed amounts; report absolute debit total.
    adjustment_debits = abs(_sum_field(debit_adj))

    total_wallet_credits = (
        deposit_credits + remittance_credits + adjustment_credits
    )
    total_wallet_debits = (
        topup_debits + transfer_debits + internet_debits + datapack_debits + adjustment_debits
    )

    transaction_volume = (
        total_deposits
        + total_transfers
        + total_topups
        + total_remittances
        + total_internet
        + total_datapacks
    )

    charges = (
        _sum_field(success_topups, 'charge')
        + _sum_field(success_transfers, 'charge')
        + _sum_field(success_remittances, 'charge')
        + _sum_field(success_internet, 'charge')
        + _sum_field(success_datapacks, 'charge')
    )

    wallet_balance = Decimal('0.00')
    if hasattr(user, 'wallet') and user.wallet is not None:
        wallet_balance = user.wallet.balance

    # Daily volume series (successful amounts)
    dep_daily = _daily_volume(Deposit.objects.filter(user=user), start, end, 'approved')
    top_daily = _daily_volume(TopupTransaction.objects.filter(user=user), start, end)
    xfer_daily = _daily_volume(BankTransferTransaction.objects.filter(user=user), start, end)
    rem_daily = _daily_volume(RemittanceTransaction.objects.filter(user=user), start, end)
    net_daily = _daily_volume(InternetBillTransaction.objects.filter(user=user), start, end)
    pack_daily = _daily_volume(DataPackTransaction.objects.filter(user=user), start, end)

    volume_series = []
    cursor = start
    while cursor <= end:
        volume_series.append({
            'date': cursor.isoformat(),
            'label': cursor.strftime('%d %b'),
            'deposits': dep_daily.get(cursor, 0),
            'topups': top_daily.get(cursor, 0),
            'transfers': xfer_daily.get(cursor, 0),
            'remittances': rem_daily.get(cursor, 0),
            'internet_bills': net_daily.get(cursor, 0),
            'data_packs': pack_daily.get(cursor, 0),
            'total': (
                dep_daily.get(cursor, 0)
                + top_daily.get(cursor, 0)
                + xfer_daily.get(cursor, 0)
                + rem_daily.get(cursor, 0)
                + net_daily.get(cursor, 0)
                + pack_daily.get(cursor, 0)
            ),
        })
        cursor += timedelta(days=1)

    service_mix = [
        {'key': key, 'name': data['label'], 'value': data['success_volume'], 'count': data['success_count']}
        for key, data in categories.items()
        if data['success_volume'] > 0 or data['success_count'] > 0
    ]

    total_txn_count = sum(c['count'] for c in categories.values())
    total_success_count = sum(c['success_count'] for c in categories.values())

    return Response({
        'user': {
            'id': user.id,
            'phone': user.phone,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'email': getattr(user, 'email', '') or '',
        },
        'range': {
            'start_date': start.isoformat(),
            'end_date': end.isoformat(),
            'days': day_count,
        },
        'wallet_balance': str(wallet_balance),
        'summary': {
            'total_deposits': _money(total_deposits),
            'total_transfers': _money(total_transfers),
            'total_topups': _money(total_topups),
            'total_wallet_credits': _money(total_wallet_credits),
            'total_wallet_debits': _money(total_wallet_debits),
            'transaction_volume': _money(transaction_volume),
            'charges': _money(charges),
            'total_transactions': total_txn_count,
            'success_count': total_success_count,
        },
        'balance_summary': {
            'current_balance': str(wallet_balance),
            'credits': _money(total_wallet_credits),
            'debits': _money(total_wallet_debits),
            'net': _money(total_wallet_credits - total_wallet_debits),
            'charges': _money(charges),
            'breakdown': {
                'deposit_credits': _money(deposit_credits),
                'remittance_credits': _money(remittance_credits),
                'adjustment_credits': _money(adjustment_credits),
                'topup_debits': _money(topup_debits),
                'transfer_debits': _money(transfer_debits),
                'internet_debits': _money(internet_debits),
                'datapack_debits': _money(datapack_debits),
                'adjustment_debits': _money(adjustment_debits),
            },
        },
        'categories': categories,
        'volume_series': volume_series,
        'service_mix': service_mix,
        'charges_breakdown': {
            'topups': _money(_sum_field(success_topups, 'charge')),
            'transfers': _money(_sum_field(success_transfers, 'charge')),
            'remittances': _money(_sum_field(success_remittances, 'charge')),
            'internet_bills': _money(_sum_field(success_internet, 'charge')),
            'data_packs': _money(_sum_field(success_datapacks, 'charge')),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_wallets(request):
    wallets = Wallet.objects.select_related('user').order_by('-updated_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)

    if q:
        wallets = wallets.filter(
            Q(user__phone__icontains=q)
            | Q(user__first_name__icontains=q)
            | Q(user__last_name__icontains=q)
            | _maybe_id_query(q, 'id', 'user_id')
        )
    wallets = _apply_created_range(wallets, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-wallets.csv',
            ['id', 'user_id', 'phone', 'first_name', 'last_name', 'balance', 'created_at', 'updated_at'],
            [
                [
                    w.id, w.user_id, w.user.phone, w.user.first_name, w.user.last_name, w.balance,
                    w.created_at.isoformat() if w.created_at else '',
                    w.updated_at.isoformat() if w.updated_at else '',
                ]
                for w in wallets
            ],
        )

    total = wallets.aggregate(total=Sum('balance'))['total'] or Decimal('0.00')
    total_count = wallets.count()
    non_zero = wallets.exclude(balance=Decimal('0.00')).count()
    zero_bal = wallets.filter(balance=Decimal('0.00')).count()
    return Response({
        'items': AdminWalletSerializer(wallets, many=True).data,
        'stats': {
            'total': total_count,
            'success': non_zero,
            'pending': zero_bal,
            'failed': 0,
            'wallet_float': str(total),
        },
        'wallet_float': str(total),
        'summary': {
            'total_volume': _money(total),
            'total_amount': _money(total),
            'today_amount': 0.0,
            'monthly_amount': 0.0,
            'total_credit': _money(total),
            'total_debit': 0.0,
        },
    })


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_wallet_detail(request, wallet_id):
    try:
        wallet = Wallet.objects.select_related('user').get(pk=wallet_id)
    except Wallet.DoesNotExist:
        return Response({'error': 'Wallet not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(AdminWalletSerializer(wallet).data)

    if request.method == 'DELETE':
        wallet.delete()
        return Response({'message': 'Wallet deleted successfully'}, status=status.HTTP_200_OK)

    # Manual load / adjust: prefer {amount, adjustment_type, reason}
    # (credit = add fund / manual load, debit = subtract). Still accept {balance, reason}.
    write = WalletAdjustmentWriteSerializer(data=request.data)
    if not write.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': write.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data = write.validated_data
    reason = data['reason']
    reference = (data.get('reference') or '').strip() or None

    try:
        with transaction.atomic():
            locked = (
                Wallet.objects.select_for_update()
                .select_related('user')
                .get(pk=wallet_id)
            )
            balance_before = locked.balance

            if data.get('amount') is not None and data.get('adjustment_type'):
                magnitude = Decimal(data['amount'])
                adjustment_type = data['adjustment_type']
                signed = magnitude if adjustment_type == 'credit' else -magnitude
                balance_after = balance_before + signed
            else:
                balance_after = Decimal(data['balance'])
                signed = balance_after - balance_before
                if signed == 0:
                    return Response({
                        'message': 'Wallet unchanged',
                        'data': AdminWalletSerializer(locked).data,
                    })
                adjustment_type = 'credit' if signed > 0 else 'debit'

            if balance_after < 0:
                return Response(
                    {'error': 'Adjustment would make wallet balance negative.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            locked.balance = balance_after
            locked.save(update_fields=['balance', 'updated_at'])

            WalletAdjustment.objects.create(
                wallet=locked,
                user=locked.user,
                amount=signed,
                adjustment_type=adjustment_type,
                balance_before=balance_before,
                balance_after=balance_after,
                reason=reason,
                created_by=request.user,
                reference=reference,
            )
            wallet = locked
            from ..services.notifications import notify_wallet_adjustment
            notify_wallet_adjustment(
                locked.user,
                balance_before,
                balance_after,
                reason=reason,
                ref=reference,
            )
    except Wallet.DoesNotExist:
        return Response({'error': 'Wallet not found'}, status=status.HTTP_404_NOT_FOUND)

    wallet = Wallet.objects.select_related('user').get(pk=wallet.pk)
    return Response({
        'message': 'Wallet updated successfully',
        'data': AdminWalletSerializer(wallet).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_wallet_transactions(request, wallet_id):
    """
    Transaction history for a specific wallet (all types for that wallet's user).
    Optional filters: type, start_date, end_date.
    """
    try:
        wallet = Wallet.objects.select_related('user').get(pk=wallet_id)
    except Wallet.DoesNotExist:
        return Response({'error': 'Wallet not found'}, status=status.HTTP_404_NOT_FOUND)

    user = wallet.user
    start, end = _parse_date_range(request)
    type_raw = (request.query_params.get('type') or '').strip().lower()
    type_aliases = {
        'deposit': 'deposits',
        'remittance': 'remittances',
        'topup': 'topups',
        'transfer': 'bank_transfers',
        'bank_transfer': 'bank_transfers',
        'internet': 'internet_bills',
        'data_pack': 'data_packs',
        'adjustment': 'wallet_adjustments',
        'wallet_adjustment': 'wallet_adjustments',
    }
    type_key = type_aliases.get(type_raw) if type_raw and type_raw != 'all' else None

    def _bucket(qs):
        return _apply_created_range(qs.order_by('-created_at'), start, end)

    deposits = _bucket(Deposit.objects.filter(user=user))
    remittances = _bucket(RemittanceTransaction.objects.filter(user=user))
    topups = _bucket(TopupTransaction.objects.filter(user=user))
    transfers = _bucket(BankTransferTransaction.objects.filter(user=user))
    internet_bills = _bucket(InternetBillTransaction.objects.filter(user=user))
    data_packs = _bucket(DataPackTransaction.objects.filter(user=user))
    adjustments = _bucket(WalletAdjustment.objects.filter(user=user))

    payload = {
        'deposits': DepositSerializer(deposits, many=True).data,
        'remittances': RemittanceTransactionSerializer(remittances, many=True).data,
        'topups': TopupTransactionSerializer(topups, many=True).data,
        'bank_transfers': BankTransferTransactionSerializer(transfers, many=True).data,
        'internet_bills': InternetBillTransactionSerializer(internet_bills, many=True).data,
        'data_packs': DataPackTransactionSerializer(data_packs, many=True).data,
        'wallet_adjustments': WalletAdjustmentSerializer(adjustments, many=True).data,
        'wallet_id': wallet.id,
        'user_id': user.id,
    }

    if type_key:
        for key in (
            'deposits', 'remittances', 'topups', 'bank_transfers',
            'internet_bills', 'data_packs', 'wallet_adjustments',
        ):
            if key != type_key:
                payload[key] = []

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_deposits(request):
    qs = Deposit.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'approved', 'rejected'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(transaction_id__icontains=q)
            | Q(bank_name__icontains=q)
            | Q(note__icontains=q)
            | Q(rejection_reason__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-deposits.csv',
            [
                'id', 'phone', 'amount', 'transaction_id', 'deposit_date', 'bank_name',
                'status', 'note', 'rejection_reason', 'created_at', 'updated_at',
            ],
            [
                [
                    d.id, d.user.phone, d.amount, d.transaction_id or '',
                    d.deposit_date.isoformat() if d.deposit_date else '',
                    d.bank_name or '', d.status, d.note or '', d.rejection_reason or '',
                    d.created_at.isoformat() if d.created_at else '',
                    d.updated_at.isoformat() if d.updated_at else '',
                ]
                for d in qs
            ],
        )

    return Response({
        'items': DepositSerializer(qs, many=True, context={'request': request}).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='approved').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='rejected').count(),
        },
        'summary': _amount_summary(qs, success_status='approved', direction='credit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_deposit(request, deposit_id):
    try:
        deposit = Deposit.objects.select_related('user').get(pk=deposit_id)
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(DepositSerializer(deposit, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_approve_deposit(request, deposit_id):
    try:
        deposit = Deposit.objects.select_related('user').get(pk=deposit_id)
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)

    if deposit.status != 'pending':
        return Response(
            {'error': f'Deposit is already {deposit.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Signal credits wallet when status flips to approved
    deposit.status = 'approved'
    deposit.save()
    return Response({
        'message': 'Deposit approved successfully',
        'data': DepositSerializer(deposit, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_reject_deposit(request, deposit_id):
    try:
        deposit = Deposit.objects.get(pk=deposit_id)
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)

    if deposit.status != 'pending':
        return Response(
            {'error': f'Deposit is already {deposit.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    reason = (request.data.get('rejection_reason') or request.data.get('reason') or '').strip()
    if not reason:
        return Response(
            {'error': 'Rejection reason is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    deposit.status = 'rejected'
    deposit.rejection_reason = reason
    deposit.save()
    return Response({
        'message': 'Deposit rejected',
        'data': DepositSerializer(deposit, context={'request': request}).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_topups(request):
    qs = TopupTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    product_filter = request.query_params.get('product_id')
    if product_filter in ('1', '2'):
        qs = qs.filter(product_id=int(product_filter))
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(mobile_number__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-topups.csv',
            [
                'id', 'phone', 'mobile_number', 'product_id', 'amount', 'charge', 'cashback',
                'total_debited', 'merchant_txn_id', 'service_hub_txn_id', 'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.mobile_number, t.product_id, t.amount, t.charge,
                    t.cashback, t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': TopupTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_topup(request, topup_id):
    try:
        topup = TopupTransaction.objects.select_related('user').get(pk=topup_id)
    except TopupTransaction.DoesNotExist:
        return Response({'error': 'Top-up not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminTopupSerializer(topup).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_transfers(request):
    qs = BankTransferTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(destination_acc_no__icontains=q)
            | Q(destination_acc_name__icontains=q)
            | Q(destination_bank_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(provider_txn_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-transfers.csv',
            [
                'id', 'phone', 'amount', 'destination_bank_name', 'destination_acc_no',
                'destination_acc_name', 'transaction_remarks', 'charge', 'cashback',
                'total_debited', 'merchant_txn_id', 'provider_txn_id', 'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.amount, t.destination_bank_name, t.destination_acc_no,
                    t.destination_acc_name, t.transaction_remarks, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.provider_txn_id or '', t.status,
                    t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': BankTransferTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_transfer_status(request, transfer_id):
    """Change bank transfer status from the admin list (pending / success / failed)."""
    try:
        transfer = BankTransferTransaction.objects.select_related('user').get(pk=transfer_id)
    except BankTransferTransaction.DoesNotExist:
        return Response({'error': 'Transfer not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = transfer.status
    ok, err = apply_outbound_status_change(transfer, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    transfer.refresh_from_db()
    if old_status != 'success' and transfer.status == 'success':
        from ..services.notifications import notify_transfer_success, notify_low_balance_if_needed
        from ..models import Wallet
        bal = transfer.balance_after
        notify_transfer_success(transfer, balance_after=bal)
        try:
            wallet = Wallet.objects.select_related('user').get(user=transfer.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Transfer status updated to {transfer.status}',
        'data': BankTransferTransactionSerializer(transfer).data,
    })


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_topup_status(request, topup_id):
    """Change top-up status from the admin list (pending / success / failed)."""
    try:
        topup = TopupTransaction.objects.select_related('user').get(pk=topup_id)
    except TopupTransaction.DoesNotExist:
        return Response({'error': 'Top-up not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = topup.status
    ok, err = apply_outbound_status_change(topup, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    topup.refresh_from_db()
    if old_status != 'success' and topup.status == 'success':
        from ..services.notifications import notify_topup_success, notify_low_balance_if_needed
        from ..models import Wallet
        notify_topup_success(topup, balance_after=topup.balance_after)
        try:
            wallet = Wallet.objects.select_related('user').get(user=topup.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Top-up status updated to {topup.status}',
        'data': AdminTopupSerializer(topup).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_data_packs(request):
    qs = DataPackTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    operator_filter = (request.query_params.get('operator') or '').strip().upper()
    if operator_filter in ('NTC', 'NCELL'):
        qs = qs.filter(operator=operator_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(mobile_number__icontains=q)
            | Q(package_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-data-packs.csv',
            [
                'id', 'phone', 'operator', 'mobile_number', 'package_name', 'package_id',
                'product_code', 'amount', 'charge', 'cashback', 'total_debited',
                'merchant_txn_id', 'service_hub_txn_id', 'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.operator, t.mobile_number, t.package_name,
                    t.package_id, t.product_code, t.amount, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': DataPackTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_data_pack(request, data_pack_id):
    try:
        data_pack = DataPackTransaction.objects.select_related('user').get(pk=data_pack_id)
    except DataPackTransaction.DoesNotExist:
        return Response({'error': 'Data pack not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminDataPackSerializer(data_pack).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_data_pack_status(request, data_pack_id):
    """Change data pack status from the admin list (pending / success / failed)."""
    try:
        data_pack = DataPackTransaction.objects.select_related('user').get(pk=data_pack_id)
    except DataPackTransaction.DoesNotExist:
        return Response({'error': 'Data pack not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = data_pack.status
    ok, err = apply_outbound_status_change(data_pack, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    data_pack.refresh_from_db()
    if old_status != 'success' and data_pack.status == 'success':
        from ..services.notifications import notify_low_balance_if_needed
        from ..models import Wallet
        try:
            wallet = Wallet.objects.select_related('user').get(user=data_pack.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Data pack status updated to {data_pack.status}',
        'data': AdminDataPackSerializer(data_pack).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_internet_bills(request):
    qs = InternetBillTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(isp_name__icontains=q)
            | Q(isp_id__icontains=q)
            | Q(customer_id__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(package_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-internet-bills.csv',
            [
                'id', 'phone', 'isp_id', 'isp_name', 'customer_id', 'customer_name',
                'package_name', 'amount', 'charge', 'cashback', 'total_debited',
                'merchant_txn_id', 'service_hub_txn_id', 'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.isp_id, t.isp_name, t.customer_id,
                    t.customer_name, t.package_name, t.amount, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': InternetBillTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_internet_bill(request, bill_id):
    try:
        bill = InternetBillTransaction.objects.select_related('user').get(pk=bill_id)
    except InternetBillTransaction.DoesNotExist:
        return Response({'error': 'Internet bill not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminInternetBillSerializer(bill).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_internet_bill_status(request, bill_id):
    """Change internet bill status from the admin list (pending / success / failed)."""
    try:
        bill = InternetBillTransaction.objects.select_related('user').get(pk=bill_id)
    except InternetBillTransaction.DoesNotExist:
        return Response({'error': 'Internet bill not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = bill.status
    ok, err = apply_outbound_status_change(bill, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    bill.refresh_from_db()
    if old_status != 'success' and bill.status == 'success':
        from ..services.notifications import notify_low_balance_if_needed
        from ..models import Wallet
        try:
            wallet = Wallet.objects.select_related('user').get(user=bill.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Internet bill status updated to {bill.status}',
        'data': AdminInternetBillSerializer(bill).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_water_bills(request):
    qs = WaterBillTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(connection_no__icontains=q)
            | Q(customer_code__icontains=q)
            | Q(counter__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(session_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-water-bills.csv',
            [
                'id', 'phone', 'connection_no', 'customer_code', 'counter',
                'customer_name', 'amount', 'charge', 'cashback', 'total_debited',
                'merchant_txn_id', 'service_hub_txn_id', 'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.connection_no, t.customer_code, t.counter,
                    t.customer_name, t.amount, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': WaterBillTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_water_bill(request, bill_id):
    try:
        bill = WaterBillTransaction.objects.select_related('user').get(pk=bill_id)
    except WaterBillTransaction.DoesNotExist:
        return Response({'error': 'Water bill not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminWaterBillSerializer(bill).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_water_bill_status(request, bill_id):
    """Change water bill status from the admin list (pending / success / failed)."""
    try:
        bill = WaterBillTransaction.objects.select_related('user').get(pk=bill_id)
    except WaterBillTransaction.DoesNotExist:
        return Response({'error': 'Water bill not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = bill.status
    ok, err = apply_outbound_status_change(bill, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    bill.refresh_from_db()
    if old_status != 'success' and bill.status == 'success':
        from ..services.notifications import notify_low_balance_if_needed
        from ..models import Wallet
        try:
            wallet = Wallet.objects.select_related('user').get(user=bill.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Water bill status updated to {bill.status}',
        'data': AdminWaterBillSerializer(bill).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_community_electricity(request):
    qs = CommunityElectricityTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    platform_filter = (request.query_params.get('platform_id') or '').strip().lower()
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if platform_filter:
        qs = qs.filter(platform_id=platform_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(platform_id__icontains=q)
            | Q(platform_name__icontains=q)
            | Q(customer_ref__icontains=q)
            | Q(service_slug__icontains=q)
            | Q(counter_code__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(session_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-community-electricity.csv',
            [
                'id', 'phone', 'platform_id', 'platform_name', 'customer_ref',
                'service_slug', 'counter_code', 'amount', 'charge', 'cashback',
                'total_debited', 'merchant_txn_id', 'service_hub_txn_id',
                'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.platform_id, t.platform_name, t.customer_ref,
                    t.service_slug, t.counter_code, t.amount, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': CommunityElectricityTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='debit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_community_electricity(request, bill_id):
    try:
        bill = CommunityElectricityTransaction.objects.select_related('user').get(pk=bill_id)
    except CommunityElectricityTransaction.DoesNotExist:
        return Response(
            {'error': 'Community electricity bill not found'},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(AdminCommunityElectricitySerializer(bill).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_community_electricity_status(request, bill_id):
    """Change community electricity status from the admin list."""
    try:
        bill = CommunityElectricityTransaction.objects.select_related('user').get(pk=bill_id)
    except CommunityElectricityTransaction.DoesNotExist:
        return Response(
            {'error': 'Community electricity bill not found'},
            status=status.HTTP_404_NOT_FOUND,
        )

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = bill.status
    ok, err = apply_outbound_status_change(bill, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    bill.refresh_from_db()
    if old_status != 'success' and bill.status == 'success':
        from ..services.notifications import notify_low_balance_if_needed
        from ..models import Wallet
        try:
            wallet = Wallet.objects.select_related('user').get(user=bill.user)
            notify_low_balance_if_needed(wallet)
        except Wallet.DoesNotExist:
            pass

    return Response({
        'message': f'Community electricity status updated to {bill.status}',
        'data': AdminCommunityElectricitySerializer(bill).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_remittances(request):
    qs = RemittanceTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(ref_no__icontains=q)
            | Q(sender_name__icontains=q)
            | Q(receiver_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-remittances.csv',
            [
                'id', 'phone', 'ref_no', 'sender_name', 'receiver_name', 'amount',
                'total_credited', 'merchant_txn_id', 'provider_txn_id', 'status', 'created_at',
            ],
            [
                [
                    r.id, r.user.phone, r.ref_no, r.sender_name, r.receiver_name, r.amount,
                    r.total_credited, r.merchant_txn_id, r.provider_txn_id or '', r.status,
                    r.created_at.isoformat() if r.created_at else '',
                ]
                for r in qs
            ],
        )

    return Response({
        'items': RemittanceTransactionSerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'summary': _amount_summary(qs, direction='credit'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_remittance(request, remittance_id):
    try:
        rem = RemittanceTransaction.objects.select_related('user').get(pk=remittance_id)
    except RemittanceTransaction.DoesNotExist:
        return Response({'error': 'Remittance not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminRemittanceSerializer(rem).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_remittance_status(request, remittance_id):
    try:
        rem = RemittanceTransaction.objects.select_related('user').get(pk=remittance_id)
    except RemittanceTransaction.DoesNotExist:
        return Response({'error': 'Remittance not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    old_status = rem.status
    ok, err = apply_inbound_status_change(rem, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    rem.refresh_from_db()
    if old_status != 'success' and rem.status == 'success':
        from ..services.notifications import notify_remittance_success
        notify_remittance_success(rem)

    return Response({
        'message': f'Remittance status updated to {rem.status}',
        'data': RemittanceTransactionSerializer(rem).data,
    })


def _parse_json_field(value):
    """Parse a JSON object from request data (dict or JSON string)."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else None
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    return None


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_settings(request):
    settings_obj = Settings.load()

    if request.method == 'GET':
        return Response(SettingsSerializer(settings_obj, context={'request': request}).data)

    bank_keys = ('bank_name', 'account_name', 'account_number', 'branch')
    bank = dict(settings_obj.bank_details or {})
    updated_bank = False
    for k in bank_keys:
        if k in request.data and request.data.get(k) is not None:
            bank[k] = str(request.data.get(k))
            updated_bank = True
    if updated_bank:
        settings_obj.bank_details = bank

    if 'qr_code' in request.FILES:
        settings_obj.qr_code = request.FILES['qr_code']
    elif 'clear_qr' in request.data and str(request.data.get('clear_qr')).lower() in (
        '1', 'true', 'yes',
    ):
        if settings_obj.qr_code:
            settings_obj.qr_code.delete(save=False)
        settings_obj.qr_code = None
    elif request.data.get('qr_code') in ('', 'null', None) and 'qr_code' in request.data:
        pass  # ignore empty

    if 'logo' in request.FILES:
        settings_obj.logo = request.FILES['logo']
    elif 'clear_logo' in request.data and str(request.data.get('clear_logo')).lower() in (
        '1', 'true', 'yes',
    ):
        if settings_obj.logo:
            settings_obj.logo.delete(save=False)
        settings_obj.logo = None
    elif request.data.get('logo') in ('', 'null', None) and 'logo' in request.data:
        pass  # ignore empty

    if 'bank_details' in request.data:
        parsed_bank = _parse_json_field(request.data.get('bank_details'))
        if parsed_bank is not None:
            settings_obj.bank_details = parsed_bank

    if 'config' in request.data:
        incoming = _parse_json_field(request.data.get('config'))
        if incoming is not None:
            current = merge_app_config(settings_obj.config)
            for section, values in incoming.items():
                if isinstance(values, dict):
                    if section == 'smtp':
                        from ..services.smtp import preserve_smtp_password_on_merge
                        current[section] = preserve_smtp_password_on_merge(
                            current.get(section) or {},
                            values,
                        )
                    else:
                        current[section] = {**(current.get(section) or {}), **values}
                else:
                    current[section] = values
            settings_obj.config = current

    settings_obj.save()
    return Response({
        'message': 'Settings updated successfully',
        'data': SettingsSerializer(settings_obj, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_test_smtp_email(request):
    """
    Send a test email using saved SMTP settings, optionally overridden by
    fields in the request body (so admins can verify before saving).
    """
    from ..services.smtp import (
        merge_smtp_override,
        send_smtp_email,
        format_from_address,
    )
    from ..services.notifications import render_transaction_email, _site_name

    to_email = (
        (request.data.get('to_email') or request.data.get('email') or '').strip()
        or (getattr(request.user, 'email', None) or '').strip()
    )
    if not to_email:
        return Response(
            {
                'ok': False,
                'message': 'Provide a destination email address (to_email).',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    smtp = merge_smtp_override(request.data if isinstance(request.data, dict) else None)
    host = (smtp.get('host') or '').strip()
    if not host:
        return Response(
            {
                'ok': False,
                'message': 'SMTP host is required. Enter host and credentials, then try again.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not (smtp.get('from_email') or '').strip():
        return Response(
            {
                'ok': False,
                'message': 'Sender email is required.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    site_name = _site_name()
    subject = f'[{site_name}] SMTP test email'
    text = (
        f'This is a test email from {site_name}.\n\n'
        f'If you received this message, your SMTP configuration is working.\n'
        f'From: {format_from_address(smtp)}\n'
        f'Host: {host}:{smtp.get("port")}\n'
        f'Encryption: {smtp.get("encryption")}\n'
    )
    html = render_transaction_email(
        title='SMTP configuration test',
        subtitle=f'{site_name} email delivery is working.',
        amount_label='Status',
        amount_display='Connected',
        status='success',
        status_label='Success',
        rows=[
            ('Test type', 'SMTP connection'),
            ('SMTP host', f'{host}:{smtp.get("port")}'),
            ('Encryption', str(smtp.get('encryption') or 'tls').upper()),
            ('From', format_from_address(smtp)),
            ('Recipient', to_email),
        ],
        footer_note=(
            'This message was sent from Admin → Settings → Email / SMTP. '
            'Save your settings if you have not already.'
        ),
    )

    try:
        send_smtp_email(
            subject,
            text,
            [to_email],
            html_body=html,
            smtp=smtp,
            fail_silently=False,
        )
    except Exception as exc:
        return Response(
            {
                'ok': False,
                'message': f'Failed to send test email: {exc}',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(
        {
            'ok': True,
            'message': f'Test email sent to {to_email}.',
            'to_email': to_email,
        }
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_himalpay_status(request):
    """
    Diagnose HimalPay connectivity for admins.

    Returns the outbound public IP that must be on the HimalPay IP Allowlist,
    and probes the reseller services endpoint.
    """
    outbound_ip = get_outbound_public_ip(force=True)
    himalpay = HimalPayAPI()
    result = {
        'outbound_ip': outbound_ip,
        'base_url': himalpay.base_url,
        'api_key_configured': bool(himalpay.api_key),
        'bypass_api': bool(himalpay.bypass_api),
        'ok': False,
        'message': '',
        'error_code': None,
        'error_type': None,
        'services_count': 0,
    }

    if himalpay.bypass_api:
        result['ok'] = True
        result['message'] = 'HimalPay bypass mode is enabled (no live API calls).'
        return Response(result)

    if not himalpay.api_key:
        result['message'] = (
            'HimalPay API key is not configured. '
            'Set it under Super Admin → Settings → HimalPay reseller.'
        )
        return Response(result)

    try:
        services = himalpay.list_services()
        count = len(services) if isinstance(services, list) else 0
        result['ok'] = True
        result['services_count'] = count
        result['message'] = (
            f'Connected to HimalPay. {count} reseller service(s) available.'
        )
        return Response(result)
    except HimalPayError as exc:
        message = exc.message
        if getattr(exc, 'is_ip_blocked', False):
            message = f'{message.rstrip(".")}. {admin_himalpay_ip_hint()}'
        result['message'] = message
        result['error_code'] = exc.error_code
        result['error_type'] = exc.error_type
        return Response(result)
    except Exception as exc:
        result['message'] = f'HimalPay check failed: {exc}'
        return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_kyc(request):
    """List KYC submissions with optional status / search / date filters."""
    qs = (
        KYCSubmission.objects.select_related('user', 'reviewed_by')
        .prefetch_related('documents')
        .order_by('-created_at')
    )
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in (
        KYCSubmission.STATUS_PENDING,
        KYCSubmission.STATUS_APPROVED,
        KYCSubmission.STATUS_REJECTED,
    ):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(user__first_name__icontains=q)
            | Q(user__last_name__icontains=q)
            | Q(citizenship_number__icontains=q)
            | Q(rejection_reason__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-kyc.csv',
            [
                'id', 'phone', 'first_name', 'last_name', 'citizenship_number',
                'status', 'rejection_reason', 'reviewed_by', 'reviewed_at',
                'submitted_at', 'created_at', 'updated_at',
            ],
            [
                [
                    s.id,
                    s.user.phone,
                    s.user.first_name or '',
                    s.user.last_name or '',
                    s.citizenship_number,
                    s.status,
                    s.rejection_reason or '',
                    s.reviewed_by.phone if s.reviewed_by else '',
                    s.reviewed_at.isoformat() if s.reviewed_at else '',
                    s.submitted_at.isoformat() if s.submitted_at else '',
                    s.created_at.isoformat() if s.created_at else '',
                    s.updated_at.isoformat() if s.updated_at else '',
                ]
                for s in qs
            ],
        )

    return Response({
        'items': KYCSubmissionSerializer(qs, many=True, context={'request': request}).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status=KYCSubmission.STATUS_APPROVED).count(),
            'pending': qs.filter(status=KYCSubmission.STATUS_PENDING).count(),
            'failed': qs.filter(status=KYCSubmission.STATUS_REJECTED).count(),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_kyc(request, kyc_id):
    """KYC submission detail including document previews."""
    try:
        submission = (
            KYCSubmission.objects.select_related('user', 'reviewed_by')
            .prefetch_related('documents')
            .get(pk=kyc_id)
        )
    except KYCSubmission.DoesNotExist:
        return Response({'error': 'KYC submission not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(KYCSubmissionSerializer(submission, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_approve_kyc(request, kyc_id):
    """Approve a pending KYC submission and sync user.kyc_status."""
    try:
        submission = (
            KYCSubmission.objects.select_related('user')
            .prefetch_related('documents')
            .get(pk=kyc_id)
        )
    except KYCSubmission.DoesNotExist:
        return Response({'error': 'KYC submission not found'}, status=status.HTTP_404_NOT_FOUND)

    if submission.status != KYCSubmission.STATUS_PENDING:
        return Response(
            {'error': f'KYC submission is already {submission.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        mark_submission_reviewed(
            submission,
            status=KYCSubmission.STATUS_APPROVED,
            reviewer=request.user,
        )

    submission.refresh_from_db()
    try:
        from ..services.notifications import notify_kyc_approved
        notify_kyc_approved(submission)
    except Exception:
        pass

    return Response({
        'message': 'KYC approved successfully',
        'data': KYCSubmissionSerializer(submission, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_reject_kyc(request, kyc_id):
    """Reject a pending KYC submission with a required reason."""
    try:
        submission = (
            KYCSubmission.objects.select_related('user')
            .prefetch_related('documents')
            .get(pk=kyc_id)
        )
    except KYCSubmission.DoesNotExist:
        return Response({'error': 'KYC submission not found'}, status=status.HTTP_404_NOT_FOUND)

    if submission.status != KYCSubmission.STATUS_PENDING:
        return Response(
            {'error': f'KYC submission is already {submission.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    reason = (request.data.get('rejection_reason') or request.data.get('reason') or '').strip()
    if not reason:
        return Response(
            {'error': 'Rejection reason is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        mark_submission_reviewed(
            submission,
            status=KYCSubmission.STATUS_REJECTED,
            reviewer=request.user,
            rejection_reason=reason,
        )

    submission.refresh_from_db()
    try:
        from ..services.notifications import notify_kyc_rejected
        notify_kyc_rejected(submission)
    except Exception:
        pass

    return Response({
        'message': 'KYC rejected',
        'data': KYCSubmissionSerializer(submission, context={'request': request}).data,
    })


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_user_fees(request, user_id):
    """GET/PUT per-user transfer and top-up charge overrides."""
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    global_tx = (get_app_config().get('transactions') or {})
    defaults = {
        'transfer_charge_enabled': global_tx.get('transfer_charge_enabled', True),
        'transfer_charge_flat': global_tx.get('transfer_charge_flat', 0),
        'transfer_charge_percent': global_tx.get('transfer_charge_percent', 0),
        'topup_charge_percent': global_tx.get('topup_charge_percent', 0),
    }

    fee_config, _created = UserFeeConfig.objects.get_or_create(user=user)

    if request.method == 'GET':
        data = UserFeeConfigSerializer(fee_config).data
        return Response({
            'user_id': user.id,
            'fees': data,
            'defaults': defaults,
        })

    # Allow explicit null to clear overrides back to global defaults
    payload = dict(request.data) if hasattr(request.data, 'items') else {}
    serializer = UserFeeConfigSerializer(fee_config, data=payload, partial=True)
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    for field in (
        'transfer_charge_enabled',
        'transfer_charge_flat',
        'transfer_charge_percent',
        'topup_charge_percent',
    ):
        if field in payload:
            value = payload.get(field)
            if value is None or value == '':
                setattr(fee_config, field, None)
            else:
                setattr(fee_config, field, serializer.validated_data.get(field, value))
    fee_config.save()
    return Response({
        'message': 'User fees updated successfully',
        'user_id': user.id,
        'fees': UserFeeConfigSerializer(fee_config).data,
        'defaults': defaults,
    })

