"""
Dealer / Sub-Agent portal APIs and Super Admin hierarchy / profit reports.

Access is enforced from the authenticated user and server-side relationships.
Client-supplied dealer_id / commission amounts are never trusted for authorization.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from ..models import (
    DealerCommission,
    ServiceCommissionRule,
    Wallet,
)
from ..serializers import (
    AdminUserSerializer,
    AdminUserWriteSerializer,
    DealerCommissionSerializer,
    PushBalanceCreateSerializer,
    PushBalanceUserSerializer,
    ServiceCommissionRuleSerializer,
    WalletTransferSerializer,
)
from ..services.hierarchy import (
    DOWNLINE_ROLES,
    ROLE_AGENT,
    ROLE_CUSTOMER,
    ROLE_DEALER,
    ROLE_SUB_AGENT,
    is_admin_actor,
    require_role,
    resolve_assigned_dealer,
    scope_forbidden_response,
    user_in_scope,
    users_in_scope,
)
from ..services.network_reports import (
    _money_str,
    admin_network_kpis,
    commission_for_dealer,
    dealer_dashboard_payload,
    dealer_profit_rows,
    downline_performance,
    hierarchy_tree,
    parse_report_range,
    sales_for_users,
)
from ..services.security import log_security_event
from ..services.app_config import require_account_approved, require_wallet_not_blocked
from ..services.notifications import notify_low_balance_if_needed, notify_wallet_transfer
from ..services.pin import transaction_pin_gate
from ..services.wallet_guard import freeze_wallet, unfreeze_wallet
from ..services.wallet_transfer import perform_wallet_transfer
from .admin_views import IsStaffUser, _is_csv_export, _csv_response

logger = logging.getLogger(__name__)

User = get_user_model()


class IsNetworkOperator(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if is_admin_actor(user):
            return True
        return getattr(user, 'role', None) == ROLE_DEALER


def _actor_dealer(actor):
    if getattr(actor, 'role', None) == ROLE_DEALER:
        return actor
    return resolve_assigned_dealer(actor)


def _force_create_payload(request, data: dict, *, role: str) -> dict:
    payload = dict(data)
    actor = request.user
    if is_admin_actor(actor):
        payload.setdefault('role', role)
        return payload
    payload['is_staff'] = False
    payload['is_superuser'] = False
    payload['role'] = role
    payload['account_status'] = User.ACCOUNT_STATUS_PENDING
    if actor.role == ROLE_DEALER:
        payload['assigned_dealer'] = actor.pk
        if role == ROLE_SUB_AGENT:
            payload['parent_agent'] = None
        if role == ROLE_CUSTOMER:
            payload.setdefault('assigned_sub_agent', None)
    elif actor.role == ROLE_AGENT:
        payload['parent_agent'] = actor.pk
        payload['assigned_dealer'] = getattr(actor, 'assigned_dealer_id', None)
        if role == ROLE_CUSTOMER:
            payload['assigned_sub_agent'] = None
    elif actor.role == ROLE_SUB_AGENT:
        payload['assigned_sub_agent'] = actor.pk
        payload['assigned_dealer'] = getattr(actor, 'assigned_dealer_id', None)
        payload['parent_agent'] = getattr(actor, 'parent_agent_id', None)
    return payload


def _lock_update_payload(request, data: dict, target) -> dict:
    payload = dict(data)
    actor = request.user
    if is_admin_actor(actor):
        return payload
    payload.pop('is_staff', None)
    payload.pop('is_superuser', None)
    payload.pop('assigned_dealer', None)
    payload.pop('account_status', None)
    payload['role'] = target.role
    if actor.role == ROLE_DEALER:
        payload['assigned_dealer'] = actor.pk
        if target.role == ROLE_SUB_AGENT:
            payload['parent_agent'] = target.parent_agent_id
    elif actor.role == ROLE_AGENT:
        payload['parent_agent'] = actor.pk
        payload['assigned_dealer'] = getattr(actor, 'assigned_dealer_id', None)
    elif actor.role == ROLE_SUB_AGENT:
        payload['assigned_sub_agent'] = actor.pk
        payload['assigned_dealer'] = getattr(actor, 'assigned_dealer_id', None)
        payload['parent_agent'] = getattr(actor, 'parent_agent_id', None)
    return payload


def _log(request, user, action, details=None):
    try:
        log_security_event(user=user, action=action, request=request, details=details or {})
    except Exception:
        pass


def _related_select():
    return (
        'wallet', 'assigned_dealer', 'parent_agent', 'assigned_sub_agent',
        'dealer_commission_config',
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_dashboard(request):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    payload = dealer_dashboard_payload(request.user)
    recent = payload.pop('recent_commissions', [])
    payload['recent_commissions'] = DealerCommissionSerializer(recent, many=True).data
    if is_admin_actor(request.user):
        payload['network'] = admin_network_kpis()
    return Response(payload)


def _role_removed_response():
    return Response(
        {
            'error': 'Sub-Agent role removed',
            'message': 'The system now has only Admin, Dealer, and User roles.',
            'code': 'sub_agent_removed',
        },
        status=status.HTTP_410_GONE,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_sub_agents(request):
    return _role_removed_response()


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_sub_agent_detail(request, user_id):
    return _role_removed_response()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_customers(request):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied

    if request.method == 'GET':
        qs = users_in_scope(request.user).filter(role=ROLE_CUSTOMER).select_related(*_related_select())
        q = (request.query_params.get('q') or '').strip()
        sub_id = (request.query_params.get('sub_agent_id') or '').strip()
        if q:
            qs = qs.filter(
                Q(phone__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(email__icontains=q)
            )
        if sub_id.isdigit() and is_admin_actor(request.user):
            qs = qs.filter(assigned_sub_agent_id=int(sub_id))
        elif sub_id.isdigit() and request.user.role == ROLE_DEALER:
            qs = qs.filter(assigned_sub_agent_id=int(sub_id), assigned_dealer=request.user)
        qs = qs.order_by('-date_joined')
        return Response({
            'items': AdminUserSerializer(qs, many=True, context={'request': request}).data,
        })

    data = _force_create_payload(request, request.data, role=ROLE_CUSTOMER)
    serializer = AdminUserWriteSerializer(data=data, context={'request': request})
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = serializer.save()
    user = User.objects.select_related(*_related_select()).get(pk=user.pk)
    _log(
        request, request.user, 'customer_mapped',
        {
            'customer_id': user.pk,
            'dealer_id': user.assigned_dealer_id,
            'sub_agent_id': user.assigned_sub_agent_id,
        },
    )
    return Response(
        {
            'message': 'User created successfully',
            'data': AdminUserSerializer(user, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_customer_detail(request, user_id):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    try:
        user = User.objects.select_related(*_related_select()).get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if user.role != ROLE_CUSTOMER:
        return Response(
            {'error': 'Not a customer', 'message': 'This account is not a customer.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user_in_scope(request.user, user):
        return scope_forbidden_response()

    if request.method == 'GET':
        return Response(AdminUserSerializer(user, context={'request': request}).data)

    prev_dealer = user.assigned_dealer_id
    prev_sub = user.assigned_sub_agent_id
    data = _lock_update_payload(request, request.data, user)
    serializer = AdminUserWriteSerializer(
        user, data=data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = serializer.save()
    user = User.objects.select_related(*_related_select()).get(pk=user.pk)
    if prev_dealer != user.assigned_dealer_id or prev_sub != user.assigned_sub_agent_id:
        _log(
            request, request.user, 'customer_reassigned',
            {
                'customer_id': user.pk,
                'dealer_id': user.assigned_dealer_id,
                'sub_agent_id': user.assigned_sub_agent_id,
                'previous_dealer_id': prev_dealer,
                'previous_sub_agent_id': prev_sub,
            },
        )
    return Response({
        'message': 'Customer updated successfully',
        'data': AdminUserSerializer(user, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_user_freeze(request, user_id):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    try:
        user = User.objects.select_related('wallet').get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not user_in_scope(request.user, user) or user.pk == request.user.pk:
        return scope_forbidden_response()
    wallet, _ = Wallet.objects.get_or_create(user=user)
    reason = (request.data.get('reason') or '').strip()
    wallet = freeze_wallet(wallet, request.user, reason=reason)
    _log(request, request.user, 'wallet_frozen', {'target_id': user.pk, 'wallet_id': wallet.pk})
    user = User.objects.select_related(*_related_select()).get(pk=user.pk)
    return Response({
        'message': 'Wallet frozen. Transactions are not allowed.',
        'data': AdminUserSerializer(user, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_user_unfreeze(request, user_id):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    try:
        user = User.objects.select_related('wallet').get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not user_in_scope(request.user, user) or user.pk == request.user.pk:
        return scope_forbidden_response()
    wallet, _ = Wallet.objects.get_or_create(user=user)
    wallet = unfreeze_wallet(wallet, request.user)
    _log(request, request.user, 'wallet_unfrozen', {'target_id': user.pk, 'wallet_id': wallet.pk})
    user = User.objects.select_related(*_related_select()).get(pk=user.pk)
    return Response({
        'message': 'Wallet unfrozen. Transactions are allowed again.',
        'data': AdminUserSerializer(user, context={'request': request}).data,
    })


def _require_dealer(request):
    if getattr(request.user, 'role', None) != ROLE_DEALER:
        return Response(
            {
                'error': 'Permission denied',
                'message': 'Push Balance is only available to Dealer accounts.',
                'code': 'role_forbidden',
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_push_balance_users(request):
    """Users created or assigned to this Dealer, with current wallet balances."""
    denied = _require_dealer(request)
    if denied:
        return denied

    qs = (
        users_in_scope(request.user)
        .exclude(pk=request.user.pk)
        .select_related('wallet')
        .order_by('first_name', 'last_name', 'phone')
    )
    q = (request.query_params.get('q') or '').strip()
    if q:
        qs = qs.filter(
            Q(phone__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(email__icontains=q)
            | Q(nickname__icontains=q)
            | Q(business_name__icontains=q)
        )
    return Response({
        'items': PushBalanceUserSerializer(qs, many=True, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def dealer_push_balance(request):
    """Debit the Dealer wallet and credit an assigned User's wallet."""
    denied = _require_dealer(request)
    if denied:
        return denied
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = PushBalanceCreateSerializer(data=request.data)
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

    data = serializer.validated_data
    try:
        recipient = User.objects.select_related('wallet').get(pk=data['user_id'])
    except User.DoesNotExist:
        return Response(
            {
                'error': 'User not found',
                'message': 'No user was found with that id.',
                'code': 'recipient_not_found',
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    if recipient.pk == request.user.pk:
        return Response(
            {
                'error': 'Invalid recipient',
                'message': 'You cannot push balance to your own wallet.',
                'code': 'self_transfer',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user_in_scope(request.user, recipient):
        return scope_forbidden_response()

    remarks = (data.get('remarks') or '').strip() or 'Push Balance'
    transfer, err = perform_wallet_transfer(
        sender=request.user,
        recipient=recipient,
        amount=data['amount'],
        remarks=remarks,
        apply_charges=False,
    )
    if err:
        return err

    try:
        notify_wallet_transfer(transfer)
    except Exception:
        logger.exception('Push balance notification failed for %s', transfer.reference)
    try:
        notify_low_balance_if_needed(transfer.sender.wallet)
    except Exception:
        logger.exception('Low-balance check failed after push balance %s', transfer.pk)

    _log(
        request, request.user, 'push_balance',
        {
            'recipient_id': recipient.pk,
            'amount': str(transfer.amount),
            'reference': transfer.reference,
        },
    )
    recipient.refresh_from_db()
    return Response(
        {
            'message': 'Push balance completed',
            'data': WalletTransferSerializer(
                transfer, context={'viewer': request.user, 'request': request},
            ).data,
            'recipient': PushBalanceUserSerializer(
                User.objects.select_related('wallet').get(pk=recipient.pk),
                context={'request': request},
            ).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_commissions(request):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    qs = DealerCommission.objects.select_related(
        'dealer', 'source_user', 'sub_agent',
    ).order_by('-created_at')
    if not is_admin_actor(request.user):
        if request.user.role == ROLE_DEALER:
            qs = qs.filter(dealer=request.user)
        elif request.user.role == ROLE_SUB_AGENT:
            qs = qs.filter(sub_agent=request.user)
        else:
            dealer = resolve_assigned_dealer(request.user)
            qs = qs.filter(dealer=dealer, sub_agent__parent_agent=request.user) if dealer else qs.none()
    start, end = parse_report_range(request)
    status_filter = (request.query_params.get('status') or '').strip()
    txn_type = (request.query_params.get('txn_type') or '').strip()
    q = (request.query_params.get('q') or '').strip()
    if status_filter in ('posted', 'reversed'):
        qs = qs.filter(status=status_filter)
    if txn_type:
        qs = qs.filter(txn_type=txn_type)
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    if q:
        qs = qs.filter(
            Q(dealer__phone__icontains=q)
            | Q(source_user__phone__icontains=q)
            | Q(reference__icontains=q)
        )
    posted = qs.filter(status=DealerCommission.STATUS_POSTED)
    earnings = posted.aggregate(
        gross=Sum('gross_commission'),
        tds=Sum('tds_amount'),
        net=Sum('net_commission'),
        sub=Sum('sub_agent_commission'),
        profit=Sum('super_admin_profit'),
        sales=Sum('txn_amount'),
    )
    return Response({
        'items': DealerCommissionSerializer(qs[:500], many=True).data,
        'earnings': {
            'sales': float(earnings['sales'] or 0),
            'gross_commission': float(earnings['gross'] or 0),
            'tds_amount': float(earnings['tds'] or 0),
            'net_commission': float(earnings['net'] or 0),
            'sub_agent_commission': float(earnings['sub'] or 0),
            'super_admin_profit': float(earnings['profit'] or 0),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsNetworkOperator])
def network_report(request):
    denied = require_role(request.user, ROLE_DEALER)
    if denied:
        return denied
    start, end = parse_report_range(request)
    actor = request.user
    dealer = actor if actor.role == ROLE_DEALER else resolve_assigned_dealer(actor)
    if dealer is None and not is_admin_actor(actor):
        return Response({'error': 'No assigned Dealer'}, status=status.HTTP_400_BAD_REQUEST)

    target_id = (request.query_params.get('user_id') or '').strip()
    target = dealer
    if target_id.isdigit():
        try:
            target = User.objects.select_related('wallet').get(pk=int(target_id))
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if not user_in_scope(actor, target):
            return scope_forbidden_response()

    if target.role == ROLE_DEALER:
        user_ids = list(
            User.objects.filter(Q(pk=target.pk) | Q(assigned_dealer=target)).values_list('id', flat=True)
        )
        comm = commission_for_dealer(target, start, end)
        performance = downline_performance(target, start, end)
    elif target.role in DOWNLINE_ROLES:
        user_ids = list(
            User.objects.filter(
                Q(pk=target.pk) | Q(assigned_sub_agent=target) | Q(parent_agent=target)
            ).values_list('id', flat=True)
        )
        parent = resolve_assigned_dealer(target)
        comm = commission_for_dealer(parent, start, end, sub_agent=target) if parent else {
            'count': 0, 'sales': Decimal('0'), 'gross_commission': Decimal('0'),
            'tds_amount': Decimal('0'), 'net_commission': Decimal('0'),
            'sub_agent_commission': Decimal('0'), 'super_admin_profit': Decimal('0'),
            'by_service': [],
        }
        performance = []
    else:
        user_ids = [target.pk]
        parent = resolve_assigned_dealer(target)
        comm = commission_for_dealer(
            parent, start, end,
        ) if parent else {
            'count': 0, 'sales': Decimal('0'), 'gross_commission': Decimal('0'),
            'tds_amount': Decimal('0'), 'net_commission': Decimal('0'),
            'sub_agent_commission': Decimal('0'), 'super_admin_profit': Decimal('0'),
            'by_service': [],
        }
        # Restrict to this customer's generated rows
        if parent:
            from ..models import DealerCommission as DC
            own = DC.objects.filter(
                dealer=parent, source_user=target, status=DC.STATUS_POSTED,
            )
            if start:
                own = own.filter(created_at__date__gte=start)
            if end:
                own = own.filter(created_at__date__lte=end)
            agg = own.aggregate(
                sales=Sum('txn_amount'), gross=Sum('gross_commission'),
                tds=Sum('tds_amount'), net=Sum('net_commission'),
                sub=Sum('sub_agent_commission'), profit=Sum('super_admin_profit'),
                count=Sum('id'),
            )
            comm = {
                'count': own.count(),
                'sales': agg['sales'] or Decimal('0'),
                'gross_commission': agg['gross'] or Decimal('0'),
                'tds_amount': agg['tds'] or Decimal('0'),
                'net_commission': agg['net'] or Decimal('0'),
                'sub_agent_commission': agg['sub'] or Decimal('0'),
                'super_admin_profit': agg['profit'] or Decimal('0'),
                'by_service': comm.get('by_service') if isinstance(comm, dict) else [],
            }
        performance = []

    sales = sales_for_users(user_ids, start, end)
    wallet = getattr(target, 'wallet', None)
    return Response({
        'user': AdminUserSerializer(target, context={'request': request}).data,
        'range': {
            'start_date': start.isoformat() if start else None,
            'end_date': end.isoformat() if end else None,
        },
        'wallet_balance': _money_str(wallet.balance if wallet else 0),
        'total_customers': User.objects.filter(id__in=user_ids, role=ROLE_CUSTOMER).count(),
        'total_sub_agents': User.objects.filter(id__in=user_ids, role__in=DOWNLINE_ROLES).exclude(pk=target.pk).count(),
        'sales': _money_str(sales['sales']),
        'success_count': sales['success_count'],
        'failed_count': sales['failed_count'],
        'gross_commission': _money_str(comm['gross_commission']),
        'tds_amount': _money_str(comm['tds_amount']),
        'net_commission': _money_str(comm['net_commission']),
        'sub_agent_commission': _money_str(comm['sub_agent_commission']),
        'super_admin_profit': _money_str(comm['super_admin_profit']),
        'by_service': comm['by_service'] or list(sales['by_service'].values()),
        'sub_agent_performance': performance,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_hierarchy(request):
    start, end = parse_report_range(request)
    return Response({'items': hierarchy_tree(start, end)})


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_dealer_profit(request):
    start, end = parse_report_range(request)
    dealer_id = (request.query_params.get('dealer_id') or '').strip()
    sub_id = (request.query_params.get('sub_agent_id') or '').strip()
    txn_type = (request.query_params.get('txn_type') or '').strip() or None
    status_filter = (request.query_params.get('status') or 'posted').strip() or 'posted'
    dealer = None
    sub_agent = None
    if dealer_id.isdigit():
        dealer = User.objects.filter(pk=int(dealer_id), role=ROLE_DEALER).first()
    if sub_id.isdigit():
        sub_agent = User.objects.filter(pk=int(sub_id), role__in=DOWNLINE_ROLES).first()
    rows = dealer_profit_rows(
        start, end, dealer=dealer, sub_agent=sub_agent, txn_type=txn_type, status=status_filter,
    )
    totals = {
        'sales': sum(Decimal(r['sales']) for r in rows),
        'gross_commission': sum(Decimal(r['gross_commission']) for r in rows),
        'tds_amount': sum(Decimal(r['tds_amount']) for r in rows),
        'net_commission': sum(Decimal(r['net_commission']) for r in rows),
        'super_admin_profit': sum(Decimal(r['super_admin_profit']) for r in rows),
    }
    if _is_csv_export(request):
        return _csv_response(
            'dealer-profit.csv',
            ['dealer', 'phone', 'sales', 'commission', 'tds', 'net_commission', 'super_admin_profit'],
            [
                [r['name'], r['phone'], r['sales'], r['gross_commission'], r['tds_amount'],
                 r['net_commission'], r['super_admin_profit']]
                for r in rows
            ],
        )
    return Response({
        'items': rows,
        'totals': {k: _money_str(v) for k, v in totals.items()},
        'range': {
            'start_date': start.isoformat() if start else None,
            'end_date': end.isoformat() if end else None,
        },
    })


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated, IsStaffUser])
def admin_service_commission_rules(request, user_id):
    try:
        dealer = User.objects.get(pk=user_id, role=ROLE_DEALER)
    except User.DoesNotExist:
        return Response({'error': 'Dealer not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        rules = ServiceCommissionRule.objects.filter(dealer=dealer).order_by('txn_type')
        config = getattr(dealer, 'dealer_commission_config', None)
        return Response({
            'dealer_id': dealer.pk,
            'defaults': {
                'commission_rate': str(config.commission_rate) if config else '0.00',
                'sub_agent_commission_rate': str(getattr(config, 'sub_agent_commission_rate', 0) or 0),
                'super_admin_rate': str(getattr(config, 'super_admin_rate', 0) or 0),
                'tds_rate': None if config is None or config.tds_rate is None else str(config.tds_rate),
            },
            'items': ServiceCommissionRuleSerializer(rules, many=True).data,
        })

    items = request.data.get('items') if isinstance(request.data, dict) else request.data
    if not isinstance(items, list):
        return Response(
            {'error': 'Expected a list of service rules in "items".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    saved = []
    for raw in items:
        txn_type = str(raw.get('txn_type') or '').strip()
        if not txn_type:
            continue
        rule, _ = ServiceCommissionRule.objects.update_or_create(
            dealer=dealer,
            txn_type=txn_type,
            defaults={
                'dealer_rate': raw.get('dealer_rate') or 0,
                'sub_agent_rate': raw.get('sub_agent_rate') or 0,
                'super_admin_rate': raw.get('super_admin_rate') or 0,
            },
        )
        saved.append(rule)
    _log(request, request.user, 'commission_changed', {'dealer_id': dealer.pk, 'count': len(saved)})
    return Response({
        'message': 'Service commission rules saved',
        'items': ServiceCommissionRuleSerializer(saved, many=True).data,
    })
