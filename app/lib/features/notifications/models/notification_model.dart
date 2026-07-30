/// In-app notification derived from wallet activity / system events.
class NotificationModel {
  final String id;
  final String title;
  final String body;
  final String type; // deposit | transfer | topup | system
  final DateTime createdAt;
  final bool isRead;
  final String? relatedType; // deposit | topup
  final int? relatedId;
  final double? amount;
  final String? status;

  const NotificationModel({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.createdAt,
    this.isRead = false,
    this.relatedType,
    this.relatedId,
    this.amount,
    this.status,
  });

  NotificationModel copyWith({bool? isRead}) {
    return NotificationModel(
      id: id,
      title: title,
      body: body,
      type: type,
      createdAt: createdAt,
      isRead: isRead ?? this.isRead,
      relatedType: relatedType,
      relatedId: relatedId,
      amount: amount,
      status: status,
    );
  }
}
