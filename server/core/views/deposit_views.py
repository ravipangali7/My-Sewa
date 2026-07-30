"""
Deposit views: Create deposit request, list deposits, upload screenshot
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import Deposit
from ..serializers import DepositSerializer, DepositCreateSerializer


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_deposit(request):
    """Create a new deposit request"""
    serializer = DepositCreateSerializer(data=request.data)
    if serializer.is_valid():
        deposit = Deposit.objects.create(
            user=request.user,
            amount=serializer.validated_data['amount'],
            screenshot_proof=serializer.validated_data['screenshot_proof'],
            note=serializer.validated_data.get('note', ''),
            status='pending'
        )
        response_serializer = DepositSerializer(deposit)
        return Response({
            'message': 'Deposit request created successfully',
            'data': response_serializer.data
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_deposits(request):
    """List all deposits for the current user"""
    deposits = Deposit.objects.filter(user=request.user).order_by('-created_at')
    serializer = DepositSerializer(deposits, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_deposit(request, deposit_id):
    """Get a specific deposit by ID"""
    try:
        deposit = Deposit.objects.get(id=deposit_id, user=request.user)
        serializer = DepositSerializer(deposit)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Deposit.DoesNotExist:
        return Response({
            'error': 'Deposit not found'
        }, status=status.HTTP_404_NOT_FOUND)
