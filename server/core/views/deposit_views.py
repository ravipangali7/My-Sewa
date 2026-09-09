"""
Deposit views: manual wallet load + Himal Pay Checkout payin.
"""
from django.http import HttpResponseRedirect
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from ..models import Deposit
from ..serializers import DepositSerializer, DepositCreateSerializer
from ..services.app_config import require_feature_enabled, require_account_approved, require_wallet_not_frozen
from ..services.himalpay import HimalPayError, with_himapay_response
from ..services.checkout_deposit import (
    ALREADY_PROCESSED,
    AMOUNT_MISMATCH,
    FAILED_PAYMENT,
    ORDER_MISMATCH,
    PENDING_PAYMENT,
    SETTLED,
    create_checkout_deposit,
    extract_documented_identifiers,
    frontend_result_url,
    lookup_checkout_deposit,
    sanitize_provider_payload,
    verify_deposit,
)
from ..services.notifications import notify_deposit_submitted

_DEPOSIT_PENDING = ('pending', 'processing')
_DEPOSIT_FAILED = ('rejected', 'failed', 'cancelled', 'expired', 'refunded')
_DEPOSIT_ALIASES = {
    'success': 'approved',
    'failed': list(_DEPOSIT_FAILED),
    'approved': 'approved',
    'rejected': 'rejected',
    'pending': list(_DEPOSIT_PENDING),
    'processing': 'processing',
    'expired': 'expired',
    'cancelled': 'cancelled',
    'refunded': 'refunded',
}


def _himalpay_network_payload(exc: HimalPayError):
    """Sanitized HimalPay body (or local error) for the Network tab."""
    data = sanitize_provider_payload(getattr(exc, 'response_data', None))
    if data:
        return data
    payload = {}
    provider_message = str(getattr(exc, 'provider_message', '') or '').strip()
    if provider_message:
        payload['error'] = provider_message
    if getattr(exc, 'error_code', None) is not None:
        payload['error_code'] = exc.error_code
    if getattr(exc, 'error_type', None):
        payload['error_type'] = exc.error_type
    return payload or {'error': str(exc.message or exc)}


