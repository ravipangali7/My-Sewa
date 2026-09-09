"""API-key Bank List / Verify / Transfer using existing HimalPay bank-transfer flow."""
from __future__ import annotations

import hashlib
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from ..models import (
    ApiIdempotencyRecord,
    BankTransferTransaction,
    Wallet,
    _ensure_api_fund_transfer,
)
from .api_fund_transfer import api_error
from .app_config import (
    get_app_config,
    is_auto_status_verified,
    require_account_approved,
    require_feature_enabled,
    require_user_feature,
    require_wallet_not_blocked,
    validate_amount_bounds,
)
from .himalpay import HimalPayAPI, HimalPayError
from .himalpay_banks import fetch_normalized_banks
from .notifications import notify_low_balance_if_needed, notify_transfer_success
from .txn_charges import (
    TXN_BANK_TRANSFER,
    overlay_himalpay_debit,
    persist_transaction_charge,
)
from .txn_status import debit_wallet_for_txn, resolve_provider_outcome
from .wallet_guard import handle_provider_success_without_wallet, schedule_post_transaction_reconcile

logger = logging.getLogger(__name__)

_REFERENCE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
VERIFY_CACHE_TTL = 15 * 60
VERIFY_CACHE_PREFIX = 'api_bank_verify'
BANK_IDEMPOTENCY_PREFIX = 'bank:'

ACCOUNT_DETAILS_MISMATCH = 'Bank account verification failed'
BANK_VERIFY_UNAVAILABLE = (
    'Bank account verification is not available on the payment provider right now. '
    'Please try again later.'
)
_ACCOUNT_NUMBER_RE = re.compile(r'^[A-Za-z0-9]{5,34}$')


def _blocked_to_error(blocked, fallback='This operation is disabled.'):
    data = getattr(blocked, 'data', None)
    if isinstance(data, dict):
        message = data.get('message') or data.get('error') or fallback
    else:
        message = fallback
    code = blocked.status_code if getattr(blocked, 'status_code', None) else status.HTTP_403_FORBIDDEN
    return api_error('Unauthorized transaction', str(message), 'unauthorized_transaction', code)


def _validate_account_number(account_number: str):
    compact = re.sub(r'\s+', '', account_number or '')
    if not compact:
        return api_error(
            'Invalid account number',
            'bank_account_number is required.',
            'invalid_account_number',
            status.HTTP_400_BAD_REQUEST,
        )
    if not _ACCOUNT_NUMBER_RE.match(compact):
        return api_error(
            'Invalid account number',
            'bank_account_number must be 5-34 letters or digits.',
            'invalid_account_number',
            status.HTTP_400_BAD_REQUEST,
        )
    return None


def _resolve_supported_bank(himalpay, bank_code: str, bank_name: str):
    try:
        banks, _source = fetch_normalized_banks(himalpay=himalpay)
    except HimalPayError as exc:
        return None, _provider_error(exc)
    except Exception:
        logger.exception('Could not load HimalPay bank list')
        return None, api_error(
            'HimalPay unavailable',
            'The payment provider is temporarily unavailable. Please try again later.',
            'provider_unavailable',
            status.HTTP_502_BAD_GATEWAY,
        )

    from ..views.bank_transfer_views import _resolve_destination_bank

    resolved = _resolve_destination_bank(himalpay, bank_code, bank_name)
    codes = {row['bank_code']: row for row in banks if row.get('bank_code')}
    if resolved not in codes and bank_name:
        name_u = bank_name.casefold()
        name_hits = [
            row for row in banks
            if name_u in (row.get('bank_name') or '').casefold()
            or (row.get('bank_name') or '').casefold() in name_u
        ]
        if len(name_hits) == 1:
            resolved = name_hits[0]['bank_code']
    if resolved not in codes:
        return None, api_error(
            'Bank not supported',
            'This bank is not available through the configured HimalPay bank list.',
            'bank_not_supported',
            status.HTTP_400_BAD_REQUEST,
        )
    row = codes[resolved]
    return {'bank_code': resolved, 'bank_name': row.get('bank_name') or bank_name or resolved}, None


