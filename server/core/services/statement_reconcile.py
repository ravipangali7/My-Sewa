"""
Compare HimalPay reseller statement entries against MySewa transactions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ..models import (
    BankTransferTransaction,
    CommunityElectricityTransaction,
    DataPackTransaction,
    InternetBillTransaction,
    RemittanceTransaction,
    StatementDiscrepancy,
    StatementReconcileRun,
    TopupTransaction,
    WaterBillTransaction,
)
from .himalpay import HimalPayAPI, HimalPayError

logger = logging.getLogger(__name__)

MONEY_TOLERANCE = Decimal('0.05')
MAX_STATEMENT_SPAN_DAYS = 62  # HimalPay allows at most ~2 months

TXN_MODELS = (
    (StatementDiscrepancy.TXN_TOPUP, TopupTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_DATA_PACK, DataPackTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_INTERNET, InternetBillTransaction, 'service_hub_txn_id'),
    (StatementDiscrepancy.TXN_WATER, WaterBillTransaction, 'service_hub_txn_id'),
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
    ids = {str(x).strip() for x in provider_ids if str(x).strip()}
    indexed: Dict[str, LocalTxn] = {}

    for txn_type, model, provider_field in TXN_MODELS:
        q = Q(**{f'{provider_field}__in': ids}) if ids else Q(pk__in=[])
        q = q | Q(created_at__date__gte=from_date, created_at__date__lte=to_date)
        qs = model.objects.select_related('user').filter(q)
        for obj in qs:
            provider_id = str(getattr(obj, provider_field, None) or '').strip()
            if not provider_id:
                continue
            indexed[provider_id] = LocalTxn(txn_type=txn_type, obj=obj, provider_id=provider_id)
    return indexed


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
                f'HimalPay credited Rs. {net} but MySewa wallet was not credited.'
            )
        return 'debit', net, (
            f'HimalPay debited Rs. {net} but MySewa wallet was not debited.'
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
    )
    api = himalpay or HimalPayAPI()

    try:
        entries = api.get_reseller_statement(
            from_date=from_date.isoformat(),
            to_date=to_date.isoformat(),
        )
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
        run.save(update_fields=['status', 'error_message', 'finished_at'])
        raise


def default_reconcile_dates(day: Optional[date] = None) -> Tuple[date, date]:
    day = day or timezone.localdate()
    return day, day
