"""
Remittance views: HimalPay Samsara SAMSARA_GET / SAMSARA_PAY (inbound credit).
"""
import uuid
import logging
from decimal import Decimal

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import RemittanceTransaction, Settings
from ..serializers import (
    RemittanceTransactionSerializer,
    RemittanceLookupSerializer,
    RemittanceReceiveSerializer,
    TransactionStatusSerializer,
)
from ..services.himalpay import HimalPayAPI, HimalPayError, with_himapay_response
from ..services.app_config import (
    get_app_config,
    require_feature_enabled,
    require_account_approved,
)
from ..services.notifications import notify_remittance_success
from ..services.txn_status import apply_inbound_status_change

logger = logging.getLogger(__name__)

BENEFICIARY_FIELDS = (
    'beneficiary_gender',
    'beneficiary_nationality',
    'beneficiary_state',
    'beneficiary_district',
    'beneficiary_municipality',
    'beneficiary_ward_number',
    'beneficiary_city',
    'beneficiary_address',
    'beneficiary_relation',
    'beneficiary_occupation',
    'beneficiary_citizenship_number',
    'beneficiary_citizenship_issuing_district',
    'beneficiary_id_type',
    'beneficiary_id_number',
    'beneficiary_id_issue_date',
    'beneficiary_id_issue_by',
    'beneficiary_mobile_no',
    'beneficiary_dob',
    'remittance_purpose',
)


def _agent_defaults() -> dict:
    cfg = get_app_config().get('remittance') or {}
    site = get_app_config().get('site') or {}
    settings = Settings.load()
    from ..services.payment_accounts import normalize_bank_details
    bank = normalize_bank_details(settings.bank_details)
    support_phone = str(site.get('support_phone') or '').strip()
    return {
        'payout_location_name': str(cfg.get('payout_location_name') or site.get('site_name') or 'MySewa'),
        'payout_agent_state': str(cfg.get('payout_agent_state') or 'Bagmati'),
        'payout_agent_district': str(cfg.get('payout_agent_district') or 'Kathmandu'),
        'payout_agent_municipality': str(
            cfg.get('payout_agent_municipality') or 'Kathmandu Metropolitan City'
        ),
        'payout_agent_ward_number': str(cfg.get('payout_agent_ward_number') or '10'),
        'payout_agent_pan_number': str(cfg.get('payout_agent_pan_number') or ''),
        'teller_contact': str(cfg.get('teller_contact') or support_phone or ''),
        'payout_payment_type': str(cfg.get('payout_payment_type') or 'Cash'),
        'payout_payment_number': str(cfg.get('payout_payment_number') or ''),
        'payout_payment_bank_name': str(
            cfg.get('payout_payment_bank_name') or bank.get('bank_name') or ''
        ),
        'payout_payment_bank_branch': str(
            cfg.get('payout_payment_bank_branch') or bank.get('branch') or ''
        ),
    }


def _apply_load_fields(
    txn: RemittanceTransaction,
    himalpay: HimalPayAPI,
    response: dict,
    *,
    persist: bool = True,
):
    """Apply fee/credit/provider metadata from a HimalPay response.

    Wallet credit is always the net amount after charge/cashback:
    total_credited = amount - charge + cashback (never the gross amount when a
    charge applies). Prefer provider total_credited when it already reflects netting.

    When persist=True (default), save immediately so a later
    apply_inbound_status_change + refresh_from_db cannot wipe these fields.
    """
    charge_paisa = response.get('charge', response.get('applied_charge', 0)) or 0
    cashback_paisa = response.get('cashback', response.get('applied_cashback', 0)) or 0
    amount_raw = response.get('amount')
    credited_raw = response.get('total_credited')

    txn.charge = himalpay.to_rupees(charge_paisa)
    txn.cashback = himalpay.to_rupees(cashback_paisa)

    gross = (
        himalpay.to_rupees(amount_raw)
        if amount_raw is not None and str(amount_raw).strip() != ''
        else Decimal(str(txn.amount or 0))
    )
    net = gross - txn.charge + txn.cashback
    if net < 0:
        net = Decimal('0.00')

    provider_credited = None
    if credited_raw is not None and str(credited_raw).strip() != '':
        provider_credited = himalpay.to_rupees(credited_raw)

    if provider_credited is not None and provider_credited > 0:
        # If provider echoed the gross amount while a charge applies, use net.
        if txn.charge > 0 and provider_credited == gross:
            txn.total_credited = net
        else:
            txn.total_credited = provider_credited
    else:
        txn.total_credited = net if (txn.charge or txn.cashback) else gross

    if txn.total_credited <= 0 and gross > 0 and txn.charge <= 0:
        txn.total_credited = gross

    txn.provider_txn_id = himalpay.extract_transaction_id(response) or None
    txn.reference_id = himalpay.extract_reference_id(response) or txn.ref_no
    txn.provider_response = response
    if persist and txn.pk:
        txn.save(
            update_fields=[
                'charge',
                'cashback',
                'total_credited',
                'provider_txn_id',
                'reference_id',
                'provider_response',
                'updated_at',
            ]
        )


