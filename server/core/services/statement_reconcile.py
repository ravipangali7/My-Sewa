"""
Compare HimalPay reseller statement entries against MySewa transactions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ..models import (
    BankTransferTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    Deposit,
    ElectricityBillTransaction,
    InternetBillTransaction,
    RemittanceTransaction,
    StatementDiscrepancy,
    StatementReconcileRun,
    TopupTransaction,
    WalletAdjustment,
    WaterBillTransaction,
)
from .himalpay import HimalPayAPI, HimalPayError, is_route_not_found_error

logger = logging.getLogger(__name__)

MONEY_TOLERANCE = Decimal('0.05')
MAX_STATEMENT_SPAN_DAYS = 62  # HimalPay allows at most ~2 months

TXN_MODELS = (
    (StatementDiscrepancy.TXN_TOPUP, TopupTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_DATA_PACK, DataPackTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_INTERNET, InternetBillTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_WATER, WaterBillTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_ELECTRICITY, ElectricityBillTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_COMMUNITY_ELECTRICITY, CommunityElectricityTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_BANK_TRANSFER, BankTransferTransaction, 'provider_txn_id'),
    (StatementDiscrepancy.TXN_REMITTANCE, RemittanceTransaction, 'provider_txn_id'),
)


@dataclass
class LocalTxn:
    txn_type: str
    obj: Any
    provider_id: str


@dataclass
class GroupedHpTxn:
    transaction_uuid: str
    entries: List[Dict[str, Any]]
    direction: str
    status: str
    wallet_service_name: str
    principal_amount: Decimal
    charge: Decimal
    cashback: Decimal
    net_amount: Decimal
    reference_id: str
    created_at: Optional[str]
    snapshot: Dict[str, Any]


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal('0.00')


def _approx_equal(a: Decimal, b: Decimal, tol: Decimal = MONEY_TOLERANCE) -> bool:
    return abs(_money(a) - _money(b)) <= tol


def clamp_date_range(from_date: date, to_date: date) -> Tuple[date, date]:
    if to_date < from_date:
        from_date, to_date = to_date, from_date
    max_end = from_date + timedelta(days=MAX_STATEMENT_SPAN_DAYS)
    if to_date > max_end:
        to_date = max_end
    return from_date, to_date


def _group_statement_entries(entries: Iterable[Dict[str, Any]]) -> Dict[str, GroupedHpTxn]:
    by_uuid: Dict[str, List[Dict[str, Any]]] = {}
    for raw in entries:
        if not isinstance(raw, dict):
            continue
        uuid = str(raw.get('transaction_uuid') or '').strip()
        if not uuid:
            continue
        by_uuid.setdefault(uuid, []).append(raw)

    grouped: Dict[str, GroupedHpTxn] = {}
    for uuid, rows in by_uuid.items():
        principal = next(
            (
                r for r in rows
                if not r.get('is_charge') and not r.get('is_cashback') and not r.get('is_refund')
            ),
            rows[0],
        )
        direction = str(principal.get('direction') or '').lower()
        status = str(principal.get('status') or '').upper()
        service = str(principal.get('wallet_service_name') or '')
        amount = HimalPayAPI.to_rupees(principal.get('amount') or 0)
        charge = HimalPayAPI.to_rupees(
            principal.get('transaction_charge')
            or next((r.get('amount') for r in rows if r.get('is_charge')), 0)
            or 0
        )
        cashback = HimalPayAPI.to_rupees(
            principal.get('transaction_cashback')
            or next((r.get('amount') for r in rows if r.get('is_cashback')), 0)
            or 0
        )
        if direction == 'credit':
            net = amount - charge + cashback
        else:
            net = amount + charge - cashback
            direction = direction or 'debit'

        grouped[uuid] = GroupedHpTxn(
            transaction_uuid=uuid,
            entries=rows,
            direction=direction,
            status=status,
            wallet_service_name=service,
            principal_amount=_money(amount),
            charge=_money(charge),
            cashback=_money(cashback),
            net_amount=_money(net),
            reference_id=str(principal.get('reference_id') or ''),
            created_at=str(principal.get('created_at') or '') or None,
            snapshot={
                'entries': rows,
                'direction': direction,
                'status': status,
                'wallet_service_name': service,
                'principal_amount': str(_money(amount)),
                'charge': str(_money(charge)),
                'cashback': str(_money(cashback)),
                'net_amount': str(_money(net)),
            },
        )
    return grouped


def _index_local_txns(
    from_date: date,
    to_date: date,
    provider_ids: Iterable[str],
) -> Dict[str, LocalTxn]:
    """
    Index all MySewa HimalPay-linked transactions in range (and any matching
    provider ids). Rows without a provider UUID are kept under a synthetic key
    so they still appear on the ledger and are not silently dropped.
    """
    ids = {str(x).strip() for x in provider_ids if str(x).strip()}
    indexed: Dict[str, LocalTxn] = {}

    for txn_type, model, provider_field in TXN_MODELS:
        q = Q(**{f'{provider_field}__in': ids}) if ids else Q(pk__in=[])
        q = q | Q(created_at__date__gte=from_date, created_at__date__lte=to_date)
        qs = model.objects.select_related('user').filter(q)
        for obj in qs:
            provider_id = str(getattr(obj, provider_field, None) or '').strip()
            if not provider_id:
                provider_id = f'local:{txn_type}:{obj.pk}'
            # Prefer a real provider id if we already indexed a synthetic key for
            # the same object (should not happen); real UUID wins on collision.
            if provider_id in indexed and provider_id.startswith('local:'):
                continue
            indexed[provider_id] = LocalTxn(
                txn_type=txn_type, obj=obj, provider_id=provider_id,
            )
    return indexed


def _collect_hp_entries_for_range(from_date: date, to_date: date) -> List[Dict[str, Any]]:
    """Merge HimalPay statement logs from all successful runs overlapping the range."""
    runs = (
        StatementReconcileRun.objects
        .filter(
            status=StatementReconcileRun.STATUS_SUCCESS,
            from_date__lte=to_date,
            to_date__gte=from_date,
        )
        .order_by('-created_at')
    )
    seen: set = set()
    entries: List[Dict[str, Any]] = []
    for run in runs:
        logs = run.himalpay_statement_logs
        if not isinstance(logs, list):
            continue
        for row in logs:
            if not isinstance(row, dict):
                continue
            key = (
                str(row.get('transaction_uuid') or ''),
                str(row.get('created_at') or ''),
                str(row.get('amount') or ''),
                str(row.get('direction') or ''),
                bool(row.get('is_charge')),
                bool(row.get('is_cashback')),
            )
            if key in seen:
                continue
            seen.add(key)
            entries.append(row)
    return entries


def _local_net_amount(local: LocalTxn) -> Decimal:
    obj = local.obj
    if local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
        return _money(getattr(obj, 'total_credited', None) or getattr(obj, 'amount', 0))
    return _money(getattr(obj, 'total_debited', None) or getattr(obj, 'amount', 0))


def _wallet_applied(local: LocalTxn) -> bool:
    obj = local.obj
    if local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
        return bool(getattr(obj, 'wallet_credited', False))
    return (
        getattr(obj, 'balance_before', None) is not None
        and getattr(obj, 'balance_after', None) is not None
    )


def _map_hp_status(hp_status: str) -> str:
    status = (hp_status or '').upper()
    if status == 'SUCCESS':
        return 'success'
    if status == 'FAILED':
        return 'failed'
    return 'pending'


def _build_entries_via_status_checks(
    api: HimalPayAPI,
    from_date: date,
    to_date: date,
) -> List[Dict[str, Any]]:
    """
    LIVE fallback when HimalPay statement routes are missing.

    Builds synthetic statement rows from local merchant_txn_id status polls so
    reconcile can still detect status/amount/wallet mismatches.
    Cannot detect provider-only (missing local) rows without a real ledger.
    """
    local_index = _index_local_txns(from_date, to_date, [])
    entries: List[Dict[str, Any]] = []

    for local in local_index.values():
        merchant_id = str(getattr(local.obj, 'merchant_txn_id', None) or '').strip()
        if not merchant_id:
            continue
        try:
            result = api.check_transaction_status(merchant_id)
        except HimalPayError as exc:
            logger.warning(
                'Status check failed for %s during statement fallback: %s',
                merchant_id,
                exc,
            )
            continue
        if not isinstance(result, dict):
            continue

        status = str(result.get('status') or '').upper() or 'UNKNOWN'
        txn_uuid = (
            api.extract_transaction_id(result)
            or local.provider_id
            or merchant_id
        )
        if local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
            direction = 'credit'
            amount_paisa = result.get('total_credited')
            if amount_paisa is None:
                amount_paisa = result.get('amount')
            if amount_paisa is None:
                amount_paisa = api.to_paisa(_local_net_amount(local))
        else:
            direction = 'debit'
            amount_paisa = result.get('total_debited')
            if amount_paisa is None:
                amount_paisa = result.get('amount')
            if amount_paisa is None:
                amount_paisa = api.to_paisa(_local_net_amount(local))

        charge = int(result.get('charge') or 0)
        cashback = int(result.get('cashback') or 0)
        # Prefer principal amount when net was returned as total_debited/credited.
        principal = result.get('amount')
        if principal is None:
            if direction == 'debit':
                principal = max(int(amount_paisa) - charge + cashback, 0)
            else:
                principal = max(int(amount_paisa) + charge - cashback, 0)

        entries.append({
            'direction': direction,
            'amount': int(principal),
            'is_refund': False,
            'is_cashback': False,
            'is_charge': False,
            'reference_id': api.extract_reference_id(result),
            'created_at': str(result.get('created_at') or '') or None,
            'transaction_uuid': str(txn_uuid).strip(),
            'status': status,
            'wallet_service_name': str(
                result.get('wallet_service_name')
                or getattr(local.obj, 'wallet_service_name', None)
                or getattr(local.obj, 'product_name', None)
                or ''
            ),
            'transaction_cashback': cashback,
            'transaction_charge': charge,
            '_fallback': 'status_check',
            '_merchant_txn_id': merchant_id,
        })

    logger.info(
        'Built %s synthetic HimalPay statement entries via status checks (%s → %s)',
        len(entries),
        from_date,
        to_date,
    )
    return entries


def _suggest_for_issue(
    issue_type: str,
    hp: Optional[GroupedHpTxn],
    local: Optional[LocalTxn],
) -> Tuple[str, Optional[Decimal], str]:
    """
    Return (adjustment_type, amount, reason).
    Suggested fix always targets the MySewa user wallet.
    """
    if local is None or hp is None:
        return '', None, ''

    local_status = getattr(local.obj, 'status', '')
    expected_status = _map_hp_status(hp.status)
    net = hp.net_amount

    if issue_type == StatementDiscrepancy.ISSUE_WALLET_NOT_APPLIED:
        if hp.direction == 'credit' or local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
            return 'credit', net, (
                f'HimalPay credited Rs. {net} but MySewa business wallet was not credited.'
            )
        return 'debit', net, (
            f'HimalPay debited Rs. {net} but MySewa business wallet was not debited.'
        )

    if issue_type == StatementDiscrepancy.ISSUE_STATUS_MISMATCH:
        # HP success + local not success → apply wallet movement MySewa missed
        if expected_status == 'success' and local_status != 'success':
            if hp.direction == 'credit' or local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
                return 'credit', net, (
                    f'HimalPay SUCCESS credit Rs. {net}; MySewa status is {local_status}.'
                )
            return 'debit', net, (
                f'HimalPay SUCCESS debit Rs. {net}; MySewa status is {local_status}.'
            )
        # HP failed/unknown + local success → reverse wallet
        if expected_status != 'success' and local_status == 'success':
            if local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
                return 'debit', _local_net_amount(local), (
                    f'MySewa remittance success but HimalPay status is {hp.status}; reverse credit.'
                )
            return 'credit', _local_net_amount(local), (
                f'MySewa debit success but HimalPay status is {hp.status}; refund user.'
            )

    if issue_type == StatementDiscrepancy.ISSUE_AMOUNT_MISMATCH:
        local_net = _local_net_amount(local)
        delta = _money(net - local_net)
        if delta == 0:
            return '', None, f'Amount mismatch between HimalPay ({net}) and MySewa ({local_net}).'
        if local.txn_type == StatementDiscrepancy.TXN_REMITTANCE:
            # Positive delta => HP credited more than local → credit user
            if delta > 0:
                return 'credit', abs(delta), (
                    f'Remittance amount short by Rs. {abs(delta)} vs HimalPay.'
                )
            return 'debit', abs(delta), (
                f'Remittance over-credited by Rs. {abs(delta)} vs HimalPay.'
            )
        # Outbound: positive delta => HP took more → debit user more
        if delta > 0:
            return 'debit', abs(delta), (
                f'User under-debited by Rs. {abs(delta)} vs HimalPay.'
            )
        return 'credit', abs(delta), (
            f'User over-debited by Rs. {abs(delta)} vs HimalPay.'
        )

    return '', None, ''


def _open_key(transaction_uuid: str, merchant_txn_id: str, issue_type: str) -> str:
    return f'{transaction_uuid}|{merchant_txn_id}|{issue_type}'


def _build_issue(
    *,
    run: StatementReconcileRun,
    issue_type: str,
    hp: Optional[GroupedHpTxn],
    local: Optional[LocalTxn],
) -> Dict[str, Any]:
    adj_type, adj_amount, reason = _suggest_for_issue(issue_type, hp, local)
    if not reason:
        if issue_type == StatementDiscrepancy.ISSUE_MISSING_LOCAL and hp:
            reason = (
                f'HimalPay {hp.status} {hp.direction} Rs. {hp.net_amount} '
                f'({hp.wallet_service_name}) has no matching MySewa transaction.'
            )
        elif issue_type == StatementDiscrepancy.ISSUE_MISSING_PROVIDER and local:
            reason = (
                f'MySewa {local.txn_type} #{local.obj.pk} status={local.obj.status} '
                f'has no HimalPay statement entry for {local.provider_id}.'
            )
        else:
            reason = issue_type.replace('_', ' ')

    return {
        'run': run,
        'issue_type': issue_type,
        'transaction_uuid': hp.transaction_uuid if hp else (local.provider_id if local else ''),
        'merchant_txn_id': str(getattr(local.obj, 'merchant_txn_id', '') or '') if local else '',
        'wallet_service_name': hp.wallet_service_name if hp else '',
        'direction': hp.direction if hp else (
            'credit' if local and local.txn_type == StatementDiscrepancy.TXN_REMITTANCE else 'debit'
        ),
        'hp_status': hp.status if hp else '',
        'hp_amount': hp.principal_amount if hp else Decimal('0.00'),
        'hp_net_amount': hp.net_amount if hp else Decimal('0.00'),
        'local_status': str(getattr(local.obj, 'status', '') or '') if local else '',
        'local_amount': _local_net_amount(local) if local else None,
        'txn_type': local.txn_type if local else '',
        'txn_id': local.obj.pk if local else None,
        'user': getattr(local.obj, 'user', None) if local else None,
        'himalpay_snapshot': hp.snapshot if hp else {},
        'suggested_adjustment_type': adj_type,
        'suggested_amount': adj_amount,
        'reason': reason,
    }


def run_statement_reconcile(
    *,
    from_date: date,
    to_date: date,
    triggered_by: str = StatementReconcileRun.TRIGGER_ADMIN,
    triggered_by_user=None,
    himalpay: Optional[HimalPayAPI] = None,
) -> StatementReconcileRun:
    from_date, to_date = clamp_date_range(from_date, to_date)
    run = StatementReconcileRun.objects.create(
        from_date=from_date,
        to_date=to_date,
        triggered_by=triggered_by,
        triggered_by_user=triggered_by_user,
        status=StatementReconcileRun.STATUS_RUNNING,
        himalpay_statement_logs=[],
    )
    api = himalpay or HimalPayAPI()

    try:
        used_status_fallback = False
        try:
            entries = api.get_reseller_statement(
                from_date=from_date.isoformat(),
                to_date=to_date.isoformat(),
            )
        except HimalPayError as exc:
            if not is_route_not_found_error(exc.message, exc.status_code, exc.error_type):
                raise
            logger.warning(
                'HimalPay statement unavailable (%s); using status-check fallback',
                exc,
            )
            entries = _build_entries_via_status_checks(api, from_date, to_date)
            used_status_fallback = True

        try:
            balance = api.get_reseller_balance()
        except HimalPayError as exc:
            logger.warning('Could not fetch HimalPay reseller balance: %s', exc)
            balance = {}

        grouped = _group_statement_entries(entries)
        local_index = _index_local_txns(from_date, to_date, grouped.keys())

        found_issues: Dict[str, Dict[str, Any]] = {}
        matched = 0

        for uuid, hp in grouped.items():
            local = local_index.get(uuid)
            if local is None:
                # Only alert on successful HP money movement without a local match
                if hp.status == 'SUCCESS':
                    issue = _build_issue(
                        run=run,
                        issue_type=StatementDiscrepancy.ISSUE_MISSING_LOCAL,
                        hp=hp,
                        local=None,
                    )
                    found_issues[_open_key(uuid, '', issue['issue_type'])] = issue
                continue

            matched += 1
            local_status = str(getattr(local.obj, 'status', '') or '')
            expected = _map_hp_status(hp.status)

            if expected == 'success' and local_status != 'success':
                issue = _build_issue(
                    run=run,
                    issue_type=StatementDiscrepancy.ISSUE_STATUS_MISMATCH,
                    hp=hp,
                    local=local,
                )
                found_issues[_open_key(uuid, issue['merchant_txn_id'], issue['issue_type'])] = issue
            elif expected != 'success' and local_status == 'success':
                issue = _build_issue(
                    run=run,
                    issue_type=StatementDiscrepancy.ISSUE_STATUS_MISMATCH,
                    hp=hp,
                    local=local,
                )
                found_issues[_open_key(uuid, issue['merchant_txn_id'], issue['issue_type'])] = issue
            elif expected == 'success' and not _approx_equal(_local_net_amount(local), hp.net_amount):
                issue = _build_issue(
                    run=run,
                    issue_type=StatementDiscrepancy.ISSUE_AMOUNT_MISMATCH,
                    hp=hp,
                    local=local,
                )
                found_issues[_open_key(uuid, issue['merchant_txn_id'], issue['issue_type'])] = issue
            elif expected == 'success' and not _wallet_applied(local):
                issue = _build_issue(
                    run=run,
                    issue_type=StatementDiscrepancy.ISSUE_WALLET_NOT_APPLIED,
                    hp=hp,
                    local=local,
                )
                found_issues[_open_key(uuid, issue['merchant_txn_id'], issue['issue_type'])] = issue

        # Local success rows in range with provider id but no HP entry
        for provider_id, local in local_index.items():
            if provider_id in grouped:
                continue
            if str(getattr(local.obj, 'status', '')) != 'success':
                continue
            created = getattr(local.obj, 'created_at', None)
            if created is not None:
                local_day = timezone.localtime(created).date() if timezone.is_aware(created) else created.date()
                if local_day < from_date or local_day > to_date:
                    continue
            issue = _build_issue(
                run=run,
                issue_type=StatementDiscrepancy.ISSUE_MISSING_PROVIDER,
                hp=None,
                local=local,
            )
            found_issues[_open_key(provider_id, issue['merchant_txn_id'], issue['issue_type'])] = issue

        new_count = 0
        with transaction.atomic():
            existing_open = {
                _open_key(d.transaction_uuid, d.merchant_txn_id, d.issue_type): d
                for d in StatementDiscrepancy.objects.filter(status=StatementDiscrepancy.STATUS_OPEN)
            }

            still_open_keys = set(found_issues.keys())
            for key, payload in found_issues.items():
                current = existing_open.get(key)
                if current:
                    for field, value in payload.items():
                        if field == 'run':
                            continue
                        setattr(current, field, value)
                    current.run = run
                    current.save()
                else:
                    StatementDiscrepancy.objects.create(
                        status=StatementDiscrepancy.STATUS_OPEN,
                        **payload,
                    )
                    new_count += 1

            # Auto-resolve opens that are no longer present for UUIDs we re-checked
            checked_uuids = set(grouped.keys()) | {
                local.provider_id for local in local_index.values()
            }
            for key, disc in existing_open.items():
                if key in still_open_keys:
                    continue
                uuid = disc.transaction_uuid
                if uuid and uuid not in checked_uuids:
                    continue
                disc.status = StatementDiscrepancy.STATUS_RESOLVED
                disc.resolved_at = timezone.now()
                disc.reason = (disc.reason or '') + ' [auto-closed: matched on re-check]'
                disc.save(update_fields=['status', 'resolved_at', 'reason', 'updated_at'])

            open_count = StatementDiscrepancy.objects.filter(
                status=StatementDiscrepancy.STATUS_OPEN,
            ).count()

            run.hp_entries = len(grouped)
            run.matched = matched
            run.issues_open = open_count
            run.issues_new = new_count
            run.himalpay_statement_logs = [
                row for row in (entries or []) if isinstance(row, dict)
            ]
            if isinstance(balance, dict):
                bal = balance.get('balance')
                bonus = balance.get('bonus_balance')
                if bal is not None:
                    run.himalpay_balance_paisa = int(bal)
                if bonus is not None:
                    run.himalpay_bonus_balance_paisa = int(bonus)
                rupees = balance.get('balance_in_rupees')
                if rupees is None and bal is not None:
                    rupees = HimalPayAPI.to_rupees(bal)
                if rupees is not None:
                    run.himalpay_balance_rupees = _money(rupees)
            run.status = StatementReconcileRun.STATUS_SUCCESS
            if used_status_fallback:
                run.error_message = (
                    'Used status-check fallback (HimalPay reseller statement route unavailable on this host).'
                )
            run.finished_at = timezone.now()
            run.save()

        if new_count > 0:
            try:
                from .notifications import notify_statement_discrepancies
                notify_statement_discrepancies(run, new_count)
            except Exception:
                logger.exception('Failed to send statement discrepancy alert email')

        return run

    except Exception as exc:
        logger.exception('Statement reconcile failed')
        run.status = StatementReconcileRun.STATUS_FAILED
        run.error_message = str(exc)
        run.finished_at = timezone.now()
        if run.himalpay_statement_logs is None:
            run.himalpay_statement_logs = []
        run.save(update_fields=[
            'status', 'error_message', 'finished_at', 'himalpay_statement_logs',
        ])
        raise


def default_reconcile_dates(day: Optional[date] = None) -> Tuple[date, date]:
    day = day or timezone.localdate()
    return day, day


_TXN_TYPE_LABELS = {
    StatementDiscrepancy.TXN_TOPUP: 'Top-up',
    StatementDiscrepancy.TXN_DATA_PACK: 'Data pack',
    StatementDiscrepancy.TXN_INTERNET: 'Internet',
    StatementDiscrepancy.TXN_WATER: 'Water',
    StatementDiscrepancy.TXN_COMMUNITY_ELECTRICITY: 'Community electricity',
    StatementDiscrepancy.TXN_BANK_TRANSFER: 'Bank transfer',
    StatementDiscrepancy.TXN_REMITTANCE: 'Remittance',
}


def _user_display(user) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    if not user:
        return None, None, None
    name = f'{getattr(user, "first_name", "") or ""} {getattr(user, "last_name", "") or ""}'.strip()
    phone = getattr(user, 'phone', None)
    return getattr(user, 'pk', None), phone, (name or phone)


def _local_side(local: LocalTxn) -> Dict[str, Any]:
    obj = local.obj
    user = getattr(obj, 'user', None)
    user_id, user_phone, user_name = _user_display(user)
    created = getattr(obj, 'created_at', None)
    created_at = None
    if created is not None:
        created_at = (
            timezone.localtime(created).isoformat()
            if timezone.is_aware(created)
            else created.isoformat()
        )
    return {
        'txn_type': local.txn_type,
        'txn_type_display': _TXN_TYPE_LABELS.get(local.txn_type, local.txn_type),
        'txn_id': obj.pk,
        'merchant_txn_id': str(getattr(obj, 'merchant_txn_id', '') or ''),
        'provider_txn_id': local.provider_id,
        'status': str(getattr(obj, 'status', '') or ''),
        'amount': str(_local_net_amount(local)),
        'user_id': user_id,
        'user_phone': user_phone,
        'user_name': user_name,
        'created_at': created_at,
        'wallet_applied': _wallet_applied(local),
    }


def _hp_side(hp: GroupedHpTxn) -> Dict[str, Any]:
    return {
        'transaction_uuid': hp.transaction_uuid,
        'created_at': hp.created_at,
        'service': hp.wallet_service_name,
        'direction': hp.direction,
        'status': hp.status,
        'principal_amount': str(hp.principal_amount),
        'net_amount': str(hp.net_amount),
        'charge': str(hp.charge),
        'cashback': str(hp.cashback),
        'reference_id': hp.reference_id,
    }


def _match_state_for_pair(
    hp: Optional[GroupedHpTxn],
    local: Optional[LocalTxn],
) -> str:
    if hp is None and local is not None:
        return StatementDiscrepancy.ISSUE_MISSING_PROVIDER
    if local is None and hp is not None:
        return StatementDiscrepancy.ISSUE_MISSING_LOCAL
    if hp is None or local is None:
        return 'unmatched'

    local_status = str(getattr(local.obj, 'status', '') or '')
    expected = _map_hp_status(hp.status)
    if expected == 'success' and local_status != 'success':
        return StatementDiscrepancy.ISSUE_STATUS_MISMATCH
    if expected != 'success' and local_status == 'success':
        return StatementDiscrepancy.ISSUE_STATUS_MISMATCH
    if expected == 'success' and not _approx_equal(_local_net_amount(local), hp.net_amount):
        return StatementDiscrepancy.ISSUE_AMOUNT_MISMATCH
    if expected == 'success' and not _wallet_applied(local):
        return StatementDiscrepancy.ISSUE_WALLET_NOT_APPLIED
    return 'matched'


def build_statement_ledger(
    *,
    from_date: date,
    to_date: date,
    entries: Optional[List[Dict[str, Any]]] = None,
    run: Optional[StatementReconcileRun] = None,
) -> List[Dict[str, Any]]:
    """
    Build a dual-sided ledger: HimalPay on one side, MySewa on the other.

    Includes every MySewa transaction in the date range (HimalPay-linked services,
    deposits, and wallet adjustments) so nothing is dropped. When `entries` is
    omitted, HimalPay rows are merged from all successful runs overlapping the
    range (plus `run` if given).
    """
    from_date, to_date = clamp_date_range(from_date, to_date)
    if entries is None:
        entries = _collect_hp_entries_for_range(from_date, to_date)
        if run is not None and isinstance(run.himalpay_statement_logs, list):
            # Ensure the explicit run's logs are included even if status/dates differ
            extra = [
                row for row in run.himalpay_statement_logs
                if isinstance(row, dict)
            ]
            if extra:
                seen = {
                    (
                        str(r.get('transaction_uuid') or ''),
                        str(r.get('created_at') or ''),
                        str(r.get('amount') or ''),
                        str(r.get('direction') or ''),
                        bool(r.get('is_charge')),
                        bool(r.get('is_cashback')),
                    )
                    for r in entries
                }
                for row in extra:
                    key = (
                        str(row.get('transaction_uuid') or ''),
                        str(row.get('created_at') or ''),
                        str(row.get('amount') or ''),
                        str(row.get('direction') or ''),
                        bool(row.get('is_charge')),
                        bool(row.get('is_cashback')),
                    )
                    if key not in seen:
                        entries.append(row)
                        seen.add(key)
    entries = entries or []

    grouped = _group_statement_entries(entries)
    local_index = _index_local_txns(from_date, to_date, grouped.keys())

    open_discs = {
        (d.transaction_uuid or '', d.issue_type): d
        for d in StatementDiscrepancy.objects.filter(
            status=StatementDiscrepancy.STATUS_OPEN,
        ).select_related('user', 'resolution_adjustment')
    }
    open_by_uuid: Dict[str, StatementDiscrepancy] = {}
    for d in StatementDiscrepancy.objects.filter(
        status=StatementDiscrepancy.STATUS_OPEN,
    ).select_related('user', 'resolution_adjustment'):
        key = d.transaction_uuid or d.merchant_txn_id
        if key and key not in open_by_uuid:
            open_by_uuid[key] = d

    rows: List[Dict[str, Any]] = []
    seen_local: set = set()

    def _append_row(
        *,
        key: str,
        match_state: str,
        hp: Optional[GroupedHpTxn],
        local: Optional[LocalTxn],
        mysewa_override: Optional[Dict[str, Any]] = None,
        disc: Optional[StatementDiscrepancy] = None,
        reason_fallback: str = '',
    ):
        suggested_type, suggested_amount, suggested_reason = ('', None, '')
        if match_state not in ('matched', 'local_only') and local and hp:
            suggested_type, suggested_amount, suggested_reason = _suggest_for_issue(
                match_state, hp, local,
            )
        user = None
        if local:
            user = getattr(local.obj, 'user', None)
        elif mysewa_override:
            # user fields already on override
            pass
        elif disc:
            user = disc.user
        user_id, user_phone, user_name = _user_display(user)
        if mysewa_override and mysewa_override.get('user_id'):
            user_id = mysewa_override.get('user_id')
            user_phone = mysewa_override.get('user_phone')
            user_name = mysewa_override.get('user_name')

        can_solve = bool(
            disc
            and disc.status == StatementDiscrepancy.STATUS_OPEN
            and disc.user_id
            and disc.suggested_adjustment_type
            and disc.suggested_amount is not None
            and Decimal(str(disc.suggested_amount)) > 0
        )
        rows.append({
            'key': key,
            'match_state': match_state,
            'himalpay': _hp_side(hp) if hp else None,
            'mysewa': mysewa_override if mysewa_override is not None else (
                _local_side(local) if local else None
            ),
            'discrepancy_id': disc.pk if disc else None,
            'suggested_adjustment_type': (
                disc.suggested_adjustment_type if disc else suggested_type
            ),
            'suggested_amount': (
                str(disc.suggested_amount)
                if disc and disc.suggested_amount is not None
                else (str(suggested_amount) if suggested_amount is not None else None)
            ),
            'reason': (disc.reason if disc else (suggested_reason or reason_fallback)) or '',
            'can_solve': can_solve,
            'can_correct': bool(user_id),
            'user_id': user_id,
            'user_phone': user_phone,
            'user_name': user_name,
        })

    for uuid, hp in grouped.items():
        local = local_index.get(uuid)
        if local:
            seen_local.add(uuid)
        match_state = _match_state_for_pair(hp, local)
        disc = open_discs.get((uuid, match_state)) or open_by_uuid.get(uuid)
        _append_row(
            key=f'hp:{uuid}',
            match_state=match_state,
            hp=hp,
            local=local,
            disc=disc,
        )

    for provider_id, local in local_index.items():
        if provider_id in seen_local or provider_id in grouped:
            continue
        created = getattr(local.obj, 'created_at', None)
        if created is not None:
            local_day = (
                timezone.localtime(created).date()
                if timezone.is_aware(created)
                else created.date()
            )
            if local_day < from_date or local_day > to_date:
                continue
        is_synthetic = provider_id.startswith('local:')
        local_status = str(getattr(local.obj, 'status', '') or '')
        if is_synthetic and local_status != 'success':
            match_state = 'local_only'
        else:
            match_state = StatementDiscrepancy.ISSUE_MISSING_PROVIDER
        disc = open_discs.get((provider_id, match_state)) or open_by_uuid.get(provider_id)
        _append_row(
            key=f'local:{local.txn_type}:{local.obj.pk}',
            match_state=match_state,
            hp=None,
            local=local,
            disc=disc,
            reason_fallback=(
                f'MySewa {local.txn_type} #{local.obj.pk} has no HimalPay statement entry.'
                if match_state == StatementDiscrepancy.ISSUE_MISSING_PROVIDER
                else ''
            ),
        )

    # Deposits and wallet adjustments (MySewa-only; never on HimalPay reseller ledger)
    for dep in Deposit.objects.select_related('user').filter(
        created_at__date__gte=from_date,
        created_at__date__lte=to_date,
    ):
        user_id, user_phone, user_name = _user_display(dep.user)
        created = dep.created_at
        created_at = (
            timezone.localtime(created).isoformat()
            if created and timezone.is_aware(created)
            else (created.isoformat() if created else None)
        )
        _append_row(
            key=f'deposit:{dep.pk}',
            match_state='local_only',
            hp=None,
            local=None,
            mysewa_override={
                'txn_type': 'deposit',
                'txn_type_display': 'Deposit',
                'txn_id': dep.pk,
                'merchant_txn_id': str(dep.transaction_id or ''),
                'provider_txn_id': '',
                'status': dep.status,
                'amount': str(_money(dep.amount)),
                'user_id': user_id,
                'user_phone': user_phone,
                'user_name': user_name,
                'created_at': created_at,
                'wallet_applied': dep.status == 'approved',
            },
        )

    for adj in WalletAdjustment.objects.select_related('user').filter(
        created_at__date__gte=from_date,
        created_at__date__lte=to_date,
    ):
        user_id, user_phone, user_name = _user_display(adj.user)
        created = adj.created_at
        created_at = (
            timezone.localtime(created).isoformat()
            if created and timezone.is_aware(created)
            else (created.isoformat() if created else None)
        )
        _append_row(
            key=f'adjustment:{adj.pk}',
            match_state='local_only',
            hp=None,
            local=None,
            mysewa_override={
                'txn_type': 'wallet_adjustment',
                'txn_type_display': (
                    'Wallet credit' if adj.adjustment_type == 'credit' else 'Wallet debit'
                ),
                'txn_id': adj.pk,
                'merchant_txn_id': str(adj.reference or ''),
                'provider_txn_id': '',
                'status': 'success',
                'amount': str(_money(abs(adj.amount))),
                'user_id': user_id,
                'user_phone': user_phone,
                'user_name': user_name,
                'created_at': created_at,
                'wallet_applied': True,
            },
        )

    # Stable: sort by user then by date desc (most recent statement first)
    def _row_ts(r: Dict[str, Any]) -> float:
        raw = (
            (r.get('himalpay') or {}).get('created_at')
            or (r.get('mysewa') or {}).get('created_at')
            or ''
        )
        if not raw:
            return 0.0
        try:
            # Accept ISO strings with/without timezone.
            normalized = str(raw).replace('Z', '+00:00')
            return datetime.fromisoformat(normalized).timestamp()
        except (TypeError, ValueError):
            return 0.0

    by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        bucket = row.get('user_phone') or '__unmatched__'
        by_user.setdefault(bucket, []).append(row)
    ordered: List[Dict[str, Any]] = []
    for phone in sorted(by_user.keys(), key=lambda p: (p == '__unmatched__', p.lower())):
        bucket_rows = by_user[phone]
        bucket_rows.sort(key=_row_ts, reverse=True)
        ordered.extend(bucket_rows)
    return ordered


def group_ledger_by_user(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse flat ledger rows into per-user groups for the admin UI."""
    groups: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for row in rows:
        user_id = row.get('user_id')
        phone = row.get('user_phone') or (
            (row.get('mysewa') or {}).get('user_phone')
        )
        key = str(user_id) if user_id else (phone or '__unmatched__')
        if key not in groups:
            order.append(key)
            groups[key] = {
                'user_id': user_id,
                'user_phone': phone or row.get('user_phone'),
                'user_name': row.get('user_name') or (
                    (row.get('mysewa') or {}).get('user_name')
                ),
                'row_count': 0,
                'issue_count': 0,
                'rows': [],
            }
        groups[key]['rows'].append(row)
        groups[key]['row_count'] += 1
        if row.get('match_state') not in ('matched', 'local_only'):
            groups[key]['issue_count'] += 1

    def _group_latest_ts(g: Dict[str, Any]) -> float:
        best = 0.0
        for r in g.get('rows') or []:
            raw = (
                (r.get('himalpay') or {}).get('created_at')
                or (r.get('mysewa') or {}).get('created_at')
                or ''
            )
            if not raw:
                continue
            try:
                normalized = str(raw).replace('Z', '+00:00')
                best = max(best, datetime.fromisoformat(normalized).timestamp())
            except (TypeError, ValueError):
                continue
        return best

    # Newest activity first; unmatched HimalPay-only last
    order.sort(
        key=lambda k: (
            k == '__unmatched__',
            -_group_latest_ts(groups[k]),
            k,
        ),
    )
    return [groups[k] for k in order]


