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
from django.db import ProgrammingError, OperationalError, transaction
from django.db.models import Count, Sum, Q
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import (
    Wallet,
    WalletAdjustment,
    WalletTransfer,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    WaterBillTransaction,
    ElectricityBillTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    UserFeeConfig,
    KYCSubmission,
    StatementReconcileRun,
    StatementDiscrepancy,
    HomePopup,
    DeviceToken,
    PushNotification,
    merge_app_config,
)
from ..serializers import (
    AdminUserSerializer,
    AdminUserWriteSerializer,
    AdminWalletSerializer,
    WalletAdjustmentSerializer,
    WalletTransferSerializer,
    WalletAdjustmentWriteSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    AdminTopupSerializer,
    BankTransferTransactionSerializer,
    CommissionHistorySerializer,
    RemittanceTransactionSerializer,
    AdminRemittanceSerializer,
    InternetBillTransactionSerializer,
    AdminInternetBillSerializer,
    WaterBillTransactionSerializer,
    AdminWaterBillSerializer,
    ElectricityBillTransactionSerializer,
    AdminElectricityBillSerializer,
    CommunityElectricityTransactionSerializer,
    AdminCommunityElectricitySerializer,
    DataPackTransactionSerializer,
    AdminDataPackSerializer,
    SettingsSerializer,
    SetTransactionPinSerializer,
    UserFeeConfigSerializer,
    KYCSubmissionSerializer,
    AdminKYCUpdateSerializer,
    StatementReconcileRunSerializer,
    StatementDiscrepancySerializer,
    HomePopupSerializer,
    PushNotificationSerializer,
)
from ..services.kyc import mark_submission_reviewed, update_kyc_submission
from ..services.himalpay import (
    HimalPayAPI,
    HimalPayError,
    admin_himalpay_ip_hint,
    get_outbound_public_ip,
)
from ..services.app_config import get_app_config, require_user_feature
from ..services.txn_status import apply_outbound_status_change, apply_inbound_status_change
from ..services.statement_reconcile import (
    build_himalpay_history_items,
    build_statement_ledger,
    clamp_date_range,
    collect_himalpay_entries_for_range,
    group_ledger_by_user,
    ledger_from_latest_run,
    run_statement_reconcile_range,
)

User = get_user_model()


