"""
Wallet views: Get balance, transaction history
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from ..models import (
    Wallet,
    Deposit,
    TopupTransaction,
    BankTransferTransaction,
    RemittanceTransaction,
    InternetBillTransaction,
    DataPackTransaction,
)
from ..serializers import (
    WalletSerializer,
    DepositSerializer,
    TopupTransactionSerializer,
    BankTransferTransactionSerializer,
    RemittanceTransactionSerializer,
    InternetBillTransactionSerializer,
    DataPackTransactionSerializer,
)
from ..services.list_query import (
    apply_date_filters,
    apply_search,
    csv_response,
    deposit_stats,
    list_params,
    merge_stats,
    txn_stats,
)


def _filter_wallet_qs(model, user, params, search_fields, amount_field='amount'):
    qs = model.objects.filter(user=user).order_by('-created_at')
    if params['status'] in ('pending', 'success', 'failed'):
        qs = qs.filter(status=params['status'])
    elif model is Deposit and params['status'] in ('approved', 'rejected'):
        qs = qs.filter(status=params['status'])
    qs = apply_date_filters(qs, params['date_from'], params['date_to'])
    qs = apply_search(qs, params['search'], search_fields)
    return qs


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
    """Get transaction history (deposits, remittances, topups, bank transfers, bills, data packs)"""
    params = list_params(request)
    kind = (request.query_params.get('kind') or '').strip().lower()
    include_all = not kind or kind == 'all'

    deposits_qs = _filter_wallet_qs(
        Deposit, request.user, params, ['note'],
    ) if include_all or kind == 'deposit' else Deposit.objects.none()

    remittances_qs = _filter_wallet_qs(
        RemittanceTransaction,
        request.user,
        params,
        ['ref_no', 'sender_name', 'receiver_name', 'receiver_phone', 'merchant_txn_id'],
    ) if include_all or kind == 'remittance' else RemittanceTransaction.objects.none()

    topups_qs = _filter_wallet_qs(
        TopupTransaction,
        request.user,
        params,
        ['mobile_number', 'merchant_txn_id', 'service_hub_txn_id', 'product_name'],
    ) if include_all or kind == 'topup' else TopupTransaction.objects.none()

    transfers_qs = _filter_wallet_qs(
        BankTransferTransaction,
        request.user,
        params,
        [
            'destination_acc_name', 'destination_acc_no', 'destination_bank_name',
            'merchant_txn_id', 'provider_txn_id',
        ],
    ) if include_all or kind == 'transfer' else BankTransferTransaction.objects.none()

    internet_qs = _filter_wallet_qs(
        InternetBillTransaction,
        request.user,
        params,
        ['customer_id', 'isp_name', 'customer_name', 'package_name', 'merchant_txn_id'],
    ) if include_all or kind == 'internet' else InternetBillTransaction.objects.none()

    data_packs_qs = _filter_wallet_qs(
        DataPackTransaction,
        request.user,
        params,
        ['mobile_number', 'package_name', 'merchant_txn_id', 'operator'],
    ) if include_all or kind == 'data_pack' else DataPackTransaction.objects.none()

    deposits_data = DepositSerializer(
        deposits_qs, many=True, context={'request': request},
    ).data
    remittances_data = RemittanceTransactionSerializer(remittances_qs, many=True).data
    topups_data = TopupTransactionSerializer(topups_qs, many=True).data
    transfers_data = BankTransferTransactionSerializer(transfers_qs, many=True).data
    internet_data = InternetBillTransactionSerializer(internet_qs, many=True).data
    data_packs_data = DataPackTransactionSerializer(data_packs_qs, many=True).data

    stats = merge_stats([
        deposit_stats(deposits_qs),
        txn_stats(remittances_qs, amount_field='total_credited'),
        txn_stats(topups_qs),
        txn_stats(transfers_qs),
        txn_stats(internet_qs),
        txn_stats(data_packs_qs),
    ])

    if params['format'] == 'csv':
        rows = []
        for row in deposits_data:
            rows.append({
                'kind': 'deposit',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': 'Wallet load',
                'detail': row.get('note') or '',
                'amount': row['amount'],
                'status': row['status'],
                'reference': f'#{row["id"]}',
            })
        for row in remittances_data:
            rows.append({
                'kind': 'remittance',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': 'Remittance',
                'detail': row.get('ref_no') or '',
                'amount': row.get('total_credited') or row['amount'],
                'status': row['status'],
                'reference': row.get('merchant_txn_id') or '',
            })
        for row in topups_data:
            rows.append({
                'kind': 'topup',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': row.get('product_name') or 'Top-up',
                'detail': row['mobile_number'],
                'amount': row.get('total_debited') or row['amount'],
                'status': row['status'],
                'reference': row.get('merchant_txn_id') or '',
            })
        for row in transfers_data:
            rows.append({
                'kind': 'transfer',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': 'Transfer',
                'detail': row['destination_acc_name'],
                'amount': row.get('total_debited') or row['amount'],
                'status': row['status'],
                'reference': row.get('merchant_txn_id') or '',
            })
        for row in internet_data:
            rows.append({
                'kind': 'internet',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': row['isp_name'],
                'detail': row['customer_id'],
                'amount': row.get('total_debited') or row['amount'],
                'status': row['status'],
                'reference': row.get('merchant_txn_id') or '',
            })
        for row in data_packs_data:
            rows.append({
                'kind': 'data_pack',
                'id': row['id'],
                'created_at': row['created_at'],
                'title': f'{row["operator"]} Data',
                'detail': row['mobile_number'],
                'amount': row.get('total_debited') or row['amount'],
                'status': row['status'],
                'reference': row.get('merchant_txn_id') or '',
            })
        rows.sort(key=lambda r: r['created_at'], reverse=True)
        return csv_response(
            'transactions.csv',
            rows,
            ['kind', 'id', 'created_at', 'title', 'detail', 'amount', 'status', 'reference'],
        )

    return Response({
        'deposits': deposits_data,
        'remittances': remittances_data,
        'topups': topups_data,
        'bank_transfers': transfers_data,
        'internet_bills': internet_data,
        'data_packs': data_packs_data,
        'stats': stats,
    }, status=status.HTTP_200_OK)
