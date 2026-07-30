/// Settings model
class SettingsModel {
  final int id;
  final String? qrCodeUrl;
  final Map<String, dynamic> bankDetails;
  final DateTime createdAt;
  final DateTime updatedAt;

  SettingsModel({
    required this.id,
    this.qrCodeUrl,
    required this.bankDetails,
    required this.createdAt,
    required this.updatedAt,
  });

  factory SettingsModel.fromJson(Map<String, dynamic> json) {
    return SettingsModel(
      id: json['id'] ?? 0,
      qrCodeUrl: json['qr_code_url'],
      bankDetails: json['bank_details'] ?? {},
      createdAt: DateTime.parse(json['created_at']),
      updatedAt: DateTime.parse(json['updated_at']),
    );
  }
}
