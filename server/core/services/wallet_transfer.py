"""
Atomic MySewa wallet-to-wallet debit/credit used by user transfers and Dealer push balance.
"""
from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from ..models import Wallet, WalletTransfer, BankTransferTransaction, _ensure_wallet_transfer_table

User = get_user_model()
_PHONE_DIGITS_RE = re.compile(r'\D+')

logger = logging.getLogger(__name__)


def get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def normalize_nepal_mobile(raw: str) -> str:
    digits = _PHONE_DIGITS_RE.sub('', raw or '')
    if digits.startswith('977') and len(digits) >= 13:
        digits = digits[-10:]
    elif digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    return digits


def lookup_active_user(raw: str):
    """Resolve a MySewa user by phone, email, or numeric user id."""
    stripped = (raw or '').strip()
    if not stripped:
        return None

    phone = normalize_nepal_mobile(stripped)
    if phone:
        user = User.objects.filter(phone=phone, is_active=True).first()
        if user:
            return user
        if stripped != phone:
            user = User.objects.filter(phone=stripped, is_active=True).first()
            if user:
                return user

    if '@' in stripped:
        user = User.objects.filter(email__iexact=stripped, is_active=True).first()
        if user:
            return user

    if stripped.isdigit():
        return User.objects.filter(pk=int(stripped), is_active=True).first()
    return None


def check_daily_transfer_limit(user, amount: Decimal) -> Response | None:
    from .app_config import get_app_config

    tx_cfg = get_app_config().get('transactions') or {}
    daily_limit = Decimal(str(tx_cfg.get('daily_transfer_limit') or 0))
    if daily_limit <= 0:
        return None
    today = timezone.localdate()
    bank_used = (
        BankTransferTransaction.objects.filter(
            user=user,
            created_at__date=today,
        )
        .exclude(status='failed')
        .aggregate(total=Sum('amount'))['total']
        or Decimal('0.00')
    )
    wallet_used = (
        WalletTransfer.objects.filter(
            sender=user,
            created_at__date=today,
        )
        .exclude(status='failed')
        .aggregate(total=Sum('amount'))['total']
        or Decimal('0.00')
    )
    used = bank_used + wallet_used
    if used + amount > daily_limit:
        return Response(
            {
                'error': 'Daily transfer limit exceeded',
                'message': (
                    f'Daily transfer limit is Rs. {daily_limit}. '
                    f'You have already transferred Rs. {used} today.'
                ),
                'code': 'daily_limit_exceeded',
                'daily_limit': str(daily_limit),
                'used_today': str(used),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def perform_wallet_transfer(
    *,
    sender,
    recipient,
    amount: Decimal,
    remarks: str = '',
    apply_charges: bool = True,
    source: str = WalletTransfer.SOURCE_APP,
    client_reference: str = '',
) -> tuple[WalletTransfer | None, Response | None]:
    """Debit sender and credit recipient. Returns (transfer, None) or (None, error Response).

    When apply_charges is True (User-initiated transfers), System / Dealer / HimalPay
    charges are added to the sender debit. The recipient still receives ``amount``.
    Dealer push-balance should pass apply_charges=False.
    """
    _ensure_wallet_transfer_table()
    amount = Decimal(amount).quantize(Decimal('0.01'))
    remarks = (remarks or '').strip()

    from .txn_charges import (
        TXN_WALLET_TRANSFER,
        persist_transaction_charge,
        quote_charges,
        visible_fee_extra,
    )

    if apply_charges:
        quote = quote_charges(amount, TXN_WALLET_TRANSFER, sender)
    else:
        quote = {
            'amount': amount,
            'service_charge': Decimal('0.00'),
            'system_charge': Decimal('0.00'),
            'dealer_commission': Decimal('0.00'),
            'himalpay_charge': Decimal('0.00'),
            'total_charges': Decimal('0.00'),
            'cashback': Decimal('0.00'),
            'provider_cashback': Decimal('0.00'),
            'direction': 'debit',
            'wallet_amount': amount,
            'dealer': None,
            'dealer_id': None,
            'txn_type': TXN_WALLET_TRANSFER,
            'visible_charge': Decimal('0.00'),
        }
    total_required = quote['wallet_amount']

    sender_wallet = get_or_create_wallet(sender)
    recipient_wallet = get_or_create_wallet(recipient)

    from .wallet_guard import (
        WALLET_FROZEN_MESSAGE,
        WalletBalanceMismatchError,
        WalletFrozenError,
        assert_wallet_not_frozen,
        frozen_response,
    )

    try:
        with transaction.atomic():
            first_id, second_id = sorted([sender_wallet.pk, recipient_wallet.pk])
            Wallet.objects.select_for_update().get(pk=first_id)
            if second_id != first_id:
                Wallet.objects.select_for_update().get(pk=second_id)
            sender_locked = Wallet.objects.get(pk=sender_wallet.pk)
            recipient_locked = Wallet.objects.get(pk=recipient_wallet.pk)

            if sender_locked.balance < total_required:
                return None, Response(
                    {
                        'error': 'Insufficient balance',
                        'message': (
                            f'Insufficient MySewa business wallet balance. '
                            f'Need Rs. {total_required}, have Rs. {sender_locked.balance}.'
                        ),
                        'required': str(total_required),
                        'available': str(sender_locked.balance),
                        'charge': str(quote['total_charges']),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                assert_wallet_not_frozen(sender_locked)
                assert_wallet_not_frozen(recipient_locked)
            except WalletFrozenError as exc:
                return None, frozen_response(str(exc) or WALLET_FROZEN_MESSAGE)

            sender_before = sender_locked.balance
            recipient_before = recipient_locked.balance
            expected_sender = sender_before - total_required
            expected_recipient = recipient_before + amount
            sender_locked.balance = expected_sender
            recipient_locked.balance = expected_recipient
            sender_locked.save(update_fields=['balance', 'updated_at'])
            recipient_locked.save(update_fields=['balance', 'updated_at'])
            sender_locked.refresh_from_db(fields=['balance'])
            recipient_locked.refresh_from_db(fields=['balance'])
            if sender_locked.balance != expected_sender or recipient_locked.balance != expected_recipient:
                raise WalletBalanceMismatchError(
                    f'{expected_sender}/{expected_recipient}',
                    f'{sender_locked.balance}/{recipient_locked.balance}',
                )

            transfer = WalletTransfer.objects.create(
                sender=sender,
                recipient=recipient,
                amount=amount,
                remarks=remarks,
                source=source or WalletTransfer.SOURCE_APP,
                client_reference=(client_reference or '').strip(),
                status='success',
                reference=f'MYSEWA_WT_{uuid.uuid4().hex[:14].upper()}',
                sender_balance_before=sender_before,
                sender_balance_after=sender_locked.balance,
                recipient_balance_before=recipient_before,
                recipient_balance_after=recipient_locked.balance,
                charge=visible_fee_extra(quote) if apply_charges else Decimal('0.00'),
                total_debited=total_required,
            )
            persist_transaction_charge(transfer, quote)
            if apply_charges:
                from .txn_status import settle_posted_charges
                settle_posted_charges(transfer, wallet=sender_locked)
    except Wallet.DoesNotExist:
        return None, Response(
            {'error': 'Wallet not found', 'message': 'Wallet not found.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    except WalletFrozenError as exc:
        return None, frozen_response(str(exc) or WALLET_FROZEN_MESSAGE)
    except WalletBalanceMismatchError as exc:
        return None, Response(
            {
                'error': 'Wallet update failed',
                'message': str(exc),
                'code': 'wallet_balance_mismatch',
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return transfer, None