def mask_account_number(number: str) -> str:
    digits = (number or '').strip()
    if not digits:
        return ''
    if len(digits) <= 4:
        return '*' * len(digits)
    return f"{'*' * max(4, len(digits) - 4)}{digits[-4:]}"


def _amount_out(amount: Decimal):
    if amount == amount.to_integral_value():
        return int(amount)
    return str(amount)


def _provider_error(exc: HimalPayError):
    if getattr(exc, 'is_ip_blocked', False):
        return api_error(
            'HimalPay unavailable',
            'The payment provider is temporarily unavailable. Please try again later.',
            'provider_unavailable',
            status.HTTP_502_BAD_GATEWAY,
        )
    if exc.status_code == 504:
        return api_error(
            'HimalPay timeout',
            'The payment provider took too long to respond. Please try again.',
            'provider_timeout',
            status.HTTP_504_GATEWAY_TIMEOUT,
        )
    if exc.status_code >= 500:
        return api_error(
            'HimalPay unavailable',
            'The payment provider is temporarily unavailable. Please try again later.',
            'provider_unavailable',
            status.HTTP_502_BAD_GATEWAY,
        )
    return api_error(
        'HimalPay API error',
        exc.message or 'The payment provider rejected this request.',
        'provider_error',
        status.HTTP_400_BAD_REQUEST,
    )


def _pick(raw: dict, *keys: str) -> str:
    for key in keys:
        value = raw.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ''


def _verify_cache_key(user_id, bank_code, account_number, account_name) -> str:
    material = '|'.join(
        [
            str(user_id),
            HimalPayAPI.normalize_bank_code(bank_code),
            HimalPayAPI.normalize_account_number(account_number),
            HimalPayAPI.normalize_account_name(account_name),
        ]
    )
    digest = hashlib.sha256(material.encode('utf-8')).hexdigest()
    return f'{VERIFY_CACHE_PREFIX}:{digest}'


def _store_verification(user, *, bank_code, bank_name, account_number, account_name):
    cache.set(
        _verify_cache_key(user.pk, bank_code, account_number, account_name),
        {
            'bank_code': bank_code,
            'bank_name': bank_name or '',
            'account_number': account_number,
            'account_name': account_name,
            'user_id': user.pk,
        },
        VERIFY_CACHE_TTL,
    )


def _load_verification(user, *, bank_code, account_number, account_name):
    return cache.get(_verify_cache_key(user.pk, bank_code, account_number, account_name))


