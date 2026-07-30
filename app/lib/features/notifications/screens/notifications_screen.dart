import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../models/notification_model.dart';
import '../services/notification_service.dart';
import '../../deposit/services/deposit_service.dart';
import '../../topup/services/topup_service.dart';
import '../../bank_transfer/services/bank_transfer_service.dart';
import '../../wallet/screens/transaction_detail_screen.dart';
import '../../wallet/models/transaction_detail_data.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final NotificationService _notificationService = NotificationService();
  final DepositService _depositService = DepositService();
  final TopupService _topupService = TopupService();
  final BankTransferService _bankTransferService = BankTransferService();

  List<NotificationModel> _notifications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final list = await _notificationService.getNotifications();
      if (mounted) {
        setState(() {
          _notifications = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _markAllRead() async {
    await _notificationService.markAllAsRead(_notifications);
    await _load();
  }

  Future<void> _openNotification(NotificationModel n) async {
    if (!n.isRead) {
      await _notificationService.markAsRead(n.id);
    }

    if (n.relatedType == 'deposit' && n.relatedId != null) {
      final res = await _depositService.getDeposits();
      if (res.success && res.data != null) {
        final match = res.data!.where((d) => d.id == n.relatedId);
        if (match.isNotEmpty && mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TransactionDetailScreen(
                data: TransactionDetailData.fromDeposit(match.first),
              ),
            ),
          );
          await _load();
          return;
        }
      }
    }

    if (n.relatedType == 'topup' && n.relatedId != null) {
      final res = await _topupService.getTopupHistory();
      if (res.success && res.data != null) {
        final match = res.data!.where((t) => t.id == n.relatedId);
        if (match.isNotEmpty && mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TransactionDetailScreen(
                data: TransactionDetailData.fromTopup(match.first),
              ),
            ),
          );
          await _load();
          return;
        }
      }
    }

    if (n.relatedType == 'bank_transfer' && n.relatedId != null) {
      final res = await _bankTransferService.getHistory();
      if (res.success && res.data != null) {
        final match = res.data!.where((t) => t.id == n.relatedId);
        if (match.isNotEmpty && mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TransactionDetailScreen(
                data: TransactionDetailData.fromBankTransfer(match.first),
              ),
            ),
          );
          await _load();
          return;
        }
      }
    }

    if (mounted) await _load();
  }

  String _formatRelative(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  IconData _iconFor(String type) {
    switch (type) {
      case 'deposit':
        return Icons.south_west_rounded;
      case 'topup':
        return Icons.phone_android_rounded;
      case 'bank_transfer':
        return Icons.account_balance_rounded;
      default:
        return Icons.notifications_rounded;
    }
  }

  Color _colorFor(String type) {
    switch (type) {
      case 'deposit':
        return AppColors.success;
      case 'topup':
        return AppColors.primary;
      case 'bank_transfer':
        return AppColors.error;
      default:
        return AppColors.info;
    }
  }

  @override
  Widget build(BuildContext context) {
    final unread = _notifications.where((n) => !n.isRead).length;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Notifications'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        actions: [
          if (unread > 0)
            TextButton(
              onPressed: _markAllRead,
              child: const Text(
                'Mark all read',
                style: TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.primary,
              child: _notifications.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.25,
                        ),
                        Icon(
                          Icons.notifications_none_rounded,
                          size: 64,
                          color: AppColors.textSecondary.withOpacity(0.35),
                        ),
                        const SizedBox(height: 16),
                        Center(
                          child: Text(
                            'No notifications yet',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Center(
                          child: Text(
                            'Activity from remittances and transfers will appear here',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: AppColors.textSecondary.withOpacity(0.8),
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                      itemCount: _notifications.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final n = _notifications[index];
                        final color = _colorFor(n.type);
                        return Material(
                          color: n.isRead
                              ? Colors.white
                              : color.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            onTap: () => _openNotification(n),
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: n.isRead
                                      ? AppColors.border
                                      : color.withOpacity(0.25),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 42,
                                    height: 42,
                                    decoration: BoxDecoration(
                                      color: color.withOpacity(0.14),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      _iconFor(n.type),
                                      color: color,
                                      size: 20,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Expanded(
                                              child: Text(
                                                n.title,
                                                style: TextStyle(
                                                  fontWeight: n.isRead
                                                      ? FontWeight.w600
                                                      : FontWeight.w700,
                                                  fontSize: 14,
                                                  color: AppColors.textPrimary,
                                                ),
                                              ),
                                            ),
                                            if (!n.isRead)
                                              Container(
                                                width: 8,
                                                height: 8,
                                                decoration: BoxDecoration(
                                                  color: AppColors.error,
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          n.body,
                                          style: TextStyle(
                                            fontSize: 12.5,
                                            height: 1.35,
                                            color: AppColors.textSecondary,
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          _formatRelative(n.createdAt),
                                          style: TextStyle(
                                            fontSize: 11,
                                            color: AppColors.textSecondary
                                                .withOpacity(0.85),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
