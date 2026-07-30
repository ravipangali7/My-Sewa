import '../../deposit/models/deposit_model.dart';
import '../../topup/models/topup_model.dart';
import '../../bank_transfer/models/bank_transfer_model.dart';

/// Unified view-model for banking-style transaction detail screens.
class TransactionDetailData {
  final int id;
  final String type; // deposit | topup | bank_transfer
  final String title;
  final String subtitle;
  final double amount;
  final bool isCredit;
  final String status;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? transactionId;
  final String? referenceId;
  final String? counterparty;
  final String? productName;
  final String? mobileNumber;
  final String? note;
  final String? screenshotProof;
  final List<DetailField> extraFields;

  const TransactionDetailData({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.amount,
    required this.isCredit,
    required this.status,
    required this.createdAt,
    this.updatedAt,
    this.transactionId,
    this.referenceId,
    this.counterparty,
    this.productName,
    this.mobileNumber,
    this.note,
    this.screenshotProof,
    this.extraFields = const [],
  });

  factory TransactionDetailData.fromDeposit(DepositModel d) {
    return TransactionDetailData(
      id: d.id,
      type: 'deposit',
      title: 'Remittance Received',
      subtitle: 'Wallet credit from remittance deposit',
      amount: d.amount,
      isCredit: true,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      transactionId: 'DEP-${d.id}',
      counterparty: d.username.isNotEmpty ? d.username : null,
      note: d.note,
      screenshotProof: d.screenshotProof,
      extraFields: [
        if (d.username.isNotEmpty)
          DetailField(label: 'Account', value: d.username),
        if (d.note != null && d.note!.isNotEmpty)
          DetailField(label: 'Note', value: d.note!),
      ],
    );
  }

  factory TransactionDetailData.fromTopup(TopupModel t) {
    return TransactionDetailData(
      id: t.id,
      type: 'topup',
      title: 'Fund Transfer',
      subtitle: '${t.productName} mobile topup',
      amount: t.amount,
      isCredit: false,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      transactionId: t.merchantTxnId.isNotEmpty
          ? t.merchantTxnId
          : 'TOP-${t.id}',
      referenceId: t.serviceHubTxnId,
      productName: t.productName,
      mobileNumber: t.mobileNumber,
      counterparty: t.mobileNumber,
      extraFields: [
        DetailField(label: 'Operator', value: t.productName),
        DetailField(label: 'Mobile number', value: t.mobileNumber),
        if (t.merchantTxnId.isNotEmpty)
          DetailField(label: 'Merchant Txn ID', value: t.merchantTxnId),
        if (t.serviceHubTxnId != null && t.serviceHubTxnId!.isNotEmpty)
          DetailField(label: 'Provider Txn ID', value: t.serviceHubTxnId!),
      ],
    );
  }

  factory TransactionDetailData.fromBankTransfer(BankTransferModel t) {
    final displayAmount = t.totalDebited > 0 ? t.totalDebited : t.amount;
    final bankLabel = t.destinationBankName.isNotEmpty
        ? t.destinationBankName
        : t.destinationBank;

    return TransactionDetailData(
      id: t.id,
      type: 'bank_transfer',
      title: 'Bank Transfer',
      subtitle: bankLabel.isNotEmpty
          ? 'Transfer to $bankLabel'
          : 'Wallet debit to bank account',
      amount: displayAmount,
      isCredit: false,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      transactionId: t.merchantTxnId.isNotEmpty
          ? t.merchantTxnId
          : 'BTR-${t.id}',
      referenceId: t.referenceId ?? t.providerTxnId,
      counterparty: t.destinationAccName.isNotEmpty
          ? t.destinationAccName
          : t.destinationAccNo,
      extraFields: [
        if (bankLabel.isNotEmpty) DetailField(label: 'Bank', value: bankLabel),
        if (t.destinationAccName.isNotEmpty)
          DetailField(label: 'Account name', value: t.destinationAccName),
        if (t.destinationAccNo.isNotEmpty)
          DetailField(label: 'Account number', value: t.destinationAccNo),
        DetailField(
          label: 'Transfer amount',
          value: 'रु. ${t.amount.toStringAsFixed(2)}',
        ),
        if (t.charge > 0)
          DetailField(
            label: 'Charge',
            value: 'रु. ${t.charge.toStringAsFixed(2)}',
          ),
        if (t.cashback > 0)
          DetailField(
            label: 'Cashback',
            value: 'रु. ${t.cashback.toStringAsFixed(2)}',
          ),
        if (t.totalDebited > 0)
          DetailField(
            label: 'Total debited',
            value: 'रु. ${t.totalDebited.toStringAsFixed(2)}',
          ),
        if (t.transactionRemarks.isNotEmpty)
          DetailField(label: 'Remarks', value: t.transactionRemarks),
        if (t.merchantTxnId.isNotEmpty)
          DetailField(label: 'Merchant Txn ID', value: t.merchantTxnId),
        if (t.providerTxnId != null && t.providerTxnId!.isNotEmpty)
          DetailField(label: 'Provider Txn ID', value: t.providerTxnId!),
        if (t.referenceId != null && t.referenceId!.isNotEmpty)
          DetailField(label: 'Reference ID', value: t.referenceId!),
      ],
    );
  }
}

class DetailField {
  final String label;
  final String value;

  const DetailField({required this.label, required this.value});
}
