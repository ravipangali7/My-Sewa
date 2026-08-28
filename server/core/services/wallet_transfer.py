"""
Atomic MySewa wallet-to-wallet debit/credit used by user transfers and Dealer push balance.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from ..models import Wallet, WalletTransfer, _ensure_wallet_transfer_table

logger = logging.getLogger(__name__)


def get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def perform_wallet_transfer(
    *,
    sender,
    recipient,
    amount: Decimal,
    remarks: str = '',
    apply_charges: bool = True,
) -> tuple[WalletTransfer | None, Response | None]:
    """Debit sender and credit recipient. Returns (transfer, None) or (None, error Response).

    When apply_charges is True (User-initiated transfers), System / Dealer / HimalPay
    charges are added to the sender debit. The recipient still receives ``amount``.
    Dealer push-balance should pass apply_charges=False.
    """
    _ensure_wallet_transfer_table()
    amount = Decimal(amount).quantize(Decimal('0.01'))
    remarks = (remarks or '').strip()

    from .txn_charges import TXN_WALLET_TRANSFER, persist_transaction_charge, quote_charges
    from .dealer_commission import record_dealer_commission

    if apply_charges:
        quote = quote_charges(amount, TXN_WALLET_TRANSFER, sender)
    else:
        quote = {
            'amount': amount,
            'system_charge': Decimal('0.00'),
            'dealer_commission': Decimal('0.00'),
            'himalpay_charge': Decimal('0.00'),
            'total_charges': Decimal('0.00'),
            'cashback': Decimal('0.00'),
            'direction': 'debit',
            'wallet_amount': amount,
            'dealer': None,
            'dealer_id': None,
            'txn_type': TXN_WALLET_TRANSFER,
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
                status='success',
                reference=f'MYSEWA_WT_{uuid.uuid4().hex[:14].upper()}',
                sender_balance_before=sender_before,
                sender_balance_after=sender_locked.balance,
                recipient_balance_before=recipient_before,
                recipient_balance_after=recipient_locked.balance,
                charge=quote['total_charges'],
                total_debited=total_required,
            )
            persist_transaction_charge(transfer, quote)
            if apply_charges:
                record_dealer_commission(transfer)
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
