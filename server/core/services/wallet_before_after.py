"""
Detect user-wallet before/after mismatches and apply atomic Issue Share corrections.

A mismatch is when a successful wallet-moving transaction recorded an amount
but `balance_after` did not equal `balance_before ± amount` (e.g. Rs. 100
deducted on the txn while both before and after still show Rs. 1,000).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.db import IntegrityError, OperationalError, ProgrammingError, transaction
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
    TopupTransaction,
    Wallet,
    WalletAdjustment,
    WalletBalanceIssue,
    WalletTransfer,
    WaterBillTransaction,
)

logger = logging.getLogger(__name__)

MONEY_TOLERANCE = Decimal('0.01')
CORRECTION_REF_PREFIX = 'BA-ISSUE-'


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal('0.00')


def _optional_money(value) -> Optional[Decimal]:
    if value is None or value == '':
        return None
    try:
        return _money(value)
    except Exception:
        return None


def _fingerprint(txn_type: str, txn_id: int, party: str = '') -> str:
    party = (party or '').strip()
    if party:
        return f'{txn_type}:{txn_id}:{party}'
    return f'{txn_type}:{txn_id}'


@dataclass
class WalletEvent:
    user_id: int
    txn_type: str
    txn_id: int
    party: str
    created_at: datetime
    amount: Decimal
    signed: Decimal
    direction: str
    balance_before: Optional[Decimal]
    balance_after: Optional[Decimal]
    reference: str
    status: str
    service_name: str
    description: str
    snapshot: Dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        return _fingerprint(self.txn_type, self.txn_id, self.party)

    @property
    def expected_after(self) -> Optional[Decimal]:
        if self.balance_before is None:
            return None
        return _money(self.balance_before + self.signed)


def _safe_qs(model, **filters):
    try:
        qs = model.objects.filter(**filters).select_related('user', 'user__wallet')
        qs.exists()
        return qs
    except (OperationalError, ProgrammingError):
        return model.objects.none()


def _safe_transfer_qs(**filters):
    try:
        qs = WalletTransfer.objects.filter(**filters).select_related(
            'sender', 'sender__wallet', 'recipient', 'recipient__wallet',
        )
        qs.exists()
        return qs
    except (OperationalError, ProgrammingError):
        return WalletTransfer.objects.none()


def _ref(*parts) -> str:
    for part in parts:
        text = (str(part) if part is not None else '').strip()
        if text:
            return text[:120]
    return ''


def _product_label(obj) -> str:
    try:
        return obj.get_product_id_display()
    except Exception:
        return ''


def _apply_date_range(qs, from_date: Optional[date], to_date: Optional[date]):
    if from_date:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date:
        qs = qs.filter(created_at__date__lte=to_date)
    return qs


def _iter_debit_events(
    model,
    txn_type: str,
    *,
    from_date: Optional[date],
    to_date: Optional[date],
    user_id: Optional[int],
    service_name: str,
    describe,
) -> Iterable[WalletEvent]:
    filters: Dict[str, Any] = {'status': 'success'}
    if user_id:
        filters['user_id'] = user_id
    qs = _apply_date_range(_safe_qs(model, **filters), from_date, to_date)
    for obj in qs.iterator():
        amount = _money(getattr(obj, 'total_debited', None) or obj.amount or 0)
        if amount <= 0:
            continue
        yield WalletEvent(
            user_id=obj.user_id,
            txn_type=txn_type,
            txn_id=obj.pk,
            party='',
            created_at=obj.created_at,
            amount=amount,
            signed=-amount,
            direction=WalletBalanceIssue.DIRECTION_DEBIT,
            balance_before=_optional_money(getattr(obj, 'balance_before', None)),
            balance_after=_optional_money(getattr(obj, 'balance_after', None)),
            reference=_ref(
                getattr(obj, 'merchant_txn_id', None),
                getattr(obj, 'service_hub_txn_id', None),
                getattr(obj, 'provider_txn_id', None),
                getattr(obj, 'reference_id', None),
                f'{txn_type}-{obj.pk}',
            ),
            status=obj.status,
            service_name=service_name,
            description=describe(obj),
            snapshot={
                'merchant_txn_id': getattr(obj, 'merchant_txn_id', '') or '',
                'provider_txn_id': getattr(obj, 'provider_txn_id', '') or '',
                'service_hub_txn_id': getattr(obj, 'service_hub_txn_id', '') or '',
                'reference_id': getattr(obj, 'reference_id', '') or '',
                'amount': str(_money(obj.amount)),
                'charge': str(_money(getattr(obj, 'charge', 0))),
                'total_debited': str(amount),
            },
        )


def collect_wallet_events(
    *,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    user_id: Optional[int] = None,
) -> List[WalletEvent]:
    events: List[WalletEvent] = []

    debit_sources = (
        (
            TopupTransaction,
            WalletBalanceIssue.TXN_TOPUP,
            'Mobile top-up',
            lambda o: (
                f"Mobile top-up to {o.mobile_number}"
                + (f" ({_product_label(o)})" if _product_label(o) else '')
            ),
        ),
        (
            DataPackTransaction,
            WalletBalanceIssue.TXN_DATA_PACK,
            'Data pack',
            lambda o: f"Data pack {getattr(o, 'package_name', '') or o.operator} {o.mobile_number}".strip(),
        ),
        (
            InternetBillTransaction,
            WalletBalanceIssue.TXN_INTERNET,
            'Internet bill',
            lambda o: f"Internet bill {o.isp_name} {o.customer_id}".strip(),
        ),
        (
            WaterBillTransaction,
            WalletBalanceIssue.TXN_WATER,
            'Water bill',
            lambda o: f"Water bill {o.connection_no}/{o.customer_code}".strip(),
        ),
        (
            ElectricityBillTransaction,
            WalletBalanceIssue.TXN_ELECTRICITY,
            'Electricity bill',
            lambda o: f"Electricity bill {getattr(o, 'consumer_id', '') or ''}".strip(),
        ),
        (
            CommunityElectricityTransaction,
            WalletBalanceIssue.TXN_COMMUNITY_ELECTRICITY,
            'Community electricity',
            lambda o: f"Community electricity {o.platform_name} {o.customer_ref}".strip(),
        ),
        (
            BankTransferTransaction,
            WalletBalanceIssue.TXN_BANK_TRANSFER,
            'Bank transfer',
            lambda o: (
                f"Bank transfer to {getattr(o, 'destination_acc_name', '') or ''} "
                f"{getattr(o, 'destination_acc_no', '') or ''}"
            ).strip(),
        ),
    )
    for model, txn_type, service, describe in debit_sources:
        events.extend(
            _iter_debit_events(
                model,
                txn_type,
                from_date=from_date,
                to_date=to_date,
                user_id=user_id,
                service_name=service,
                describe=describe,
            )
        )

    remit_filters: Dict[str, Any] = {'status': 'success'}
    if user_id:
        remit_filters['user_id'] = user_id
    for obj in _apply_date_range(_safe_qs(RemittanceTransaction, **remit_filters), from_date, to_date).iterator():
        amount = _money(getattr(obj, 'total_credited', None) or obj.amount or 0)
        if amount <= 0:
            continue
        events.append(WalletEvent(
            user_id=obj.user_id,
            txn_type=WalletBalanceIssue.TXN_REMITTANCE,
            txn_id=obj.pk,
            party='',
            created_at=obj.created_at,
            amount=amount,
            signed=amount,
            direction=WalletBalanceIssue.DIRECTION_CREDIT,
            balance_before=_optional_money(obj.balance_before),
            balance_after=_optional_money(obj.balance_after),
            reference=_ref(obj.merchant_txn_id, obj.ref_no, getattr(obj, 'reference_id', None), f'remittance-{obj.pk}'),
            status=obj.status,
            service_name='Remittance',
            description=f"Remittance {obj.ref_no or ''}".strip(),
            snapshot={
                'merchant_txn_id': obj.merchant_txn_id or '',
                'ref_no': obj.ref_no or '',
                'amount': str(_money(obj.amount)),
                'total_credited': str(amount),
            },
        ))

    deposit_filters: Dict[str, Any] = {'status': 'approved'}
    if user_id:
        deposit_filters['user_id'] = user_id
    for obj in _apply_date_range(_safe_qs(Deposit, **deposit_filters), from_date, to_date).iterator():
        amount = _money(obj.amount)
        if amount <= 0:
            continue
        events.append(WalletEvent(
            user_id=obj.user_id,
            txn_type=WalletBalanceIssue.TXN_DEPOSIT,
            txn_id=obj.pk,
            party='',
            created_at=obj.created_at,
            amount=amount,
            signed=amount,
            direction=WalletBalanceIssue.DIRECTION_CREDIT,
            balance_before=_optional_money(obj.balance_before),
            balance_after=_optional_money(obj.balance_after),
            reference=_ref(obj.transaction_id, f'deposit-{obj.pk}'),
            status=obj.status,
            service_name='Deposit',
            description=(obj.note or 'Wallet deposit').strip()[:500],
            snapshot={
                'transaction_id': obj.transaction_id or '',
                'amount': str(amount),
            },
        ))

    adj_filters: Dict[str, Any] = {}
    if user_id:
        adj_filters['user_id'] = user_id
    for obj in _apply_date_range(_safe_qs(WalletAdjustment, **adj_filters), from_date, to_date).iterator():
        signed = _money(obj.amount)
        if signed == 0:
            continue
        events.append(WalletEvent(
            user_id=obj.user_id,
            txn_type=WalletBalanceIssue.TXN_WALLET_ADJUSTMENT,
            txn_id=obj.pk,
            party='',
            created_at=obj.created_at,
            amount=_money(abs(signed)),
            signed=signed,
            direction=(
                WalletBalanceIssue.DIRECTION_CREDIT
                if signed > 0
                else WalletBalanceIssue.DIRECTION_DEBIT
            ),
            balance_before=_optional_money(obj.balance_before),
            balance_after=_optional_money(obj.balance_after),
            reference=_ref(obj.reference, f'adjustment-{obj.pk}'),
            status='success',
            service_name='Wallet adjustment',
            description=(obj.reason or 'Wallet adjustment').strip()[:500],
            snapshot={
                'reference': obj.reference or '',
                'adjustment_type': obj.adjustment_type,
                'amount': str(signed),
            },
        ))

    transfer_q = Q()
    if user_id:
        transfer_q = Q(sender_id=user_id) | Q(recipient_id=user_id)
    transfers = _apply_date_range(
        _safe_transfer_qs(status='success').filter(transfer_q),
        from_date,
        to_date,
    )
    for obj in transfers.iterator():
        debit_amount = _money(obj.total_debited or obj.amount)
        credit_amount = _money(obj.amount)
        sender_desc = (
            f"Wallet transfer to {obj.recipient.phone}"
            + (f" ({(obj.remarks or '').strip()})" if (obj.remarks or '').strip() else '')
        )
        recipient_desc = (
            f"Wallet transfer from {obj.sender.phone}"
            + (f" ({(obj.remarks or '').strip()})" if (obj.remarks or '').strip() else '')
        )
        if not user_id or obj.sender_id == user_id:
            events.append(WalletEvent(
                user_id=obj.sender_id,
                txn_type=WalletBalanceIssue.TXN_WALLET_TRANSFER,
                txn_id=obj.pk,
                party='sender',
                created_at=obj.created_at,
                amount=debit_amount,
                signed=-debit_amount,
                direction=WalletBalanceIssue.DIRECTION_DEBIT,
                balance_before=_optional_money(obj.sender_balance_before),
                balance_after=_optional_money(obj.sender_balance_after),
                reference=_ref(obj.reference, f'transfer-{obj.pk}'),
                status=obj.status,
                service_name='Wallet transfer',
                description=sender_desc,
                snapshot={
                    'reference': obj.reference or '',
                    'party': 'sender',
                    'amount': str(_money(obj.amount)),
                    'charge': str(_money(obj.charge)),
                    'total_debited': str(debit_amount),
                    'counterparty': obj.recipient.phone,
                },
            ))
        if not user_id or obj.recipient_id == user_id:
            events.append(WalletEvent(
                user_id=obj.recipient_id,
                txn_type=WalletBalanceIssue.TXN_WALLET_TRANSFER,
                txn_id=obj.pk,
                party='recipient',
                created_at=obj.created_at,
                amount=credit_amount,
                signed=credit_amount,
                direction=WalletBalanceIssue.DIRECTION_CREDIT,
                balance_before=_optional_money(obj.recipient_balance_before),
                balance_after=_optional_money(obj.recipient_balance_after),
                reference=_ref(obj.reference, f'transfer-{obj.pk}'),
                status=obj.status,
                service_name='Wallet transfer',
                description=recipient_desc,
                snapshot={
                    'reference': obj.reference or '',
                    'party': 'recipient',
                    'amount': str(credit_amount),
                    'counterparty': obj.sender.phone,
                },
            ))

    events.sort(key=lambda e: (e.created_at, e.txn_type, e.txn_id, e.party))
    return events


def event_is_mismatch(event: WalletEvent) -> bool:
    if event.balance_before is None or event.balance_after is None:
        return False
    if event.amount <= 0:
        return False
    expected = event.expected_after
    if expected is None:
        return False
    return abs(_money(event.balance_after) - expected) > MONEY_TOLERANCE


def reconstruct_expected_balance(user_id: int) -> Optional[Decimal]:
    """Replay signed amounts from the first known before-balance."""
    events = collect_wallet_events(user_id=user_id)
    if not events:
        return None
    start_idx = next(
        (i for i, e in enumerate(events) if e.balance_before is not None),
        None,
    )
    if start_idx is None:
        return None
    running = _money(events[start_idx].balance_before)
    for event in events[start_idx:]:
        running = _money(running + event.signed)
    return running


def _clamp_same_sign(gap: Decimal, remaining: Optional[Decimal]) -> Decimal:
    gap = _money(gap)
    if gap == 0:
        return Decimal('0.00')
    if remaining is None:
        return gap
    remaining = _money(remaining)
    if remaining == 0:
        return Decimal('0.00')
    if (gap > 0) != (remaining > 0):
        return Decimal('0.00')
    if abs(gap) <= abs(remaining):
        return gap
    return remaining


def _issue_reason(event: WalletEvent) -> str:
    verb = 'deducted' if event.direction == WalletBalanceIssue.DIRECTION_DEBIT else 'credited'
    return (
        f'Transaction of Rs. {event.amount} was {verb} on {event.service_name} '
        f'({event.reference or event.fingerprint}) but the stored after-balance '
        f'({event.balance_after}) did not match the expected balance '
        f'({event.expected_after}). Before: {event.balance_before}.'
    )


def _suggested_for(event: WalletEvent) -> Tuple[str, Decimal]:
    gap = _money(event.expected_after - event.balance_after)
    if gap > 0:
        return 'credit', gap
    if gap < 0:
        return 'debit', abs(gap)
    return '', Decimal('0.00')


def _current_wallet_balance(user_id: int, cache: Dict[int, Decimal]) -> Decimal:
    if user_id not in cache:
        try:
            cache[user_id] = _money(Wallet.objects.get(user_id=user_id).balance)
        except Wallet.DoesNotExist:
            cache[user_id] = Decimal('0.00')
    return cache[user_id]


def scan_wallet_before_after(
    *,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    user_id: Optional[int] = None,
) -> Dict[str, int]:
    """
    Scan wallet-moving records and persist new open issues.
    Existing resolved/ignored fingerprints are never reopened.
    """
    events = collect_wallet_events(from_date=from_date, to_date=to_date, user_id=user_id)
    mismatches = [e for e in events if event_is_mismatch(e)]
    fingerprints = [e.fingerprint for e in mismatches]
    existing = {
        row.fingerprint: row
        for row in WalletBalanceIssue.objects.filter(fingerprint__in=fingerprints)
    } if fingerprints else {}

    wallet_cache: Dict[int, Decimal] = {}
    created = 0
    updated = 0
    skipped = 0

    for event in mismatches:
        current = _current_wallet_balance(event.user_id, wallet_cache)
        adj_type, adj_amount = _suggested_for(event)
        payload = dict(
            user_id=event.user_id,
            txn_type=event.txn_type,
            txn_id=event.txn_id,
            party=event.party,
            direction=event.direction,
            amount=event.amount,
            balance_before=event.balance_before,
            recorded_balance_after=event.balance_after,
            expected_balance_after=event.expected_after,
            current_wallet_balance=current,
            txn_at=event.created_at,
            txn_reference=event.reference,
            txn_status=event.status,
            service_name=event.service_name,
            description=event.description[:2000],
            txn_snapshot=event.snapshot,
            suggested_adjustment_type=adj_type,
            suggested_amount=adj_amount if adj_amount > 0 else None,
            reason=_issue_reason(event),
        )
        row = existing.get(event.fingerprint)
        if row is None:
            try:
                with transaction.atomic():
                    WalletBalanceIssue.objects.create(fingerprint=event.fingerprint, **payload)
                created += 1
            except IntegrityError:
                skipped += 1
            continue
        if row.status != WalletBalanceIssue.STATUS_OPEN:
            skipped += 1
            continue
        for key, value in payload.items():
            setattr(row, key, value)
        row.save()
        updated += 1

    open_count = WalletBalanceIssue.objects.filter(status=WalletBalanceIssue.STATUS_OPEN)
    if user_id:
        open_count = open_count.filter(user_id=user_id)
    return {
        'scanned': len(events),
        'mismatches': len(mismatches),
        'created': created,
        'updated': updated,
        'skipped': skipped,
        'open': open_count.count(),
    }


class IssueShareError(ValueError):
    """Raised when Issue Share cannot proceed (duplicate, missing user, etc.)."""


def share_wallet_balance_issue(issue_id: int, admin_user) -> Tuple[WalletBalanceIssue, Optional[WalletAdjustment]]:
    """
    Confirm an open before/after issue: adjust the wallet if needed, write a
    ledger row, record who confirmed, and email the user.

    Wallet + issue + adjustment are committed atomically. Email is best-effort
    after that commit so a mail failure cannot duplicate or roll back money.
    """
    from .notifications import notify_wallet_before_after_correction

    with transaction.atomic():
        try:
            issue = (
                WalletBalanceIssue.objects
                .select_for_update()
                .select_related('user', 'user__wallet', 'resolution_adjustment')
                .get(pk=issue_id)
            )
        except WalletBalanceIssue.DoesNotExist as exc:
            raise IssueShareError('Issue not found') from exc

        if issue.status != WalletBalanceIssue.STATUS_OPEN:
            raise IssueShareError('This issue was already confirmed or closed.')
        if WalletBalanceIssue.objects.filter(
            fingerprint=issue.fingerprint,
            status=WalletBalanceIssue.STATUS_RESOLVED,
        ).exclude(pk=issue.pk).exists():
            raise IssueShareError('A correction for this transaction already exists.')

        try:
            wallet = Wallet.objects.select_for_update().select_related('user').get(user_id=issue.user_id)
        except Wallet.DoesNotExist as exc:
            raise IssueShareError('User wallet not found') from exc

        snapshot_gap = _money(issue.expected_balance_after - issue.recorded_balance_after)
        remaining = None
        reconstructed = reconstruct_expected_balance(issue.user_id)
        if reconstructed is not None:
            remaining = _money(reconstructed - wallet.balance)
        apply_delta = _clamp_same_sign(snapshot_gap, remaining)

        now = timezone.now()
        adj = None
        balance_before = _money(wallet.balance)
        balance_after = balance_before

        if apply_delta != 0:
            balance_after = _money(balance_before + apply_delta)
            if balance_after < 0:
                raise IssueShareError('Correction would make the wallet balance negative.')
            reference = f'{CORRECTION_REF_PREFIX}{issue.pk}'
            if WalletAdjustment.objects.filter(reference=reference).exists():
                raise IssueShareError('A wallet correction for this issue already exists.')
            wallet.balance = balance_after
            wallet.save(update_fields=['balance', 'updated_at'])
            adj_type = 'credit' if apply_delta > 0 else 'debit'
            reason = (
                f'Before/after wallet correction for {issue.get_txn_type_display()} '
                f'{issue.txn_reference or issue.fingerprint}. {issue.reason}'
            )[:2000]
            try:
                adj = WalletAdjustment.objects.create(
                    wallet=wallet,
                    user=wallet.user,
                    amount=apply_delta,
                    adjustment_type=adj_type,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    reason=reason,
                    created_by=admin_user,
                    reference=reference,
                )
            except IntegrityError as exc:
                raise IssueShareError('A wallet correction for this issue already exists.') from exc

        issue.status = WalletBalanceIssue.STATUS_RESOLVED
        issue.shared_by = admin_user
        issue.shared_at = now
        issue.resolved_by = admin_user
        issue.resolved_at = now
        issue.resolution_adjustment = adj
        issue.current_wallet_balance = balance_after
        issue.save(update_fields=[
            'status', 'shared_by', 'shared_at', 'resolved_by', 'resolved_at',
            'resolution_adjustment', 'current_wallet_balance', 'updated_at',
        ])

        email_ctx = {
            'issue_id': issue.pk,
            'user_id': issue.user_id,
            'applied': apply_delta != 0,
            'balance_before': str(issue.balance_before),
            'recorded_after': str(issue.recorded_balance_after),
            'expected_after': str(issue.expected_balance_after),
            'corrected_balance': str(balance_after),
            'amount': str(issue.amount),
            'direction': issue.direction,
            'txn_at': issue.txn_at,
            'txn_reference': issue.txn_reference,
            'service_name': issue.service_name,
            'description': issue.description,
            'txn_type_display': issue.get_txn_type_display(),
        }

    sent = False
    if email_ctx['applied']:
        try:
            sent = bool(notify_wallet_before_after_correction(issue.user, email_ctx))
        except Exception:
            logger.exception(
                'Failed to email wallet before/after correction for issue %s', issue.pk,
            )
        if sent:
            WalletBalanceIssue.objects.filter(pk=issue.pk).update(
                email_sent_at=timezone.now(),
            )

    issue = (
        WalletBalanceIssue.objects
        .select_related('user', 'shared_by', 'resolved_by', 'resolution_adjustment')
        .get(pk=issue.pk)
    )
    return issue, adj
