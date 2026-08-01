"""
Deposit views: Create deposit request, list deposits
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import Deposit
from ..serializers import DepositSerializer, DepositCreateSerializer
from ..services.app_config import is_auto_status_verified, require_feature_enabled, require_account_approved
from ..services.notifications import notify_deposit_submitted


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_deposit(request):
    """Create a new deposit request"""
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
            screenshot_proof=serializer.validated_data.get('screenshot_proof'),
            note=serializer.validated_data.get('note', ''),
            status='pending'
        )
        notify_deposit_submitted(deposit)

        # Super Admin: Auto Status Verified → approve immediately (wallet credited via signal)
        if is_auto_status_verified():
            deposit.status = 'approved'
            deposit.save()

        response_serializer = DepositSerializer(deposit, context={'request': request})
        message = (
            'Deposit approved automatically'
            if deposit.status == 'approved'
            else 'Deposit request created successfully'
        )
        return Response({
            'message': message,
            'data': response_serializer.data
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_deposits(request):
    """List all deposits for the current user"""
    deposits = Deposit.objects.filter(user=request.user).order_by('-created_at')
    serializer = DepositSerializer(deposits, many=True, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)


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
