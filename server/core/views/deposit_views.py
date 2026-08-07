"""
Deposit views: Create deposit request, list deposits
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import Deposit
from ..serializers import DepositSerializer, DepositCreateSerializer
from ..services.app_config import require_feature_enabled, require_account_approved
from ..services.notifications import notify_deposit_submitted


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_deposit(request):
    """Create a new deposit request.

    Manual deposits always stay pending for Super Admin approval, even when
    Auto Status Verified is enabled for top-ups/transfers/bills.
    """
    blocked = require_feature_enabled('deposits')
    if blocked:
        return blocked

    pending = require_account_approved(request.user)
    if pending:
        return pending

    serializer = DepositCreateSerializer(data=request.data)
    if serializer.is_valid():
        deposit = Deposit.objects.create(
            user=request.user,
            amount=serializer.validated_data['amount'],
            transaction_id=serializer.validated_data.get('transaction_id', ''),
            deposit_date=serializer.validated_data.get('deposit_date'),
            bank_name=serializer.validated_data.get('bank_name', ''),
            screenshot_proof=serializer.validated_data.get('screenshot_proof'),
            note=serializer.validated_data.get('note') or '',
            status='pending',
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
        search_fields=('transaction_id', 'bank_name', 'note', 'rejection_reason'),
        success=('approved',),
        pending=('pending',),
        failed=('rejected',),
        status_aliases={
            'success': 'approved',
            'failed': 'rejected',
            'approved': 'approved',
            'rejected': 'rejected',
        },
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
