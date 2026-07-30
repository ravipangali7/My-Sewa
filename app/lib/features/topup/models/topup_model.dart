/// Topup transaction model
class TopupModel {
  final int id;
  final String username;
  final String mobileNumber;
  final double amount;
  final int productId; // 1 for NTC, 2 for NCELL
  final String status;
  final String? serviceHubTxnId;
  final String merchantTxnId;
  final DateTime createdAt;
  final DateTime updatedAt;

  TopupModel({
    required this.id,
    required this.username,
    required this.mobileNumber,
    required this.amount,
    required this.productId,
    required this.status,
    this.serviceHubTxnId,
    required this.merchantTxnId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory TopupModel.fromJson(Map<String, dynamic> json) {
    // Handle username: check username first, then user, then phone
    String username = json['username'] ?? 
                     json['user']?.toString() ?? 
                     json['phone']?.toString() ?? 
                     '';
    
    // Handle amount: convert from string/Decimal to double
    double amount = 0.0;
    if (json['amount'] != null) {
      if (json['amount'] is String) {
        amount = double.tryParse(json['amount']) ?? 0.0;
      } else if (json['amount'] is num) {
        amount = json['amount'].toDouble();
      } else {
        amount = 0.0;
      }
    }
    
    return TopupModel(
      id: json['id'] ?? 0,
      username: username,
      mobileNumber: json['mobile_number'] ?? '',
      amount: amount,
      productId: json['product_id'] ?? 0,
      status: json['status'] ?? 'pending',
      serviceHubTxnId: json['service_hub_txn_id'],
      merchantTxnId: json['merchant_txn_id'] ?? '',
      createdAt: DateTime.parse(json['created_at']),
      updatedAt: DateTime.parse(json['updated_at']),
    );
  }

  String get productName {
    return productId == 1 ? 'NTC' : 'NCELL';
  }
}