def _provider_message(himalpay: HimalPayAPI, response, fallback: str = '') -> str:
    """Return the raw HimalPay/vendor message when present."""
    message = himalpay.extract_provider_message(response)
    return message or fallback


def _remittance_error_payload(
    *,
    error: str,
    message: str,
    himalpay_data=None,
    **extra,
) -> dict:
    """
    Always return Error / Message / HimaPay Response with real values.

    - error: short label (e.g. Already received)
    - message: actionable provider/user text
    - himapayResponse: raw HimalPay payload (via with_himapay_response)
    """
    payload = {
        'error': (error or 'Remittance failed').strip() or 'Remittance failed',
        'message': (message or error or 'Remittance failed').strip() or 'Remittance failed',
    }
    payload.update(extra)
    return with_himapay_response(payload, himalpay_data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lookup_remittance(request):
    """Step 1: Look up a remittance by ref_no via SAMSARA_GET."""
    blocked = require_feature_enabled('remittances')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = RemittanceLookupSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    ref_no = serializer.validated_data['ref_no']

    if RemittanceTransaction.objects.filter(ref_no=ref_no, status='success').exists():
        return Response(
            {
                'error': 'Already received',
                'message': f'Remittance {ref_no} has already been credited.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    himalpay = HimalPayAPI()
    try:
        raw = himalpay.lookup_remittance(ref_no)
        parsed = himalpay.parse_remittance_lookup(raw)
    except HimalPayError as exc:
        logger.error(
            'Remittance lookup failed: %s code=%s type=%s',
            exc.message, exc.error_code, exc.error_type,
        )
        return Response(
            _remittance_error_payload(
                error='Remittance lookup failed',
                message=exc.provider_message or exc.message or 'Remittance lookup failed',
                himalpay_data=exc.response_data,
                error_code=exc.error_code,
                error_type=exc.error_type,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )

    provider_message = _provider_message(himalpay, raw, '')
    vendor_state = himalpay.extract_vendor_state(raw)

    def _lookup_error(error: str, message: str, **extra):
        """Build a remittance lookup error; never invent 'Invalid amount'."""
        return Response(
            _remittance_error_payload(
                error=error,
                message=message,
                himalpay_data=raw,
                provider_message=provider_message or None,
                vendor_state=vendor_state or None,
                **extra,
            ),
            status=status.HTTP_400_BAD_REQUEST,
        )

    # HimalPay/Samsara may return outer SUCCESS with zero/missing payout_amt and
    # the real reason in vendor_state (already received / already paid / locked).
    # Surface that reason instead of a misleading "Invalid amount" / amount 0.
    if himalpay.is_remittance_already_received(provider_message, raw):
        return _lookup_error(
            'Already received',
            provider_message
            or vendor_state
            or f'Remittance {ref_no} has already been received.',
        )

    if himalpay.is_remittance_amount_locked(provider_message, raw):
        return _lookup_error(
            'Amount locked',
            provider_message or vendor_state or 'Amount is locked',
        )

    provider_status = himalpay.normalize_status(raw)
    if provider_status == 'failed':
        message = provider_message or vendor_state or 'Remittance lookup failed.'
        failure = himalpay.extract_failure_details(raw)
        return _lookup_error(
            'Remittance lookup failed',
            message,
            error_code=failure.get('error_code'),
            error_type=failure.get('error_type'),
        )

    if not parsed.get('samsara_link_id'):
        logger.error(
            'Remittance lookup missing samsara_link_id ref_no=%s raw_keys=%s',
            ref_no,
            list((parsed.get('raw') or {}).keys()) if isinstance(parsed.get('raw'), dict) else type(raw),
        )
        return _lookup_error(
            'Invalid remittance',
            provider_message
            or vendor_state
            or 'Remittance details could not be resolved. Check the reference number.',
        )

    if parsed['payout_amt'] <= 0:
        logger.error(
            'Remittance lookup missing/zero payout_amt ref_no=%s link_id=%s status=%s '
            'provider_message=%r vendor_state=%r raw=%s',
            ref_no,
            parsed.get('samsara_link_id'),
            parsed.get('status'),
            provider_message,
            vendor_state,
            parsed.get('raw') or raw,
        )
        # Always surface the exact HimalPay/vendor reason (ms_message / vendor_state).
        # Never invent "missing or zero" / "Remittance not available".
        message = provider_message or vendor_state or (
            'Remittance is not available for payout right now. '
            'Please try again later or contact MySewa support.'
        )
        if himalpay.is_remittance_already_received(message, raw):
            error_label = 'Already received'
        elif himalpay.is_remittance_amount_locked(message, raw):
            error_label = 'Amount locked'
        else:
            error_label = 'Lookup failed'
        return _lookup_error(error_label, message)

    lookup_status = str(parsed.get('status') or '').upper()
    if lookup_status and lookup_status not in (
        'SUCCESS', 'SUCCESSFUL', 'OK', 'PENDING', 'UNKNOWN', '',
    ):
        message = _provider_message(
            himalpay,
            raw,
            f'Remittance status is {lookup_status}.',
        )
        if himalpay.is_remittance_already_received(message, raw):
            error_label = 'Already received'
        elif himalpay.is_remittance_amount_locked(message, raw):
            error_label = 'Amount locked'
        else:
            error_label = 'Lookup failed'
        return _lookup_error(
            error_label,
            message,
            data={
                'ref_no': parsed.get('ref_no') or ref_no,
                'status': lookup_status,
            },
        )

    return Response(
        with_himapay_response(
            {
                'message': 'Remittance details retrieved',
                'data': {
                    'ref_no': parsed.get('ref_no') or ref_no,
                    'samsara_link_id': parsed['samsara_link_id'],
                    'amount': str(parsed['payout_amt']),
                    'payout_currency': parsed.get('payout_currency') or 'NPR',
                    'sender_name': parsed.get('sender_name') or '',
                    'sender_address': parsed.get('sender_address') or '',
                    'sender_city': parsed.get('sender_city') or '',
                    'sender_country': parsed.get('sender_country') or '',
                    'sender_mobile': parsed.get('sender_mobile') or '',
                    'receiver_name': parsed.get('receiver_name') or '',
                    'receiver_phone': parsed.get('receiver_phone') or '',
                    'receiver_address': parsed.get('receiver_address') or '',
                    'receiver_city': parsed.get('receiver_city') or '',
                    'receiver_country': parsed.get('receiver_country') or '',
                    'payment_type': parsed.get('payment_type') or '',
                    'send_agent': parsed.get('send_agent') or '',
                    'txn_date': parsed.get('txn_date') or '',
                    'status': parsed.get('status') or '',
                },
                'lookup_response': parsed.get('raw') or raw,
            },
            raw,
        ),
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def receive_remittance(request):
    """Step 2: Confirm remittance payout via SAMSARA_PAY and credit wallet."""
    blocked = require_feature_enabled('remittances')
    if blocked:
        return blocked
    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = RemittanceReceiveSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from ..services.pin import transaction_pin_gate
    pin_failed = transaction_pin_gate(
        request.user, serializer.validated_data.get('transaction_pin')
    )
    if pin_failed:
        return pin_failed

    data = serializer.validated_data
    # Strip PIN so it is never persisted on the remittance row / provider payload.
    data.pop('transaction_pin', None)
    ref_no = data['ref_no']
    samsara_link_id = data['samsara_link_id']
    amount = HimalPayAPI.normalize_rupees(data['amount'])

    if RemittanceTransaction.objects.filter(ref_no=ref_no, status='success').exists():
        return Response(
            {
                'error': 'Already received',
                'message': f'Remittance {ref_no} has already been credited.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    agent = _agent_defaults()
    from django.conf import settings as django_settings
    bypass = getattr(django_settings, 'HIMALPAY_BYPASS_API', False)
    if bypass:
        agent.setdefault('payout_agent_pan_number', agent.get('payout_agent_pan_number') or '123456789')
        agent.setdefault('teller_contact', agent.get('teller_contact') or '9800000000')
        if not agent.get('payout_agent_pan_number'):
            agent['payout_agent_pan_number'] = '123456789'
        if not agent.get('teller_contact'):
            agent['teller_contact'] = '9800000000'
    elif not agent.get('payout_agent_pan_number'):
        return Response(
            {
                'error': 'Agent not configured',
                'message': (
                    'Remittance agent PAN is not configured. '
                    'Ask an admin to set it under Settings → Remittance agent.'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    elif not agent.get('teller_contact'):
        return Response(
            {
                'error': 'Agent not configured',
                'message': (
                    'Teller contact is not configured. '
                    'Ask an admin to set it under Settings → Remittance agent.'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    merchant_txn_id = f"MYSEWA_REM_{uuid.uuid4().hex[:16].upper()}"
    beneficiary = {field: data.get(field) or '' for field in BENEFICIARY_FIELDS}
    if not beneficiary['beneficiary_mobile_no']:
        beneficiary['beneficiary_mobile_no'] = request.user.phone

    txn = RemittanceTransaction.objects.create(
        user=request.user,
        ref_no=ref_no,
        samsara_link_id=samsara_link_id,
        amount=amount,
        payout_currency=data.get('payout_currency') or 'NPR',
        sender_name=data.get('sender_name') or '',
        sender_address=data.get('sender_address') or '',
        sender_city=data.get('sender_city') or '',
        sender_country=data.get('sender_country') or '',
        receiver_name=data.get('receiver_name') or '',
        receiver_phone=data.get('receiver_phone') or '',
        receiver_country=data.get('receiver_country') or '',
        payment_type=data.get('payment_type') or '',
        txn_date=data.get('txn_date') or '',
        status='pending',
        merchant_txn_id=merchant_txn_id,
        total_credited=amount,
        **beneficiary,
    )

    pay_data = {
        'samsara_link_id': samsara_link_id,
        **agent,
        **beneficiary,
    }
    meta_data = [
        {
            'title': 'Payment Details',
            'details': [
                {
                    'receiver_country': data.get('receiver_country') or 'NEPAL',
                    'receiver_name': data.get('receiver_name') or '',
                    'receiver_phone': data.get('receiver_phone') or '',
                    'ref_no': ref_no,
                    'send_agent': data.get('send_agent') or '',
                    'sender_address': data.get('sender_address') or '',
                    'sender_city': data.get('sender_city') or '',
                    'sender_country': data.get('sender_country') or '',
                }
            ],
        }
    ]

    himalpay = HimalPayAPI()
    try:
        response = himalpay.receive_remittance(
            amount_rupees=amount,
            merchant_transaction_id=merchant_txn_id,
            data=pay_data,
            meta_data=meta_data,
        )
        txn_status = himalpay.normalize_status(response)
        _apply_load_fields(txn, himalpay, response)

        if txn_status == 'failed':
            txn.status = 'failed'
            txn.save()
            failure = himalpay.extract_failure_details(response)
            return Response(
                _remittance_error_payload(
                    error='Remittance payout failed',
                    message=(
                        failure.get('provider_message')
                        or failure.get('message')
                        or _provider_message(himalpay, response, 'Payout failed')
                    ),
                    himalpay_data=response,
                    data=RemittanceTransactionSerializer(txn).data,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )

        if txn_status == 'success':
            ok, err = apply_inbound_status_change(txn, 'success')
            if not ok:
                txn.status = 'pending'
                txn.save(update_fields=['status', 'updated_at'])
                return Response(
                    _remittance_error_payload(
                        error='Wallet credit failed',
                        message=err or 'Could not credit wallet after successful payout.',
                        himalpay_data=response,
                        data=RemittanceTransactionSerializer(txn).data,
                    ),
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            txn.refresh_from_db()
            notify_remittance_success(txn)
            return Response(
                with_himapay_response(
                    {
                        'message': 'Remittance received and credited to wallet',
                        'data': RemittanceTransactionSerializer(txn).data,
                    },
                    response,
                ),
                status=status.HTTP_200_OK,
            )

        # Provider pending / unknown — keep local pending, do not credit yet
        txn.status = 'pending'
        txn.save()
        return Response(
            with_himapay_response(
                {
                    'message': 'Remittance payout is being processed',
                    'pending_message': (
                        _provider_message(himalpay, response)
                        or response.get('message')
                        or 'Your remittance is being processed. Check status shortly.'
                    ),
                    'data': RemittanceTransactionSerializer(txn).data,
                },
                response,
            ),
            status=status.HTTP_202_ACCEPTED,
        )

    except HimalPayError as exc:
        txn.status = 'failed'
        txn.provider_response = exc.response_data
        txn.save()
        logger.error(
            'Remittance HimalPay error: %s code=%s type=%s',
            exc.message, exc.error_code, exc.error_type,
        )
        return Response(
            _remittance_error_payload(
                error='Remittance payout failed',
                message=exc.provider_message or exc.message or 'Remittance payout failed',
                himalpay_data=exc.response_data,
                error_code=exc.error_code,
                error_type=exc.error_type,
                data=RemittanceTransactionSerializer(txn).data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        txn.status = 'failed'
        txn.save()
        logger.exception('Unexpected remittance error: %s', exc)
        return Response(
            {
                'error': 'Remittance payout failed',
                'message': 'An unexpected error occurred while processing remittance.',
                'data': RemittanceTransactionSerializer(txn).data,
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def remittance_history(request):
    from ..services.list_response import items_with_stats_response

    qs = RemittanceTransaction.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        qs,
        RemittanceTransactionSerializer,
        request,
        search_fields=(
            'ref_no', 'sender_name', 'receiver_name', 'receiver_phone',
            'merchant_txn_id', 'reference_id',
        ),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def remittance_status(request):
    serializer = TransactionStatusSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    merchant_txn_id = serializer.validated_data['merchant_transaction_id']
    try:
        txn = RemittanceTransaction.objects.get(
            user=request.user, merchant_txn_id=merchant_txn_id,
        )
    except RemittanceTransaction.DoesNotExist:
        return Response({'error': 'Remittance not found'}, status=status.HTTP_404_NOT_FOUND)

    himalpay = HimalPayAPI()
    try:
        response = himalpay.check_transaction_status(merchant_txn_id)
        provider_status = himalpay.normalize_status(response)
        _apply_load_fields(txn, himalpay, response)

        if provider_status == 'success' and txn.status != 'success':
            apply_inbound_status_change(txn, 'success')
            txn.refresh_from_db()
            notify_remittance_success(txn)
        elif provider_status == 'failed' and txn.status != 'failed':
            apply_inbound_status_change(txn, 'failed')
            txn.refresh_from_db()
        else:
            txn.save()

        return Response(
            with_himapay_response(
                {
                    'message': 'Status checked',
                    'provider_status': provider_status,
                    'data': RemittanceTransactionSerializer(txn).data,
                },
                response,
            )
        )
    except HimalPayError as exc:
        return Response(
            _remittance_error_payload(
                error='Status check failed',
                message=exc.provider_message or exc.message or 'Status check failed',
                himalpay_data=exc.response_data,
                data=RemittanceTransactionSerializer(txn).data,
            ),
            status=status.HTTP_400_BAD_REQUEST if exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
        )
