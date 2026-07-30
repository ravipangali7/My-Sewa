import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/mysewa_logo.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../services/wallet_service.dart';
import '../models/wallet_model.dart';
import '../models/transaction_detail_data.dart';
import '../../deposit/screens/deposit_screen.dart';
import '../../deposit/services/deposit_service.dart';
import '../../deposit/models/deposit_model.dart';
import '../../topup/services/topup_service.dart';
import '../../topup/models/topup_model.dart';
import '../../topup/screens/topup_screen.dart';
import '../../bank_transfer/screens/bank_transfer_screen.dart';
import '../../bank_transfer/services/bank_transfer_service.dart';
import '../../bank_transfer/models/bank_transfer_model.dart';
import '../../profile/services/profile_service.dart';
import '../../auth/models/user_model.dart';
import '../../notifications/screens/notifications_screen.dart';
import '../../notifications/services/notification_service.dart';
import 'history_screen.dart';
import 'transaction_detail_screen.dart';

class WalletScreen extends StatefulWidget {
  final VoidCallback? onNavigateToTransfer;
  final VoidCallback? onNavigateToHistory;
  final VoidCallback? onNavigateToProfile;

  const WalletScreen({
    super.key,
    this.onNavigateToTransfer,
    this.onNavigateToHistory,
    this.onNavigateToProfile,
  });

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  final WalletService _walletService = WalletService();
  final DepositService _depositService = DepositService();
  final TopupService _topupService = TopupService();
  final BankTransferService _bankTransferService = BankTransferService();
  final ProfileService _profileService = ProfileService();
  final NotificationService _notificationService = NotificationService();

  WalletModel? _wallet;
  UserModel? _user;
  List<DepositModel> _deposits = [];
  List<TopupModel> _topups = [];
  List<BankTransferModel> _bankTransfers = [];
  int _unreadNotifications = 0;
  bool _isLoading = true;
  bool _balanceVisible = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    await Future.wait([
      _loadWallet(),
      _loadTransactions(),
      _loadProfile(),
      _loadUnreadNotifications(),
    ]);

    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> _loadUnreadNotifications() async {
    try {
      final count = await _notificationService.getUnreadCount();
      if (mounted) setState(() => _unreadNotifications = count);
    } catch (_) {}
  }

  Future<void> _loadProfile() async {
    try {
      final response = await _profileService.getProfile();
      if (mounted && response.success && response.data != null) {
        setState(() => _user = response.data);
      }
    } catch (_) {}
  }

