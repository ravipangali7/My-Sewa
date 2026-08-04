"""
Staff / superuser admin API endpoints for the web console.
"""
import json
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Wallet,
    Deposit,
    Settings,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    merge_app_config,
)
from ..serializers import (
    AdminUserSerializer,
    AdminUserWriteSerializer,
    AdminWalletSerializer,
    AdminWalletWriteSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    AdminTopupSerializer,
    BankTransferTransactionSerializer,
    RemittanceTransactionSerializer,
    AdminRemittanceSerializer,
    SettingsSerializer,
)
from ..services.himalpay import (
    HimalPayAPI,
    HimalPayError,
    admin_himalpay_ip_hint,
    get_outbound_public_ip,
)
from ..services.txn_status import apply_outbound_status_change, apply_inbound_status_change

User = get_user_model()


class IsStaffUser(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_staff or request.user.is_superuser)
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_dashboard(request):
    today = timezone.localdate()
    week_start = today - timedelta(days=6)

    total_users = User.objects.count()
    wallet_float = Wallet.objects.aggregate(total=Sum('balance'))['total'] or Decimal('0.00')
    pending_count = Deposit.objects.filter(status='pending').count()
    topups_today = TopupTransaction.objects.filter(created_at__date=today).count()
    transfers_today = BankTransferTransaction.objects.filter(created_at__date=today).count()

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
    return Response(AdminUserSerializer(users, many=True, context={'request': request}).data)


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


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_wallets(request):
    wallets = Wallet.objects.select_related('user').order_by('-updated_at')
    total = wallets.aggregate(total=Sum('balance'))['total'] or Decimal('0.00')
    return Response({
        'wallet_float': str(total),
        'wallets': AdminWalletSerializer(wallets, many=True).data,
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

    serializer = AdminWalletWriteSerializer(
        wallet, data=request.data, partial=(request.method == 'PATCH'),
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    wallet = serializer.save()
    wallet = Wallet.objects.select_related('user').get(pk=wallet.pk)
    return Response({
        'message': 'Wallet updated successfully',
        'data': AdminWalletSerializer(wallet).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_deposits(request):
    qs = Deposit.objects.select_related('user').order_by('-created_at')
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'approved', 'rejected'):
        qs = qs.filter(status=status_filter)
    return Response(DepositSerializer(qs, many=True, context={'request': request}).data)


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
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    product_filter = request.query_params.get('product_id')
    if product_filter in ('1', '2'):
        qs = qs.filter(product_id=int(product_filter))
    return Response(TopupTransactionSerializer(qs, many=True).data)


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
    return Response(BankTransferTransactionSerializer(qs, many=True).data)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_update_transfer_status(request, transfer_id):
    """Change bank transfer status from the admin list (pending / success / failed)."""
    try:
        transfer = BankTransferTransaction.objects.select_related('user').get(pk=transfer_id)
    except BankTransferTransaction.DoesNotExist:
        return Response({'error': 'Transfer not found'}, status=status.HTTP_404_NOT_FOUND)

    new_status = (request.data.get('status') or '').strip().lower()
    ok, err = apply_outbound_status_change(transfer, new_status)
    if not ok:
        return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    transfer.refresh_from_db()
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
        from ..services.notifications import notify_topup_success
        notify_topup_success(topup)

    return Response({
        'message': f'Top-up status updated to {topup.status}',
        'data': AdminTopupSerializer(topup).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_list_remittances(request):
    qs = RemittanceTransaction.objects.select_related('user').order_by('-created_at')
    status_filter = request.query_params.get('status')
    if status_filter in ('pending', 'success', 'failed'):
        qs = qs.filter(status=status_filter)
    return Response(RemittanceTransactionSerializer(qs, many=True).data)


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
                    current[section] = {**(current.get(section) or {}), **values}
                else:
                    current[section] = values
            settings_obj.config = current

    settings_obj.save()
    return Response({
        'message': 'Settings updated successfully',
        'data': SettingsSerializer(settings_obj, context={'request': request}).data,
    })


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
