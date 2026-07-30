/// Wallet model
class WalletModel {
  final int id;
  final String username;
  final double balance;
  final DateTime createdAt;
  final DateTime updatedAt;

  WalletModel({
    required this.id,
    required this.username,
    required this.balance,
    required this.createdAt,
    required this.updatedAt,
  });

  factory WalletModel.fromJson(Map<String, dynamic> json) {
    // Handle username: check username first, then user, then phone
    String username = json['username'] ?? 
                     json['user']?.toString() ?? 
                     json['phone']?.toString() ?? 
                     '';
    
    // Handle balance: convert from string/Decimal to double
    double balance = 0.0;
    if (json['balance'] != null) {
      if (json['balance'] is String) {
        balance = double.tryParse(json['balance']) ?? 0.0;
      } else if (json['balance'] is num) {
        balance = json['balance'].toDouble();
      } else {
        balance = 0.0;
      }
    }
    
    // Handle date parsing with fallback
    DateTime parseDate(dynamic dateValue) {
      if (dateValue == null) {
        return DateTime.now();
      }
      if (dateValue is DateTime) {
        return dateValue;
      }
      if (dateValue is String) {
        try {
          return DateTime.parse(dateValue);
        } catch (e) {
          // Try ISO 8601 format or other common formats
          try {
            // Try parsing with timezone
            return DateTime.parse(dateValue.replaceAll('Z', '+00:00'));
          } catch (e2) {
            return DateTime.now();
          }
        }
      }
      return DateTime.now();
    }
    
    return WalletModel(
      id: json['id'] ?? 0,
      username: username,
      balance: balance,
      createdAt: parseDate(json['created_at']),
      updatedAt: parseDate(json['updated_at']),
    );
  }
}

/// Transaction model (for deposits and topups)
class TransactionModel {
  final int id;
  final String type; // 'deposit' or 'topup'
  final double amount;
  final String status;
  final DateTime createdAt;
  final Map<String, dynamic>? additionalData;

  TransactionModel({
    required this.id,
    required this.type,
    required this.amount,
    required this.status,
    required this.createdAt,
    this.additionalData,
  });

  factory TransactionModel.fromJson(Map<String, dynamic> json, String type) {
    return TransactionModel(
      id: json['id'] ?? 0,
      type: type,
      amount: (json['amount'] ?? 0.0).toDouble(),
      status: json['status'] ?? '',
      createdAt: DateTime.parse(json['created_at']),
      additionalData: json,
    );
  }
}
