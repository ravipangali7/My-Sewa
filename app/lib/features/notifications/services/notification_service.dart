import 'package:shared_preferences/shared_preferences.dart';
import '../../deposit/services/deposit_service.dart';
import '../../deposit/models/deposit_model.dart';
import '../../topup/services/topup_service.dart';
import '../../topup/models/topup_model.dart';
import '../../bank_transfer/services/bank_transfer_service.dart';
import '../../bank_transfer/models/bank_transfer_model.dart';
import '../models/notification_model.dart';

/// Builds notifications dynamically from deposits, topups & bank transfers.
/// Read state is persisted locally via SharedPreferences.
class NotificationService {
  static const _readIdsKey = 'notification_read_ids';

  final DepositService _depositService = DepositService();
  final TopupService _topupService = TopupService();
  final BankTransferService _bankTransferService = BankTransferService();

  Future<List<NotificationModel>> getNotifications() async {
    final depositsResponse = await _depositService.getDeposits();
    final topupsResponse = await _topupService.getTopupHistory();
    final transfersResponse = await _bankTransferService.getHistory();
    final readIds = await _getReadIds();

    final items = <NotificationModel>[];

    if (depositsResponse.success && depositsResponse.data != null) {
      for (final d in depositsResponse.data!) {
        items.add(_fromDeposit(d, readIds));
      }
    }

    if (topupsResponse.success && topupsResponse.data != null) {
      for (final t in topupsResponse.data!) {
        items.add(_fromTopup(t, readIds));
      }
    }

    if (transfersResponse.success && transfersResponse.data != null) {
      for (final t in transfersResponse.data!) {
        items.add(_fromBankTransfer(t, readIds));
      }
    }

    items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return items;
  }

  Future<int> getUnreadCount() async {
    final list = await getNotifications();
    return list.where((n) => !n.isRead).length;
  }

  Future<void> markAsRead(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final ids = await _getReadIds();
    if (ids.add(id)) {
      await prefs.setStringList(_readIdsKey, ids.toList());
    }
  }

  Future<void> markAllAsRead(List<NotificationModel> notifications) async {
    final prefs = await SharedPreferences.getInstance();
    final ids = await _getReadIds();
    for (final n in notifications) {
      ids.add(n.id);
    }
    await prefs.setStringList(_readIdsKey, ids.toList());
  }

  Future<Set<String>> _getReadIds() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_readIdsKey) ?? []).toSet();
  }

  NotificationModel _fromDeposit(DepositModel d, Set<String> readIds) {
    final id = 'deposit_${d.id}';
    final status = d.status.toLowerCase();
    String title;
    String body;

    switch (status) {
      case 'approved':
        title = 'Remittance credited';
        body =
            'रु. ${_fmt(d.amount)} has been credited to your MySewa wallet.';
        break;
      case 'rejected':
        title = 'Deposit rejected';
        body =
            'Your remittance deposit of रु. ${_fmt(d.amount)} was rejected.';
        break;
      default:
        title = 'Deposit pending';
        body =
            'Your remittance deposit of रु. ${_fmt(d.amount)} is under review.';
    }

    return NotificationModel(
      id: id,
      title: title,
      body: body,
      type: 'deposit',
      createdAt: d.createdAt,
      isRead: readIds.contains(id),
      relatedType: 'deposit',
      relatedId: d.id,
      amount: d.amount,
      status: d.status,
    );
  }

  NotificationModel _fromTopup(TopupModel t, Set<String> readIds) {
    final id = 'topup_${t.id}';
    final status = t.status.toLowerCase();
    String title;
    String body;

    switch (status) {
      case 'success':
        title = 'Top-up successful';
        body =
            '${t.productName} topup of रु. ${_fmt(t.amount)} to ${t.mobileNumber} succeeded.';
        break;
      case 'failed':
        title = 'Top-up failed';
        body =
            '${t.productName} topup of रु. ${_fmt(t.amount)} to ${t.mobileNumber} failed.';
        break;
      default:
        title = 'Top-up pending';
        body =
            '${t.productName} topup of रु. ${_fmt(t.amount)} to ${t.mobileNumber} is processing.';
    }

    return NotificationModel(
      id: id,
      title: title,
      body: body,
      type: 'topup',
      createdAt: t.createdAt,
      isRead: readIds.contains(id),
      relatedType: 'topup',
      relatedId: t.id,
      amount: t.amount,
      status: t.status,
    );
  }

  NotificationModel _fromBankTransfer(
    BankTransferModel t,
    Set<String> readIds,
  ) {
    final id = 'bank_transfer_${t.id}';
    final status = t.status.toLowerCase();
    final amount = t.totalDebited > 0 ? t.totalDebited : t.amount;
    final bank = t.destinationBankName.isNotEmpty
        ? t.destinationBankName
        : t.destinationBank;
    final dest = t.destinationAccName.isNotEmpty
        ? t.destinationAccName
        : t.destinationAccNo;

    String title;
    String body;

    switch (status) {
      case 'success':
      case 'completed':
        title = 'Bank transfer successful';
        body =
            'रु. ${_fmt(amount)} sent to $dest${bank.isNotEmpty ? ' ($bank)' : ''}.';
        break;
      case 'failed':
      case 'rejected':
        title = 'Bank transfer failed';
        body =
            'Transfer of रु. ${_fmt(amount)} to $dest could not be completed.';
        break;
      default:
        title = 'Bank transfer pending';
        body =
            'Transfer of रु. ${_fmt(amount)} to $dest is being processed.';
    }

    return NotificationModel(
      id: id,
      title: title,
      body: body,
      type: 'bank_transfer',
      createdAt: t.createdAt,
      isRead: readIds.contains(id),
      relatedType: 'bank_transfer',
      relatedId: t.id,
      amount: amount,
      status: t.status,
    );
  }

  String _fmt(double amount) {
    final parts = amount.toStringAsFixed(2).split('.');
    final intPart = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
    return '$intPart.${parts[1]}';
  }
}
