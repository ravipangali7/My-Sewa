import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../deposit/services/deposit_service.dart';
import '../../deposit/models/deposit_model.dart';
import '../../topup/services/topup_service.dart';
import '../../topup/models/topup_model.dart';
import '../../bank_transfer/services/bank_transfer_service.dart';
import '../../bank_transfer/models/bank_transfer_model.dart';
import '../models/transaction_detail_data.dart';
import 'transaction_detail_screen.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final DepositService _depositService = DepositService();
  final TopupService _topupService = TopupService();
  final BankTransferService _bankTransferService = BankTransferService();

  List<DepositModel> _deposits = [];
  List<TopupModel> _topups = [];
  List<BankTransferModel> _bankTransfers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadTransactions();
  }

  Future<void> _loadTransactions() async {
    setState(() => _isLoading = true);
    try {
      final depositsResponse = await _depositService.getDeposits();
      final topupsResponse = await _topupService.getTopupHistory();
      final transfersResponse = await _bankTransferService.getHistory();

      if (mounted) {
        setState(() {
          _deposits = depositsResponse.success && depositsResponse.data != null
              ? depositsResponse.data!
              : [];
          _topups = topupsResponse.success && topupsResponse.data != null
              ? topupsResponse.data!
              : [];
          _bankTransfers =
              transfersResponse.success && transfersResponse.data != null
                  ? transfersResponse.data!
                  : [];
          _deposits.sort((a, b) => b.createdAt.compareTo(a.createdAt));
          _topups.sort((a, b) => b.createdAt.compareTo(a.createdAt));
          _bankTransfers.sort((a, b) => b.createdAt.compareTo(a.createdAt));
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved':
      case 'success':
        return AppColors.success;
      case 'pending':
        return AppColors.warning;
      case 'rejected':
      case 'failed':
        return AppColors.error;
      default:
        return AppColors.textSecondary;
    }
  }

  String _formatDateTime(DateTime date) {
    final hour = date.hour > 12
        ? date.hour - 12
        : (date.hour == 0 ? 12 : date.hour);
    final period = date.hour >= 12 ? 'PM' : 'AM';
    final minute = date.minute.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '$day/$month/${date.year} · ${hour.toString().padLeft(2, '0')}:$minute $period';
  }

  String _formatAmount(double amount) {
    final parts = amount.toStringAsFixed(2).split('.');
    final intPart = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
    return '$intPart.${parts[1]}';
  }

  bool get _isEmpty =>
      _deposits.isEmpty && _topups.isEmpty && _bankTransfers.isEmpty;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('History'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              onRefresh: _loadTransactions,
              color: AppColors.primary,
              child: _isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.25,
                        ),
                        Icon(
                          Icons.receipt_long_rounded,
                          size: 64,
                          color: AppColors.textSecondary.withOpacity(0.35),
                        ),
                        const SizedBox(height: 16),
                        Center(
                          child: Text(
                            'No transactions yet',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                      children: [
                        _buildSection(
                          title: 'Deposit History',
                          icon: Icons.south_west_rounded,
                          accent: AppColors.success,
                          emptyLabel: 'No deposits yet',
                          children:
                              _deposits.map((d) => _buildDepositRow(d)).toList(),
                        ),
                        const SizedBox(height: 20),
                        _buildSection(
                          title: 'Mobile Top-up',
                          icon: Icons.phone_android_rounded,
                          accent: AppColors.ntcColor,
                          emptyLabel: 'No top-ups yet',
                          children:
                              _topups.map((t) => _buildTopupRow(t)).toList(),
                        ),
                        const SizedBox(height: 20),
                        _buildSection(
                          title: 'Bank Transfers',
                          icon: Icons.account_balance_rounded,
                          accent: AppColors.error,
                          emptyLabel: 'No bank transfers yet',
                          children: _bankTransfers
                              .map((t) => _buildBankTransferRow(t))
                              .toList(),
                        ),
                      ],
                    ),
            ),
    );
  }

  Widget _buildSection({
    required String title,
    required IconData icon,
    required Color accent,
    required String emptyLabel,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: accent.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: accent),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            if (children.isNotEmpty)
              Text(
                '${children.length}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (children.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: Text(
              emptyLabel,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
              ),
            ),
          )
        else
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0)
                    Divider(height: 1, color: AppColors.divider, indent: 62),
                  children[i],
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildStatusChip(String status, {Color? forceColor}) {
    final color = forceColor ?? _statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  Widget _buildDepositRow(DepositModel deposit) {
    final isSuccess = deposit.status.toLowerCase() == 'approved';

    return InkWell(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => TransactionDetailScreen(
              data: TransactionDetailData.fromDeposit(deposit),
            ),
          ),
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.success.withOpacity(0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.arrow_downward_rounded,
                color: AppColors.success,
                size: 18,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          'Deposit',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                            color: AppColors.textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      _buildStatusChip(
                        deposit.status,
                        forceColor: isSuccess ? AppColors.success : null,
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    _formatDateTime(deposit.createdAt),
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '+ रु. ${_formatAmount(deposit.amount)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: isSuccess ? AppColors.success : AppColors.textPrimary,
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: AppColors.textSecondary.withOpacity(0.45),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopupRow(TopupModel topup) {
    final brand =
        topup.productId == 1 ? AppColors.ntcColor : AppColors.ncellColor;

    return InkWell(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => TransactionDetailScreen(
              data: TransactionDetailData.fromTopup(topup),
            ),
          ),
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: brand.withOpacity(0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.phone_android_rounded, color: brand, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          '${topup.productName} Top-up',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                            color: AppColors.textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      _buildStatusChip(topup.status),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${topup.mobileNumber} · ${_formatDateTime(topup.createdAt)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Text(
              '- रु. ${_formatAmount(topup.amount)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: AppColors.error,
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: AppColors.textSecondary.withOpacity(0.45),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBankTransferRow(BankTransferModel transfer) {
    return InkWell(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => TransactionDetailScreen(
              data: TransactionDetailData.fromBankTransfer(transfer),
            ),
          ),
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.error.withOpacity(0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.account_balance_rounded,
                color: AppColors.error,
                size: 18,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          transfer.destinationBankName.isNotEmpty
                              ? transfer.destinationBankName
                              : 'Bank Transfer',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                            color: AppColors.textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      _buildStatusChip(transfer.status),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${transfer.destinationAccNo} · ${_formatDateTime(transfer.createdAt)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Text(
              '- रु. ${_formatAmount(transfer.totalDebited > 0 ? transfer.totalDebited : transfer.amount)}',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: AppColors.error,
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: AppColors.textSecondary.withOpacity(0.45),
            ),
          ],
        ),
      ),
    );
  }
}
