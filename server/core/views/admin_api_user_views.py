"""Admin console endpoints for API users, Developer API Partners, and audit logs."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    ApiFundTransferLog,
    ApiPayinLog,
    GgrTransaction,
    GgrWallet,
    WalletTransfer,
    _ensure_api_fund_transfer,
)
from ..serializers import AdminUserSerializer
from ..services.api_keys import (
    disable_api_access,
    enable_api_access,
    mask_api_key,
    regenerate_api_key,
)
from ..services.hierarchy import scope_forbidden_response, users_in_scope
from ..services.security import log_security_event
from .admin_views import IsStaffOrShareholder, IsStaffUser

User = get_user_model()


def _api_user_payload(user, request, *, reveal_key=False):
    data = AdminUserSerializer(user, context={'request': request}).data
    data['is_api_user'] = bool(user.is_api_user)
    data['is_api'] = bool(user.is_api_user)
    data['api_deposit_percent'] = str(user.api_deposit_percent) if user.api_deposit_percent is not None else None
    data['api_withdraw_percent'] = str(user.api_withdraw_percent) if user.api_withdraw_percent is not None else None
    data['effective_api_deposit_percent'] = str(user.get_api_deposit_percent())
    data['effective_api_withdraw_percent'] = str(user.get_api_withdraw_percent())
    data['is_ggr_user'] = bool(getattr(user, 'is_ggr_user', False) or getattr(user, 'is_ggr', False))
    data['is_ggr'] = data['is_ggr_user']
    data['can_api_payin'] = bool(getattr(user, 'can_api_payin', False))
    data['can_api_payout'] = bool(getattr(user, 'can_api_payout', True))
    data['can_fund_transfer'] = bool(getattr(user, 'can_fund_transfer', True))
    data['business_name'] = getattr(user, 'business_name', '') or ''
    data['pan_no'] = getattr(user, 'pan_no', '') or ''
    data['company_registration_no'] = getattr(user, 'company_registration_no', '') or ''
    data['citizenship_no'] = getattr(user, 'citizenship_no', '') or getattr(user, 'citizenship_number', '') or ''

    def file_url(f):
        if not f:
            return None
        try:
            return request.build_absolute_uri(f.url) if request else f.url
        except Exception:
            return None

    data['pan_document_url'] = file_url(getattr(user, 'pan_document', None))
    data['company_registration_document_url'] = file_url(getattr(user, 'company_registration_document', None))

    c_front_url = file_url(getattr(user, 'citizenship_front', None))
    c_back_url = file_url(getattr(user, 'citizenship_back', None))
    if not c_front_url or not c_back_url:
        try:
            from ..models import KYCDocument
            docs = KYCDocument.objects.filter(submission__user=user, document_type=KYCDocument.DOC_CITIZENSHIP)
            for d in docs:
                if not c_front_url and d.side == KYCDocument.SIDE_FRONT and d.file:
                    c_front_url = file_url(d.file)
                elif not c_back_url and d.side == KYCDocument.SIDE_BACK and d.file:
                    c_back_url = file_url(d.file)
        except Exception:
            pass

    data['citizenship_front_url'] = c_front_url
    data['citizenship_back_url'] = c_back_url

    kyc_completed = bool(data['pan_no'] and data['company_registration_no'] and data['citizenship_no'])
    data['business_kyc_completed'] = kyc_completed
    data['business_kyc_status'] = (
        'verified' if (kyc_completed and user.kyc_status == 'approved')
        else ('pending' if kyc_completed else 'incomplete')
    )

    data['api_webhook_url'] = str(getattr(user, 'api_webhook_url', '') or '')
    data['api_return_url'] = str(getattr(user, 'api_return_url', '') or '')
    data['api_key_masked'] = mask_api_key(user.api_key)
    data['has_api_key'] = bool(user.api_key)
    data['api_key_created_at'] = user.api_key_created_at
    data['api_key_updated_at'] = user.api_key_updated_at
    data['api_last_used_at'] = user.api_last_used_at
    if reveal_key:
        data['api_key'] = user.api_key or ''
    return data


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_list_api_users(request):
    _ensure_api_fund_transfer()
    is_shareholder = getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser
    only_api = True if is_shareholder else ((request.query_params.get('api_only') or '1').strip() not in ('0', 'false', 'no'))

    if is_shareholder:
        users = User.objects.filter(Q(is_api_user=True) | Q(is_ggr_user=True) | Q(can_api_payin=True))
    else:
        users = users_in_scope(request.user)
        if only_api:
            users = users.filter(Q(is_api_user=True) | Q(is_ggr_user=True) | Q(can_api_payin=True))

    users = users.select_related('wallet').order_by('-date_joined')
    q = (request.query_params.get('q') or '').strip()
    if q:
        users = users.filter(
            Q(phone__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(email__icontains=q)
            | Q(business_name__icontains=q)
            | Q(pan_no__icontains=q)
            | Q(company_registration_no__icontains=q)
        )
    items = [_api_user_payload(u, request) for u in users]
    all_partners = User.objects.filter(Q(is_api_user=True) | Q(is_ggr_user=True) | Q(can_api_payin=True))
    return Response({
        'items': items,
        'stats': {
            'total': all_partners.count(),
            'enabled': all_partners.filter(is_api_user=True).count(),
            'ggr_count': all_partners.filter(is_ggr_user=True).count(),
            'payin_count': all_partners.filter(can_api_payin=True).count(),
            'payout_count': all_partners.filter(can_api_payout=True).count(),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_search_partner_candidates(request):
    """Search registered users to select as a new API Partner."""
    _ensure_api_fund_transfer()
    q = (request.query_params.get('q') or '').strip()
    qs = User.objects.filter(is_active=True).order_by('-date_joined')
    if q:
        qs = qs.filter(
            Q(phone__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(email__icontains=q)
            | Q(business_name__icontains=q)
        )
    results = []
    for u in qs[:25]:
        results.append({
            'id': u.id,
            'phone': u.phone,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'email': u.email,
            'business_name': getattr(u, 'business_name', '') or '',
            'pan_no': getattr(u, 'pan_no', '') or '',
            'company_registration_no': getattr(u, 'company_registration_no', '') or '',
            'citizenship_no': getattr(u, 'citizenship_no', '') or getattr(u, 'citizenship_number', '') or '',
            'is_api_user': bool(u.is_api_user),
            'is_ggr_user': bool(getattr(u, 'is_ggr_user', False)),
            'can_api_payin': bool(getattr(u, 'can_api_payin', False)),
            'can_api_payout': bool(getattr(u, 'can_api_payout', True)),
            'kyc_status': u.kyc_status,
        })
    return Response({'items': results})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_select_api_partner(request):
    """Register or upgrade a user into an API Partner with selected services and Business KYC."""
    _ensure_api_fund_transfer()
    if getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser:
        return Response({'error': 'Super Admin permission required.'}, status=status.HTTP_403_FORBIDDEN)

    user_id = request.data.get('user_id')
    phone = (request.data.get('phone') or '').strip()
    user = None
    if user_id:
        user = User.objects.filter(pk=user_id).first()
    elif phone:
        user = User.objects.filter(phone=phone).first()

    if not user:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    enable_api_access(user, generate_if_missing=True)
    user.is_api_user = True

    # Configure services: GGR, Pay In, Pay Out
    if 'is_ggr_user' in request.data:
        val = request.data.get('is_ggr_user')
        user.is_ggr_user = val in (True, 'true', 'True', '1', 1)
        if user.is_ggr_user:
            from ..services.ggr_service import ensure_ggr_wallet
            ensure_ggr_wallet(user)
    if 'can_api_payin' in request.data:
        val = request.data.get('can_api_payin')
        user.can_api_payin = val in (True, 'true', 'True', '1', 1)
    if 'can_api_payout' in request.data:
        val = request.data.get('can_api_payout')
        user.can_api_payout = val in (True, 'true', 'True', '1', 1)
        user.can_fund_transfer = user.can_api_payout

    from decimal import Decimal, InvalidOperation
    if 'api_deposit_percent' in request.data:
        val = request.data.get('api_deposit_percent')
        if val in (None, '', 'null', 'None'):
            user.api_deposit_percent = None
        else:
            try:
                user.api_deposit_percent = round(Decimal(str(val)), 2)
            except Exception:
                pass
    if 'api_withdraw_percent' in request.data:
        val = request.data.get('api_withdraw_percent')
        if val in (None, '', 'null', 'None'):
            user.api_withdraw_percent = None
        else:
            try:
                user.api_withdraw_percent = round(Decimal(str(val)), 2)
            except Exception:
                pass

    # Business KYC fields
    if 'business_name' in request.data:
        user.business_name = str(request.data.get('business_name') or '').strip()
    if 'pan_no' in request.data:
        user.pan_no = str(request.data.get('pan_no') or '').strip()
    if 'company_registration_no' in request.data:
        user.company_registration_no = str(request.data.get('company_registration_no') or '').strip()
    if 'citizenship_no' in request.data:
        c_no = str(request.data.get('citizenship_no') or '').strip()
        user.citizenship_no = c_no
        user.citizenship_number = c_no

    # Documents from files
    if 'pan_document' in request.FILES:
        user.pan_document = request.FILES['pan_document']
    if 'company_registration_document' in request.FILES:
        user.company_registration_document = request.FILES['company_registration_document']
    if 'citizenship_front' in request.FILES:
        user.citizenship_front = request.FILES['citizenship_front']
    if 'citizenship_back' in request.FILES:
        user.citizenship_back = request.FILES['citizenship_back']

    user.save()
    user.refresh_from_db()

    return Response({
        'message': f'API Partner {user.phone} configured successfully.',
        'data': _api_user_payload(user, request),
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_api_user_detail(request, user_id):
    _ensure_api_fund_transfer()
    is_shareholder = getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser
    if is_shareholder:
        user = User.objects.filter(pk=user_id, is_api_user=True).select_related('wallet').first()
        if not user:
            user = User.objects.filter(pk=user_id, is_ggr_user=True).select_related('wallet').first()
        if not user:
            return Response({'error': 'API Partner not found.'}, status=status.HTTP_404_NOT_FOUND)
    else:
        qs = users_in_scope(request.user).select_related('wallet')
        try:
            user = qs.get(pk=user_id)
        except User.DoesNotExist:
            if User.objects.filter(pk=user_id).exists():
                return scope_forbidden_response()
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(_api_user_payload(user, request))

    if is_shareholder:
        # Shareholders can configure Deposit API and Withdraw API fee percentages per user
        allowed_shareholder_keys = {'api_deposit_percent', 'api_withdraw_percent'}
        received_keys = set(request.data.keys())
        disallowed_keys = received_keys - allowed_shareholder_keys
        if disallowed_keys and not any(k in received_keys for k in allowed_shareholder_keys):
            return Response(
                {'error': 'Shareholders can only set Deposit API and Withdraw API fee percentages.'},
                status=status.HTTP_403_FORBIDDEN,
            )

    was_api_user = bool(user.is_api_user)
    enable = request.data.get('is_api_user') if not is_shareholder else None
    payin = request.data.get('can_api_payin', None) if not is_shareholder else None
    payout = request.data.get('can_api_payout', None) if not is_shareholder else None
    webhook_url = request.data.get('api_webhook_url', None) if not is_shareholder else None
    return_url = request.data.get('api_return_url', None) if not is_shareholder else None
    ggr_enable = (request.data.get('is_ggr_user') if 'is_ggr_user' in request.data else request.data.get('is_ggr')) if not is_shareholder else None
    business_name = request.data.get('business_name', None) if not is_shareholder else None
    pan_no = request.data.get('pan_no', None) if not is_shareholder else None
    company_registration_no = request.data.get('company_registration_no', None) if not is_shareholder else None
    citizenship_no = request.data.get('citizenship_no', None) if not is_shareholder else None

    update_fields = []

    # Fee percentages can be set by both Superadmin and Shareholder
    from decimal import Decimal, InvalidOperation
    if 'api_deposit_percent' in request.data:
        val = request.data.get('api_deposit_percent')
        if val in (None, '', 'null', 'None'):
            user.api_deposit_percent = None
            update_fields.append('api_deposit_percent')
        else:
            try:
                dec = Decimal(str(val))
                if dec < Decimal('0.00') or dec > Decimal('100.00'):
                    return Response({'error': 'Deposit API percentage must be between 0 and 100.'}, status=status.HTTP_400_BAD_REQUEST)
                user.api_deposit_percent = round(dec, 2)
                update_fields.append('api_deposit_percent')
            except (InvalidOperation, ValueError, TypeError):
                return Response({'error': 'Invalid deposit API percentage format.'}, status=status.HTTP_400_BAD_REQUEST)

    if 'api_withdraw_percent' in request.data:
        val = request.data.get('api_withdraw_percent')
        if val in (None, '', 'null', 'None'):
            user.api_withdraw_percent = None
            update_fields.append('api_withdraw_percent')
        else:
            try:
                dec = Decimal(str(val))
                if dec < Decimal('0.00') or dec > Decimal('100.00'):
                    return Response({'error': 'Withdraw API percentage must be between 0 and 100.'}, status=status.HTTP_400_BAD_REQUEST)
                user.api_withdraw_percent = round(dec, 2)
                update_fields.append('api_withdraw_percent')
            except (InvalidOperation, ValueError, TypeError):
                return Response({'error': 'Invalid withdraw API percentage format.'}, status=status.HTTP_400_BAD_REQUEST)
    if enable is not None:
        enabled = bool(enable) if not isinstance(enable, str) else enable.lower() in ('true', '1')
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

    if ggr_enable is not None:
        user.is_ggr_user = bool(ggr_enable) if not isinstance(ggr_enable, str) else ggr_enable.lower() in ('true', '1')
        update_fields.append('is_ggr_user')
        if user.is_ggr_user:
            from ..services.ggr_service import ensure_ggr_wallet
            ensure_ggr_wallet(user)

    if payin is not None:
        user.can_api_payin = bool(payin) if not isinstance(payin, str) else payin.lower() in ('true', '1')
        update_fields.append('can_api_payin')

    if payout is not None:
        user.can_api_payout = bool(payout) if not isinstance(payout, str) else payout.lower() in ('true', '1')
        user.can_fund_transfer = user.can_api_payout
        update_fields.extend(['can_api_payout', 'can_fund_transfer'])

    if business_name is not None:
        user.business_name = str(business_name).strip()
        update_fields.append('business_name')

    if pan_no is not None:
        user.pan_no = str(pan_no).strip()
        update_fields.append('pan_no')

    if company_registration_no is not None:
        user.company_registration_no = str(company_registration_no).strip()
        update_fields.append('company_registration_no')

    if citizenship_no is not None:
        c_str = str(citizenship_no).strip()
        user.citizenship_number = c_str
        user.citizenship_no = c_str
        update_fields.append('citizenship_number')

    # File uploads
    if 'pan_document' in request.FILES:
        user.pan_document = request.FILES['pan_document']
        update_fields.append('pan_document')
    if 'company_registration_document' in request.FILES:
        user.company_registration_document = request.FILES['company_registration_document']
        update_fields.append('company_registration_document')
    if 'citizenship_front' in request.FILES:
        user.citizenship_front = request.FILES['citizenship_front']
        update_fields.append('citizenship_front')
    if 'citizenship_back' in request.FILES:
        user.citizenship_back = request.FILES['citizenship_back']
        update_fields.append('citizenship_back')

    if webhook_url is not None:
        from ..services.api_payin_webhook import validate_webhook_url
        cleaned = str(webhook_url or '').strip()
        if cleaned:
            ok, err = validate_webhook_url(cleaned)
            if not ok:
                return Response(
                    {'error': 'Validation failed', 'message': err},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        user.api_webhook_url = cleaned
        update_fields.append('api_webhook_url')

    if return_url is not None:
        from ..services.api_payin_webhook import validate_webhook_url
        cleaned_return = str(return_url or '').strip()
        if cleaned_return:
            ok, err = validate_webhook_url(cleaned_return)
            if not ok:
                return Response(
                    {'error': 'Validation failed', 'message': err},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        user.api_return_url = cleaned_return
        update_fields.append('api_return_url')

    if update_fields:
        user.save(update_fields=list(set(update_fields)))

    user.refresh_from_db()
    return Response({
        'message': 'API Partner details updated successfully.',
        'data': _api_user_payload(user, request),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_regenerate_key(request, user_id):
    _ensure_api_fund_transfer()
    if getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser:
        return Response({'error': 'Super Admin permission required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = users_in_scope(request.user)
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    regenerate_api_key(user)
    user.refresh_from_db()
    payload = _api_user_payload(user, request, reveal_key=True)
    return Response({
        'message': 'A new API key was generated. The previous key no longer works.',
        'data': payload,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_api_user_reveal_key(request, user_id):
    _ensure_api_fund_transfer()
    if getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser:
        return Response({'error': 'Super Admin permission required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = users_in_scope(request.user)
    try:
        user = qs.get(pk=user_id)
    except User.DoesNotExist:
        if User.objects.filter(pk=user_id).exists():
            return scope_forbidden_response()
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    return Response(_api_user_payload(user, request, reveal_key=True))


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffOrShareholder])
def admin_api_user_logs(request, user_id):
    _ensure_api_fund_transfer()
    is_shareholder = getattr(request.user, 'role', None) == 'shareholder' and not request.user.is_superuser
    if is_shareholder:
        user = User.objects.filter(pk=user_id).first()
        if not user or not (user.is_api_user or getattr(user, 'is_ggr_user', False)):
            return Response({'error': 'API Partner not found.'}, status=status.HTTP_404_NOT_FOUND)
    else:
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
    payin_logs = (
        ApiPayinLog.objects.filter(user=user)
        .select_related('deposit')
        .order_by('-created_at')[:200]
    )
    transfers = (
        WalletTransfer.objects.filter(sender=user, source=WalletTransfer.SOURCE_API)
        .select_related('recipient')
        .order_by('-created_at')[:200]
    )

    # GGR transactions
    ggr_wallet = GgrWallet.objects.filter(user=user).first()
    ggr_logs = (
        GgrTransaction.objects.filter(wallet=ggr_wallet).order_by('-created_at')[:200]
        if ggr_wallet
        else []
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
        'payin_items': [
            {
                'id': row.id,
                'reference': row.reference,
                'receiver': row.receiver,
                'amount': str(row.amount) if row.amount is not None else None,
                'status': row.status,
                'error_code': row.error_code,
                'error_message': row.error_message,
                'transaction_id': row.transaction_id or row.order_id,
                'order_id': row.order_id,
                'deposit_id': row.deposit_id,
                'ip_address': row.ip_address,
                'created_at': row.created_at,
            }
            for row in payin_logs
        ],
        'ggr_items': [
            {
                'id': row.id,
                'txn_type': row.txn_type,
                'txn_type_label': row.get_txn_type_display(),
                'amount': str(row.amount),
                'balance_after': str(row.balance_after),
                'reference': row.reference,
                'notes': row.notes,
                'created_at': row.created_at.isoformat(),
            }
            for row in ggr_logs
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
