"""
Deposit views: manual wallet load + Himal Pay Checkout + PayBridgeNP payin.
"""
from django.http import HttpResponseRedirect
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
import logging

from ..models import Deposit, _ensure_checkout_session_table
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
    checkout_session_public_dict,
    create_checkout_session,
    extract_documented_identifiers,
    frontend_result_url,
    resolve_checkout_intent,
    sanitize_provider_payload,
    verify_checkout_intent,
)
from ..services.himalpay_checkout import append_query, default_frontend_return_url
from ..services.notifications import notify_deposit_submitted
from ..services.paybridgenp import PayBridgeError
from ..services import paybridge_deposit as pb

logger = logging.getLogger(__name__)

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
    http_status = exc.status_code or status.HTTP_400_BAD_REQUEST
    if http_status == 500:
        http_status = status.HTTP_502_BAD_GATEWAY
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
        status=http_status,
    )


def _public_checkout_data(request, session, deposit):
    if deposit is not None:
        return DepositSerializer(deposit, context={'request': request}).data
    if session is not None:
        return checkout_session_public_dict(session)
    return None


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
    """Create a Himal Pay Checkout QR session. Does not create a wallet transaction."""
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
        _ensure_checkout_session_table()
        session, payment_url = create_checkout_session(request.user, amount)
    except HimalPayError as exc:
        return _deposit_error(exc)
    except Exception as exc:
        logger.exception('checkout_initiate failed')
        return Response(
            with_himapay_response(
                {
                    'error': str(exc) or 'Could not start Himal Pay Checkout.',
                    'message': str(exc) or 'Could not start Himal Pay Checkout.',
                    'code': 'checkout_initiate_failed',
                },
                {'error': str(exc)},
            ),
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(
        with_himapay_response(
            {
                'message': 'Checkout QR ready',
                'payment_url': payment_url,
                'data': checkout_session_public_dict(session),
            },
            sanitize_provider_payload(session.provider_payload),
        ),
        status=status.HTTP_201_CREATED,
    )


def _verify_response(request, outcome, session, deposit):
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
    payload_source = deposit if deposit is not None else session
    provider_payload = getattr(payload_source, 'provider_payload', None) if payload_source else None
    return Response(
        with_himapay_response(
            {
                'message': messages.get(outcome, 'Checkout status updated'),
                'outcome': outcome,
                'already_processed': already,
                'data': _public_checkout_data(request, session, deposit),
            },
            sanitize_provider_payload(provider_payload),
        ),
        status=http_status,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def checkout_verify(request):
    """
    Server-side verification via checkout-status.

    Ignores any client-supplied payment status or amount.
    Creates a wallet Deposit only after Himal Pay reports payment completed.
    """
    try:
        outcome, session, deposit = verify_checkout_intent(
            process_id=str(request.data.get('process_id') or ''),
            purchase_order_identifier=str(
                request.data.get('purchase_order_identifier')
                or request.data.get('order')
                or ''
            ),
            session_id=request.data.get('session_id'),
            deposit_id=request.data.get('deposit_id'),
            generic_id=request.data.get('id'),
            user=request.user,
        )
    except LookupError:
        return Response({'error': 'Checkout session not found'}, status=status.HTTP_404_NOT_FOUND)
    except HimalPayError as exc:
        return _deposit_error(exc)
    return _verify_response(request, outcome, session, deposit)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def checkout_return(request):
    """
    Customer return_url. Identifies the session from our own `order` query
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
    session, deposit = resolve_checkout_intent(
        process_id=process_id,
        purchase_order_identifier=order,
    )
    if session is None and deposit is None:
        target = append_query(default_frontend_return_url(), order=order, error='not_found')
        return HttpResponseRedirect(target)

    try:
        if session is not None:
            _, session, deposit = verify_checkout_intent(
                process_id=process_id or (session.process_id or ''),
                purchase_order_identifier=order or session.purchase_order_identifier,
                session_id=session.pk,
            )
        else:
            _, session, deposit = verify_checkout_intent(
                process_id=process_id,
                purchase_order_identifier=order,
                deposit_id=deposit.pk,
            )
    except HimalPayError:
        pass
    record = session or deposit
    return HttpResponseRedirect(frontend_result_url(record, deposit))


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
    try:
        outcome, session, deposit = verify_checkout_intent(
            process_id=identifiers.get('process_id', ''),
            purchase_order_identifier=identifiers.get('purchase_order_identifier', ''),
        )
    except LookupError:
        return Response({'error': 'Checkout session not found'}, status=status.HTTP_404_NOT_FOUND)
    except HimalPayError as exc:
        return _deposit_error(exc)
    already = outcome == ALREADY_PROCESSED
    status_value = deposit.status if deposit is not None else (session.status if session else '')
    payload_source = deposit if deposit is not None else session
    return Response(
        with_himapay_response(
            {
                'ok': True,
                'outcome': outcome,
                'already_processed': already,
                'status': status_value,
            },
            sanitize_provider_payload(
                getattr(payload_source, 'provider_payload', None) if payload_source else None
            ),
        ),
        status=status.HTTP_200_OK,
    )


def _paybridge_error(exc: PayBridgeError):
    http_status = exc.status_code or status.HTTP_400_BAD_REQUEST
    if http_status == 500:
        http_status = status.HTTP_502_BAD_GATEWAY
    return Response(
        {
            'error': str(exc.message or exc),
            'message': str(exc.message or exc),
            'code': 'paybridgenp_error',
            'error_code': getattr(exc, 'error_code', None),
            'error_type': getattr(exc, 'error_type', None),
        },
        status=http_status,
    )


def _paybridge_verify_response(request, outcome, deposit):
    messages = {
        pb.SETTLED: 'Deposit verified and wallet credited',
        pb.ALREADY_PROCESSED: 'Deposit already processed',
        pb.PENDING_PAYMENT: 'Payment is not completed yet',
        pb.FAILED_PAYMENT: 'Payment was not successful',
        pb.AMOUNT_MISMATCH: 'Provider amount does not match the deposit. Held for review.',
        pb.ORDER_MISMATCH: 'Provider order id does not match the deposit. Held for review.',
    }
    http_status = status.HTTP_200_OK
    if outcome in (pb.AMOUNT_MISMATCH, pb.ORDER_MISMATCH):
        http_status = status.HTTP_409_CONFLICT
    return Response(
        {
            'message': messages.get(outcome, 'PayBridgeNP status updated'),
            'outcome': outcome,
            'already_processed': outcome == pb.ALREADY_PROCESSED,
            'data': DepositSerializer(deposit, context={'request': request}).data if deposit else None,
        },
        status=http_status,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def paybridge_initiate(request):
    """Create a PayBridgeNP Direct-QR (preferred) or hosted checkout deposit."""
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
        deposit, public = pb.create_paybridge_deposit(request.user, amount)
    except PayBridgeError as exc:
        return _paybridge_error(exc)
    except Exception as exc:
        logger.exception('paybridge_initiate failed')
        return Response(
            {
                'error': str(exc) or 'Could not start PayBridgeNP checkout.',
                'message': str(exc) or 'Could not start PayBridgeNP checkout.',
                'code': 'paybridge_initiate_failed',
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    checkout_url = str(public.get('checkout_url') or public.get('payment_url') or '').strip()
    return Response(
        {
            'message': 'PayBridgeNP checkout ready',
            'payment_url': checkout_url,
            'checkout_url': checkout_url,
            'mode': public.get('mode') or '',
            'qr_image': public.get('qr_image') or '',
            'qr_message': public.get('qr_message') or '',
            'events_url': public.get('events_url') or '',
            'expires_at': public.get('expires_at'),
            'session_id': public.get('session_id') or '',
            'data': DepositSerializer(deposit, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def paybridge_refresh_qr(request):
    """Refresh the in-app Fonepay QR display window for a pending Direct-QR deposit."""
    blocked = require_feature_enabled('deposits')
    if blocked:
        return blocked

    deposit_id = request.data.get('deposit_id') or request.data.get('id')
    try:
        deposit = Deposit.objects.get(
            pk=deposit_id,
            user=request.user,
            provider=Deposit.PROVIDER_PAYBRIDGENP,
        )
    except (Deposit.DoesNotExist, TypeError, ValueError):
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        public = pb.refresh_paybridge_qr(deposit)
    except PayBridgeError as exc:
        return _paybridge_error(exc)
    except Exception as exc:
        logger.exception('paybridge_refresh_qr failed deposit=%s', deposit_id)
        return Response(
            {
                'error': str(exc) or 'Could not refresh QR.',
                'message': str(exc) or 'Could not refresh QR.',
                'code': 'paybridge_refresh_failed',
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(
        {
            'message': 'QR refreshed',
            **public,
            'data': DepositSerializer(deposit, context={'request': request}).data,
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def paybridge_verify(request):
    """
    Server-side verification via PayBridgeNP GET session/payment.
    Never trusts client-supplied payment status or amount.
    """
    deposit = pb.lookup_paybridge_deposit(
        order_id=str(
            request.data.get('order_id')
            or request.data.get('order')
            or request.data.get('purchase_order_identifier')
            or ''
        ),
        session_id=str(request.data.get('session_id') or request.data.get('process_id') or ''),
        payment_id=str(request.data.get('payment_id') or ''),
        deposit_id=request.data.get('deposit_id') or request.data.get('id'),
        user=request.user,
    )
    if deposit is None:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)
    try:
        outcome, deposit = pb.verify_deposit(deposit)
    except PayBridgeError as exc:
        return _paybridge_error(exc)
    return _paybridge_verify_response(request, outcome, deposit)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def paybridge_status(request, deposit_id):
    """Authenticated deposit status for the owning user only."""
    try:
        deposit = Deposit.objects.get(
            pk=deposit_id,
            user=request.user,
            provider=Deposit.PROVIDER_PAYBRIDGENP,
        )
    except Deposit.DoesNotExist:
        return Response({'error': 'Deposit not found'}, status=status.HTTP_404_NOT_FOUND)

    # Soft poll provider while still open (does not trust client).
    if deposit.status in (Deposit.STATUS_PENDING, Deposit.STATUS_PROCESSING):
        try:
            _, deposit = pb.verify_deposit(deposit)
        except PayBridgeError:
            pass
        except Exception:
            logger.exception('paybridge_status verify failed deposit=%s', deposit_id)

    include_qr = str(request.query_params.get('include_qr') or '').lower() in (
        '1',
        'true',
        'yes',
    )
    return Response(
        pb.public_deposit_dict(deposit, include_qr=include_qr),
        status=status.HTTP_200_OK,
    )


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def paybridge_return(request):
    """
    Customer return_url. Identifies deposit from our `order` query param,
    then verifies via PayBridgeNP API. Never trusts redirect status/amount.

    App deposits redirect to the authenticated MySewa frontend page.

    API Payin deposits (e.g. Lucky777):
      1. Verify using return-url payment_id/session_id when present.
      2. POST result to the API user's saved webhook URL (server-to-server).
      3. Redirect the browser to that same webhook URL with success query
         params so the game flow continues (no MySewa login).
      4. If no webhook URL is configured, show the public success HTML page.
    """
    order = (
        request.query_params.get('order')
        or request.query_params.get('order_id')
        or ''
    )
    session_id = (
        request.query_params.get('session_id')
        or request.query_params.get('process_id')
        or ''
    )
    payment_id = request.query_params.get('payment_id') or ''

    deposit = pb.lookup_paybridge_deposit(
        order_id=order,
        session_id=session_id,
        payment_id=payment_id,
    )
    if deposit is None:
        # Prefer a public page over /app/paybridge-return (which requires login).
        return pb.api_payin_public_return_response(error='not_found')

    try:
        pb.verify_deposit(
            deposit,
            payment_id=payment_id,
            session_id=session_id,
        )
    except PayBridgeError:
        pass
    except Exception:
        logger.exception('paybridge_return verify failed deposit=%s', deposit.pk)

    try:
        deposit = (
            Deposit.objects.select_related('initiated_by', 'user')
            .filter(pk=deposit.pk)
            .first()
        ) or deposit
    except Exception:
        try:
            deposit.refresh_from_db()
        except Exception:
            pass

    if deposit.source == Deposit.SOURCE_API:
        # Safety net: always attempt developer callback when approved on return.
        if deposit.status == Deposit.STATUS_APPROVED:
            try:
                from ..services.api_payin_webhook import deliver_developer_payin_webhook
                deliver_developer_payin_webhook(deposit)
            except Exception:
                logger.exception(
                    'paybridge_return developer webhook failed deposit=%s',
                    deposit.pk,
                )

            partner_url = pb.developer_payin_browser_return_url(deposit)
            if partner_url:
                return HttpResponseRedirect(partner_url)

        refresh = request.build_absolute_uri()
        return pb.api_payin_public_return_response(deposit, refresh_url=refresh)

    return HttpResponseRedirect(
        pb.frontend_result_url(
            order=deposit.purchase_order_identifier or order,
            deposit_id=deposit.pk,
        )
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def paybridge_webhook(request):
    """
    Signed PayBridgeNP webhook. Uses raw body for HMAC verification.
    Credits wallet only after payment.succeeded + amount/currency match.
    """
    raw_body = getattr(request, '_paybridge_raw_body', None)
    if raw_body is None:
        try:
            raw_body = request.body.decode('utf-8')
        except Exception:
            raw_body = ''
    signature = (
        request.META.get('HTTP_X_PAYBRIDGENP_SIGNATURE')
        or request.headers.get('X-PayBridgeNP-Signature')
        or ''
    )
    try:
        outcome, deposit = pb.process_raw_webhook(raw_body, signature)
    except PayBridgeError as exc:
        return _paybridge_error(exc)
    except Exception:
        logger.exception('paybridge_webhook failed')
        return Response({'error': 'Webhook processing failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response(
        {
            'received': True,
            'outcome': outcome,
            'already_processed': outcome == pb.ALREADY_PROCESSED,
            'deposit_id': deposit.pk if deposit else None,
            'status': deposit.status if deposit else None,
        },
        status=status.HTTP_200_OK,
    )
