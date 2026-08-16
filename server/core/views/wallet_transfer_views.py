"""
Instant MySewa wallet-to-wallet transfers between registered users.
"""
from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Wallet, WalletTransfer, BankTransferTransaction
from ..serializers import (
    WalletTransferSerializer,
    WalletTransferLookupSerializer,
    WalletTransferCreateSerializer,
    _user_display_name,
)
from ..services.app_config import (
    get_app_config,
    require_user_feature,
    require_account_approved,
    require_wallet_not_blocked,
)
from ..services.list_response import items_with_stats_response
from ..services.notifications import notify_low_balance_if_needed, notify_wallet_transfer
from ..services.pin import transaction_pin_gate

logger = logging.getLogger(__name__)
User = get_user_model()

_PHONE_DIGITS_RE = re.compile(r'\D+')


def normalize_nepal_mobile(raw: str) -> str:
    digits = _PHONE_DIGITS_RE.sub('', raw or '')
    if digits.startswith('977') and len(digits) >= 13:
        digits = digits[-10:]
    elif digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    return digits


def lookup_active_user_by_phone(raw: str):
    phone = normalize_nepal_mobile(raw)
    if not phone:
        return None
    user = User.objects.filter(phone=phone, is_active=True).first()
    if user:
        return user
    stripped = (raw or '').strip()
    if stripped and stripped != phone:
        return User.objects.filter(phone=stripped, is_active=True).first()
    return None


def _get_or_create_wallet(user):
    try:
        return Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Wallet.objects.create(user=user, balance=Decimal('0.00'))


def _wallet_transfers_qs(user):
    return (
        WalletTransfer.objects.filter(Q(sender=user) | Q(recipient=user))
        .select_related('sender', 'recipient')
        .order_by('-created_at')
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lookup_wallet_transfer_recipient(request):
    """Resolve a MySewa user by phone before sending a wallet transfer."""
    blocked = require_user_feature(request.user, 'wallet_adjustment')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = WalletTransferLookupSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {'error': 'Validation failed', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    raw_phone = serializer.validated_data['phone']
    recipient = lookup_active_user_by_phone(raw_phone)
    if recipient is None:
        return Response(
            {
                'error': 'User not found',
                'message': 'No MySewa user was found with that phone number.',
                'code': 'recipient_not_found',
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    if recipient.pk == request.user.pk:
        return Response(
            {
                'error': 'Invalid recipient',
                'message': 'You cannot transfer to your own wallet.',
                'code': 'self_transfer',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(
        {
            'phone': recipient.phone,
            'name': _user_display_name(recipient),
            'business_name': (getattr(recipient, 'business_name', None) or '').strip(),
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_wallet_transfer(request):
    """Debit the sender and credit another MySewa user instantly."""
    blocked = require_user_feature(request.user, 'wallet_adjustment')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return locked

    serializer = WalletTransferCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    data = serializer.validated_data
    amount = Decimal(data['amount']).quantize(Decimal('0.01'))
    remarks = (data.get('remarks') or '').strip()
    recipient = lookup_active_user_by_phone(data['recipient_phone'])
    if recipient is None:
        return Response(
            {
                'error': 'User not found',
                'message': 'No MySewa user was found with that phone number.',
                'code': 'recipient_not_found',
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    if recipient.pk == request.user.pk:
        return Response(
            {
                'error': 'Invalid recipient',
                'message': 'You cannot transfer to your own wallet.',
                'code': 'self_transfer',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    tx_cfg = get_app_config().get('transactions') or {}
    daily_limit = Decimal(str(tx_cfg.get('daily_transfer_limit') or 0))
    if daily_limit > 0:
        today = timezone.localdate()
        bank_used = (
            BankTransferTransaction.objects.filter(
                user=request.user,
                created_at__date=today,
            )
            .exclude(status='failed')
            .aggregate(total=Sum('amount'))['total']
            or Decimal('0.00')
        )
        wallet_used = (
            WalletTransfer.objects.filter(
                sender=request.user,
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
                    'daily_limit': str(daily_limit),
                    'used_today': str(used),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    sender_wallet = _get_or_create_wallet(request.user)
    recipient_wallet = _get_or_create_wallet(recipient)

    try:
        with transaction.atomic():
            first_id, second_id = sorted([sender_wallet.pk, recipient_wallet.pk])
            Wallet.objects.select_for_update().get(pk=first_id)
            if second_id != first_id:
                Wallet.objects.select_for_update().get(pk=second_id)
            sender_locked = Wallet.objects.get(pk=sender_wallet.pk)
            recipient_locked = Wallet.objects.get(pk=recipient_wallet.pk)

            if sender_locked.balance < amount:
                return Response(
                    {
                        'error': 'Insufficient balance',
                        'message': (
                            f'Insufficient MySewa business wallet balance. '
                            f'Need Rs. {amount}, have Rs. {sender_locked.balance}.'
                        ),
                        'required': str(amount),
                        'available': str(sender_locked.balance),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            sender_before = sender_locked.balance
            recipient_before = recipient_locked.balance
            sender_locked.balance = sender_before - amount
            recipient_locked.balance = recipient_before + amount
            sender_locked.save(update_fields=['balance', 'updated_at'])
            recipient_locked.save(update_fields=['balance', 'updated_at'])

            transfer = WalletTransfer.objects.create(
                sender=request.user,
                recipient=recipient,
                amount=amount,
                remarks=remarks,
                status='success',
                reference=f'MYSEWA_WT_{uuid.uuid4().hex[:14].upper()}',
                sender_balance_before=sender_before,
                sender_balance_after=sender_locked.balance,
                recipient_balance_before=recipient_before,
                recipient_balance_after=recipient_locked.balance,
            )
    except Wallet.DoesNotExist:
        return Response(
            {'error': 'Wallet not found', 'message': 'Wallet not found.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        notify_wallet_transfer(transfer)
    except Exception:
        logger.exception('Wallet transfer notification failed for %s', transfer.reference)
    try:
        notify_low_balance_if_needed(sender_locked)
    except Exception:
        logger.exception('Low-balance check failed after wallet transfer %s', transfer.pk)

    return Response(
        {
            'message': 'Wallet transfer completed',
            'data': WalletTransferSerializer(
                transfer, context={'viewer': request.user, 'request': request},
            ).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def wallet_transfer_history(request):
    return items_with_stats_response(
        _wallet_transfers_qs(request.user),
        WalletTransferSerializer,
        request,
        search_fields=(
            'reference',
            'remarks',
            'sender__phone',
            'recipient__phone',
            'sender__first_name',
            'sender__last_name',
            'recipient__first_name',
            'recipient__last_name',
        ),
        serializer_context={'viewer': request.user},
    )
