"""Dealer payout accounts and dealer-scoped deposit / wallet-load APIs."""
from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import DealerPayoutAccount, Deposit, Settings
from ..serializers import (
    DealerPayoutAccountSerializer,
    DepositSerializer,
    PushBalanceCreateSerializer,
    WalletTransferSerializer,
)
from ..services.app_config import require_account_approved, require_wallet_not_blocked
from ..services.hierarchy import (
    ROLE_CUSTOMER,
    ROLE_DEALER,
    is_admin_actor,
    require_role,
    resolve_assigned_dealer,
    scope_forbidden_response,
    user_in_scope,
    users_in_scope,
)
from ..services.notifications import (
    notify_low_balance_if_needed,
    notify_payout_account_reviewed,
    notify_payout_account_submitted,
    notify_wallet_transfer,
)
from ..services.payment_accounts import enrich_bank_details_qr_urls
from ..services.pin import transaction_pin_gate
from ..services.wallet_transfer import perform_wallet_transfer
from .admin_views import IsStaffUser
from .dealer_views import IsNetworkOperator

logger = logging.getLogger(__name__)

User = get_user_model()


def _payout_to_payment_account(account, request) -> dict:
    qr_url = None
    if account.qr_code:
        qr_url = request.build_absolute_uri(account.qr_code.url) if request else account.qr_code.url
    return {
        'id': f'payout_{account.pk}',
        'method': account.method,
        'label': account.label or account.get_method_display(),
        'bank_name': account.bank_name or '',
        'account_name': account.account_name,
        'account_number': account.account_number,
        'branch': account.branch or '',
        'enabled': True,
        'qr_code_url': qr_url,
        'payout_account_id': account.pk,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def deposit_destinations(request):
    """Deposit destinations for the current user (dealer payouts or platform accounts)."""
    user = request.user
    dealer = resolve_assigned_dealer(user)
    if dealer is not None and dealer.pk != user.pk:
        accounts = list(
            DealerPayoutAccount.objects.filter(
                dealer=dealer,
                status=DealerPayoutAccount.STATUS_APPROVED,
            ).order_by('method', 'id')
        )
        if accounts:
            dealer_name = ' '.join(
                part for part in (dealer.first_name, dealer.last_name) if part
            ).strip() or dealer.phone
            return Response({
                'source': 'dealer',
                'dealer_id': dealer.pk,
                'dealer_phone': dealer.phone,
                'dealer_name': dealer_name,
                'bank_details': {
                    'accounts': [_payout_to_payment_account(a, request) for a in accounts],
                },
            })

    settings_obj = Settings.load()
    return Response({
        'source': 'platform',
        'dealer_id': None,
        'dealer_phone': None,
        'dealer_name': None,
        'bank_details': enrich_bank_details_qr_urls(
            settings_obj.bank_details, request,
        ),
        'qr_code_url': (
            request.build_absolute_uri(settings_obj.qr_code.url)
            if settings_obj.qr_code else None
        ),
        'khalti_qr_code_url': (
            request.build_absolute_uri(settings_obj.khalti_qr_code.url)
            if settings_obj.khalti_qr_code else None
        ),
        'esewa_qr_code_url': (
            request.build_absolute_uri(settings_obj.esewa_qr_code.url)
            if settings_obj.esewa_qr_code else None
        ),
    })


def _dealer_or_admin(request):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    return None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def dealer_payout_accounts(request):
    denied = _dealer_or_admin(request)
    if denied:
        return denied

    if request.method == 'GET':
        if is_admin_actor(request.user):
            qs = DealerPayoutAccount.objects.select_related('dealer').all()
        else:
            qs = DealerPayoutAccount.objects.filter(dealer=request.user)
        qs = qs.order_by('-updated_at')
        return Response({
            'items': DealerPayoutAccountSerializer(qs, many=True, context={'request': request}).data,
        })

    if is_admin_actor(request.user):
        return Response(
            {'error': 'Use the Admin payout accounts screen to manage dealer accounts.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if request.user.role != ROLE_DEALER:
        return Response(
            {'error': 'Only Dealers can add payout accounts.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = DealerPayoutAccountSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    account = serializer.save(
        dealer=request.user,
        status=DealerPayoutAccount.STATUS_PENDING,
        rejection_reason='',
        reviewed_by=None,
        reviewed_at=None,
    )
    try:
        notify_payout_account_submitted(account, edited=False)
    except Exception:
        pass
    return Response(
        {
            'message': 'Payout account submitted for Admin approval.',
            'data': DealerPayoutAccountSerializer(account, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def dealer_payout_account_detail(request, account_id):
    denied = _dealer_or_admin(request)
    if denied:
        return denied
    try:
        account = DealerPayoutAccount.objects.select_related('dealer').get(pk=account_id)
    except DealerPayoutAccount.DoesNotExist:
        return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)

    if not is_admin_actor(request.user) and account.dealer_id != request.user.pk:
        return scope_forbidden_response()

    if request.method == 'GET':
        return Response(DealerPayoutAccountSerializer(account, context={'request': request}).data)

    serializer = DealerPayoutAccountSerializer(
        account, data=request.data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    account = serializer.save(
        status=DealerPayoutAccount.STATUS_PENDING,
        rejection_reason='',
        reviewed_by=None,
        reviewed_at=None,
    )
    try:
        notify_payout_account_submitted(account, edited=True)
    except Exception:
        pass
    return Response({
        'message': 'Payout account updated and sent for Admin approval.',
        'data': DealerPayoutAccountSerializer(account, context={'request': request}).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_payout_accounts(request):
    qs = DealerPayoutAccount.objects.select_related('dealer').order_by('-updated_at')
    status_filter = (request.query_params.get('status') or '').strip()
    if status_filter in (
        DealerPayoutAccount.STATUS_PENDING,
        DealerPayoutAccount.STATUS_APPROVED,
        DealerPayoutAccount.STATUS_REJECTED,
    ):
        qs = qs.filter(status=status_filter)
    q = (request.query_params.get('q') or '').strip()
    if q:
        from django.db.models import Q
        qs = qs.filter(
            Q(dealer__phone__icontains=q)
            | Q(dealer__first_name__icontains=q)
            | Q(dealer__last_name__icontains=q)
            | Q(account_name__icontains=q)
            | Q(account_number__icontains=q)
            | Q(bank_name__icontains=q)
        )
    return Response({
        'items': DealerPayoutAccountSerializer(qs, many=True, context={'request': request}).data,
        'stats': {
            'total': qs.count(),
            'pending': qs.filter(status=DealerPayoutAccount.STATUS_PENDING).count(),
            'success': qs.filter(status=DealerPayoutAccount.STATUS_APPROVED).count(),
            'failed': qs.filter(status=DealerPayoutAccount.STATUS_REJECTED).count(),
        },
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsStaffUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_payout_account_detail(request, account_id):
    try:
        account = DealerPayoutAccount.objects.select_related('dealer').get(pk=account_id)
    except DealerPayoutAccount.DoesNotExist:
        return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(DealerPayoutAccountSerializer(account, context={'request': request}).data)

    serializer = DealerPayoutAccountSerializer(
        account, data=request.data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    account = serializer.save()
    return Response({
        'message': 'Payout account updated.',
        'data': DealerPayoutAccountSerializer(account, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_approve_payout_account(request, account_id):
    try:
        account = DealerPayoutAccount.objects.select_related('dealer').get(pk=account_id)
    except DealerPayoutAccount.DoesNotExist:
        return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)
    account.status = DealerPayoutAccount.STATUS_APPROVED
    account.rejection_reason = ''
    account.reviewed_by = request.user
    account.reviewed_at = timezone.now()
    account.save(update_fields=['status', 'rejection_reason', 'reviewed_by', 'reviewed_at', 'updated_at'])
    try:
        notify_payout_account_reviewed(account)
    except Exception:
        pass
    return Response({
        'message': 'Payout account approved.',
        'data': DealerPayoutAccountSerializer(account, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_reject_payout_account(request, account_id):
    try:
        account = DealerPayoutAccount.objects.select_related('dealer').get(pk=account_id)
    except DealerPayoutAccount.DoesNotExist:
        return Response({'error': 'Payout account not found'}, status=status.HTTP_404_NOT_FOUND)
    reason = (request.data.get('rejection_reason') or request.data.get('reason') or '').strip()
    if not reason:
        return Response(
            {'error': 'Rejection reason is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    account.status = DealerPayoutAccount.STATUS_REJECTED
    account.rejection_reason = reason
    account.reviewed_by = request.user
    account.reviewed_at = timezone.now()
    account.save(update_fields=['status', 'rejection_reason', 'reviewed_by', 'reviewed_at', 'updated_at'])
    try:
        notify_payout_account_reviewed(account)
    except Exception:
        pass
    return Response({
        'message': 'Payout account rejected.',
        'data': DealerPayoutAccountSerializer(account, context={'request': request}).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_deposits(request):
    denied = _dealer_or_admin(request)
    if denied:
        return denied
    from ..services.list_response import items_with_stats_response

    scoped = users_in_scope(request.user).filter(role=ROLE_CUSTOMER)
    qs = Deposit.objects.filter(user__in=scoped).select_related(
        'user', 'payout_account',
    ).order_by('-created_at')
    return items_with_stats_response(
        qs,
        DepositSerializer,
        request,
        search_fields=('transaction_id', 'bank_name', 'note', 'user__phone'),
        success=('approved',),
        pending=('pending',),
        failed=('rejected',),
        status_aliases={
            'success': 'approved',
            'failed': 'rejected',
            'approved': 'approved',
            'rejected': 'rejected',
        },
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_approve_deposit(request, deposit_id):
    denied = _dealer_or_admin(request)
    if denied:
        return denied
    try:
        deposit = Deposit.objects.select_related('user').get(pk=deposit_id)
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    if not user_in_scope(request.user, deposit.user) or deposit.user_id == request.user.pk:
        return scope_forbidden_response()
    if deposit.status != 'pending':
        return Response(
            {'error': f'Deposit is already {deposit.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    from ..services.wallet_guard import require_wallet_not_frozen
    frozen = require_wallet_not_frozen(deposit.user)
    if frozen:
        return frozen
    try:
        deposit.status = 'approved'
        deposit.save()
    except ValueError as exc:
        return Response(
            {'error': str(exc), 'message': str(exc), 'code': 'wallet_frozen'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return Response({
        'message': 'Deposit approved successfully',
        'data': DepositSerializer(deposit, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_reject_deposit(request, deposit_id):
    denied = _dealer_or_admin(request)
    if denied:
        return denied
    try:
        deposit = Deposit.objects.get(pk=deposit_id)
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    if not user_in_scope(request.user, deposit.user) or deposit.user_id == request.user.pk:
        return scope_forbidden_response()
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


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_load_user_wallet(request, user_id):
    """Load an assigned user's wallet from the Dealer's MySewa wallet (no transfer charges)."""
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = PushBalanceCreateSerializer(data={
        'user_id': user_id,
        'amount': request.data.get('amount'),
        'remarks': (request.data.get('remarks') or '').strip() or 'Dealer wallet load',
        'transaction_pin': request.data.get('transaction_pin'),
    })
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    try:
        target = User.objects.select_related('wallet').get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not user_in_scope(request.user, target) or target.pk == request.user.pk:
        return scope_forbidden_response()
    if target.role != ROLE_CUSTOMER:
        return Response(
            {'error': 'You can only load wallets for Users in your network.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    remarks = (serializer.validated_data.get('remarks') or '').strip() or 'Dealer wallet load'
    transfer, err = perform_wallet_transfer(
        sender=request.user,
        recipient=target,
        amount=serializer.validated_data['amount'],
        remarks=remarks,
        apply_charges=False,
    )
    if err:
        return err

    try:
        notify_wallet_transfer(transfer)
    except Exception:
        logger.exception('Dealer wallet load notification failed for %s', transfer.reference)
    try:
        notify_low_balance_if_needed(transfer.sender.wallet)
    except Exception:
        logger.exception('Low-balance check failed after dealer wallet load %s', transfer.pk)

    return Response(
        {
            'message': 'Wallet loaded',
            'data': WalletTransferSerializer(
                transfer, context={'viewer': request.user, 'request': request},
            ).data,
        },
        status=status.HTTP_201_CREATED,
    )
