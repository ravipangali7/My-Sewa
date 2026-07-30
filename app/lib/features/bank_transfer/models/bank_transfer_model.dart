/// Bank model from HimalPay bank list
class BankModel {
  final String bankCode;
  final String bankName;

  BankModel({required this.bankCode, required this.bankName});

  factory BankModel.fromJson(Map<String, dynamic> json) {
    return BankModel(
      bankCode: (json['bank_code'] ?? json['code'] ?? '').toString(),
      bankName: (json['bank_name'] ?? json['name'] ?? '').toString(),
    );
  }

  @override
  String toString() => bankName.isNotEmpty ? '$bankName ($bankCode)' : bankCode;
}

/// Charge preview for transfers / topups
class ChargePreview {
  final double amount;
  final double charge;
  final double cashback;
  final double totalDebited;

  ChargePreview({
    required this.amount,
    required this.charge,
    required this.cashback,
    required this.totalDebited,
  });

  factory ChargePreview.fromJson(Map<String, dynamic> json) {
    double parse(dynamic v) {
      if (v == null) return 0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0;
    }

    return ChargePreview(
      amount: parse(json['amount']),
      charge: parse(json['charge']),
      cashback: parse(json['cashback']),
      totalDebited: parse(json['total_debited']),
    );
  }
}

/// Bank transfer transaction
class BankTransferModel {
  final int id;
  final double amount;
  final String destinationBank;
  final String destinationBankName;
  final String destinationAccNo;
  final String destinationAccName;
  final bool isDestinationMobile;
  final String transactionRemarks;
  final String status;
  final String merchantTxnId;
  final String? providerTxnId;
  final String? referenceId;
  final double charge;
  final double cashback;
  final double totalDebited;
  final DateTime createdAt;
  final DateTime updatedAt;

  BankTransferModel({
    required this.id,
    required this.amount,
    required this.destinationBank,
    required this.destinationBankName,
    required this.destinationAccNo,
    required this.destinationAccName,
    required this.isDestinationMobile,
    required this.transactionRemarks,
    required this.status,
    required this.merchantTxnId,
    this.providerTxnId,
    this.referenceId,
    required this.charge,
    required this.cashback,
    required this.totalDebited,
    required this.createdAt,
    required this.updatedAt,
  });

  factory BankTransferModel.fromJson(Map<String, dynamic> json) {
    double parse(dynamic v) {
      if (v == null) return 0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0;
    }

    return BankTransferModel(
      id: json['id'] ?? 0,
      amount: parse(json['amount']),
      destinationBank: json['destination_bank'] ?? '',
      destinationBankName: json['destination_bank_name'] ?? '',
      destinationAccNo: json['destination_acc_no'] ?? '',
      destinationAccName: json['destination_acc_name'] ?? '',
      isDestinationMobile: json['is_destination_mobile'] == true,
      transactionRemarks: json['transaction_remarks'] ?? '',
      status: json['status'] ?? 'pending',
      merchantTxnId: json['merchant_txn_id'] ?? '',
      providerTxnId: json['provider_txn_id'],
      referenceId: json['reference_id'],
      charge: parse(json['charge']),
      cashback: parse(json['cashback']),
      totalDebited: parse(json['total_debited']),
      createdAt: DateTime.parse(json['created_at']),
      updatedAt: DateTime.parse(json['updated_at']),
    );
  }
}