  Future<void> _loadWallet() async {
    try {
      final response = await _walletService.getBalance();
      if (!mounted) return;
      if (response.success && response.data != null) {
        setState(() {
          _wallet = response.data;
          _errorMessage = null;
        });
      } else {
        setState(() {
          _errorMessage = response.message ?? 'Failed to load wallet balance';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = 'Error loading wallet');
      }
    }
  }

  Future<void> _loadTransactions() async {
    try {
      final depositsResponse = await _depositService.getDeposits();
      final topupsResponse = await _topupService.getTopupHistory();
      final transfersResponse = await _bankTransferService.getHistory();
      if (!mounted) return;
      setState(() {
        if (depositsResponse.success && depositsResponse.data != null) {
          _deposits = depositsResponse.data!;
        }
        if (topupsResponse.success && topupsResponse.data != null) {
          _topups = topupsResponse.data!;
        }
        if (transfersResponse.success && transfersResponse.data != null) {
          _bankTransfers = transfersResponse.data!;
        }
      });
    } catch (_) {}
  }

  List<Map<String, dynamic>> _getRecentTransactions() {
    final all = <Map<String, dynamic>>[];

    for (final deposit in _deposits) {
      all.add({
        'type': 'deposit',
        'amount': deposit.amount,
        'date': deposit.createdAt,
        'title': 'Remittance Received',
        'isCredit': true,
        'deposit': deposit,
      });
    }

    for (final topup in _topups) {
      all.add({
        'type': 'topup',
        'amount': topup.amount,
        'date': topup.createdAt,
        'title': '${topup.productName} Top-up',
        'isCredit': false,
        'topup': topup,
      });
    }

    for (final transfer in _bankTransfers) {
      all.add({
        'type': 'bank_transfer',
        'amount': transfer.totalDebited > 0 ? transfer.totalDebited : transfer.amount,
        'date': transfer.createdAt,
        'title': 'Bank Transfer',
        'isCredit': false,
        'bankTransfer': transfer,
      });
    }

    all.sort((a, b) => (b['date'] as DateTime).compareTo(a['date'] as DateTime));
    return all.take(3).toList();
  }

  void _openTransactionDetail(Map<String, dynamic> txn) {
    final TransactionDetailData detail;
    switch (txn['type']) {
      case 'deposit':
        detail = TransactionDetailData.fromDeposit(txn['deposit'] as DepositModel);
        break;
      case 'topup':
        detail = TransactionDetailData.fromTopup(txn['topup'] as TopupModel);
        break;
      case 'bank_transfer':
        detail = TransactionDetailData.fromBankTransfer(
          txn['bankTransfer'] as BankTransferModel,
        );
        break;
      default:
        return;
    }

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TransactionDetailScreen(data: detail),
      ),
    );
  }

  Future<void> _openNotifications() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const NotificationsScreen()),
    );
    await _loadUnreadNotifications();
  }

  String _formatAmount(double amount) {
    final parts = amount.toStringAsFixed(2).split('.');
    final intPart = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
    return '$intPart.${parts[1]}';
  }

  String _formatDateTime(DateTime date) {
    final hour12 = date.hour == 0
        ? 12
        : (date.hour > 12 ? date.hour - 12 : date.hour);
    final period = date.hour >= 12 ? 'PM' : 'AM';
    final minute = date.minute.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    final hour = hour12.toString().padLeft(2, '0');
    return '${date.year}-$month-$day $hour:$minute $period';
  }

  String get _displayName {
    final first = _user?.firstName?.trim();
    if (first != null && first.isNotEmpty) return first;
    return 'User';
  }

  String get _displayPhone {
    final phone = _user?.phone ?? '';
    if (phone.isEmpty) return '';
    if (phone.startsWith('+')) return phone;
    if (phone.startsWith('977')) return '+$phone';
    return '+977 $phone';
  }

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              onRefresh: _loadAllData,
              color: AppColors.primary,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  children: [
                    _buildHeader(topPadding),
                    Transform.translate(
                      offset: const Offset(0, -28),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Column(
                          children: [
                            _buildWalletCard(),
                            const SizedBox(height: 16),
                            _buildQuickActions(),
                            const SizedBox(height: 20),
                            _buildRecentTransactions(),
                            const SizedBox(height: 24),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildHeader(double topPadding) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(20, topPadding + 8, 20, 48),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.headerBlue,
            const Color(0xFF0E5C8C),
            AppColors.headerTeal,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: const [0.0, 0.55, 1.0],
        ),
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Soft mountain silhouette
          Positioned(
            left: 0,
            right: 0,
            bottom: -48,
            height: 70,
            child: CustomPaint(painter: _MountainPainter()),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Expanded(child: MySewaBrandHeader()),
                  _buildNotificationBell(),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  UserAvatar(
                    avatarUrl: _user?.avatarUrl,
                    displayName: _user?.displayName ?? _displayName,
                    size: 48,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'नमस्ते, $_displayName',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (_displayPhone.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            _displayPhone,
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.85),
                              fontSize: 12,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationBell() {
    final badgeText = _unreadNotifications > 9
        ? '9+'
        : '$_unreadNotifications';

    return GestureDetector(
      onTap: _openNotifications,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.notifications_none_rounded,
              color: Colors.white,
              size: 22,
            ),
          ),
          if (_unreadNotifications > 0)
            Positioned(
              top: -2,
              right: -2,
              child: Container(
                constraints: const BoxConstraints(minWidth: 18),
                height: 18,
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFE53935),
                  borderRadius: BorderRadius.circular(9),
                ),
                alignment: Alignment.center,
                child: Text(
                  badgeText,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildWalletCard() {
    final balance = _wallet?.balance ?? 0.0;
    final balanceText = _balanceVisible
        ? 'रु. ${_formatAmount(balance)}'
        : 'रु. ••••••';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          colors: [
            AppColors.walletBlue,
            const Color(0xFF1A7A9A),
            AppColors.walletTeal,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.28),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        children: [
          // Dot mesh texture
          Positioned.fill(
            child: CustomPaint(painter: _DotMeshPainter()),
          ),
          // Wallet illustration
          Positioned(
            right: 0,
            bottom: 0,
            child: Opacity(
              opacity: 0.9,
              child: _WalletIllustration(),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'MySewa Wallet',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.95),
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(width: 6),
                  GestureDetector(
                    onTap: () => setState(() => _balanceVisible = !_balanceVisible),
                    child: Icon(
                      _balanceVisible
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                      color: Colors.white.withOpacity(0.9),
                      size: 18,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.secondary,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text(
                      'Remittance Received',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                balanceText,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.3,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '(रेमिटेन्सबाट प्राप्त कुल रकम)',
                style: TextStyle(
                  color: Colors.white.withOpacity(0.8),
                  fontSize: 11,
                  fontWeight: FontWeight.w400,
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 8),
                Text(
                  _errorMessage!,
                  style: TextStyle(
                    color: Colors.red.shade100,
                    fontSize: 11,
                  ),
                ),
              ],
              const SizedBox(height: 8),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    final actions = [
      _QuickAction(
        label: 'Bank Transfer',
        icon: Icons.account_balance_rounded,
        color: AppColors.actionGreen,
        onTap: () {
          if (widget.onNavigateToTransfer != null) {
            widget.onNavigateToTransfer!();
          } else {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const BankTransferScreen()),
            ).then((_) => _loadAllData());
          }
        },
      ),
      _QuickAction(
        label: 'Mobile Top-up',
        icon: Icons.phone_android_rounded,
        color: AppColors.actionBlue,
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const TopupScreen()),
          ).then((_) => _loadAllData());
        },
      ),
      _QuickAction(
        label: 'Add Money',
        icon: Icons.download_rounded,
        color: AppColors.actionPurple,
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const DepositScreen()),
          ).then((_) => _loadAllData());
        },
      ),
      _QuickAction(
        label: 'History',
        icon: Icons.history_rounded,
        color: AppColors.actionLightBlue,
        onTap: () {
          if (widget.onNavigateToHistory != null) {
            widget.onNavigateToHistory!();
          } else {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const HistoryScreen()),
            );
          }
        },
      ),
    ];

    return Row(
      children: actions
          .map(
            (a) => Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  left: a == actions.first ? 0 : 5,
                  right: a == actions.last ? 0 : 5,
                ),
                child: _buildQuickActionTile(a),
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildQuickActionTile(_QuickAction action) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      elevation: 0,
      shadowColor: Colors.black12,
      child: InkWell(
        onTap: action.onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 4),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.05),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: action.color,
                  shape: BoxShape.circle,
                ),
                child: Icon(action.icon, color: Colors.white, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                action.label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRecentTransactions() {
    final transactions = _getRecentTransactions();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'हालका कारोबारहरू',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () {
                  if (widget.onNavigateToHistory != null) {
                    widget.onNavigateToHistory!();
                  } else {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const HistoryScreen()),
                    );
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0F3F7),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'View All',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      Icon(
                        Icons.chevron_right,
                        size: 16,
                        color: AppColors.textSecondary,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (transactions.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Column(
                children: [
                  Icon(
                    Icons.receipt_long_outlined,
                    size: 40,
                    color: AppColors.textSecondary.withOpacity(0.4),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'No transactions yet',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            )
          else
            ...transactions.asMap().entries.map((entry) {
              final index = entry.key;
              final txn = entry.value;
              return Column(
                children: [
                  if (index > 0)
                    Divider(height: 1, color: AppColors.divider),
                  _buildTransactionRow(txn),
                ],
              );
            }),
        ],
      ),
    );
  }

  Widget _buildTransactionRow(Map<String, dynamic> txn) {
    final isCredit = txn['isCredit'] as bool;
    final amount = txn['amount'] as double;
    final date = txn['date'] as DateTime;
    final title = txn['title'] as String;

    return InkWell(
      onTap: () => _openTransactionDetail(txn),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: (isCredit ? AppColors.success : AppColors.primary)
                    .withOpacity(0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isCredit
                    ? Icons.arrow_downward_rounded
                    : Icons.subdirectory_arrow_right_rounded,
                color: isCredit ? AppColors.success : AppColors.primary,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13.5,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _formatDateTime(date),
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '${isCredit ? '+' : '-'} रु. ${_formatAmount(amount)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: isCredit ? AppColors.success : AppColors.textPrimary,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: AppColors.textSecondary.withOpacity(0.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickAction {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  _QuickAction({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
  });
}

class _MountainPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.12)
      ..style = PaintingStyle.fill;

    final path = Path()
      ..moveTo(0, size.height)
      ..lineTo(0, size.height * 0.55)
      ..lineTo(size.width * 0.18, size.height * 0.2)
      ..lineTo(size.width * 0.32, size.height * 0.48)
      ..lineTo(size.width * 0.48, size.height * 0.08)
      ..lineTo(size.width * 0.62, size.height * 0.42)
      ..lineTo(size.width * 0.78, size.height * 0.18)
      ..lineTo(size.width, size.height * 0.5)
      ..lineTo(size.width, size.height)
      ..close();

    canvas.drawPath(path, paint);

    final paint2 = Paint()
      ..color = Colors.white.withOpacity(0.08)
      ..style = PaintingStyle.fill;

    final path2 = Path()
      ..moveTo(0, size.height)
      ..lineTo(0, size.height * 0.7)
      ..lineTo(size.width * 0.25, size.height * 0.4)
      ..lineTo(size.width * 0.45, size.height * 0.65)
      ..lineTo(size.width * 0.7, size.height * 0.35)
      ..lineTo(size.width, size.height * 0.6)
      ..lineTo(size.width, size.height)
      ..close();

    canvas.drawPath(path2, paint2);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _DotMeshPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.07)
      ..style = PaintingStyle.fill;

    const spacing = 14.0;
    for (double x = 0; x < size.width; x += spacing) {
      for (double y = 0; y < size.height; y += spacing) {
        canvas.drawCircle(Offset(x, y), 1.1, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Half-open wallet with cash notes peeking out the top.
class _WalletIllustration extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 86,
      height: 72,
      child: CustomPaint(painter: _OpenWalletPainter()),
    );
  }
}