def _validation_error_message(exc):
    """Flatten DRF ValidationError.detail into a single string for API clients."""
    detail = getattr(exc, 'detail', None) or str(exc)
    if isinstance(detail, dict):
        parts = []
        for key, value in detail.items():
            if isinstance(value, (list, tuple)):
                parts.append(f'{key}: {", ".join(str(v) for v in value)}')
            else:
                parts.append(f'{key}: {value}')
        return '; '.join(parts) if parts else 'Validation failed'
    if isinstance(detail, (list, tuple)):
        return '; '.join(str(v) for v in detail)
    return str(detail)


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
    try:
        open_statement_issues = StatementDiscrepancy.objects.filter(
            status=StatementDiscrepancy.STATUS_OPEN,
        ).count()
    except (ProgrammingError, OperationalError):
        # Migration 0024 not applied yet — keep dashboard usable.
        open_statement_issues = 0

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

    try:
        commission_today = (
            xfer_success.filter(created_at__date=today).aggregate(
                t=Sum('platform_charge'),
            )['t']
            or Decimal('0.00')
        )
        commission_total = (
            xfer_success.aggregate(t=Sum('platform_charge'))['t'] or Decimal('0.00')
        )
    except (ProgrammingError, OperationalError):
        commission_today = Decimal('0.00')
        commission_total = Decimal('0.00')

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
            'open_statement_issues': open_statement_issues,
            'commission_today': _money(commission_today),
            'commission_total': _money(commission_total),
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
                'can_fund_transfer', 'can_wallet_adjust',
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
                    u.can_fund_transfer,
                    u.can_wallet_adjust,
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
        # Soft-delete: deactivate and retain data (do not hard-delete from DB).
        from .auth_views import _deactivate_user_account

        if not user.is_active:
            return Response(
                {'message': 'User account is already deactivated.'},
                status=status.HTTP_200_OK,
            )
        _deactivate_user_account(user)
        return Response(
            {
                'message': 'User account deactivated successfully. Data has been retained.',
            },
            status=status.HTTP_200_OK,
        )

    serializer = AdminUserWriteSerializer(
        user, data=request.data, partial=(request.method == 'PATCH'),
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    prev_status = user.account_status
    user = serializer.save()
    user = User.objects.select_related('wallet').get(pk=user.pk)
    if (
        prev_status != User.ACCOUNT_STATUS_APPROVED
        and user.account_status == User.ACCOUNT_STATUS_APPROVED
    ):
        try:
            from ..services.notifications import notify_account_approved
            notify_account_approved(user)
        except Exception:
            pass
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

    wallet_transfer_debits = Decimal('0.00')
    wallet_transfer_credits = Decimal('0.00')
    try:
        wt_sent = _apply_created_range(
            WalletTransfer.objects.filter(sender=user, status='success'), start, end,
        )
        wt_received = _apply_created_range(
            WalletTransfer.objects.filter(recipient=user, status='success'), start, end,
        )
        wallet_transfer_debits = _sum_field(wt_sent)
        wallet_transfer_credits = _sum_field(wt_received)
    except (OperationalError, ProgrammingError):
        pass

    total_wallet_credits = (
        deposit_credits + remittance_credits + adjustment_credits + wallet_transfer_credits
    )
    total_wallet_debits = (
        topup_debits + transfer_debits + internet_debits + datapack_debits
        + adjustment_debits + wallet_transfer_debits
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
            ['id', 'user_id', 'phone', 'first_name', 'last_name', 'balance', 'transactions_blocked', 'created_at', 'updated_at'],
            [
                [
                    w.id, w.user_id, w.user.phone, w.user.first_name, w.user.last_name, w.balance,
                    w.transactions_blocked,
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

    blocked = require_user_feature(request.user, 'wallet_adjustment')
    if blocked:
        return blocked

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


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_wallet_unblock(request, wallet_id):
    """Unlock a wallet that was auto-blocked after a HimalPay/MySewa mismatch."""
    try:
        wallet = Wallet.objects.select_related('user').get(pk=wallet_id)
    except Wallet.DoesNotExist:
        return Response({'error': 'Wallet not found'}, status=status.HTTP_404_NOT_FOUND)
    if not wallet.transactions_blocked:
        return Response({
            'message': 'Wallet is already unblocked',
            'data': AdminWalletSerializer(wallet).data,
        })
    from ..services.wallet_guard import unblock_wallet
    wallet = unblock_wallet(wallet, request.user)
    wallet = Wallet.objects.select_related('user').get(pk=wallet.pk)
    return Response({
        'message': 'Wallet unblocked. Outbound payments are allowed again.',
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
        'water': 'water_bills',
        'electricity': 'electricity_bills',
        'community_electricity': 'community_electricity',
        'adjustment': 'wallet_adjustments',
        'wallet_adjustment': 'wallet_adjustments',
        'wallet_transfer': 'wallet_transfers',
        'wallet_transfers': 'wallet_transfers',
    }
    type_key = type_aliases.get(type_raw) if type_raw and type_raw != 'all' else None

    def _bucket(model):
        try:
            qs = model.objects.filter(user=user).order_by('-created_at')
            qs.exists()
            return _apply_created_range(qs, start, end)
        except (OperationalError, ProgrammingError):
            if model is ElectricityBillTransaction:
                try:
                    from ..models import _ensure_electricity_bill_table
                    _ensure_electricity_bill_table()
                    qs = model.objects.filter(user=user).order_by('-created_at')
                    qs.exists()
                    return _apply_created_range(qs, start, end)
                except Exception:
                    pass
            return model.objects.none()

    def _ser(serializer_cls, qs):
        try:
            return serializer_cls(qs, many=True).data
        except (OperationalError, ProgrammingError):
            return []

    deposits = _bucket(Deposit)
    remittances = _bucket(RemittanceTransaction)
    topups = _bucket(TopupTransaction)
    transfers = _bucket(BankTransferTransaction)
    internet_bills = _bucket(InternetBillTransaction)
    data_packs = _bucket(DataPackTransaction)
    water_bills = _bucket(WaterBillTransaction)
    electricity_bills = _bucket(ElectricityBillTransaction)
    community_electricity = _bucket(CommunityElectricityTransaction)
    adjustments = _bucket(WalletAdjustment)
    try:
        wallet_transfers = _apply_created_range(
            WalletTransfer.objects.filter(Q(sender=user) | Q(recipient=user)).order_by('-created_at'),
            start,
            end,
        )
        wallet_transfers.exists()
    except (OperationalError, ProgrammingError):
        wallet_transfers = WalletTransfer.objects.none()

    payload = {
        'deposits': _ser(DepositSerializer, deposits),
        'remittances': _ser(RemittanceTransactionSerializer, remittances),
        'topups': _ser(TopupTransactionSerializer, topups),
        'bank_transfers': _ser(BankTransferTransactionSerializer, transfers),
        'internet_bills': _ser(InternetBillTransactionSerializer, internet_bills),
        'data_packs': _ser(DataPackTransactionSerializer, data_packs),
        'water_bills': _ser(WaterBillTransactionSerializer, water_bills),
        'electricity_bills': _ser(ElectricityBillTransactionSerializer, electricity_bills),
        'community_electricity': _ser(
            CommunityElectricityTransactionSerializer, community_electricity
        ),
        'wallet_adjustments': _ser(WalletAdjustmentSerializer, adjustments),
        'wallet_transfers': [],
        'wallet_id': wallet.id,
        'user_id': user.id,
    }

    try:
        payload['wallet_transfers'] = WalletTransferSerializer(
            wallet_transfers, many=True, context={'viewer': user},
        ).data
    except (OperationalError, ProgrammingError):
        payload['wallet_transfers'] = []

    if type_key:
        for key in (
            'deposits', 'remittances', 'topups', 'bank_transfers',
            'internet_bills', 'data_packs', 'water_bills', 'electricity_bills',
            'community_electricity',
            'wallet_adjustments',
            'wallet_transfers',
        ):
            if key != type_key:
                payload[key] = []

    return Response(payload, status=status.HTTP_200_OK)


_TXN_KIND_ALIASES = {
    'deposit': 'deposit',
    'deposits': 'deposit',
    'remittance': 'remittance',
    'remittances': 'remittance',
    'topup': 'topup',
    'topups': 'topup',
    'transfer': 'transfer',
    'bank_transfer': 'transfer',
    'bank_transfers': 'transfer',
    'internet': 'internet',
    'internet_bills': 'internet',
    'data_pack': 'data_pack',
    'data_packs': 'data_pack',
    'water': 'water',
    'water_bills': 'water',
    'electricity': 'electricity',
    'electricity_bills': 'electricity',
    'community_electricity': 'community_electricity',
    'adjustment': 'wallet_adjustment',
    'wallet_adjustment': 'wallet_adjustment',
    'wallet_adjustments': 'wallet_adjustment',
    'wallet_transfer': 'wallet_transfer',
    'wallet_transfers': 'wallet_transfer',
}


def _money_str(value):
    if value is None:
        return None
    return f'{Decimal(value):.2f}'


def _iso_dt(value):
    return value.isoformat() if value else None


def _user_ledger_fields(user):
    wallet_id = None
    try:
        wallet_id = user.wallet.id
    except Wallet.DoesNotExist:
        pass
    return {
        'user_id': user.id,
        'phone': user.phone or '',
        'first_name': user.first_name or '',
        'last_name': user.last_name or '',
        'wallet_id': wallet_id,
    }


def _safe_ledger_qs(model, start, end):
    """Query a transaction model with date range; tolerate missing optional tables."""
    try:
        qs = model.objects.select_related('user', 'user__wallet').order_by('-created_at')
        qs.exists()
        return _apply_created_range(qs, start, end)
    except (OperationalError, ProgrammingError):
        if model is ElectricityBillTransaction:
            try:
                from ..models import _ensure_electricity_bill_table
                _ensure_electricity_bill_table()
                qs = model.objects.select_related('user', 'user__wallet').order_by('-created_at')
                qs.exists()
                return _apply_created_range(qs, start, end)
            except Exception:
                pass
        return model.objects.none()


def _apply_mixed_status(qs, status_filter, *, kind):
    """Filter status across deposit (approved/rejected), adjustments (always success), and provider txns."""
    if not status_filter or status_filter == 'all':
        return qs
    if kind in ('wallet_adjustment', 'wallet_transfer'):
        if status_filter in ('success', 'approved'):
            return qs
        return qs.none()
    if kind == 'deposit':
        if status_filter == 'success':
            return qs.filter(status='approved')
        if status_filter == 'failed':
            return qs.filter(status='rejected')
        if status_filter in ('pending', 'approved', 'rejected'):
            return qs.filter(status=status_filter)
        return qs.none()
    if status_filter == 'approved':
        return qs.none()
    if status_filter == 'rejected':
        return qs.none()
    if status_filter in ('pending', 'success', 'failed'):
        return qs.filter(status=status_filter)
    return qs.none()


def _ledger_row(*, kind, obj, amount, credit, status, reference, detail):
    return {
        'id': f'{kind}-{obj.id}',
        'record_id': obj.id,
        'kind': kind,
        'amount': _money_str(amount) or '0.00',
        'credit': credit,
        'status': status,
        'reference': (reference or '').strip(),
        'detail': (detail or '').strip(),
        'balance_before': _money_str(getattr(obj, 'balance_before', None)),
        'balance_after': _money_str(getattr(obj, 'balance_after', None)),
        'created_at': _iso_dt(obj.created_at),
        **_user_ledger_fields(obj.user),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_transaction_history(request):
    """
    Unified ledger of every wallet-moving transaction across all users.
    Includes before/after wallet balances, type, user, amount, status, and reference.
    Optional filters: type, status, q, start_date, end_date. export=csv for download.
    """
    start, end = _parse_date_range(request)
    q = (request.query_params.get('q') or '').strip()
    status_filter = (request.query_params.get('status') or '').strip().lower()
    type_raw = (request.query_params.get('type') or '').strip().lower()
    type_key = _TXN_KIND_ALIASES.get(type_raw) if type_raw and type_raw != 'all' else None

    def _qs(model, kind, extra_q=None):
        qs = _safe_ledger_qs(model, start, end)
        qs = _apply_mixed_status(qs, status_filter, kind=kind)
        if q:
            user_q = (
                Q(user__phone__icontains=q)
                | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
                | _maybe_id_query(q, 'id')
            )
            qs = qs.filter(user_q | extra_q) if extra_q is not None else qs.filter(user_q)
        return qs

    sources = []

    if type_key in (None, 'deposit'):
        extra = (
            Q(transaction_id__icontains=q) | Q(bank_name__icontains=q) | Q(note__icontains=q)
        ) if q else None
        sources.append(('deposit', _qs(Deposit, 'deposit', extra), lambda d: _ledger_row(
            kind='deposit',
            obj=d,
            amount=d.amount,
            credit=True,
            status=d.status,
            reference=d.transaction_id or f'#{d.id}',
            detail=d.note or d.bank_name or '',
        )))

    if type_key in (None, 'remittance'):
        extra = (
            Q(ref_no__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(provider_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(sender_name__icontains=q)
            | Q(receiver_name__icontains=q)
        ) if q else None
        sources.append(('remittance', _qs(RemittanceTransaction, 'remittance', extra), lambda r: _ledger_row(
            kind='remittance',
            obj=r,
            amount=r.total_credited if r.total_credited else r.amount,
            credit=True,
            status=r.status,
            reference=r.ref_no or r.merchant_txn_id or r.reference_id or f'#{r.id}',
            detail=' · '.join(p for p in (r.sender_name, r.receiver_name) if p) or r.ref_no or '',
        )))

    if type_key in (None, 'topup'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(mobile_number__icontains=q)
        ) if q else None
        sources.append(('topup', _qs(TopupTransaction, 'topup', extra), lambda t: _ledger_row(
            kind='topup',
            obj=t,
            amount=t.total_debited if t.total_debited else t.amount,
            credit=False,
            status=t.status,
            reference=t.merchant_txn_id or t.reference_id or t.service_hub_txn_id or f'#{t.id}',
            detail=t.mobile_number or t.get_product_id_display(),
        )))

    if type_key in (None, 'transfer'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(provider_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(destination_acc_no__icontains=q)
            | Q(destination_acc_name__icontains=q)
            | Q(destination_bank_name__icontains=q)
        ) if q else None
        sources.append(('transfer', _qs(BankTransferTransaction, 'transfer', extra), lambda b: _ledger_row(
            kind='transfer',
            obj=b,
            amount=b.total_debited if b.total_debited else b.amount,
            credit=False,
            status=b.status,
            reference=b.merchant_txn_id or b.reference_id or b.provider_txn_id or f'#{b.id}',
            detail=' · '.join(
                p for p in (b.destination_acc_name, b.destination_bank_name or b.destination_bank) if p
            ),
        )))

    if type_key in (None, 'internet'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(customer_id__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(isp_name__icontains=q)
        ) if q else None
        sources.append(('internet', _qs(InternetBillTransaction, 'internet', extra), lambda bill: _ledger_row(
            kind='internet',
            obj=bill,
            amount=bill.total_debited if bill.total_debited else bill.amount,
            credit=False,
            status=bill.status,
            reference=bill.merchant_txn_id or bill.reference_id or bill.service_hub_txn_id or f'#{bill.id}',
            detail=' · '.join(p for p in (bill.isp_name, bill.customer_id) if p),
        )))

    if type_key in (None, 'data_pack'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(mobile_number__icontains=q)
            | Q(operator__icontains=q)
        ) if q else None
        sources.append(('data_pack', _qs(DataPackTransaction, 'data_pack', extra), lambda dp: _ledger_row(
            kind='data_pack',
            obj=dp,
            amount=dp.total_debited if dp.total_debited else dp.amount,
            credit=False,
            status=dp.status,
            reference=dp.merchant_txn_id or dp.reference_id or dp.service_hub_txn_id or f'#{dp.id}',
            detail=' · '.join(p for p in (dp.operator, dp.mobile_number) if p),
        )))

    if type_key in (None, 'water'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(connection_no__icontains=q)
            | Q(customer_code__icontains=q)
            | Q(customer_name__icontains=q)
        ) if q else None
        sources.append(('water', _qs(WaterBillTransaction, 'water', extra), lambda bill: _ledger_row(
            kind='water',
            obj=bill,
            amount=bill.total_debited if bill.total_debited else bill.amount,
            credit=False,
            status=bill.status,
            reference=bill.merchant_txn_id or bill.reference_id or bill.service_hub_txn_id or f'#{bill.id}',
            detail=' · '.join(p for p in (bill.connection_no, bill.customer_code) if p),
        )))

    if type_key in (None, 'electricity'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(sc_no__icontains=q)
            | Q(consumer_id__icontains=q)
            | Q(customer_name__icontains=q)
        ) if q else None
        sources.append(('electricity', _qs(ElectricityBillTransaction, 'electricity', extra), lambda bill: _ledger_row(
            kind='electricity',
            obj=bill,
            amount=bill.total_debited if bill.total_debited else bill.amount,
            credit=False,
            status=bill.status,
            reference=bill.merchant_txn_id or bill.reference_id or bill.service_hub_txn_id or f'#{bill.id}',
            detail=' · '.join(p for p in (bill.sc_no, bill.consumer_id) if p),
        )))

    if type_key in (None, 'community_electricity'):
        extra = (
            Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(reference_id__icontains=q)
            | Q(customer_ref__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(platform_name__icontains=q)
        ) if q else None
        sources.append((
            'community_electricity',
            _qs(CommunityElectricityTransaction, 'community_electricity', extra),
            lambda bill: _ledger_row(
                kind='community_electricity',
                obj=bill,
                amount=bill.total_debited if bill.total_debited else bill.amount,
                credit=False,
                status=bill.status,
                reference=bill.merchant_txn_id or bill.reference_id or bill.service_hub_txn_id or f'#{bill.id}',
                detail=' · '.join(p for p in (bill.platform_name, bill.customer_ref) if p),
            ),
        ))

    if type_key in (None, 'wallet_adjustment'):
        extra = (Q(reference__icontains=q) | Q(reason__icontains=q)) if q else None
        sources.append((
            'wallet_adjustment',
            _qs(WalletAdjustment, 'wallet_adjustment', extra),
            lambda a: _ledger_row(
                kind='wallet_adjustment',
                obj=a,
                amount=abs(a.amount),
                credit=a.adjustment_type == 'credit',
                status='success',
                reference=a.reference or f'#{a.id}',
                detail=a.reason or a.reference or '',
            ),
        ))

    if type_key in (None, 'wallet_transfer'):
        extra = None
        if q:
            extra = (
                Q(reference__icontains=q)
                | Q(remarks__icontains=q)
                | Q(sender__phone__icontains=q)
                | Q(recipient__phone__icontains=q)
                | Q(sender__first_name__icontains=q)
                | Q(sender__last_name__icontains=q)
                | Q(recipient__first_name__icontains=q)
                | Q(recipient__last_name__icontains=q)
                | _maybe_id_query(q, 'id')
            )
        try:
            wt_qs = WalletTransfer.objects.select_related(
                'sender', 'sender__wallet', 'recipient', 'recipient__wallet',
            ).order_by('-created_at')
            wt_qs.exists()
            wt_qs = _apply_created_range(wt_qs, start, end)
            wt_qs = _apply_mixed_status(wt_qs, status_filter, kind='wallet_transfer')
            if extra is not None:
                wt_qs = wt_qs.filter(extra)
        except (OperationalError, ProgrammingError):
            wt_qs = WalletTransfer.objects.none()

        def _wallet_transfer_rows(obj):
            detail = (
                f'{obj.sender.phone} → {obj.recipient.phone}'
                + (f' · {obj.remarks}' if (obj.remarks or '').strip() else '')
            )
            sender_row = {
                'id': f'wallet_transfer-{obj.id}-out',
                'record_id': obj.id,
                'kind': 'wallet_transfer',
                'amount': _money_str(obj.amount) or '0.00',
                'credit': False,
                'status': obj.status or 'success',
                'reference': (obj.reference or '').strip(),
                'detail': detail,
                'balance_before': _money_str(obj.sender_balance_before),
                'balance_after': _money_str(obj.sender_balance_after),
                'created_at': _iso_dt(obj.created_at),
                **_user_ledger_fields(obj.sender),
            }
            recipient_row = {
                'id': f'wallet_transfer-{obj.id}-in',
                'record_id': obj.id,
                'kind': 'wallet_transfer',
                'amount': _money_str(obj.amount) or '0.00',
                'credit': True,
                'status': obj.status or 'success',
                'reference': (obj.reference or '').strip(),
                'detail': detail,
                'balance_before': _money_str(obj.recipient_balance_before),
                'balance_after': _money_str(obj.recipient_balance_after),
                'created_at': _iso_dt(obj.created_at),
                **_user_ledger_fields(obj.recipient),
            }
            return [sender_row, recipient_row]

        sources.append((
            'wallet_transfer',
            wt_qs,
            _wallet_transfer_rows,
        ))

    rows = []
    type_counts = {
        'all': 0,
        'deposit': 0,
        'remittance': 0,
        'topup': 0,
        'transfer': 0,
        'internet': 0,
        'data_pack': 0,
        'water': 0,
        'electricity': 0,
        'community_electricity': 0,
        'wallet_adjustment': 0,
        'wallet_transfer': 0,
    }
    for kind, qs, mapper in sources:
        for obj in qs:
            mapped = mapper(obj)
            mapped_rows = mapped if isinstance(mapped, list) else [mapped]
            for row in mapped_rows:
                rows.append(row)
                type_counts[kind] += 1
                type_counts['all'] += 1

    rows.sort(key=lambda r: r['created_at'] or '', reverse=True)

    if _is_csv_export(request):
        return _csv_response(
            'admin-transaction-history.csv',
            [
                'id', 'created_at', 'kind', 'phone', 'first_name', 'last_name',
                'amount', 'credit', 'balance_before', 'balance_after',
                'status', 'reference', 'detail',
            ],
            [
                [
                    r['id'],
                    r['created_at'] or '',
                    r['kind'],
                    r['phone'],
                    r['first_name'],
                    r['last_name'],
                    r['amount'],
                    'credit' if r['credit'] else 'debit',
                    r['balance_before'] or '',
                    r['balance_after'] or '',
                    r['status'],
                    r['reference'],
                    r['detail'],
                ]
                for r in rows
            ],
        )

    success_n = sum(1 for r in rows if r['status'] in ('success', 'approved'))
    pending_n = sum(1 for r in rows if r['status'] == 'pending')
    failed_n = sum(1 for r in rows if r['status'] in ('failed', 'rejected'))

    today = timezone.localdate()
    month_start = today.replace(day=1)
    total_volume = Decimal('0')
    total_credit = Decimal('0')
    total_debit = Decimal('0')
    today_amount = Decimal('0')
    monthly_amount = Decimal('0')
    for r in rows:
        amt = Decimal(r['amount'] or '0')
        total_volume += amt
        settled = r['status'] in ('success', 'approved')
        if settled and r['credit']:
            total_credit += amt
        elif settled and not r['credit']:
            total_debit += amt
        created = r['created_at']
        if settled and created:
            try:
                day = parse_date(created[:10])
            except (TypeError, ValueError):
                day = None
            if day == today:
                today_amount += amt
            if day and day >= month_start:
                monthly_amount += amt

    return Response({
        'items': rows,
        'stats': {
            'total': len(rows),
            'success': success_n,
            'pending': pending_n,
            'failed': failed_n,
        },
        'type_counts': type_counts,
        'summary': {
            'total_volume': _money(total_volume),
            'total_amount': _money(total_credit + total_debit),
            'today_amount': _money(today_amount),
            'monthly_amount': _money(monthly_amount),
            'total_credit': _money(total_credit),
            'total_debit': _money(total_debit),
        },
    })


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


def _commission_earnings(qs):
    """Roll up MySewa transfer commission. Earnings count successful rows only."""
    today = timezone.localdate()
    month_start = today.replace(day=1)
    success_qs = qs.filter(status='success')
    today_qs = success_qs.filter(created_at__date=today)
    month_qs = success_qs.filter(created_at__date__gte=month_start)

    def _sum(filtered, field):
        return filtered.aggregate(t=Sum(field))['t'] or Decimal('0.00')

    return {
        'total_earnings': _money(_sum(success_qs, 'platform_charge')),
        'today_earnings': _money(_sum(today_qs, 'platform_charge')),
        'monthly_earnings': _money(_sum(month_qs, 'platform_charge')),
        'total_charges': _money(_sum(success_qs, 'charge')),
        'total_provider_charges': _money(_sum(success_qs, 'provider_charge')),
        'transfer_volume': _money(_sum(success_qs, 'amount')),
        'earning_count': success_qs.filter(platform_charge__gt=0).count(),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_commission_history(request):
    """
    History of charges collected on bank transfers (wallet → bank) and
    MySewa platform commission earned from each successful movement.
    """
    qs = BankTransferTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(user__first_name__icontains=q)
            | Q(user__last_name__icontains=q)
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
            'admin-commission-history.csv',
            [
                'id', 'created_at', 'phone', 'first_name', 'last_name',
                'amount', 'destination_bank_name', 'destination_acc_no',
                'destination_acc_name', 'provider_charge', 'platform_charge',
                'commission_earned', 'charge', 'cashback', 'total_debited',
                'merchant_txn_id', 'status',
            ],
            [
                [
                    t.id,
                    t.created_at.isoformat() if t.created_at else '',
                    t.user.phone,
                    t.user.first_name,
                    t.user.last_name,
                    t.amount,
                    t.destination_bank_name,
                    t.destination_acc_no,
                    t.destination_acc_name,
                    t.provider_charge,
                    t.platform_charge,
                    t.platform_charge if t.status == 'success' else Decimal('0.00'),
                    t.charge,
                    t.cashback,
                    t.total_debited,
                    t.merchant_txn_id,
                    t.status,
                ]
                for t in qs
            ],
        )

    return Response({
        'items': CommissionHistorySerializer(qs, many=True).data,
        'stats': {
            'total': qs.count(),
            'success': qs.filter(status='success').count(),
            'pending': qs.filter(status='pending').count(),
            'failed': qs.filter(status='failed').count(),
        },
        'earnings': _commission_earnings(qs),
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
def admin_list_electricity_bills(request):
    qs = ElectricityBillTransaction.objects.select_related('user').order_by('-created_at')
    q = (request.query_params.get('q') or '').strip()
    start, end = _parse_date_range(request)
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    if q:
        qs = qs.filter(
            Q(user__phone__icontains=q)
            | Q(sc_no__icontains=q)
            | Q(consumer_id__icontains=q)
            | Q(office_code__icontains=q)
            | Q(office_name__icontains=q)
            | Q(customer_name__icontains=q)
            | Q(merchant_txn_id__icontains=q)
            | Q(service_hub_txn_id__icontains=q)
            | Q(session_id__icontains=q)
            | _maybe_id_query(q, 'id')
        )
    qs = _apply_created_range(qs, start, end)

    if _is_csv_export(request):
        return _csv_response(
            'admin-electricity-bills.csv',
            [
                'id', 'phone', 'sc_no', 'consumer_id', 'office_code',
                'office_name', 'customer_name', 'amount', 'charge', 'cashback',
                'total_debited', 'merchant_txn_id', 'service_hub_txn_id',
                'status', 'created_at',
            ],
            [
                [
                    t.id, t.user.phone, t.sc_no, t.consumer_id, t.office_code,
                    t.office_name, t.customer_name, t.amount, t.charge, t.cashback,
                    t.total_debited, t.merchant_txn_id, t.service_hub_txn_id or '',
                    t.status, t.created_at.isoformat() if t.created_at else '',
                ]
                for t in qs
            ],
        )

    return Response({
        'items': ElectricityBillTransactionSerializer(qs, many=True).data,
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
def admin_get_electricity_bill(request, bill_id):
    try:
        bill = ElectricityBillTransaction.objects.select_related('user').get(pk=bill_id)
    except ElectricityBillTransaction.DoesNotExist:
        return Response({'error': 'Electricity bill not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(AdminElectricityBillSerializer(bill).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_electricity_bill_status(request, bill_id):
    """Change electricity bill status from the admin list (pending / success / failed)."""
    try:
        bill = ElectricityBillTransaction.objects.select_related('user').get(pk=bill_id)
    except ElectricityBillTransaction.DoesNotExist:
        return Response({'error': 'Electricity bill not found'}, status=status.HTTP_404_NOT_FOUND)

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
        'message': f'Electricity bill status updated to {bill.status}',
        'data': AdminElectricityBillSerializer(bill).data,
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
            | Q(user__first_name__icontains=q)
            | Q(user__last_name__icontains=q)
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
                'id', 'phone', 'user_name', 'ref_no', 'sender_name', 'receiver_name', 'amount',
                'total_credited', 'merchant_txn_id', 'provider_txn_id', 'status', 'created_at',
            ],
            [
                [
                    r.id, r.user.phone,
                    ' '.join(p for p in (r.user.first_name, r.user.last_name) if p).strip(),
                    r.ref_no, r.sender_name, r.receiver_name, r.amount,
                    r.total_credited, r.merchant_txn_id, r.provider_txn_id or '', r.status,
                    r.created_at.isoformat() if r.created_at else '',
                ]
                for r in qs
            ],
        )

    return Response({
        'items': RemittanceTransactionSerializer(qs, many=True, context={'request': request}).data,
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
    return Response(AdminRemittanceSerializer(rem, context={'request': request}).data)


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
        'data': RemittanceTransactionSerializer(rem, context={'request': request}).data,
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

    from ..services.payment_accounts import (
        ACCOUNT_QR_CLEAR_PREFIX,
        ACCOUNT_QR_UPLOAD_PREFIX,
        apply_account_qr_uploads,
        normalize_bank_details,
        preserve_account_qr_codes,
        prune_removed_account_qrs,
    )

    bank_keys = ('bank_name', 'account_name', 'account_number', 'branch')
    previous_bank = (
        dict(settings_obj.bank_details or {})
        if isinstance(settings_obj.bank_details, dict)
        else {}
    )
    bank = dict(previous_bank)
    updated_bank = False
    for k in bank_keys:
        if k in request.data and request.data.get(k) is not None:
            bank[k] = str(request.data.get(k))
            updated_bank = True

    def _apply_image_upload(field_name, clear_key):
        if field_name in request.FILES:
            setattr(settings_obj, field_name, request.FILES[field_name])
        elif clear_key in request.data and str(request.data.get(clear_key)).lower() in (
            '1', 'true', 'yes',
        ):
            current = getattr(settings_obj, field_name)
            if current:
                current.delete(save=False)
            setattr(settings_obj, field_name, None)
        elif request.data.get(field_name) in ('', 'null', None) and field_name in request.data:
            pass  # ignore empty

    _apply_image_upload('qr_code', 'clear_qr')
    _apply_image_upload('khalti_qr_code', 'clear_khalti_qr')
    _apply_image_upload('esewa_qr_code', 'clear_esewa_qr')

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

    if 'auto_update_enabled' in request.data and request.data.get('auto_update_enabled') is not None:
        raw_enabled = request.data.get('auto_update_enabled')
        if isinstance(raw_enabled, bool):
            settings_obj.auto_update_enabled = raw_enabled
        else:
            settings_obj.auto_update_enabled = str(raw_enabled).strip().lower() in (
                '1', 'true', 'yes', 'on',
            )

    if 'app_version' in request.data and request.data.get('app_version') is not None:
        settings_obj.app_version = str(request.data.get('app_version') or '').strip()[:32]

    if 'apk' in request.FILES:
        uploaded_apk = request.FILES['apk']
        apk_name = (getattr(uploaded_apk, 'name', '') or '').lower()
        if not apk_name.endswith('.apk'):
            return Response(
                {
                    'error': 'Upload a valid .apk file.',
                    'message': 'Upload a valid .apk file.',
                    'code': 'invalid_apk',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if settings_obj.apk:
            settings_obj.apk.delete(save=False)
        settings_obj.apk = uploaded_apk
    elif 'clear_apk' in request.data and str(request.data.get('clear_apk')).lower() in (
        '1', 'true', 'yes',
    ):
        if settings_obj.apk:
            settings_obj.apk.delete(save=False)
        settings_obj.apk = None

    if 'bank_details' in request.data:
        parsed_bank = _parse_json_field(request.data.get('bank_details'))
        if parsed_bank is not None:
            bank = parsed_bank if isinstance(parsed_bank, dict) else bank
            bank = preserve_account_qr_codes(previous_bank, bank)
            updated_bank = True

    account_qr_touched = any(
        str(k).startswith(ACCOUNT_QR_UPLOAD_PREFIX) for k in request.FILES.keys()
    ) or any(
        str(k).startswith(ACCOUNT_QR_CLEAR_PREFIX) for k in request.data.keys()
    )
    if account_qr_touched:
        bank = apply_account_qr_uploads(bank, request.FILES, request.data)
        updated_bank = True

    if updated_bank:
        # Flat bank_* fields from older clients merge into first bank account
        if any(k in request.data for k in bank_keys) and 'bank_details' not in request.data:
            accounts = list(bank.get('accounts') or []) if isinstance(bank.get('accounts'), list) else []
            primary = next((a for a in accounts if isinstance(a, dict) and a.get('method', 'bank') == 'bank'), None)
            if primary is None:
                accounts.insert(0, {
                    'id': '',
                    'method': 'bank',
                    'label': bank.get('bank_name') or 'Bank account',
                    'bank_name': bank.get('bank_name') or '',
                    'account_name': bank.get('account_name') or '',
                    'account_number': bank.get('account_number') or '',
                    'branch': bank.get('branch') or '',
                    'enabled': True,
                })
            else:
                for k in bank_keys:
                    if k in request.data and request.data.get(k) is not None:
                        primary[k] = str(request.data.get(k))
                primary['label'] = primary.get('label') or primary.get('bank_name') or 'Bank account'
            bank['accounts'] = accounts
        normalized_bank = normalize_bank_details(bank)
        prune_removed_account_qrs(previous_bank, normalized_bank)
        settings_obj.bank_details = normalized_bank

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
                    elif section == 'integrations':
                        from ..services.smtp import PASSWORD_MASK
                        merged_integ = {**(current.get(section) or {}), **values}
                        incoming_pw = str(values.get('himalpay_portal_password') or '').strip()
                        if not incoming_pw or incoming_pw == PASSWORD_MASK:
                            merged_integ['himalpay_portal_password'] = (
                                (current.get(section) or {}).get('himalpay_portal_password') or ''
                            )
                        merged_integ.pop('himalpay_portal_password_set', None)
                        current[section] = merged_integ
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


class AdminExportDataView(APIView):
    """
    Download every database table as Excel (.xlsx), a ZIP of CSVs, or a
    phpMyAdmin-compatible MySQL dump (.sql).

    DRF uses ?format= to pick a renderer (json, api, …). This endpoint uses
    the same query param for the file type, so content negotiation must not
    treat sql/xlsx/csv as missing renderers (that 404s with {"detail":"Not found."}).
    """

    permission_classes = [IsAuthenticated, IsStaffUser]
    renderer_classes = [JSONRenderer]
    http_method_names = ['get', 'head', 'options']

    def perform_content_negotiation(self, request, force=True):
        renderer = JSONRenderer()
        return renderer, renderer.media_type

    def get(self, request, *args, **kwargs):
        params = request.query_params
        fmt = (
            params.get('export_format')
            or params.get('file')
            or params.get('format')
            or 'sql'
        ).strip().lower()
        from ..services.data_export import EXPORT_FORMATS, build_export

        aliases = {
            'excel': 'xlsx',
            'xls': 'xlsx',
            'mysql': 'sql',
            'phpmyadmin': 'sql',
            'dump': 'sql',
            'csvs': 'csv',
            'zip': 'csv',
        }
        fmt = aliases.get(fmt, fmt)
        if fmt not in EXPORT_FORMATS:
            return Response(
                {'error': 'format must be xlsx, csv, or sql'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            payload, filename, content_type = build_export(fmt)
        except Exception as exc:
            return Response(
                {'error': f'Export failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        response = HttpResponse(payload, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Cache-Control'] = 'no-store'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition'
        return response


admin_export_data = AdminExportDataView.as_view()


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
    if not (smtp.get('smtp_email_from') or smtp.get('from_email') or '').strip():
        return Response(
            {
                'ok': False,
                'message': 'smtp_email_from (sender email) is required.',
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
    probes reseller services, and checks whether balance is readable via API key.
    """
    from ..services.himalpay import is_route_not_found_error

    outbound_ip = get_outbound_public_ip(force=True)
    himalpay = HimalPayAPI()
    result = {
        'outbound_ip': outbound_ip,
        'base_url': himalpay.base_url,
        'api_key_configured': bool(himalpay.api_key),
        'portal_login_configured': bool(himalpay._has_portal_login()),
        'bypass_api': bool(himalpay.bypass_api),
        'ok': False,
        'message': '',
        'error_code': None,
        'error_type': None,
        'services_count': 0,
        'balance_ok': False,
        'balance_source': None,
        'balance_total_rupees': None,
        'balance_message': '',
    }

    if himalpay.bypass_api:
        result['ok'] = True
        result['balance_ok'] = True
        result['balance_source'] = 'bypass'
        result['message'] = 'HimalPay bypass mode is enabled (no live API calls).'
        result['balance_message'] = 'Bypass mode returns a fake balance.'
        return Response(result)

    if not himalpay.api_key:
        result['message'] = (
            'HimalPay API key is not configured. '
            'Set it under Super Admin → Settings → HimalPay reseller.'
        )
        result['balance_message'] = result['message']
        return Response(result)

    try:
        services = himalpay.list_services()
        count = len(services) if isinstance(services, list) else 0
        result['ok'] = True
        result['services_count'] = count
        result['message'] = (
            f'Connected to HimalPay with API key. {count} reseller service(s) available.'
        )
    except HimalPayError as exc:
        message = exc.message
        if getattr(exc, 'is_ip_blocked', False):
            message = f'{message.rstrip(".")}. {admin_himalpay_ip_hint()}'
        result['message'] = message
        result['error_code'] = exc.error_code
        result['error_type'] = exc.error_type
    except Exception as exc:
        result['message'] = f'HimalPay check failed: {exc}'

    # Separate probe: can we read float with this API key / fallbacks?
    original_timeout = getattr(himalpay, 'timeout', 60)
    himalpay.timeout = min(int(original_timeout or 60), 20)
    try:
        balance = himalpay.get_reseller_balance()
        if isinstance(balance, dict) and HimalPayAPI._balance_payload_has_amounts(balance):
            result['balance_ok'] = True
            result['balance_source'] = balance.get('source') or 'reseller-balance'
            result['balance_total_rupees'] = balance.get('total_balance_in_rupees')
            result['balance_message'] = (
                f"Balance readable via {result['balance_source']}: "
                f"Rs. {result['balance_total_rupees']}"
            )
        else:
            result['balance_message'] = 'HimalPay returned an empty balance payload.'
    except HimalPayError as exc:
        message = str(exc.message if hasattr(exc, 'message') else exc)
        if is_route_not_found_error(message, exc.status_code, exc.error_type):
            result['balance_message'] = (
                'API key is set, but LIVE HimalPay returned 404 for '
                '/wallet/reseller-balance (UAT-only route). '
                'Ask HimalPay to enable it on LIVE, or configure portal login.'
            )
        else:
            result['balance_message'] = message
        if result.get('error_code') is None:
            result['error_code'] = exc.error_code
            result['error_type'] = exc.error_type
    except Exception as exc:
        result['balance_message'] = f'Balance check failed: {exc}'
    finally:
        himalpay.timeout = original_timeout

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


@api_view(['GET', 'PATCH', 'PUT'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_get_kyc(request, kyc_id):
    """KYC submission detail, or staff correction of submitted identity fields."""
    try:
        submission = (
            KYCSubmission.objects.select_related('user', 'reviewed_by')
            .prefetch_related('documents')
            .get(pk=kyc_id)
        )
    except KYCSubmission.DoesNotExist:
        return Response({'error': 'KYC submission not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(KYCSubmissionSerializer(submission, context={'request': request}).data)

    serializer = AdminKYCUpdateSerializer(data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(
            {'error': 'Invalid KYC update', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data = serializer.validated_data
    if not data:
        return Response(
            {'error': 'No KYC fields provided to update'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        with transaction.atomic():
            kwargs = {'actor': request.user}
            if 'citizenship_number' in data:
                kwargs['citizenship_number'] = data['citizenship_number']
            if 'first_name' in data:
                kwargs['first_name'] = data['first_name']
            if 'last_name' in data:
                kwargs['last_name'] = data['last_name']
            if 'date_of_birth' in data:
                kwargs['date_of_birth'] = data['date_of_birth']
            update_kyc_submission(submission, **kwargs)
    except ValidationError as exc:
        return Response(
            {'error': _validation_error_message(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    submission.refresh_from_db()
    submission.user.refresh_from_db()
    return Response({
        'message': 'KYC details updated',
        'data': KYCSubmissionSerializer(submission, context={'request': request}).data,
    })


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

    try:
        with transaction.atomic():
            mark_submission_reviewed(
                submission,
                status=KYCSubmission.STATUS_APPROVED,
                reviewer=request.user,
            )
    except ValidationError as exc:
        return Response(
            {'error': _validation_error_message(exc)},
            status=status.HTTP_400_BAD_REQUEST,
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

    try:
        with transaction.atomic():
            mark_submission_reviewed(
                submission,
                status=KYCSubmission.STATUS_REJECTED,
                reviewer=request.user,
                rejection_reason=reason,
            )
    except ValidationError as exc:
        return Response(
            {'error': _validation_error_message(exc)},
            status=status.HTTP_400_BAD_REQUEST,
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


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_set_user_transaction_pin(request, user_id):
    """
    Staff/superuser override: set or replace a user's transaction PIN.
    Does not require the user's current PIN — only new PIN + confirm.
    """
    from django.contrib.auth.hashers import make_password
    from ..models import SecurityAuditLog
    from ..services.security import log_security_event

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    serializer = SetTransactionPinSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    had_pin = bool(user.transaction_pin)
    user.transaction_pin = make_password(serializer.validated_data['transaction_pin'])
    user.save(update_fields=['transaction_pin'])
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_TRANSACTION_PIN_ADMIN_SET,
        request=request,
        details={
            'method': 'admin',
            'admin_id': request.user.pk,
            'replaced_existing': had_pin,
        },
    )

    return Response({
        'message': (
            'Transaction PIN updated successfully'
            if had_pin
            else 'Transaction PIN set successfully'
        ),
        'user_id': user.id,
        'has_transaction_pin': True,
    })


# ---------------------------------------------------------------------------
# HimalPay statement reconciliation
# ---------------------------------------------------------------------------


def _statement_tables_missing_response():
    return Response(
        {
            'error': (
                'Statement reconcile tables are missing. '
                'Run: python manage.py migrate core 0024_statement_reconcile'
            ),
            'summary': {'open_issues': 0, 'by_issue_type': {}, 'latest_run': None},
            'items': [],
            'count': 0,
            'statement_logs': [],
            'ledger': [],
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _apply_statement_wallet_correction(
    *,
    user_id: int,
    adjustment_type: str,
    magnitude: Decimal,
    reason: str,
    reference: str,
    created_by,
    discrepancy: StatementDiscrepancy | None = None,
):
    """
    Apply a wallet credit/debit for statement correction and email the user.
    Optionally resolve an open discrepancy in the same transaction.
    Returns (wallet_adjustment, locked_discrepancy_or_none).
    """
    from ..services.notifications import notify_wallet_adjustment

    if adjustment_type not in ('credit', 'debit'):
        raise ValueError('adjustment_type must be credit or debit')
    magnitude = Decimal(str(magnitude)).quantize(Decimal('0.01'))
    if magnitude <= 0:
        raise ValueError('Amount must be positive')

    signed = magnitude if adjustment_type == 'credit' else -magnitude
    reason = (reason or '').strip()[:2000]
    if not reason:
        raise ValueError('Reason is required')

    with transaction.atomic():
        locked_disc = None
        if discrepancy is not None:
            locked_disc = (
                StatementDiscrepancy.objects
                .select_for_update()
                .select_related('user')
                .get(pk=discrepancy.pk)
            )
            if locked_disc.status != StatementDiscrepancy.STATUS_OPEN:
                raise ValueError('Discrepancy was already resolved.')
            user_id = locked_disc.user_id or user_id

        if not user_id:
            raise ValueError('No MySewa user to correct')

        wallet = (
            Wallet.objects.select_for_update()
            .select_related('user')
            .get(user_id=user_id)
        )
        balance_before = wallet.balance
        balance_after = balance_before + signed
        if balance_after < 0:
            raise ValueError('Adjustment would make wallet balance negative.')

        wallet.balance = balance_after
        wallet.save(update_fields=['balance', 'updated_at'])
        adj = WalletAdjustment.objects.create(
            wallet=wallet,
            user=wallet.user,
            amount=signed,
            adjustment_type=adjustment_type,
            balance_before=balance_before,
            balance_after=balance_after,
            reason=reason,
            created_by=created_by,
            reference=reference[:100],
        )
        if locked_disc is not None:
            locked_disc.status = StatementDiscrepancy.STATUS_RESOLVED
            locked_disc.resolved_by = created_by
            locked_disc.resolved_at = timezone.now()
            locked_disc.resolution_adjustment = adj
            locked_disc.save(update_fields=[
                'status', 'resolved_by', 'resolved_at', 'resolution_adjustment', 'updated_at',
            ])

        notify_wallet_adjustment(
            wallet.user,
            balance_before,
            balance_after,
            reason=reason,
            ref=reference,
        )
        return adj, locked_disc


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_list(request):
    """List statement discrepancies with filters + open-issue summary + ledger."""
    try:
        qs = (
            StatementDiscrepancy.objects
            .select_related('user', 'run', 'resolved_by', 'resolution_adjustment')
            .order_by('-created_at')
        )
        status_filter = (request.query_params.get('status') or 'open').strip()
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        issue_type = (request.query_params.get('issue_type') or '').strip()
        if issue_type:
            qs = qs.filter(issue_type=issue_type)
        start, end = _parse_date_range(request)
        qs = _apply_created_range(qs, start, end)
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(transaction_uuid__icontains=q)
                | Q(merchant_txn_id__icontains=q)
                | Q(wallet_service_name__icontains=q)
                | Q(user__phone__icontains=q)
                | Q(reason__icontains=q)
            )

        if _is_csv_export(request):
            rows = []
            for item in qs[:2000]:
                rows.append([
                    item.id,
                    item.status,
                    item.get_issue_type_display(),
                    getattr(item.user, 'phone', '') if item.user_id else '',
                    item.transaction_uuid,
                    item.merchant_txn_id,
                    item.wallet_service_name,
                    item.direction,
                    item.hp_status,
                    item.hp_net_amount,
                    item.local_status,
                    item.local_amount if item.local_amount is not None else '',
                    item.reason,
                    item.created_at.isoformat() if item.created_at else '',
                    item.resolved_at.isoformat() if item.resolved_at else '',
                ])
            return _csv_response(
                'statement-issues.csv',
                [
                    'id', 'status', 'issue_type', 'user_phone', 'transaction_uuid',
                    'merchant_txn_id', 'service', 'direction', 'hp_status',
                    'hp_net_amount', 'local_status', 'local_amount', 'reason',
                    'created_at', 'resolved_at',
                ],
                rows,
            )

        open_count = StatementDiscrepancy.objects.filter(
            status=StatementDiscrepancy.STATUS_OPEN,
        ).count()
        by_type = {
            row['issue_type']: row['c']
            for row in StatementDiscrepancy.objects.filter(
                status=StatementDiscrepancy.STATUS_OPEN,
            ).values('issue_type').annotate(c=Count('id'))
        }
        latest_run = StatementReconcileRun.objects.order_by('-created_at').first()
        latest_run_data = (
            StatementReconcileRunSerializer(latest_run).data if latest_run else None
        )
        statement_logs = []
        ledger = []
        ledger_by_user = []
        if latest_run is not None:
            logs = latest_run.himalpay_statement_logs
            if isinstance(logs, list):
                statement_logs = logs
            ledger = build_statement_ledger(
                from_date=latest_run.from_date,
                to_date=latest_run.to_date,
                run=latest_run,
            )
            ledger_by_user = group_ledger_by_user(ledger)

        return Response({
            'summary': {
                'open_issues': open_count,
                'by_issue_type': by_type,
                'latest_run': latest_run_data,
            },
            'items': StatementDiscrepancySerializer(qs[:500], many=True).data,
            'count': qs.count(),
            'statement_logs': statement_logs,
            'ledger': ledger,
            'ledger_by_user': ledger_by_user,
        })
    except (ProgrammingError, OperationalError):
        return _statement_tables_missing_response()


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_ledger(request):
    """Dual-sided HimalPay ↔ MySewa ledger for a date range, grouped by user."""
    from_raw = (
        request.query_params.get('from_date')
        or request.query_params.get('start_date')
        or ''
    ).strip()
    to_raw = (
        request.query_params.get('to_date')
        or request.query_params.get('end_date')
        or ''
    ).strip()
    from_date = parse_date(from_raw) if from_raw else None
    to_date = parse_date(to_raw) if to_raw else None
    # Default window: start of month → today so “up to present” is covered.
    if not from_date and not to_date:
        today = timezone.localdate()
        from_date = today.replace(day=1)
        to_date = today
    elif from_date and not to_date:
        to_date = timezone.localdate()
    elif to_date and not from_date:
        from_date = to_date.replace(day=1)

    match_filter = (request.query_params.get('match_state') or 'all').strip()
    user_q = (request.query_params.get('user') or '').strip().lower()
    q = (request.query_params.get('q') or '').strip().lower()

    try:
        run, rows = ledger_from_latest_run(from_date=from_date, to_date=to_date)
        if match_filter and match_filter != 'all':
            rows = [r for r in rows if r.get('match_state') == match_filter]
        if user_q:
            rows = [
                r for r in rows
                if user_q in str(r.get('user_phone') or '').lower()
                or user_q in str(r.get('user_name') or '').lower()
                or user_q == str(r.get('user_id') or '')
            ]
        if q:
            def _row_matches(row):
                hp = row.get('himalpay') or {}
                ms = row.get('mysewa') or {}
                hay = ' '.join([
                    str(hp.get('transaction_uuid') or ''),
                    str(hp.get('service') or ''),
                    str(hp.get('status') or ''),
                    str(ms.get('merchant_txn_id') or ''),
                    str(ms.get('provider_txn_id') or ''),
                    str(ms.get('user_phone') or ''),
                    str(ms.get('user_name') or ''),
                    str(ms.get('txn_type') or ''),
                    str(row.get('user_phone') or ''),
                    str(row.get('reason') or ''),
                ]).lower()
                return q in hay
            rows = [r for r in rows if _row_matches(r)]

        by_user = group_ledger_by_user(rows)
        counts = {
            'total': len(rows),
            'matched': sum(1 for r in rows if r.get('match_state') == 'matched'),
            'local_only': sum(1 for r in rows if r.get('match_state') == 'local_only'),
            'issues': sum(
                1 for r in rows
                if r.get('match_state') not in ('matched', 'local_only')
            ),
            'users': len([g for g in by_user if g.get('user_id')]),
        }
        if _is_csv_export(request):
            csv_rows = []
            for row in rows[:2000]:
                hp = row.get('himalpay') or {}
                ms = row.get('mysewa') or {}
                csv_rows.append([
                    row.get('user_name') or '',
                    row.get('user_phone') or '',
                    row.get('match_state') or '',
                    hp.get('service') or '',
                    hp.get('direction') or '',
                    hp.get('status') or '',
                    hp.get('net_amount') or '',
                    hp.get('transaction_uuid') or '',
                    ms.get('txn_type_display') or ms.get('txn_type') or '',
                    ms.get('status') or '',
                    ms.get('amount') or '',
                    ms.get('merchant_txn_id') or ms.get('provider_txn_id') or '',
                    row.get('reason') or '',
                ])
            return _csv_response(
                'statement-ledger.csv',
                [
                    'user_name', 'user_phone', 'match_state', 'hp_service',
                    'hp_direction', 'hp_status', 'hp_net_amount', 'hp_uuid',
                    'mysewa_type', 'mysewa_status', 'mysewa_amount',
                    'mysewa_ref', 'reason',
                ],
                csv_rows,
            )
        return Response({
            'run': StatementReconcileRunSerializer(run).data if run else None,
            'from_date': from_date,
            'to_date': to_date,
            'counts': counts,
            'items': rows[:2000],
            'by_user': by_user,
        })
    except (ProgrammingError, OperationalError):
        return Response(
            {
                'error': (
                    'Statement reconcile tables are missing. '
                    'Run: python manage.py migrate core 0024_statement_reconcile'
                ),
                'run': None,
                'items': [],
                'by_user': [],
                'counts': {
                    'total': 0, 'matched': 0, 'local_only': 0, 'issues': 0, 'users': 0,
                },
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _statement_window(request):
    from_raw = (
        request.query_params.get('from_date')
        or request.query_params.get('start_date')
        or ''
    ).strip()
    to_raw = (
        request.query_params.get('to_date')
        or request.query_params.get('end_date')
        or ''
    ).strip()
    from_date = parse_date(from_raw) if from_raw else None
    to_date = parse_date(to_raw) if to_raw else None
    today = timezone.localdate()
    if not from_date and not to_date:
        from_date = today.replace(day=1)
        to_date = today
    elif from_date and not to_date:
        to_date = today
    elif to_date and not from_date:
        from_date = to_date.replace(day=1)
    from_date, to_date = clamp_date_range(from_date, to_date)
    return from_date, to_date


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_history(request):
    """HimalPay reseller wallet history (credit/debit), live with stored fallback."""
    from_date, to_date = _statement_window(request)
    direction = (request.query_params.get('direction') or 'all').strip().lower()
    q = (request.query_params.get('q') or '').strip().lower()
    live_raw = (request.query_params.get('live') or '1').strip().lower()
    live = live_raw not in ('0', 'false', 'no')

    entries: list = []
    source = 'stored'
    warning = None
    if live:
        himalpay = HimalPayAPI()
        original_timeout = getattr(himalpay, 'timeout', 60)
        himalpay.timeout = min(int(original_timeout or 60), 25)
        try:
            fetched = himalpay.get_reseller_statement(
                from_date=from_date.isoformat(),
                to_date=to_date.isoformat(),
            )
            if isinstance(fetched, list):
                entries = [row for row in fetched if isinstance(row, dict)]
            source = 'live'
        except HimalPayError as exc:
            warning = str(exc.message if hasattr(exc, 'message') else exc)
            try:
                entries = collect_himalpay_entries_for_range(from_date, to_date)
            except (ProgrammingError, OperationalError):
                entries = []
            source = 'stored'
        except Exception as exc:
            warning = str(exc)
            try:
                entries = collect_himalpay_entries_for_range(from_date, to_date)
            except (ProgrammingError, OperationalError):
                entries = []
            source = 'stored'
        finally:
            himalpay.timeout = original_timeout
    else:
        try:
            entries = collect_himalpay_entries_for_range(from_date, to_date)
        except (ProgrammingError, OperationalError):
            entries = []

    try:
        items = build_himalpay_history_items(entries)
    except (ProgrammingError, OperationalError):
        return Response(
            {
                'error': (
                    'Statement reconcile tables are missing. '
                    'Run: python manage.py migrate core 0024_statement_reconcile'
                ),
                'items': [],
                'counts': {
                    'total': 0, 'credit': 0, 'debit': 0,
                    'credit_amount': '0.00', 'debit_amount': '0.00',
                },
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    if direction in ('credit', 'debit'):
        items = [row for row in items if str(row.get('direction') or '').lower() == direction]
    if q:
        def _hist_match(row):
            hay = ' '.join([
                str(row.get('transaction_uuid') or ''),
                str(row.get('service') or ''),
                str(row.get('status') or ''),
                str(row.get('reference_id') or ''),
                str(row.get('direction') or ''),
                str(row.get('kind') or ''),
            ]).lower()
            return q in hay
        items = [row for row in items if _hist_match(row)]

    credit_rows = [row for row in items if str(row.get('direction') or '').lower() == 'credit']
    debit_rows = [row for row in items if str(row.get('direction') or '').lower() != 'credit']
    credit_amount = sum((Decimal(str(row.get('net_amount') or 0)) for row in credit_rows), Decimal('0.00'))
    debit_amount = sum((Decimal(str(row.get('net_amount') or 0)) for row in debit_rows), Decimal('0.00'))
    counts = {
        'total': len(items),
        'credit': len(credit_rows),
        'debit': len(debit_rows),
        'credit_amount': str(credit_amount.quantize(Decimal('0.01'))),
        'debit_amount': str(debit_amount.quantize(Decimal('0.01'))),
    }

    if _is_csv_export(request):
        return _csv_response(
            'himalpay-history.csv',
            [
                'created_at', 'service', 'direction', 'kind', 'status',
                'principal_amount', 'charge', 'cashback', 'net_amount',
                'transaction_uuid', 'reference_id', 'balance_before', 'balance_after',
            ],
            [
                [
                    row.get('created_at') or '',
                    row.get('service') or '',
                    row.get('direction') or '',
                    row.get('kind') or '',
                    row.get('status') or '',
                    row.get('principal_amount') or '',
                    row.get('charge') or '',
                    row.get('cashback') or '',
                    row.get('net_amount') or '',
                    row.get('transaction_uuid') or '',
                    row.get('reference_id') or '',
                    row.get('balance_before') or '',
                    row.get('balance_after') or '',
                ]
                for row in items[:2000]
            ],
        )

    return Response({
        'from_date': from_date,
        'to_date': to_date,
        'source': source,
        'warning': warning,
        'counts': counts,
        'items': items[:2000],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_runs(request):
    try:
        qs = StatementReconcileRun.objects.select_related('triggered_by_user').order_by('-created_at')[:50]
        return Response({
            'items': StatementReconcileRunSerializer(qs, many=True).data,
            'count': qs.count(),
        })
    except (ProgrammingError, OperationalError):
        return Response(
            {
                'error': (
                    'Statement reconcile tables are missing. '
                    'Run: python manage.py migrate core 0024_statement_reconcile'
                ),
                'items': [],
                'count': 0,
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_run(request):
    """Trigger a statement reconcile for a date range (chunked if longer than ~2 months)."""
    from_raw = (request.data.get('from_date') or '').strip()
    to_raw = (request.data.get('to_date') or '').strip()
    from_date = parse_date(from_raw) if from_raw else timezone.localdate()
    to_date = parse_date(to_raw) if to_raw else from_date
    if not from_date or not to_date:
        return Response(
            {'error': 'from_date and to_date must be YYYY-MM-DD'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        run = run_statement_reconcile_range(
            from_date=from_date,
            to_date=to_date,
            triggered_by=StatementReconcileRun.TRIGGER_ADMIN,
            triggered_by_user=request.user,
        )
    except HimalPayError as exc:
        return Response(
            {'error': str(exc.message if hasattr(exc, 'message') else exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except (ProgrammingError, OperationalError):
        return _statement_tables_missing_response()
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    ledger = build_statement_ledger(
        from_date=from_date,
        to_date=to_date,
        run=run,
    )
    payload = {
        'message': 'Statement reconcile completed',
        'data': StatementReconcileRunSerializer(run).data if run else None,
        'statement_logs': (
            run.himalpay_statement_logs
            if run is not None and isinstance(run.himalpay_statement_logs, list)
            else []
        ),
        'ledger': ledger,
        'ledger_by_user': group_ledger_by_user(ledger),
    }
    if run.error_message:
        payload['warning'] = run.error_message
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_balance(request):
    from ..services.himalpay import is_route_not_found_error

    himalpay = HimalPayAPI()
    # Allow a few sequential HimalPay probes (reseller → portal → statement).
    original_timeout = getattr(himalpay, 'timeout', 60)
    himalpay.timeout = min(int(original_timeout or 60), 25)
    api_key_configured = bool(himalpay.api_key)
    portal_configured = bool(himalpay._has_portal_login())
    try:
        data = himalpay.get_reseller_balance()
    except HimalPayError as exc:
        message = str(exc.message if hasattr(exc, 'message') else exc)
        # Soft-fail when LIVE HimalPay has not deployed reseller balance yet, so
        # the Statement page still loads instead of a hard 502.
        if is_route_not_found_error(message, exc.status_code, exc.error_type):
            return Response(
                {
                    'error': message,
                    'data': None,
                    'unavailable': True,
                    'api_key_configured': api_key_configured,
                    'portal_login_configured': portal_configured,
                    'hint': (
                        'LIVE HimalPay returned 404 for /wallet/reseller-balance '
                        'even with your API key. That route is available on UAT '
                        'per himalpay.md; ask HimalPay to enable it on LIVE, or '
                        'add portal login under Settings → HimalPay.'
                    ),
                }
            )
        return Response(
            {
                'error': message,
                'data': None,
                'api_key_configured': api_key_configured,
                'portal_login_configured': portal_configured,
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        return Response(
            {
                'error': f'Could not load HimalPay balance: {exc}',
                'data': None,
                'api_key_configured': api_key_configured,
                'portal_login_configured': portal_configured,
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    finally:
        himalpay.timeout = original_timeout

    if not isinstance(data, dict) or not HimalPayAPI._balance_payload_has_amounts(data):
        return Response(
            {
                'error': 'HimalPay returned an empty balance payload.',
                'data': None,
                'unavailable': True,
                'api_key_configured': api_key_configured,
                'portal_login_configured': portal_configured,
            }
        )

    return Response(
        {
            'data': data,
            'source': data.get('source') or 'reseller-balance',
            'api_key_configured': api_key_configured,
            'portal_login_configured': portal_configured,
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_solve(request, discrepancy_id):
    """Credit/debit the matched user wallet to resolve a statement discrepancy.

    Optional body overrides: adjustment_type, amount, reason — for manual correction.
    """
    blocked = require_user_feature(request.user, 'wallet_adjustment')
    if blocked:
        return blocked
    try:
        disc = (
            StatementDiscrepancy.objects
            .select_related('user', 'user__wallet')
            .get(pk=discrepancy_id)
        )
    except StatementDiscrepancy.DoesNotExist:
        return Response({'error': 'Discrepancy not found'}, status=status.HTTP_404_NOT_FOUND)

    if disc.status != StatementDiscrepancy.STATUS_OPEN:
        return Response(
            {'error': 'Only open discrepancies can be solved.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not disc.user_id:
        return Response(
            {
                'error': (
                    'This issue has no matched MySewa user. '
                    'Link or create the transaction manually, then re-run check.'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    override_type = (request.data.get('adjustment_type') or '').strip().lower()
    override_amount = request.data.get('amount')
    override_reason = (request.data.get('reason') or '').strip()

    adjustment_type = override_type or disc.suggested_adjustment_type
    if not adjustment_type:
        return Response(
            {'error': 'No suggested wallet adjustment for this issue. Provide adjustment_type.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    amount_raw = override_amount if override_amount not in (None, '') else disc.suggested_amount
    if amount_raw is None:
        return Response(
            {'error': 'No suggested amount for this issue. Provide amount.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        magnitude = Decimal(str(amount_raw)).quantize(Decimal('0.01'))
    except Exception:
        return Response({'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)

    if override_reason:
        reason = override_reason
    else:
        reason = (
            f'Statement correction: {disc.get_issue_type_display()} for '
            f'{disc.transaction_uuid or disc.merchant_txn_id}. {disc.reason}'
        ).strip()
    reference = f'STMT-SOLVE-{disc.pk}'

    try:
        _apply_statement_wallet_correction(
            user_id=disc.user_id,
            adjustment_type=adjustment_type,
            magnitude=magnitude,
            reason=reason,
            reference=reference,
            created_by=request.user,
            discrepancy=disc,
        )
    except Wallet.DoesNotExist:
        return Response({'error': 'User wallet not found'}, status=status.HTTP_404_NOT_FOUND)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    disc = StatementDiscrepancy.objects.select_related(
        'user', 'run', 'resolved_by', 'resolution_adjustment',
    ).get(pk=discrepancy_id)
    return Response({
        'message': 'Issue solved with wallet adjustment',
        'data': StatementDiscrepancySerializer(disc).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_correct(request):
    """
    Manually correct a ledger row: credit/debit the user wallet and email them.

    Body: user_id, adjustment_type (credit|debit), amount, reason
    Optional: discrepancy_id (resolves that open issue), transaction_uuid
    """
    blocked = require_user_feature(request.user, 'wallet_adjustment')
    if blocked:
        return blocked
    user_id = request.data.get('user_id')
    discrepancy_id = request.data.get('discrepancy_id')
    adjustment_type = (request.data.get('adjustment_type') or '').strip().lower()
    amount_raw = request.data.get('amount')
    reason = (request.data.get('reason') or '').strip()
    txn_uuid = (request.data.get('transaction_uuid') or '').strip()

    disc = None
    if discrepancy_id not in (None, ''):
        try:
            disc = StatementDiscrepancy.objects.select_related('user').get(pk=int(discrepancy_id))
        except (StatementDiscrepancy.DoesNotExist, TypeError, ValueError):
            return Response({'error': 'Discrepancy not found'}, status=status.HTTP_404_NOT_FOUND)
        if disc.status != StatementDiscrepancy.STATUS_OPEN:
            return Response(
                {'error': 'Only open discrepancies can be corrected this way.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user_id:
            user_id = disc.user_id

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return Response(
            {'error': 'user_id is required (or provide discrepancy_id with a matched user).'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if adjustment_type not in ('credit', 'debit'):
        return Response(
            {'error': 'adjustment_type must be credit or debit'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        magnitude = Decimal(str(amount_raw)).quantize(Decimal('0.01'))
    except Exception:
        return Response({'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)

    if not reason:
        return Response(
            {'error': 'Explain the correction in reason (sent to the user by email).'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if 'statement' not in reason.lower():
        prefix = 'Statement ledger correction'
        if txn_uuid:
            prefix = f'{prefix} ({txn_uuid})'
        reason = f'{prefix}: {reason}'

    ref_suffix = str(disc.pk if disc else user_id)
    reference = f'STMT-CORRECT-{ref_suffix}-{int(timezone.now().timestamp())}'

    try:
        adj, locked_disc = _apply_statement_wallet_correction(
            user_id=user_id,
            adjustment_type=adjustment_type,
            magnitude=magnitude,
            reason=reason,
            reference=reference,
            created_by=request.user,
            discrepancy=disc,
        )
    except Wallet.DoesNotExist:
        return Response({'error': 'User wallet not found'}, status=status.HTTP_404_NOT_FOUND)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    payload = {
        'message': (
            f'Wallet {adjustment_type} of Rs. {magnitude} applied; user notified by email.'
        ),
        'adjustment_id': adj.pk,
        'balance_before': str(adj.balance_before),
        'balance_after': str(adj.balance_after),
    }
    if locked_disc is not None:
        refreshed = StatementDiscrepancy.objects.select_related(
            'user', 'run', 'resolved_by', 'resolution_adjustment',
        ).get(pk=locked_disc.pk)
        payload['data'] = StatementDiscrepancySerializer(refreshed).data
    return Response(payload)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_statement_ignore(request, discrepancy_id):
    try:
        disc = StatementDiscrepancy.objects.get(pk=discrepancy_id)
    except StatementDiscrepancy.DoesNotExist:
        return Response({'error': 'Discrepancy not found'}, status=status.HTTP_404_NOT_FOUND)

    if disc.status != StatementDiscrepancy.STATUS_OPEN:
        return Response(
            {'error': 'Only open discrepancies can be ignored.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    note = (request.data.get('reason') or '').strip()
    disc.status = StatementDiscrepancy.STATUS_IGNORED
    disc.resolved_by = request.user
    disc.resolved_at = timezone.now()
    if note:
        disc.reason = f'{disc.reason}\n[ignored] {note}'.strip()
    disc.save(update_fields=['status', 'resolved_by', 'resolved_at', 'reason', 'updated_at'])
    return Response({
        'message': 'Issue ignored',
        'data': StatementDiscrepancySerializer(disc).data,
    })


def _parse_bool(value, default=None):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _apply_home_popup_fields(popup, data, files, *, partial=False):
    """Apply multipart/JSON fields onto a HomePopup instance. Returns error Response or None."""
    clear_image = _parse_bool(data.get('clear_image'), False)

    if 'title' in data:
        popup.title = str(data.get('title') or '').strip()
    elif not partial and not popup.pk:
        popup.title = ''

    if 'body' in data:
        popup.body = str(data.get('body') or '').strip()
    elif not partial and not popup.pk:
        popup.body = ''

    if 'max_per_24h' in data and data.get('max_per_24h') is not None:
        try:
            popup.max_per_24h = int(data.get('max_per_24h'))
        except (TypeError, ValueError):
            return Response(
                {'max_per_24h': 'Must be a positive integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if 'is_active' in data and data.get('is_active') is not None:
        popup.is_active = bool(_parse_bool(data.get('is_active'), popup.is_active))

    if 'sort_order' in data and data.get('sort_order') is not None:
        try:
            popup.sort_order = int(data.get('sort_order'))
        except (TypeError, ValueError):
            return Response(
                {'sort_order': 'Must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if 'image' in files:
        if popup.image:
            popup.image.delete(save=False)
        popup.image = files['image']
    elif clear_image:
        if popup.image:
            popup.image.delete(save=False)
        popup.image = None

    title = popup.title
    body = popup.body
    image = popup.image
    has_text = bool((title or '').strip() or (body or '').strip())
    has_image = bool(image)
    if not has_text and not has_image:
        return Response(
            {'detail': 'Popup must include text, an image, or both.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if popup.max_per_24h < 1:
        return Response(
            {'max_per_24h': 'Must be at least 1 time per 24 hours.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_popups(request):
    if request.method == 'GET':
        qs = HomePopup.objects.all().order_by('sort_order', '-id')
        active = request.query_params.get('is_active')
        if active is not None and str(active).strip() != '':
            qs = qs.filter(is_active=_parse_bool(active, True))
        data = HomePopupSerializer(qs, many=True, context={'request': request}).data
        return Response({'items': data, 'count': len(data)})

    popup = HomePopup(
        title='',
        body='',
        max_per_24h=1,
        is_active=True,
        sort_order=0,
    )
    err = _apply_home_popup_fields(popup, request.data, request.FILES, partial=False)
    if err is not None:
        return err
    if 'max_per_24h' not in request.data:
        popup.max_per_24h = 1
    if 'is_active' not in request.data:
        popup.is_active = True
    popup.save()
    return Response(
        {
            'message': 'Popup created',
            'data': HomePopupSerializer(popup, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsStaffUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_popup_detail(request, popup_id):
    try:
        popup = HomePopup.objects.get(pk=popup_id)
    except HomePopup.DoesNotExist:
        return Response({'detail': 'Popup not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(HomePopupSerializer(popup, context={'request': request}).data)

    if request.method == 'DELETE':
        if popup.image:
            popup.image.delete(save=False)
        popup.delete()
        return Response({'message': 'Popup deleted'})

    err = _apply_home_popup_fields(
        popup, request.data, request.FILES, partial=(request.method == 'PATCH'),
    )
    if err is not None:
        return err
    popup.save()
    return Response({
        'message': 'Popup updated',
        'data': HomePopupSerializer(popup, context={'request': request}).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_push_status(request):
    """FCM configuration + registered device counts for the admin send form."""
    from ..models import _ensure_push_notification_table
    from ..services.push import push_status

    _ensure_push_notification_table()
    return Response(push_status())


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_push_history(request):
    """List recently sent admin push notifications."""
    from ..models import _ensure_push_notification_table

    _ensure_push_notification_table()
    try:
        qs = PushNotification.objects.select_related('sent_by', 'target_user').order_by(
            '-created_at', '-id',
        )[:100]
        data = PushNotificationSerializer(qs, many=True).data
    except (ProgrammingError, OperationalError):
        data = []
    return Response({'items': data, 'count': len(data)})


def _save_push_notification(
    *,
    request,
    title,
    body,
    audience,
    result,
    target_count,
    target_user=None,
    target_phone='',
):
    from ..models import _ensure_push_notification_table

    try:
        _ensure_push_notification_table()
        PushNotification.objects.create(
            title=title,
            body=body,
            audience=audience,
            target_user=target_user,
            target_phone=(target_phone or '').strip(),
            sent_by=request.user if getattr(request.user, 'is_authenticated', False) else None,
            sent=int(result.get('sent') or 0),
            failed=int(result.get('failed') or 0),
            skipped=int(result.get('skipped') or 0),
            target_count=int(target_count or 0),
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Failed to save push notification history')


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_push_send(request):
    """Send a Firebase app push to all registered devices, or one user."""
    from ..services.push import is_push_configured, send_push_to_all, send_push_to_tokens

    title = str(request.data.get('title') or '').strip()
    body = str(request.data.get('body') or '').strip()
    audience = str(request.data.get('audience') or 'all').strip().lower()
    if not title:
        return Response(
            {'message': 'Title is required.', 'errors': {'title': ['This field is required.']}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not body:
        return Response(
            {'message': 'Message is required.', 'errors': {'body': ['This field is required.']}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(title) > 120:
        return Response(
            {'message': 'Title is too long.', 'errors': {'title': ['Keep the title under 120 characters.']}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(body) > 1000:
        return Response(
            {'message': 'Message is too long.', 'errors': {'body': ['Keep the message under 1000 characters.']}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not is_push_configured():
        return Response(
            {
                'message': (
                    'Firebase is not configured on the server. '
                    'Add firebase-service-account.json or FIREBASE_CREDENTIALS_PATH.'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    extra = {
        'event': 'admin',
        'audience': audience,
    }
    User = get_user_model()

    def _push_response(result, *, target_count, message, target_user=None, target_phone=''):
        _save_push_notification(
            request=request,
            title=title,
            body=body,
            audience=audience,
            result=result,
            target_count=target_count,
            target_user=target_user,
            target_phone=target_phone,
        )
        payload = {
            **result,
            'message': message,
            'target_count': target_count,
        }
        return Response(payload)

    if audience == 'user':
        user_id = request.data.get('user_id')
        phone = str(request.data.get('phone') or '').strip()
        user = None
        if user_id not in (None, ''):
            try:
                user = User.objects.get(pk=int(user_id))
            except (User.DoesNotExist, TypeError, ValueError):
                user = None
        if user is None and phone:
            user = User.objects.filter(phone=phone).first()
        if user is None:
            return Response(
                {'message': 'User not found. Enter a valid phone or user id.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        tokens = list(
            DeviceToken.objects.filter(user=user).values_list('token', flat=True)
        )
        result = send_push_to_tokens(tokens, title, body, extra)
        target_label = getattr(user, 'phone', str(user.pk))
        issue = result.get('issue')
        if result['sent'] == 0 and result['failed'] == 0:
            message = f'No usable FCM token for {target_label}.'
            if issue:
                message = f'{message} {issue}'
            return _push_response(
                result,
                target_count=len(tokens),
                message=message,
                target_user=user,
                target_phone=target_label,
            )
        message = f'Push sent to {target_label} ({result["sent"]} device(s)).'
        if result['failed'] or result['skipped']:
            message = (
                f'{message} Failed {result["failed"]}, skipped {result["skipped"]}.'
            )
        if issue and result['sent'] == 0:
            message = f'{message} {issue}'
        return _push_response(
            result,
            target_count=len(tokens),
            message=message,
            target_user=user,
            target_phone=target_label,
        )

    result = send_push_to_all(title, body, extra)
    issue = result.get('issue')
    message = f"Push sent to {result['sent']} device(s)."
    extras = []
    if result['failed']:
        extras.append(f"{result['failed']} failed")
    if result['skipped']:
        extras.append(f"{result['skipped']} skipped")
    if extras:
        message = f"{message} {', '.join(extras)}."
    if issue and result['sent'] == 0:
        message = f'{message} {issue}'
    return _push_response(
        result,
        target_count=result['sent'] + result['failed'] + result['skipped'],
        message=message,
    )