def ledger_from_latest_run(
    *,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> Tuple[Optional[StatementReconcileRun], List[Dict[str, Any]]]:
    """
    Load a full ledger for the requested window (defaults to latest run's dates,
    or today when no run exists yet — still returns MySewa-side rows).
    """
    qs = StatementReconcileRun.objects.filter(
        status=StatementReconcileRun.STATUS_SUCCESS,
    ).order_by('-created_at')
    today = timezone.localdate()
    if from_date and to_date:
        from_date, to_date = clamp_date_range(from_date, to_date)
    elif qs.exists():
        latest = qs.first()
        from_date = from_date or latest.from_date
        to_date = to_date or latest.to_date
    else:
        from_date = from_date or today
        to_date = to_date or today

    covering = qs.filter(from_date__lte=from_date, to_date__gte=to_date).first()
    run = covering or qs.filter(from_date=from_date, to_date=to_date).first() or qs.first()
    rows = build_statement_ledger(from_date=from_date, to_date=to_date, run=run)
    return run, rows


def _optional_paisa_rupees(value: Any) -> Optional[str]:
    if value is None or value == '':
        return None
    try:
        return str(HimalPayAPI.to_rupees(value))
    except Exception:
        try:
            return str(_money(value))
        except Exception:
            return None


def build_himalpay_history_items(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group raw HimalPay statement line items into wallet-history style rows.

    Principal / charge / cashback rows for the same UUID become one movement
    with before/after HimalPay float (rupees).
    """
    grouped = _group_statement_entries(entries)
    items: List[Dict[str, Any]] = []
    for uuid, hp in grouped.items():
        principal = next(
            (
                row for row in hp.entries
                if not row.get('is_charge')
                and not row.get('is_cashback')
                and not row.get('is_refund')
            ),
            hp.entries[0] if hp.entries else {},
        )
        if bool(principal.get('is_refund')):
            kind = 'refund'
        elif bool(principal.get('is_cashback')):
            kind = 'cashback'
        elif bool(principal.get('is_charge')):
            kind = 'charge'
        else:
            kind = 'transaction'
        items.append({
            'key': f'hp:{uuid}',
            'transaction_uuid': hp.transaction_uuid,
            'created_at': hp.created_at,
            'service': hp.wallet_service_name,
            'direction': hp.direction or 'debit',
            'status': hp.status,
            'kind': kind,
            'principal_amount': str(hp.principal_amount),
            'net_amount': str(hp.net_amount),
            'charge': str(hp.charge),
            'cashback': str(hp.cashback),
            'reference_id': hp.reference_id,
            'balance_before': _optional_paisa_rupees(principal.get('balance_before')),
            'balance_after': _optional_paisa_rupees(principal.get('balance_after')),
            'bonus_before': _optional_paisa_rupees(principal.get('bonus_balance_before')),
            'bonus_after': _optional_paisa_rupees(principal.get('bonus_balance_after')),
            'entry_count': len(hp.entries),
        })

    def _ts(item: Dict[str, Any]) -> str:
        return str(item.get('created_at') or '')

    items.sort(key=_ts, reverse=True)
    return items


def collect_himalpay_entries_for_range(from_date: date, to_date: date) -> List[Dict[str, Any]]:
    """Public wrapper used by the HimalPay history API when live fetch is unavailable."""
    return _collect_hp_entries_for_range(from_date, to_date)