def _deposit_error(exc: HimalPayError):
    return Response(
        with_himapay_response(
            {
                'error': str(exc.message or exc),
                'message': str(exc.message or exc),
                'code': 'himalpay_checkout_error',
                'error_code': getattr(exc, 'error_code', None),
                'error_type': getattr(exc, 'error_type', None),
            },
            _himalpay_network_payload(exc),
        ),
        status=exc.status_code or status.HTTP_400_BAD_REQUEST,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_deposit(request):
    """Create a new manual deposit request.

    Manual deposits always stay pending for Super Admin approval, even when
    Auto Status Verified is enabled for top-ups/transfers/bills.
    """
    blocked = require_feature_enabled('deposits')
    if blocked:
        return blocked

    pending = require_account_approved(request.user)
    if pending:
        return pending

    frozen = require_wallet_not_frozen(request.user)
    if frozen:
        return frozen

    serializer = DepositCreateSerializer(data=request.data, context={'request': request})
    if serializer.is_valid():
        deposit = Deposit.objects.create(
            user=request.user,
            amount=serializer.validated_data['amount'],
            transaction_id=serializer.validated_data.get('transaction_id', ''),
            deposit_date=serializer.validated_data.get('deposit_date'),
            bank_name=serializer.validated_data.get('bank_name', ''),
            screenshot_proof=serializer.validated_data.get('screenshot_proof'),
            note=serializer.validated_data.get('note') or '',
            payout_account=serializer.validated_data.get('payout_account'),
            status='pending',
            provider=Deposit.PROVIDER_MANUAL,
        )
        notify_deposit_submitted(deposit)

        response_serializer = DepositSerializer(deposit, context={'request': request})
        return Response({
            'message': 'Deposit request created successfully',
            'data': response_serializer.data
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_deposits(request):
    """List deposits for the current user as {items, stats}."""
    from ..services.list_response import items_with_stats_response

    deposits = Deposit.objects.filter(user=request.user).order_by('-created_at')
    return items_with_stats_response(
        deposits,
        DepositSerializer,
        request,
        search_fields=(
            'transaction_id', 'bank_name', 'note', 'rejection_reason',
            'purchase_order_identifier', 'process_id', 'failure_reason',
        ),
        success=('approved',),
        pending=_DEPOSIT_PENDING,
        failed=_DEPOSIT_FAILED,
        status_aliases=_DEPOSIT_ALIASES,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_deposit(request, deposit_id):
    """Get a specific deposit by ID"""
    try:
        deposit = Deposit.objects.get(id=deposit_id, user=request.user)
        serializer = DepositSerializer(deposit, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Deposit.DoesNotExist:
        return Response({
            'error': 'Deposit not found'
        }, status=status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def checkout_initiate(request):
    """Create a pending Himal Pay Checkout deposit and return payment_url."""
    blocked = require_feature_enabled('deposits')
    if blocked:
        return blocked

    pending = require_account_approved(request.user)
    if pending:
        return pending

    frozen = require_wallet_not_frozen(request.user)
    if frozen:
        return frozen

    amount = request.data.get('amount')
    try:
        deposit, payment_url = create_checkout_deposit(request.user, amount)
    except HimalPayError as exc:
        return _deposit_error(exc)

    return Response(
        with_himapay_response(
            {
                'message': 'Checkout session created',
                'payment_url': payment_url,
                'data': DepositSerializer(deposit, context={'request': request}).data,
            },
            sanitize_provider_payload(deposit.provider_payload),
        ),
        status=status.HTTP_201_CREATED,
    )


def _verify_response(request, deposit, outcome):
    messages = {
        SETTLED: 'Deposit verified and wallet credited',
        ALREADY_PROCESSED: 'Deposit already processed',
        PENDING_PAYMENT: 'Payment is not completed yet',
        FAILED_PAYMENT: 'Payment was not successful',
        AMOUNT_MISMATCH: 'Provider amount does not match the deposit. Held for review.',
        ORDER_MISMATCH: 'Provider order id does not match the deposit. Held for review.',
    }
    already = outcome == ALREADY_PROCESSED
    http_status = status.HTTP_200_OK
    if outcome in (AMOUNT_MISMATCH, ORDER_MISMATCH):
        http_status = status.HTTP_409_CONFLICT
    return Response(
        with_himapay_response(
            {
                'message': messages.get(outcome, 'Checkout status updated'),
                'outcome': outcome,
                'already_processed': already,
                'data': DepositSerializer(deposit, context={'request': request}).data,
            },
            sanitize_provider_payload(deposit.provider_payload),
        ),
        status=http_status,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def checkout_verify(request):
    """
    Server-side verification via checkout-status.

    Ignores any client-supplied payment status or amount.
    """
    deposit = lookup_checkout_deposit(
        process_id=str(request.data.get('process_id') or ''),
        purchase_order_identifier=str(
            request.data.get('purchase_order_identifier')
            or request.data.get('order')
            or ''
        ),
        deposit_id=request.data.get('id') or request.data.get('deposit_id'),
        user=request.user,
    )
    if deposit is None:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    try:
        outcome, deposit = verify_deposit(deposit)
    except HimalPayError as exc:
        return _deposit_error(exc)
    return _verify_response(request, deposit, outcome)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def checkout_return(request):
    """
    Customer return_url. Identifies the deposit from our own `order` query
    param (purchase_order_identifier we placed on return_url), then verifies
    via checkout-status. Never trusts redirect status/amount as payment proof.
    """
    identifiers = extract_documented_identifiers(request.data if hasattr(request, 'data') else {})
    order = (
        request.query_params.get('order')
        or request.query_params.get('purchase_order_identifier')
        or identifiers.get('purchase_order_identifier')
        or ''
    )
    process_id = (
        request.query_params.get('process_id')
        or identifiers.get('process_id')
        or ''
    )
    deposit = lookup_checkout_deposit(
        process_id=process_id,
        purchase_order_identifier=order,
    )
    if deposit is None:
        target = frontend_result_url(Deposit(purchase_order_identifier=order or '', pk=0))
        # pk=0 would be wrong; send order only
        from ..services.himalpay_checkout import append_query, default_frontend_return_url
        target = append_query(default_frontend_return_url(), order=order, error='not_found')
        return HttpResponseRedirect(target)

    try:
        verify_deposit(deposit)
        deposit.refresh_from_db()
    except HimalPayError:
        pass
    return HttpResponseRedirect(frontend_result_url(deposit))


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def checkout_webhook(request):
    """
    Optional inbound trigger. Checkout docs do not define a webhook payload
    or signature. This endpoint only extracts documented identifiers
    (process_id, purchase_order_identifier) and calls checkout-status.

    Status/amount in the body are ignored.
    """
    identifiers = extract_documented_identifiers(request.data)
    if not identifiers.get('process_id') and not identifiers.get('purchase_order_identifier'):
        return Response(
            {
                'error': 'Missing process_id or purchase_order_identifier',
                'message': 'Callback must include a documented Checkout identifier.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    deposit = lookup_checkout_deposit(
        process_id=identifiers.get('process_id', ''),
        purchase_order_identifier=identifiers.get('purchase_order_identifier', ''),
    )
    if deposit is None:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    try:
        outcome, deposit = verify_deposit(deposit)
    except HimalPayError as exc:
        return _deposit_error(exc)
    already = outcome == ALREADY_PROCESSED
    return Response(
        with_himapay_response(
            {
                'ok': True,
                'outcome': outcome,
                'already_processed': already,
                'status': deposit.status,
            },
            sanitize_provider_payload(deposit.provider_payload),
        ),
        status=status.HTTP_200_OK,
    )
