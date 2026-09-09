"""Orchestrate API fund transfers using existing wallet-transfer logic."""
from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response

from ..models import (
    ApiFundTransferLog,
    ApiIdempotencyRecord,
    WalletTransfer,
    _ensure_api_fund_transfer,
)
from .app_config import (
    get_app_config,
    require_account_approved,
    require_user_feature,
    require_wallet_not_blocked,
    validate_amount_bounds,
)
from .security import client_ip, client_user_agent
from .wallet_transfer import (
    check_daily_transfer_limit,
    lookup_active_user,
    perform_wallet_transfer,
)

logger = logging.getLogger(__name__)

_REFERENCE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')


def api_error(error: str, message: str, code: str, http_status: int, extra: dict | None = None):
    payload = {
        'success': False,
        'error': error,
        'message': message,
        'code': code,
    }
    if extra:
        payload.update(extra)
    return Response(payload, status=http_status)


def _map_wallet_error(err: Response) -> Response:
    data = err.data if isinstance(err.data, dict) else {}
    code = str(data.get('code') or '')
    error = str(data.get('error') or 'Transfer failed')
    message = str(data.get('message') or error)
    lowered = f'{error} {message} {code}'.lower()
    if 'insufficient' in lowered:
        return api_error(
            'Insufficient balance',
            message,
            'insufficient_balance',
            status.HTTP_400_BAD_REQUEST,
            extra={k: data[k] for k in ('required', 'available', 'charge') if k in data},
        )
    if 'frozen' in lowered or code in ('wallet_frozen',):
        return api_error(
            'Unauthorized transaction',
            message,
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )
    if 'not found' in lowered or err.status_code == 404:
        return api_error(
            'Wallet unavailable',
            'Wallet is unavailable for this transfer.',
            'wallet_unavailable',
            status.HTTP_404_NOT_FOUND,
        )
    if err.status_code >= 500:
        return api_error(
            'Server/internal error',
            'The transfer could not be completed. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return api_error(error, message, code or 'unauthorized_transaction', err.status_code or 400)


def _success_payload(transfer: WalletTransfer, reference: str) -> dict:
    amount = transfer.amount
    if isinstance(amount, Decimal):
        amount_out: int | str
        amount_out = int(amount) if amount == amount.to_integral_value() else str(amount)
    else:
        amount_out = amount
    return {
        'success': True,
        'message': 'Fund transfer successful',
        'transaction_id': transfer.reference,
        'reference': reference,
        'amount': amount_out,
        'status': 'SUCCESS',
    }


def _write_audit(*, user, request, reference, receiver, amount, status_value, error_code='', error_message='', transfer=None):
    try:
        ApiFundTransferLog.objects.create(
            user=user,
            reference=(reference or '')[:64],
            receiver=(receiver or '')[:80],
            amount=amount,
            status=status_value,
            error_code=(error_code or '')[:64],
            error_message=(error_message or '')[:255],
            wallet_transfer=transfer,
            transaction_id=getattr(transfer, 'reference', '') or '',
            ip_address=client_ip(request),
            user_agent=client_user_agent(request),
        )
    except Exception:
        logger.exception('Failed to persist API fund-transfer audit log')


def execute_api_fund_transfer(request) -> Response:
    _ensure_api_fund_transfer()
    sender = request.user
    raw = request.data if isinstance(request.data, dict) else {}
    receiver_raw = str(raw.get('receiver') or '').strip()
    reference = str(
        raw.get('reference')
        or request.headers.get('Idempotency-Key')
        or request.META.get('HTTP_IDEMPOTENCY_KEY')
        or ''
    ).strip()
    amount_raw = raw.get('amount')

    def fail(error, message, code, http_status, extra=None):
        _write_audit(
            user=sender,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=None,
            status_value=ApiFundTransferLog.STATUS_FAILED,
            error_code=code,
            error_message=message,
        )
        return api_error(error, message, code, http_status, extra)

    if not getattr(sender, 'is_api_user', False):
        return fail(
            'API access disabled',
            'API fund-transfer access is disabled for this account.',
            'api_access_disabled',
            status.HTTP_403_FORBIDDEN,
        )
    if not sender.is_active:
        return fail(
            'User inactive',
            'This account is inactive and cannot perform transfers.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )

    pending = require_account_approved(sender)
    if pending:
        return fail(
            'User inactive',
            'This account is not active for transactions.',
            'user_inactive',
            status.HTTP_403_FORBIDDEN,
        )
    blocked = require_user_feature(sender, 'wallet_adjustment')
    if blocked:
        return fail(
            'Unauthorized transaction',
            'Wallet transfer is disabled for this account.',
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )
    locked = require_wallet_not_blocked(sender)
    if locked:
        data = locked.data if isinstance(locked.data, dict) else {}
        return fail(
            'Unauthorized transaction',
            str(data.get('message') or 'Wallet transactions are currently blocked.'),
            'unauthorized_transaction',
            status.HTTP_403_FORBIDDEN,
        )

    if not receiver_raw:
        return fail(
            'Invalid receiver',
            'Receiver is required.',
            'invalid_receiver',
            status.HTTP_400_BAD_REQUEST,
        )
    if not reference:
        return fail(
            'Duplicate reference',
            'A unique reference is required for each API transfer.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )
    if not _REFERENCE_RE.match(reference):
        return fail(
            'Duplicate reference',
            'Reference must be 1–64 characters using letters, digits, hyphen, underscore, or period.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(amount_raw)).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError, ValueError):
        return fail(
            'Invalid amount',
            'Amount must be a valid number greater than zero.',
            'invalid_amount',
            status.HTTP_400_BAD_REQUEST,
        )
    if amount <= 0:
        return fail(
            'Invalid amount',
            'Amount must be greater than zero.',
            'invalid_amount',
            status.HTTP_400_BAD_REQUEST,
        )
    tx = get_app_config().get('transactions') or {}
    bounds_err = validate_amount_bounds(
        amount,
        min_amount=tx.get('min_transfer', 10),
        max_amount=tx.get('max_transfer', 100000),
        label='Transfer',
    )
    if bounds_err:
        return fail('Invalid amount', bounds_err, 'invalid_amount', status.HTTP_400_BAD_REQUEST)

    recipient = lookup_active_user(receiver_raw)
    if recipient is None:
        return fail(
            'Receiver not found',
            'No MySewa user was found for that receiver.',
            'receiver_not_found',
            status.HTTP_404_NOT_FOUND,
        )
    if recipient.pk == sender.pk:
        return fail(
            'Invalid receiver',
            'You cannot transfer to your own wallet.',
            'invalid_receiver',
            status.HTTP_400_BAD_REQUEST,
        )
    if not recipient.is_active or not getattr(recipient, 'is_account_approved', True):
        return fail(
            'Invalid receiver',
            'The receiver account cannot receive transfers.',
            'invalid_receiver',
            status.HTTP_400_BAD_REQUEST,
        )

    limit_err = check_daily_transfer_limit(sender, amount)
    if limit_err:
        data = limit_err.data if isinstance(limit_err.data, dict) else {}
        return fail(
            'Unauthorized transaction',
            str(data.get('message') or 'Daily transfer limit exceeded.'),
            'unauthorized_transaction',
            status.HTTP_400_BAD_REQUEST,
        )

    remarks = f'API:{reference}'[:255]

    try:
        with transaction.atomic():
            try:
                with transaction.atomic():
                    record = ApiIdempotencyRecord.objects.create(
                        user=sender,
                        reference=reference,
                        status=ApiIdempotencyRecord.STATUS_PROCESSING,
                    )
            except IntegrityError:
                existing = (
                    ApiIdempotencyRecord.objects.select_for_update()
                    .filter(user=sender, reference=reference)
                    .first()
                )
                if existing and existing.status == ApiIdempotencyRecord.STATUS_COMPLETED:
                    payload = existing.response_payload or {}
                    if existing.wallet_transfer_id and not payload:
                        payload = _success_payload(existing.wallet_transfer, reference)
                    _write_audit(
                        user=sender,
                        request=request,
                        reference=reference,
                        receiver=receiver_raw,
                        amount=amount,
                        status_value=ApiFundTransferLog.STATUS_SUCCESS,
                        transfer=existing.wallet_transfer,
                    )
                    return Response(payload, status=status.HTTP_200_OK)
                return fail(
                    'Duplicate reference',
                    'This reference is already being processed.',
                    'duplicate_reference',
                    status.HTTP_409_CONFLICT,
                )

            transfer, err = perform_wallet_transfer(
                sender=sender,
                recipient=recipient,
                amount=amount,
                remarks=remarks,
                source=WalletTransfer.SOURCE_API,
                client_reference=reference,
            )
            if err:
                raise _TransferFailed(err)

            payload = _success_payload(transfer, reference)
            record.status = ApiIdempotencyRecord.STATUS_COMPLETED
            record.wallet_transfer = transfer
            record.response_payload = payload
            record.save(update_fields=['status', 'wallet_transfer', 'response_payload', 'updated_at'])
    except _TransferFailed as exc:
        mapped = _map_wallet_error(exc.response)
        data = mapped.data if isinstance(mapped.data, dict) else {}
        _write_audit(
            user=sender,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=amount,
            status_value=ApiFundTransferLog.STATUS_FAILED,
            error_code=str(data.get('code') or ''),
            error_message=str(data.get('message') or ''),
        )
        return mapped
    except Exception:
        logger.exception('API fund transfer failed user_id=%s reference=%s', sender.pk, reference)
        _write_audit(
            user=sender,
            request=request,
            reference=reference,
            receiver=receiver_raw,
            amount=amount,
            status_value=ApiFundTransferLog.STATUS_FAILED,
            error_code='server_error',
            error_message='The transfer could not be completed.',
        )
        return api_error(
            'Server/internal error',
            'The transfer could not be completed. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        from .notifications import notify_low_balance_if_needed, notify_wallet_transfer

        notify_wallet_transfer(transfer)
        notify_low_balance_if_needed(transfer.sender.wallet)
    except Exception:
        logger.exception('API fund transfer notification failed for %s', transfer.reference)

    _write_audit(
        user=sender,
        request=request,
        reference=reference,
        receiver=receiver_raw,
        amount=amount,
        status_value=ApiFundTransferLog.STATUS_SUCCESS,
        transfer=transfer,
    )
    logger.info(
        'API fund transfer ok user_id=%s txn=%s reference=%s amount=%s',
        sender.pk,
        transfer.reference,
        reference,
        amount,
    )
    return Response(payload, status=status.HTTP_201_CREATED)


class _TransferFailed(Exception):
    def __init__(self, response: Response):
        self.response = response
        super().__init__('wallet transfer failed')
