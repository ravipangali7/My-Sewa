"""
Network sales / commission aggregations for Dealer and Super Admin reports.

All money math uses Decimal. Amounts are snapshotted from DealerCommission
and live transaction rows — never from client-submitted figures.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Optional

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from ..models import (
    BankTransferTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    DealerCommission,
    ElectricityBillTransaction,
    InternetBillTransaction,
    RemittanceTransaction,
    TopupTransaction,
    WaterBillTransaction,
)
from .hierarchy import (
    ROLE_CUSTOMER,
    ROLE_DEALER,
    ROLE_SUB_AGENT,
    DOWNLINE_ROLES,
    is_admin_actor,
    resolve_assigned_dealer,
    users_in_scope,
)

User = get_user_model()

_ZERO = Decimal('0.00')

SALES_MODELS = (
    (TopupTransaction, 'amount'),
    (DataPackTransaction, 'amount'),
    (InternetBillTransaction, 'amount'),
    (WaterBillTransaction, 'amount'),
    (ElectricityBillTransaction, 'amount'),
    (CommunityElectricityTransaction, 'amount'),
    (BankTransferTransaction, 'amount'),
    (RemittanceTransaction, 'amount'),
)


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return _ZERO


def _money_str(value) -> str:
    return str(_money(value).quantize(Decimal('0.01')))


def parse_report_range(request) -> tuple:
    """
    Return (start_date, end_date) from period=today|yesterday|week|month or start_date/end_date.
    """
    today = timezone.localdate()
    period = (request.query_params.get('period') or '').strip().lower()
    start_raw = (request.query_params.get('start_date') or '').strip()
    end_raw = (request.query_params.get('end_date') or '').strip()
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    if period == 'today':
        start = end = today
    elif period == 'yesterday':
        start = end = today - timedelta(days=1)
    elif period in ('week', 'this_week'):
        start = today - timedelta(days=today.weekday())
        end = today
    elif period in ('month', 'this_month'):
        start = today.replace(day=1)
        end = today
    if start and end and start > end:
        start, end = end, start
    return start, end


def _apply_date(qs, start, end, field='created_at'):
    if start:
        qs = qs.filter(**{f'{field}__date__gte': start})
    if end:
        qs = qs.filter(**{f'{field}__date__lte': end})
    return qs


def network_user_ids(actor, dealer=None) -> list[int]:
    if dealer is not None:
        qs = User.objects.filter(Q(pk=dealer.pk) | Q(assigned_dealer=dealer))
        return list(qs.values_list('id', flat=True))
    return list(users_in_scope(actor).values_list('id', flat=True))


def sales_for_users(user_ids, start=None, end=None, txn_type=None, txn_status='success') -> dict:
    total_amount = _ZERO
    success_count = 0
    failed_count = 0
    txn_count = 0
    by_service = {}

    type_map = {
        'topup': TopupTransaction,
        'data_pack': DataPackTransaction,
        'internet': InternetBillTransaction,
        'water': WaterBillTransaction,
        'electricity': ElectricityBillTransaction,
        'community_electricity': CommunityElectricityTransaction,
        'bank_transfer': BankTransferTransaction,
        'remittance': RemittanceTransaction,
    }
    sources = SALES_MODELS
    if txn_type and txn_type in type_map:
        sources = tuple((m, f) for m, f in SALES_MODELS if m is type_map[txn_type])

    for model, amount_field in sources:
        key = {
            TopupTransaction: 'topup',
            DataPackTransaction: 'data_pack',
            InternetBillTransaction: 'internet',
            WaterBillTransaction: 'water',
            ElectricityBillTransaction: 'electricity',
            CommunityElectricityTransaction: 'community_electricity',
            BankTransferTransaction: 'bank_transfer',
            RemittanceTransaction: 'remittance',
        }[model]
        qs = model.objects.filter(user_id__in=user_ids)
        qs = _apply_date(qs, start, end)
        if txn_status and txn_status not in ('all', ''):
            status_qs = qs.filter(status=txn_status)
        else:
            status_qs = qs
        success_qs = qs.filter(status='success')
        failed_qs = qs.filter(status='failed')
        amount = success_qs.aggregate(t=Sum(amount_field))['t'] or _ZERO
        s_count = success_qs.count()
        f_count = failed_qs.count()
        t_count = status_qs.count() if txn_status not in ('all', '', None) else qs.count()
        total_amount += amount
        success_count += s_count
        failed_count += f_count
        txn_count += t_count
        by_service[key] = {
            'txn_type': key,
            'sales': _money_str(amount),
            'success_count': s_count,
            'failed_count': f_count,
            'count': t_count,
        }
    return {
        'sales': total_amount,
        'success_count': success_count,
        'failed_count': failed_count,
        'txn_count': txn_count,
        'by_service': by_service,
    }


def commission_for_dealer(
    dealer,
    start=None,
    end=None,
    *,
    sub_agent=None,
    txn_type=None,
    status='posted',
) -> dict:
    qs = DealerCommission.objects.filter(dealer=dealer)
    if sub_agent is not None:
        qs = qs.filter(sub_agent=sub_agent)
    if txn_type:
        qs = qs.filter(txn_type=txn_type)
    if status and status not in ('all', ''):
        qs = qs.filter(status=status)
    qs = _apply_date(qs, start, end)
    posted = qs if status not in ('all', '') else qs.filter(status=DealerCommission.STATUS_POSTED)
    agg = posted.aggregate(
        sales=Sum('txn_amount'),
        gross=Sum('gross_commission'),
        tds=Sum('tds_amount'),
        net=Sum('net_commission'),
        sub=Sum('sub_agent_commission'),
        profit=Sum('super_admin_profit'),
        count=Count('id'),
    )
    by_service = []
    for row in (
        posted.values('txn_type')
        .annotate(
            sales=Sum('txn_amount'),
            gross=Sum('gross_commission'),
            tds=Sum('tds_amount'),
            net=Sum('net_commission'),
            sub=Sum('sub_agent_commission'),
            profit=Sum('super_admin_profit'),
            count=Count('id'),
        )
        .order_by('txn_type')
    ):
        by_service.append({
            'txn_type': row['txn_type'],
            'count': row['count'],
            'sales': _money_str(row['sales']),
            'gross_commission': _money_str(row['gross']),
            'tds_amount': _money_str(row['tds']),
            'net_commission': _money_str(row['net']),
            'sub_agent_commission': _money_str(row['sub']),
            'super_admin_profit': _money_str(row['profit']),
        })
    return {
        'count': agg['count'] or 0,
        'sales': _money(agg['sales']),
        'gross_commission': _money(agg['gross']),
        'tds_amount': _money(agg['tds']),
        'net_commission': _money(agg['net']),
        'sub_agent_commission': _money(agg['sub']),
        'super_admin_profit': _money(agg['profit']),
        'by_service': by_service,
    }


def _display_name(user) -> str:
    if user is None:
        return ''
    name = f'{getattr(user, "first_name", "")} {getattr(user, "last_name", "")}'.strip()
    return name or (user.phone or '')


def _user_status(user) -> dict:
    wallet = getattr(user, 'wallet', None)
    return {
        'id': user.pk,
        'phone': user.phone,
        'name': _display_name(user),
        'email': user.email or '',
        'role': user.role,
        'account_status': user.account_status,
        'is_active': user.is_active,
        'wallet_balance': _money_str(wallet.balance if wallet else 0),
        'wallet_id': wallet.id if wallet else None,
        'wallet_frozen': bool(wallet and wallet.is_frozen),
        'wallet_status': 'frozen' if wallet and wallet.is_frozen else 'unfrozen',
    }


def dealer_dashboard_payload(actor) -> dict:
    today = timezone.localdate()
    dealer = resolve_assigned_dealer(actor) if not is_admin_actor(actor) else None
    if getattr(actor, 'role', None) == ROLE_DEALER:
        dealer = actor
    user_ids = network_user_ids(actor, dealer=dealer)
    if getattr(actor, 'role', None) == ROLE_SUB_AGENT:
        user_ids = list(
            User.objects.filter(Q(pk=actor.pk) | Q(assigned_sub_agent=actor)).values_list('id', flat=True)
        )
        dealer = resolve_assigned_dealer(actor)

    wallet = getattr(actor, 'wallet', None)
    today_sales = sales_for_users(user_ids, today, today)
    all_sales = sales_for_users(user_ids)

    comm_qs = DealerCommission.objects.filter(status=DealerCommission.STATUS_POSTED)
    if dealer is not None:
        comm_qs = comm_qs.filter(dealer=dealer)
    if getattr(actor, 'role', None) == ROLE_SUB_AGENT:
        comm_qs = comm_qs.filter(sub_agent=actor)
    today_comm = comm_qs.filter(created_at__date=today).aggregate(
        gross=Sum('gross_commission'),
        net=Sum('net_commission'),
        tds=Sum('tds_amount'),
        sub=Sum('sub_agent_commission'),
        profit=Sum('super_admin_profit'),
    )
    total_comm = comm_qs.aggregate(
        gross=Sum('gross_commission'),
        net=Sum('net_commission'),
        tds=Sum('tds_amount'),
        sub=Sum('sub_agent_commission'),
        profit=Sum('super_admin_profit'),
    )

    customers = User.objects.filter(id__in=user_ids, role=ROLE_CUSTOMER)
    downline = User.objects.filter(id__in=user_ids, role__in=DOWNLINE_ROLES).exclude(pk=actor.pk)

    recent = list(
        comm_qs.select_related('dealer', 'source_user', 'sub_agent').order_by('-created_at')[:10]
    )
    return {
        'role': getattr(actor, 'role', None),
        'wallet_balance': _money_str(wallet.balance if wallet else 0),
        'wallet_frozen': bool(wallet and wallet.is_frozen),
        'today_sales': _money_str(today_sales['sales']),
        'today_txn_count': today_sales['txn_count'],
        'today_commission': _money_str(
            today_comm['sub'] if getattr(actor, 'role', None) == ROLE_SUB_AGENT else today_comm['net']
        ),
        'today_gross_commission': _money_str(today_comm['gross']),
        'total_commission': _money_str(
            total_comm['sub'] if getattr(actor, 'role', None) == ROLE_SUB_AGENT else total_comm['net']
        ),
        'total_gross_commission': _money_str(total_comm['gross']),
        'total_tds': _money_str(total_comm['tds']),
        'total_customers': customers.count(),
        'total_sub_agents': downline.count(),
        'total_sales': _money_str(all_sales['sales']),
        'success_count': all_sales['success_count'],
        'failed_count': all_sales['failed_count'],
        'super_admin_profit_today': _money_str(today_comm['profit']),
        'super_admin_profit_total': _money_str(total_comm['profit']),
        'recent_commissions': recent,
    }


def admin_network_kpis() -> dict:
    today = timezone.localdate()
    posted = DealerCommission.objects.filter(status=DealerCommission.STATUS_POSTED)
    today_posted = posted.filter(created_at__date=today)
    return {
        'total_dealers': User.objects.filter(role=ROLE_DEALER).count(),
        'total_sub_agents': User.objects.filter(role__in=DOWNLINE_ROLES).count(),
        'total_customers': User.objects.filter(role=ROLE_CUSTOMER).count(),
        'today_sales': _money_str(today_posted.aggregate(t=Sum('txn_amount'))['t']),
        'dealer_commission_today': _money_str(today_posted.aggregate(t=Sum('net_commission'))['t']),
        'dealer_commission_total': _money_str(posted.aggregate(t=Sum('net_commission'))['t']),
        'tds_today': _money_str(today_posted.aggregate(t=Sum('tds_amount'))['t']),
        'tds_total': _money_str(posted.aggregate(t=Sum('tds_amount'))['t']),
        'super_admin_profit_today': _money_str(today_posted.aggregate(t=Sum('super_admin_profit'))['t']),
        'super_admin_profit_total': _money_str(posted.aggregate(t=Sum('super_admin_profit'))['t']),
    }


def hierarchy_tree(start=None, end=None) -> list[dict]:
    dealers = (
        User.objects.filter(role=ROLE_DEALER)
        .select_related('wallet', 'dealer_commission_config')
        .order_by('first_name', 'last_name', 'phone')
    )
    nodes = []
    for dealer in dealers:
        user_ids = network_user_ids(dealer, dealer=dealer)
        sales = sales_for_users(user_ids, start, end)
        comm = commission_for_dealer(dealer, start, end)
        downline = (
            User.objects.filter(assigned_dealer=dealer, role__in=DOWNLINE_ROLES)
            .select_related('wallet', 'parent_agent')
            .order_by('role', 'first_name', 'phone')
        )
        children = []
        for sub in downline:
            sub_ids = list(
                User.objects.filter(
                    Q(pk=sub.pk)
                    | Q(assigned_sub_agent=sub)
                    | Q(parent_agent=sub)
                ).values_list('id', flat=True)
            )
            sub_sales = sales_for_users(sub_ids, start, end)
            sub_comm = commission_for_dealer(dealer, start, end, sub_agent=sub)
            children.append({
                **_user_status(sub),
                'parent_agent_id': sub.parent_agent_id,
                'customer_count': User.objects.filter(
                    Q(assigned_sub_agent=sub) | Q(parent_agent=sub),
                    role=ROLE_CUSTOMER,
                ).count(),
                'transaction_count': sub_sales['success_count'],
                'sales': _money_str(sub_sales['sales']),
                'commission': _money_str(sub_comm['sub_agent_commission'] or sub_comm['net_commission']),
                'gross_commission': _money_str(sub_comm['gross_commission']),
            })
        nodes.append({
            **_user_status(dealer),
            'customer_count': User.objects.filter(assigned_dealer=dealer, role=ROLE_CUSTOMER).count(),
            'sub_agent_count': downline.count(),
            'transaction_count': sales['success_count'],
            'sales': _money_str(sales['sales']),
            'gross_commission': _money_str(comm['gross_commission']),
            'tds_amount': _money_str(comm['tds_amount']),
            'net_commission': _money_str(comm['net_commission']),
            'super_admin_profit': _money_str(comm['super_admin_profit']),
            'commission_rate': (
                str(dealer.dealer_commission_config.commission_rate)
                if getattr(dealer, 'dealer_commission_config', None) else None
            ),
            'tds_rate': (
                None if getattr(dealer, 'dealer_commission_config', None) is None
                or dealer.dealer_commission_config.tds_rate is None
                else str(dealer.dealer_commission_config.tds_rate)
            ),
            'sub_agents': children,
        })
    return nodes


def dealer_profit_rows(start=None, end=None, dealer=None, sub_agent=None, txn_type=None, status='posted') -> list[dict]:
    qs = User.objects.filter(role=ROLE_DEALER).select_related('wallet')
    if dealer is not None:
        qs = qs.filter(pk=dealer.pk)
    rows = []
    for item in qs.order_by('first_name', 'phone'):
        comm = commission_for_dealer(
            item, start, end, sub_agent=sub_agent, txn_type=txn_type, status=status,
        )
        user_ids = network_user_ids(item, dealer=item)
        sales = sales_for_users(user_ids, start, end, txn_type=txn_type)
        rows.append({
            **_user_status(item),
            'sales': _money_str(sales['sales']),
            'success_count': sales['success_count'],
            'failed_count': sales['failed_count'],
            'commission_count': comm['count'],
            'gross_commission': _money_str(comm['gross_commission']),
            'tds_amount': _money_str(comm['tds_amount']),
            'net_commission': _money_str(comm['net_commission']),
            'sub_agent_commission': _money_str(comm['sub_agent_commission']),
            'super_admin_profit': _money_str(comm['super_admin_profit']),
            'by_service': comm['by_service'],
        })
    return rows


def downline_performance(dealer, start=None, end=None) -> list[dict]:
    downline = (
        User.objects.filter(assigned_dealer=dealer, role__in=DOWNLINE_ROLES)
        .select_related('wallet')
        .order_by('role', 'phone')
    )
    rows = []
    for sub in downline:
        sub_ids = list(
            User.objects.filter(
                Q(pk=sub.pk) | Q(assigned_sub_agent=sub) | Q(parent_agent=sub)
            ).values_list('id', flat=True)
        )
        sales = sales_for_users(sub_ids, start, end)
        comm = commission_for_dealer(dealer, start, end, sub_agent=sub)
        rows.append({
            **_user_status(sub),
            'customer_count': User.objects.filter(
                Q(assigned_sub_agent=sub) | Q(parent_agent=sub),
                role=ROLE_CUSTOMER,
            ).count(),
            'sales': _money_str(sales['sales']),
            'success_count': sales['success_count'],
            'failed_count': sales['failed_count'],
            'commission': _money_str(comm['sub_agent_commission']),
            'gross_commission': _money_str(comm['gross_commission']),
        })
    return rows