def execute_api_bank_list(request) -> Response:
    _ensure_api_fund_transfer()
    blocked = require_feature_enabled('transfers')
    if blocked:
        return _blocked_to_error(blocked, 'Transfers are disabled.')
    blocked = require_user_feature(request.user, 'fund_transfer')
    if blocked:
        return api_error('Unauthorized transaction', 'Bank transfer is disabled for this account.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)

    force = str(request.query_params.get('refresh') or '').strip().lower() in ('1', 'true', 'yes')
    try:
        banks, source = fetch_normalized_banks(force_refresh=force)
    except HimalPayError as exc:
        return _provider_error(exc)
    except Exception:
        logger.exception('API bank list failed')
        return api_error(
            'Server/internal error',
            'The bank list could not be loaded. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response({'success': True, 'source': source, 'data': banks})


def execute_api_verified_bank(request) -> Response:
    _ensure_api_fund_transfer()
    blocked = require_feature_enabled('transfers')
    if blocked:
        return api_error('Unauthorized transaction', 'Transfers are disabled.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)
    blocked = require_user_feature(request.user, 'fund_transfer')
    if blocked:
        return api_error('Unauthorized transaction', 'Bank transfer is disabled for this account.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)
    pending = require_account_approved(request.user)
    if pending:
        return api_error('User inactive', 'This account is not active for transactions.', 'user_inactive', status.HTTP_403_FORBIDDEN)
    locked = require_wallet_not_blocked(request.user)
    if locked:
        return api_error('Unauthorized transaction', 'Wallet transactions are currently blocked.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)

    raw = request.data if isinstance(request.data, dict) else {}
    bank_code = _pick(raw, 'bank_code', 'destination_bank')
    bank_name = _pick(raw, 'bank_name', 'destination_bank_name')
    account_number = _pick(raw, 'bank_account_number', 'account_number', 'destination_acc_no')
    account_name = _pick(raw, 'account_holder_name', 'account_name', 'destination_acc_name')

    if not bank_code and not bank_name:
        return api_error(
            'Invalid bank code',
            'bank_code or bank_name is required.',
            'invalid_bank_code',
            status.HTTP_400_BAD_REQUEST,
        )
    if not account_number:
        return api_error('Invalid account number', 'bank_account_number is required.', 'invalid_account_number', status.HTTP_400_BAD_REQUEST)
    if not account_name:
        return api_error(
            'Missing account holder name',
            'account_holder_name is required.',
            'missing_account_holder_name',
            status.HTTP_400_BAD_REQUEST,
        )

    from ..views.bank_transfer_views import _is_wallet_service_not_allowed

    account_err = _validate_account_number(account_number)
    if account_err:
        return account_err

    himalpay = HimalPayAPI()
    supported, bank_err = _resolve_supported_bank(himalpay, bank_code, bank_name)
    if bank_err:
        return bank_err
    resolved = supported['bank_code']
    bank_name = bank_name or supported['bank_name']
    merchant_txn_id = f'MYSEWA_VF_{uuid.uuid4().hex[:14].upper()}'
    try:
        result = himalpay.verify_bank_account(
            bank_code=resolved,
            account_name=account_name,
            account_number=account_number,
            merchant_txn_id=merchant_txn_id,
            is_mobile='n',
        )
    except HimalPayError as exc:
        if _is_wallet_service_not_allowed(exc):
            return api_error(
                'HimalPay unavailable',
                BANK_VERIFY_UNAVAILABLE,
                'provider_unavailable',
                status.HTTP_502_BAD_GATEWAY,
            )
        return _provider_error(exc)
    except Exception:
        logger.exception('API bank verify failed')
        return api_error(
            'Server/internal error',
            'Bank verification could not be completed. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if not himalpay.is_verification_success(result):
        return Response(
            {
                'success': False,
                'verified': False,
                'message': ACCOUNT_DETAILS_MISMATCH,
                'error': ACCOUNT_DETAILS_MISMATCH,
                'code': 'verification_failed',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    match = himalpay.verification_details_match(
        result,
        bank_code=resolved,
        account_number=account_number,
        account_name=account_name,
        require_name=True,
    )
    if not match['matched']:
        return Response(
            {
                'success': False,
                'verified': False,
                'message': ACCOUNT_DETAILS_MISMATCH,
                'error': ACCOUNT_DETAILS_MISMATCH,
                'code': 'verification_failed',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    verified_name = match['account_name'] or account_name
    verified_number = match['account_number'] or account_number
    verified_bank = match['bank_code'] or resolved
    _store_verification(
        request.user,
        bank_code=verified_bank,
        bank_name=bank_name,
        account_number=verified_number,
        account_name=verified_name,
    )
    # Also store against the caller-submitted values so the next transfer request matches.
    _store_verification(
        request.user,
        bank_code=bank_code,
        bank_name=bank_name,
        account_number=account_number,
        account_name=account_name,
    )
    return Response(
        {
            'success': True,
            'verified': True,
            'message': 'Bank account verified successfully',
            'data': {
                'bank_code': verified_bank,
                'bank_name': bank_name or verified_bank,
                'account_number': mask_account_number(verified_number),
                'account_holder_name': verified_name,
            },
        }
    )


def execute_api_bank_transfer(request) -> Response:
    _ensure_api_fund_transfer()
    sender = request.user
    blocked = require_feature_enabled('transfers')
    if blocked:
        return api_error('Unauthorized transaction', 'Transfers are disabled.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)
    blocked = require_user_feature(sender, 'fund_transfer')
    if blocked:
        return api_error('Unauthorized transaction', 'Bank transfer is disabled for this account.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)
    pending = require_account_approved(sender)
    if pending:
        return api_error('User inactive', 'This account is not active for transactions.', 'user_inactive', status.HTTP_403_FORBIDDEN)
    locked = require_wallet_not_blocked(sender)
    if locked:
        return api_error('Unauthorized transaction', 'Wallet transactions are currently blocked.', 'unauthorized_transaction', status.HTTP_403_FORBIDDEN)

    raw = request.data if isinstance(request.data, dict) else {}
    bank_code = _pick(raw, 'bank_code', 'destination_bank')
    bank_name = _pick(raw, 'bank_name', 'destination_bank_name')
    account_number = _pick(raw, 'bank_account_number', 'account_number', 'destination_acc_no')
    account_name = _pick(raw, 'account_holder_name', 'account_name', 'destination_acc_name')
    reference = str(
        raw.get('reference')
        or request.headers.get('Idempotency-Key')
        or request.META.get('HTTP_IDEMPOTENCY_KEY')
        or ''
    ).strip()
    amount_raw = raw.get('amount')

    if not bank_code and not bank_name:
        return api_error(
            'Invalid bank code',
            'bank_code or bank_name is required.',
            'invalid_bank_code',
            status.HTTP_400_BAD_REQUEST,
        )
    if not account_number:
        return api_error('Invalid account number', 'bank_account_number is required.', 'invalid_account_number', status.HTTP_400_BAD_REQUEST)
    if not account_name:
        return api_error(
            'Missing account holder name',
            'account_holder_name is required.',
            'missing_account_holder_name',
            status.HTTP_400_BAD_REQUEST,
        )
    account_err = _validate_account_number(account_number)
    if account_err:
        return account_err
    if not reference:
        return api_error(
            'Duplicate reference',
            'A unique reference is required for each API bank transfer.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )
    if not _REFERENCE_RE.match(reference):
        return api_error(
            'Duplicate reference',
            'Reference must be 1-64 characters using letters, digits, hyphen, underscore, or period.',
            'duplicate_reference',
            status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(amount_raw)).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError, ValueError):
        return api_error('Invalid amount', 'Amount must be a valid number greater than zero.', 'invalid_amount', status.HTTP_400_BAD_REQUEST)
    if amount <= 0:
        return api_error('Invalid amount', 'Amount must be greater than zero.', 'invalid_amount', status.HTTP_400_BAD_REQUEST)
    tx = get_app_config().get('transactions') or {}
    bounds_err = validate_amount_bounds(
        amount,
        min_amount=tx.get('min_transfer', 10),
        max_amount=tx.get('max_transfer', 100000),
        label='Transfer',
    )
    if bounds_err:
        return api_error('Invalid amount', bounds_err, 'invalid_amount', status.HTTP_400_BAD_REQUEST)

    from ..views.bank_transfer_views import (
        _bank_transfer_quote,
        _is_wallet_service_not_allowed,
        BANK_VERIFY_SERVICE_UNAVAILABLE,
    )

    himalpay = HimalPayAPI()
    supported, bank_err = _resolve_supported_bank(himalpay, bank_code, bank_name)
    if bank_err:
        return bank_err
    resolved = supported['bank_code']
    bank_name = bank_name or supported['bank_name']
    prior = _load_verification(sender, bank_code=bank_code or resolved, account_number=account_number, account_name=account_name)
    if not prior:
        prior = _load_verification(sender, bank_code=resolved, account_number=account_number, account_name=account_name)
    if not prior:
        return api_error(
            'Verification required',
            'Verify this bank account with POST /api/v1/verifiedbank/ before transferring.',
            'verification_required',
            status.HTTP_400_BAD_REQUEST,
        )

    idem_key = f'{BANK_IDEMPOTENCY_PREFIX}{reference}'
    try:
        with transaction.atomic():
            try:
                with transaction.atomic():
                    record = ApiIdempotencyRecord.objects.create(
                        user=sender,
                        reference=idem_key,
                        status=ApiIdempotencyRecord.STATUS_PROCESSING,
                    )
            except IntegrityError:
                existing = (
                    ApiIdempotencyRecord.objects.select_for_update()
                    .filter(user=sender, reference=idem_key)
                    .first()
                )
                if existing and existing.status == ApiIdempotencyRecord.STATUS_COMPLETED:
                    return Response(existing.response_payload or {}, status=status.HTTP_200_OK)
                return api_error(
                    'Duplicate reference',
                    'This reference is already being processed.',
                    'duplicate_reference',
                    status.HTTP_409_CONFLICT,
                )

            payload, http_status = _execute_bank_payment(
                sender=sender,
                himalpay=himalpay,
                amount=amount,
                resolved_bank=resolved,
                bank_name=bank_name or prior.get('bank_name') or '',
                account_number=account_number,
                account_name=account_name,
                reference=reference,
                quote_fn=_bank_transfer_quote,
                mismatch_message=ACCOUNT_DETAILS_MISMATCH,
                unavailable_message=BANK_VERIFY_SERVICE_UNAVAILABLE,
                is_service_blocked=_is_wallet_service_not_allowed,
            )
            if http_status in (status.HTTP_200_OK, status.HTTP_201_CREATED, status.HTTP_202_ACCEPTED):
                record.status = ApiIdempotencyRecord.STATUS_COMPLETED
                record.response_payload = payload
                record.save(update_fields=['status', 'response_payload', 'updated_at'])
            else:
                record.delete()
            return Response(payload, status=http_status)
    except Exception:
        logger.exception('API bank transfer failed user_id=%s reference=%s', sender.pk, reference)
        return api_error(
            'Server/internal error',
            'The transfer could not be completed. Please try again.',
            'server_error',
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _execute_bank_payment(
    *,
    sender,
    himalpay,
    amount,
    resolved_bank,
    bank_name,
    account_number,
    account_name,
    reference,
    quote_fn,
    mismatch_message,
    unavailable_message,
    is_service_blocked,
):
    wallet, _ = Wallet.objects.get_or_create(user=sender, defaults={'balance': Decimal('0.00')})
    tx_cfg = get_app_config().get('transactions') or {}
    daily_limit = Decimal(str(tx_cfg.get('daily_transfer_limit') or 0))
    if daily_limit > 0:
        today = timezone.localdate()
        used = (
            BankTransferTransaction.objects.filter(user=sender, created_at__date=today)
            .exclude(status='failed')
            .aggregate(total=Sum('amount'))['total']
            or Decimal('0.00')
        )
        if used + amount > daily_limit:
            return (
                {
                    'success': False,
                    'error': 'Unauthorized transaction',
                    'message': f'Daily transfer limit is Rs. {daily_limit}.',
                    'code': 'unauthorized_transaction',
                },
                status.HTTP_400_BAD_REQUEST,
            )

    try:
        fee_info = himalpay.calculate_cashback_and_charge(HimalPayAPI.SERVICE_BANK_TRANSFER, amount)
        provider_charge = himalpay.to_rupees(fee_info.get('charge', 0) or 0)
        provider_cashback = himalpay.to_rupees(fee_info.get('cashback', 0) or 0)
    except HimalPayError as exc:
        if getattr(exc, 'is_ip_blocked', False) or exc.status_code in (401, 403, 502, 504):
            mapped = _provider_error(exc)
            return mapped.data, mapped.status_code
        provider_charge = Decimal('0.00')
        provider_cashback = Decimal('0.00')

    quote = quote_fn(amount, sender, provider_charge, provider_cashback)
    total_required = quote['wallet_amount']
    if wallet.balance < total_required:
        return (
            {
                'success': False,
                'error': 'Insufficient balance',
                'message': (
                    f'Insufficient MySewa wallet balance. Need Rs. {total_required}, have Rs. {wallet.balance}.'
                ),
                'code': 'insufficient_balance',
                'required': str(total_required),
                'available': str(wallet.balance),
            },
            status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = f'MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}'
    while BankTransferTransaction.objects.filter(merchant_txn_id=merchant_txn_id).exists():
        merchant_txn_id = f'MYSEWA_BT_{uuid.uuid4().hex[:14].upper()}'
    verify_merchant_txn_id = f'MYSEWA_VF_{uuid.uuid4().hex[:14].upper()}'

    transfer = BankTransferTransaction.objects.create(
        user=sender,
        amount=amount,
        destination_bank=resolved_bank,
        destination_bank_name=bank_name,
        destination_acc_no=account_number,
        destination_acc_name=account_name,
        is_destination_mobile=False,
        transaction_remarks=f'API:{reference}'[:255],
        status='pending',
        merchant_txn_id=merchant_txn_id,
        charge=quote['total_charges'],
        cashback=quote['cashback'],
        total_debited=total_required,
        platform_charge=quote['system_charge'],
        provider_charge=quote['himalpay_charge'],
        verified=False,
        source=BankTransferTransaction.SOURCE_API,
        client_reference=reference,
    )
    persist_transaction_charge(transfer, quote)

    try:
        verify_result = himalpay.verify_bank_account(
            bank_code=resolved_bank,
            account_name=account_name,
            account_number=account_number,
            merchant_txn_id=verify_merchant_txn_id,
            is_mobile='n',
        )
        if not himalpay.is_verification_success(verify_result):
            transfer.status = 'failed'
            transfer.provider_response = verify_result if isinstance(verify_result, dict) else {}
            transfer.save()
            return (
                {
                    'success': False,
                    'verified': False,
                    'error': mismatch_message,
                    'message': mismatch_message,
                    'code': 'verification_failed',
                    'transaction_id': transfer.merchant_txn_id,
                    'reference': reference,
                    'status': 'FAILED',
                },
                status.HTTP_400_BAD_REQUEST,
            )
        match = himalpay.verification_details_match(
            verify_result,
            bank_code=resolved_bank,
            account_number=account_number,
            account_name=account_name,
            require_name=True,
        )
        if not match['matched']:
            transfer.status = 'failed'
            transfer.provider_response = verify_result if isinstance(verify_result, dict) else {}
            transfer.save()
            return (
                {
                    'success': False,
                    'verified': False,
                    'error': mismatch_message,
                    'message': mismatch_message,
                    'code': 'verification_failed',
                    'transaction_id': transfer.merchant_txn_id,
                    'reference': reference,
                    'status': 'FAILED',
                },
                status.HTTP_400_BAD_REQUEST,
            )

        verified_name = match['account_name'] or account_name
        transfer.destination_acc_name = verified_name
        transfer.verified = True
        transfer.save(update_fields=['destination_acc_name', 'verified', 'updated_at'])

        response = himalpay.bank_transfer(
            amount_rupees=amount,
            merchant_transaction_id=merchant_txn_id,
            destination_bank=resolved_bank,
            destination_acc_no=account_number,
            destination_acc_name=verified_name,
            is_destination_mobile='n',
            transaction_remarks=transfer.transaction_remarks,
        )
        txn_status = himalpay.normalize_status(response)
        overlay_himalpay_debit(
            transfer, himalpay, response, amount, TXN_BANK_TRANSFER, user=sender,
        )
        if txn_status == 'failed':
            transfer.status = 'failed'
            transfer.save()
            failure = himalpay.extract_failure_details(response)
            return (
                {
                    'success': False,
                    'error': 'Transfer failed',
                    'message': failure.get('message') or 'Bank transfer failed.',
                    'code': 'transfer_failed',
                    'transaction_id': transfer.merchant_txn_id,
                    'reference': reference,
                    'status': 'FAILED',
                },
                status.HTTP_400_BAD_REQUEST,
            )

        local_status = resolve_provider_outcome(txn_status, is_auto_status_verified())
        if local_status == 'success':
            with transaction.atomic():
                wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                debit = transfer.total_debited or amount
                if wallet.balance < debit:
                    handle_provider_success_without_wallet(sender, transfer, schedule=False)
                    transfer.status = 'failed'
                    transfer.save()
                    return (
                        {
                            'success': False,
                            'error': 'Insufficient balance',
                            'message': 'Insufficient wallet balance after fee calculation.',
                            'code': 'insufficient_balance',
                            'transaction_id': transfer.merchant_txn_id,
                            'reference': reference,
                            'status': 'FAILED',
                        },
                        status.HTTP_400_BAD_REQUEST,
                    )
                debit_wallet_for_txn(wallet, transfer, debit)
                transfer.status = 'success'
                transfer.save()
            notify_transfer_success(transfer, balance_after=getattr(transfer, 'balance_after', None) or wallet.balance)
            notify_low_balance_if_needed(wallet)
            payload = {
                'success': True,
                'message': 'Bank transfer successful',
                'transaction_id': transfer.merchant_txn_id,
                'provider_reference': transfer.provider_txn_id or transfer.reference_id or '',
                'reference': reference,
                'amount': _amount_out(amount),
                'status': 'SUCCESS',
                'data': {
                    'bank_code': resolved_bank,
                    'bank_name': transfer.destination_bank_name or resolved_bank,
                    'account_number': mask_account_number(account_number),
                    'account_holder_name': verified_name,
                    'method': 'API Bank Transfer',
                },
            }
            return payload, status.HTTP_201_CREATED

        transfer.status = 'pending'
        transfer.save()
        payload = {
            'success': True,
            'message': 'Bank transfer is being processed',
            'transaction_id': transfer.merchant_txn_id,
            'provider_reference': transfer.provider_txn_id or transfer.reference_id or '',
            'reference': reference,
            'amount': _amount_out(amount),
            'status': 'PENDING',
            'data': {
                'bank_code': resolved_bank,
                'account_number': mask_account_number(account_number),
                'account_holder_name': verified_name,
                'method': 'API Bank Transfer',
            },
        }
        return payload, status.HTTP_202_ACCEPTED
    except HimalPayError as exc:
        transfer.status = 'failed'
        transfer.provider_response = exc.response_data
        transfer.save()
        if is_service_blocked(exc):
            mapped = api_error('HimalPay unavailable', unavailable_message, 'provider_unavailable', status.HTTP_502_BAD_GATEWAY)
            data = dict(mapped.data)
            data['transaction_id'] = transfer.merchant_txn_id
            data['reference'] = reference
            data['status'] = 'FAILED'
            return data, mapped.status_code
        mapped = _provider_error(exc)
        data = dict(mapped.data)
        data['transaction_id'] = transfer.merchant_txn_id
        data['reference'] = reference
        data['status'] = 'FAILED'
        return data, mapped.status_code
    except Exception:
        transfer.status = 'failed'
        transfer.save()
        logger.exception('API bank transfer provider call failed txn=%s', merchant_txn_id)
        return (
            {
                'success': False,
                'error': 'Server/internal error',
                'message': 'The transfer could not be completed. Please try again.',
                'code': 'server_error',
                'transaction_id': transfer.merchant_txn_id,
                'reference': reference,
                'status': 'FAILED',
            },
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    finally:
        schedule_post_transaction_reconcile(sender, transfer)
