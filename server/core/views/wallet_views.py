"""
Wallet views: Get balance, transaction history
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import Wallet, Deposit, TopupTransaction, BankTransferTransaction, RemittanceTransaction
from ..serializers import (
    WalletSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    BankTransferTransactionSerializer,
    RemittanceTransactionSerializer,
)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_wallet_balance(request):
    """Get current user's wallet balance"""
    try:
        wallet = Wallet.objects.get(user=request.user)
        serializer = WalletSerializer(wallet)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Wallet.DoesNotExist:
        wallet = Wallet.objects.create(user=request.user, balance=0.00)
        serializer = WalletSerializer(wallet)
        return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_transaction_history(request):
    """Get transaction history (deposits, remittances, topups, bank transfers)"""
    deposits = Deposit.objects.filter(user=request.user).order_by('-created_at')
    remittances = RemittanceTransaction.objects.filter(user=request.user).order_by('-created_at')
    topups = TopupTransaction.objects.filter(user=request.user).order_by('-created_at')
    transfers = BankTransferTransaction.objects.filter(user=request.user).order_by('-created_at')

    return Response({
        'deposits': DepositSerializer(deposits, many=True).data,
        'remittances': RemittanceTransactionSerializer(remittances, many=True).data,
        'topups': TopupTransactionSerializer(topups, many=True).data,
        'bank_transfers': BankTransferTransactionSerializer(transfers, many=True).data,
    }, status=status.HTTP_200_OK)
