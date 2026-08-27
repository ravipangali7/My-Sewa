"""
Block outbound wallet payments when HimalPay already took money but MySewa did not.

Also schedules a background 1-day HimalPay statement recheck after each payment.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

from django.db import close_old_connections, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from ..models import Wallet

logger = logging.getLogger(__name__)

WALLET_BLOCKED_CODE = 'wallet_blocked'
WALLET_BLOCKED_MESSAGE = (
    'Your wallet is temporarily locked because a payment was taken by the provider '
    'but not recorded on MySewa. Please contact MySewa support. Only an admin can unlock it.'
)

WALLET_FROZEN_CODE = 'wallet_frozen'
WALLET_FROZEN_MESSAGE = 'Wallet is currently frozen. Transactions are not allowed.'


class WalletFrozenError(Exception):
    def __init__(self, message: str = WALLET_FROZEN_MESSAGE):
        super().__init__(message)
        self.message = message


class InsufficientWalletBalanceError(Exception):
    def __init__(self, required, available):
        self.required = required
        self.available = available
        super().__init__(
            f'Insufficient MySewa business wallet balance. '
            f'Need Rs. {required}, have Rs. {available}.'
        )


class WalletBalanceMismatchError(Exception):
    def __init__(self, expected, actual):
        self.expected = expected
        self.actual = actual
        super().__init__(
            f'Wallet balance did not update correctly (expected {expected}, got {actual}).'
        )


def frozen_response(message: str = WALLET_FROZEN_MESSAGE) -> Response:
    return Response(
        {
            'error': WALLET_FROZEN_MESSAGE,
            'message': WALLET_FROZEN_MESSAGE,
            'code': WALLET_FROZEN_CODE,
            'wallet_frozen': True,
            'wallet_status': 'frozen',
            'freeze_reason': (message or '').strip() if (message or '').strip() != WALLET_FROZEN_MESSAGE else '',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def wallet_is_frozen(wallet) -> bool:
    return bool(wallet is not None and getattr(wallet, 'is_frozen', False))


def require_wallet_not_frozen(user) -> Optional[Response]:
    """Return 403 when this user's wallet is frozen by an admin."""
    if user is None:
        return Response(
            {
                'error': 'authentication_required',
                'message': 'Authentication required.',
                'code': 'authentication_required',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    try:
        wallet = Wallet.objects.filter(user_id=user.pk).only(
            'is_frozen', 'freeze_reason',
        ).first()
    except Exception:
        logger.exception('Could not read wallet freeze state for user %s', getattr(user, 'pk', None))
        return None
    if wallet is None or not wallet.is_frozen:
        return None
    return frozen_response((wallet.freeze_reason or '').strip() or WALLET_FROZEN_MESSAGE)


def assert_wallet_not_frozen(wallet) -> None:
    if wallet_is_frozen(wallet):
        raise WalletFrozenError(WALLET_FROZEN_MESSAGE)


def require_wallet_not_blocked(user) -> Optional[Response]:
    """Return 403 when this user's wallet is frozen or locked for outbound payments."""
    frozen = require_wallet_not_frozen(user)
    if frozen:
        return frozen
    if user is None:
        return Response(
            {
                'error': 'authentication_required',
                'message': 'Authentication required.',
                'code': 'authentication_required',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    try:
        wallet = Wallet.objects.filter(user_id=user.pk).only(
            'transactions_blocked', 'blocked_reason',
        ).first()
    except Exception:
        logger.exception('Could not read wallet block state for user %s', getattr(user, 'pk', None))
        return None
    if wallet is None or not wallet.transactions_blocked:
        return None
    message = (wallet.blocked_reason or '').strip() or WALLET_BLOCKED_MESSAGE
    return Response(
        {
            'error': WALLET_BLOCKED_MESSAGE,
            'message': message,
            'code': WALLET_BLOCKED_CODE,
            'wallet_blocked': True,
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def freeze_wallet(wallet: Wallet, admin_user, reason: str = '') -> Wallet:
    wallet.is_frozen = True
    wallet.freeze_reason = (reason or '').strip()[:2000]
    wallet.frozen_at = timezone.now()
    wallet.frozen_by = admin_user
    wallet.freeze_unfrozen_at = None
    wallet.freeze_unfrozen_by = None
    wallet.save(update_fields=[
        'is_frozen', 'freeze_reason', 'frozen_at', 'frozen_by',
        'freeze_unfrozen_at', 'freeze_unfrozen_by', 'updated_at',
    ])
    return wallet


def unfreeze_wallet(wallet: Wallet, admin_user) -> Wallet:
    wallet.is_frozen = False
    wallet.freeze_reason = ''
    wallet.freeze_unfrozen_at = timezone.now()
    wallet.freeze_unfrozen_by = admin_user
    wallet.save(update_fields=[
        'is_frozen', 'freeze_reason', 'freeze_unfrozen_at', 'freeze_unfrozen_by', 'updated_at',
    ])
    return wallet


def block_wallet(
    user,
    *,
    reason: str,
    merchant_txn_id: str = '',
    notify: bool = True,
) -> bool:
    """
    Lock the user's wallet for outbound payments. Returns True if this call
    newly blocked (or re-blocked after an unblock). Existing blocks are left as-is.
    """
    if user is None:
        return False
    reason = (reason or '').strip()[:2000]
    merchant_txn_id = (merchant_txn_id or '').strip()[:100]
    newly_blocked = False
    with transaction.atomic():
        wallet, _ = Wallet.objects.select_for_update().get_or_create(
            user=user,
            defaults={'balance': 0},
        )
        if wallet.transactions_blocked:
            if merchant_txn_id and not wallet.blocked_merchant_txn_id:
                wallet.blocked_merchant_txn_id = merchant_txn_id
                wallet.save(update_fields=['blocked_merchant_txn_id', 'updated_at'])
            return False
        wallet.transactions_blocked = True
        wallet.blocked_reason = reason or WALLET_BLOCKED_MESSAGE
        wallet.blocked_at = timezone.now()
        wallet.blocked_merchant_txn_id = merchant_txn_id
        wallet.unblocked_at = None
        wallet.unblocked_by = None
        wallet.save(update_fields=[
            'transactions_blocked', 'blocked_reason', 'blocked_at',
            'blocked_merchant_txn_id', 'unblocked_at', 'unblocked_by', 'updated_at',
        ])
        newly_blocked = True

    if newly_blocked and notify:
        try:
            from .notifications import notify_wallet_blocked
            notify_wallet_blocked(wallet, reason=reason, merchant_txn_id=merchant_txn_id)
        except Exception:
            logger.exception('Failed to send wallet-blocked admin alert for user %s', user.pk)
    return newly_blocked


def unblock_wallet(wallet: Wallet, admin_user) -> Wallet:
    wallet.transactions_blocked = False
    wallet.blocked_reason = ''
    wallet.blocked_merchant_txn_id = ''
    wallet.unblocked_at = timezone.now()
    wallet.unblocked_by = admin_user
    wallet.save(update_fields=[
        'transactions_blocked', 'blocked_reason', 'blocked_merchant_txn_id',
        'unblocked_at', 'unblocked_by', 'updated_at',
    ])
    return wallet


def handle_provider_success_without_wallet(
    user,
    txn,
    *,
    reason: str = '',
    schedule: bool = True,
) -> None:
    """HimalPay already succeeded; MySewa could not debit/credit the wallet."""
    merchant = str(getattr(txn, 'merchant_txn_id', '') or '')
    msg = reason or (
        f'HimalPay completed {merchant or "this payment"} but MySewa could not apply '
        'the wallet movement. Outbound payments are locked until an admin reviews it.'
    )
    block_wallet(user, reason=msg, merchant_txn_id=merchant)
    if schedule:
        schedule_post_transaction_reconcile(user, txn)


def schedule_post_transaction_reconcile(user, txn) -> None:
    """After the DB commit, recheck this txn id and today's HimalPay statement."""
    if user is None or txn is None:
        return
    user_id = getattr(user, 'pk', None)
    merchant_txn_id = str(getattr(txn, 'merchant_txn_id', '') or '').strip()
    provider_txn_id = str(
        getattr(txn, 'service_hub_txn_id', None)
        or getattr(txn, 'provider_txn_id', None)
        or ''
    ).strip()
    txn_pk = getattr(txn, 'pk', None)
    if not user_id or not merchant_txn_id:
        return

    def _kick():
        thread = threading.Thread(
            target=_run_post_transaction_check,
            kwargs={
                'user_id': user_id,
                'merchant_txn_id': merchant_txn_id,
                'provider_txn_id': provider_txn_id,
                'txn_pk': txn_pk,
            },
            daemon=True,
            name=f'hp-stmt-{merchant_txn_id[-8:]}',
        )
        thread.start()

    try:
        transaction.on_commit(_kick)
    except Exception:
        _kick()


def _run_post_transaction_check(
    *,
    user_id: int,
    merchant_txn_id: str,
    provider_txn_id: str = '',
    txn_pk=None,
) -> None:
    close_old_connections()
    try:
        from django.contrib.auth import get_user_model
        from .himalpay import HimalPayAPI, HimalPayError
        from .statement_reconcile import (
            _wallet_applied,
            run_statement_reconcile,
        )
        from ..models import StatementReconcileRun

        User = get_user_model()
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return

        local = _find_local_txn(merchant_txn_id, provider_txn_id, txn_pk)
        api = HimalPayAPI()
        hp_success = False
        hp_amount_mismatch = False
        try:
            result = api.check_transaction_status(merchant_txn_id)
            normalized = api.normalize_status(result) if isinstance(result, dict) else 'pending'
            hp_success = normalized == 'success'
            if hp_success and local is not None:
                from decimal import Decimal
                from .statement_reconcile import _local_net_amount, _money, _approx_equal
                hp_net = result.get('total_debited')
                if hp_net is None:
                    hp_net = result.get('total_credited')
                if hp_net is None:
                    hp_net = result.get('amount')
                if hp_net is not None:
                    try:
                        hp_rupees = HimalPayAPI.to_rupees(hp_net)
                    except Exception:
                        hp_rupees = _money(hp_net)
                    local_net = _local_net_amount(local)
                    if not _approx_equal(Decimal(str(hp_rupees)), local_net):
                        hp_amount_mismatch = True
        except HimalPayError as exc:
            logger.warning(
                'Post-txn HimalPay status check failed for %s: %s',
                merchant_txn_id,
                exc,
            )

        wallet_miss = (
            hp_success
            and local is not None
            and not _wallet_applied(local)
            and str(getattr(local.obj, 'status', '') or '') != 'pending'
        )
        # Pending + provider success is expected when auto-verify is off.
        from .app_config import is_auto_status_verified
        if (
            hp_success
            and local is not None
            and not _wallet_applied(local)
            and str(getattr(local.obj, 'status', '') or '') == 'pending'
            and is_auto_status_verified()
        ):
            wallet_miss = True

        if wallet_miss:
            handle_provider_success_without_wallet(
                user,
                local.obj if local is not None else _TxnStub(merchant_txn_id),
                reason=(
                    f'HimalPay already deducted {merchant_txn_id} but MySewa did not '
                    'apply it to the wallet. Wallet locked for outbound payments.'
                ),
                schedule=False,
            )
        elif hp_success and local is None:
            handle_provider_success_without_wallet(
                user,
                _TxnStub(merchant_txn_id),
                reason=(
                    f'HimalPay has successful txn {merchant_txn_id} that is missing '
                    'on MySewa. Wallet locked until an admin reviews the statement.'
                ),
                schedule=False,
            )

        today = timezone.localdate()
        run_statement_reconcile(
            from_date=today,
            to_date=today,
            triggered_by=StatementReconcileRun.TRIGGER_POST_TXN,
            himalpay=api,
            focus_transaction_id=provider_txn_id or None,
        )
        if hp_amount_mismatch:
            logger.warning(
                'Post-txn amount mismatch for merchant %s user %s',
                merchant_txn_id,
                user_id,
            )
    except Exception:
        logger.exception(
            'Background HimalPay statement recheck failed for merchant %s',
            merchant_txn_id,
        )
    finally:
        close_old_connections()


class _TxnStub:
    def __init__(self, merchant_txn_id: str):
        self.merchant_txn_id = merchant_txn_id
        self.pk = None
        self.service_hub_txn_id = ''
        self.provider_txn_id = ''


def _find_local_txn(merchant_txn_id: str, provider_txn_id: str = '', txn_pk=None):
    from .statement_reconcile import TXN_MODELS, LocalTxn

    if merchant_txn_id:
        for txn_type, model, provider_field in TXN_MODELS:
            obj = model.objects.filter(merchant_txn_id=merchant_txn_id).select_related('user').first()
            if obj:
                provider_id = str(getattr(obj, provider_field, None) or '').strip() or merchant_txn_id
                return LocalTxn(txn_type=txn_type, obj=obj, provider_id=provider_id)
    if provider_txn_id:
        for txn_type, model, provider_field in TXN_MODELS:
            obj = model.objects.filter(**{provider_field: provider_txn_id}).select_related('user').first()
            if obj:
                return LocalTxn(txn_type=txn_type, obj=obj, provider_id=provider_txn_id)
    return None
