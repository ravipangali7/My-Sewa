/// Deposit model
class DepositModel {
  final int id;
  final String username;
  final double amount;
  final String status;
  final String? screenshotProof;
  final String? note;
  final DateTime createdAt;
  final DateTime updatedAt;

  DepositModel({
    required this.id,
    required this.username,
    required this.amount,
    required this.status,
    this.screenshotProof,
    this.note,
    required this.createdAt,
    required this.updatedAt,
  });

  factory DepositModel.fromJson(Map<String, dynamic> json) {
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
    
    return DepositModel(
      id: json['id'] ?? 0,
      username: username,
      amount: amount,
      status: json['status'] ?? 'pending',
      screenshotProof: json['screenshot_proof'],
      note: json['note'],
      createdAt: DateTime.parse(json['created_at']),
      updatedAt: DateTime.parse(json['updated_at']),
    );
  }
}