class _OpenWalletPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Cash notes peeking from the top (drawn first, behind wallet body)
    final noteColors = [
      const Color(0xFF66BB6A),
      const Color(0xFFFFF59D),
      const Color(0xFF81C784),
    ];
    final noteOffsets = [-10.0, 0.0, 10.0];
    for (var i = 0; i < noteColors.length; i++) {
      final nx = w * 0.28 + noteOffsets[i];
      final note = RRect.fromRectAndRadius(
        Rect.fromLTWH(nx, h * 0.02, w * 0.38, h * 0.42),
        const Radius.circular(3),
      );
      canvas.drawRRect(note, Paint()..color = noteColors[i].withOpacity(0.95));
      // Note band stripe
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(nx + 4, h * 0.12, w * 0.38 - 8, 3),
          const Radius.circular(1),
        ),
        Paint()..color = Colors.white.withOpacity(0.35),
      );
    }

    // Wallet body
    final body = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.08, h * 0.32, w * 0.84, h * 0.58),
      const Radius.circular(10),
    );
    canvas.drawRRect(
      body,
      Paint()
        ..shader = LinearGradient(
          colors: [const Color(0xFF0D47A1), const Color(0xFF1565C0)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(body.outerRect),
    );
    canvas.drawRRect(
      body,
      Paint()
        ..color = Colors.white.withOpacity(0.35)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    // Flap (half-open lid)
    final flapPath = Path()
      ..moveTo(w * 0.1, h * 0.38)
      ..lineTo(w * 0.18, h * 0.18)
      ..quadraticBezierTo(w * 0.5, h * 0.08, w * 0.82, h * 0.18)
      ..lineTo(w * 0.9, h * 0.38)
      ..close();
    canvas.drawPath(
      flapPath,
      Paint()
        ..shader = LinearGradient(
          colors: [
            const Color(0xFF1976D2).withOpacity(0.95),
            const Color(0xFF0D47A1).withOpacity(0.9),
          ],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );
    canvas.drawPath(
      flapPath,
      Paint()
        ..color = Colors.white.withOpacity(0.3)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    // Clasps / stitching detail
    canvas.drawCircle(
      Offset(w * 0.78, h * 0.58),
      4.5,
      Paint()..color = const Color(0xFFFFD54F),
    );
    canvas.drawCircle(
      Offset(w * 0.78, h * 0.58),
      2.2,
      Paint()..color = const Color(0xFFFFA000),
    );

    // Soft shadow under wallet
    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(w * 0.5, h * 0.94),
        width: w * 0.7,
        height: 6,
      ),
      Paint()..color = Colors.black.withOpacity(0.18),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
