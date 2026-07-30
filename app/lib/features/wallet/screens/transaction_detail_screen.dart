import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/app_colors.dart';
import '../models/transaction_detail_data.dart';

class TransactionDetailScreen extends StatelessWidget {
  final TransactionDetailData data;

  const TransactionDetailScreen({super.key, required this.data});

  Color get _statusColor {
    switch (data.status.toLowerCase()) {
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

  String _formatAmount(double amount) {
    final parts = amount.toStringAsFixed(2).split('.');
    final intPart = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
    return '$intPart.${parts[1]}';
  }

  String _formatDate(DateTime date) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final hour12 = date.hour == 0
        ? 12
        : (date.hour > 12 ? date.hour - 12 : date.hour);
    final period = date.hour >= 12 ? 'PM' : 'AM';
    final minute = date.minute.toString().padLeft(2, '0');
    return '${date.day} ${months[date.month - 1]} ${date.year}, '
        '${hour12.toString().padLeft(2, '0')}:$minute $period';
  }

  void _copy(BuildContext context, String label, String value) {
    Clipboard.setData(ClipboardData(text: value));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$label copied'),
        backgroundColor: AppColors.primary,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final amountPrefix = data.isCredit ? '+' : '-';
    final amountColor =
        data.isCredit ? AppColors.success : AppColors.textPrimary;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Transaction Details'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        child: Column(
          children: [
            _buildAmountCard(amountPrefix, amountColor),
            const SizedBox(height: 16),
            _buildInfoCard(context),
            if (data.extraFields.isNotEmpty) ...[
              const SizedBox(height: 16),
              _buildExtraCard(context),
            ],
            const SizedBox(height: 16),
            _buildMetaCard(),
          ],
        ),
      ),
    );
  }

  Widget _buildAmountCard(String prefix, Color amountColor) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
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
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: (data.isCredit ? AppColors.success : AppColors.primary)
                  .withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              data.isCredit
                  ? Icons.arrow_downward_rounded
                  : Icons.arrow_upward_rounded,
              color: data.isCredit ? AppColors.success : AppColors.primary,
              size: 28,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            data.title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            data.subtitle,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            '$prefix रु. ${_formatAmount(data.amount)}',
            style: TextStyle(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              color: amountColor,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: _statusColor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.check_circle_rounded, size: 14, color: _statusColor),
                const SizedBox(width: 6),
                Text(
                  data.status.toUpperCase(),
                  style: TextStyle(
                    color: _statusColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoCard(BuildContext context) {
    final rows = <_InfoRow>[
      _InfoRow(
        label: 'Transaction ID',
        value: data.transactionId ?? '—',
        copyable: data.transactionId != null,
      ),
      if (data.referenceId != null && data.referenceId!.isNotEmpty)
        _InfoRow(
          label: 'Reference ID',
          value: data.referenceId!,
          copyable: true,
        ),
      _InfoRow(label: 'Type', value: data.isCredit ? 'Credit' : 'Debit'),
      _InfoRow(label: 'Category', value: data.title),
      _InfoRow(label: 'Date & time', value: _formatDate(data.createdAt)),
      if (data.updatedAt != null)
        _InfoRow(label: 'Last updated', value: _formatDate(data.updatedAt!)),
      if (data.counterparty != null && data.counterparty!.isNotEmpty)
        _InfoRow(
          label: data.isCredit ? 'Received for' : 'Sent to',
          value: data.counterparty!,
        ),
    ];

    return _sectionCard(
      title: 'Transaction information',
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) Divider(height: 1, color: AppColors.divider),
            _buildRow(context, rows[i]),
          ],
        ],
      ),
    );
  }

  Widget _buildExtraCard(BuildContext context) {
    return _sectionCard(
      title: 'Additional details',
      child: Column(
        children: [
          for (var i = 0; i < data.extraFields.length; i++) ...[
            if (i > 0) Divider(height: 1, color: AppColors.divider),
            _buildRow(
              context,
              _InfoRow(
                label: data.extraFields[i].label,
                value: data.extraFields[i].value,
                copyable: data.extraFields[i].label.toLowerCase().contains('id'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMetaCard() {
    return _sectionCard(
      title: 'Summary',
      child: Column(
        children: [
          _buildPlainRow(
            'Amount',
            '${data.isCredit ? '+' : '-'} रु. ${_formatAmount(data.amount)}',
            valueColor: data.isCredit ? AppColors.success : AppColors.error,
          ),
          Divider(height: 1, color: AppColors.divider),
          _buildPlainRow('Status', data.status.toUpperCase(),
              valueColor: _statusColor),
          Divider(height: 1, color: AppColors.divider),
          _buildPlainRow(
            'Channel',
            data.type == 'deposit'
                ? 'Remittance Deposit'
                : data.type == 'bank_transfer'
                    ? 'Bank Transfer'
                    : 'Mobile Topup',
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({required String title, required Widget child}) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Text(
              title,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
                letterSpacing: 0.2,
              ),
            ),
          ),
          Divider(height: 1, color: AppColors.divider),
          child,
        ],
      ),
    );
  }

  Widget _buildRow(BuildContext context, _InfoRow row) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(
              row.label,
              style: TextStyle(
                fontSize: 12.5,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          Expanded(
            flex: 3,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    row.value,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
                if (row.copyable) ...[
                  const SizedBox(width: 6),
                  GestureDetector(
                    onTap: () => _copy(context, row.label, row.value),
                    child: Icon(
                      Icons.copy_rounded,
                      size: 15,
                      color: AppColors.primary.withOpacity(0.7),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPlainRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: valueColor ?? AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow {
  final String label;
  final String value;
  final bool copyable;

  _InfoRow({
    required this.label,
    required this.value,
    this.copyable = false,
  });
}
