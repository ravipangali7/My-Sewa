import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/validators.dart';
import '../../../core/constants/app_constants.dart';
import '../models/bank_transfer_model.dart';
import '../services/bank_transfer_service.dart';

class BankTransferScreen extends StatefulWidget {
  const BankTransferScreen({super.key});

  @override
  State<BankTransferScreen> createState() => _BankTransferScreenState();
}

class _BankTransferScreenState extends State<BankTransferScreen> {
  final _formKey = GlobalKey<FormState>();
  final _accountNameController = TextEditingController();
  final _accountNumberController = TextEditingController();
  final _amountController = TextEditingController();
  final _remarksController = TextEditingController(text: 'Fund Transfer');
  final BankTransferService _service = BankTransferService();

  List<BankModel> _banks = [];
  BankModel? _selectedBank;
  ChargePreview? _chargePreview;
  bool _isLoadingBanks = true;
  bool _isVerifying = false;
  bool _isCalculating = false;
  bool _isSubmitting = false;
  bool _isVerified = false;
  bool _isMobileWallet = false;
  String? _errorMessage;
  String? _verifyMessage;

  @override
  void initState() {
    super.initState();
    _loadBanks();
    _amountController.addListener(_onAmountChanged);
  }

  @override
  void dispose() {
    _amountController.removeListener(_onAmountChanged);
    _accountNameController.dispose();
    _accountNumberController.dispose();
    _amountController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _loadBanks() async {
    setState(() {
      _isLoadingBanks = true;
      _errorMessage = null;
    });
    final response = await _service.getBanks();
    if (!mounted) return;
    setState(() {
      _isLoadingBanks = false;
      if (response.success && response.data != null) {
        _banks = response.data!;
      } else {
        _errorMessage = response.message ?? 'Failed to load banks';
      }
    });
  }

  void _onAmountChanged() {
    final amount = double.tryParse(_amountController.text);
    if (amount == null || amount < AppConstants.minTopupAmount) {
      setState(() => _chargePreview = null);
      return;
    }
    _calculateCharge(amount);
  }

  Future<void> _calculateCharge(double amount) async {
    setState(() => _isCalculating = true);
    final response = await _service.calculateCharge(amount: amount);
    if (!mounted) return;
    setState(() {
      _isCalculating = false;
      if (response.success && response.data != null) {
        _chargePreview = response.data;
      }
    });
  }

  Future<void> _verifyAccount() async {
    if (_selectedBank == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a bank')),
      );
      return;
    }
    if (_accountNameController.text.trim().isEmpty ||
        _accountNumberController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter account name and number')),
      );
      return;
    }

    setState(() {
      _isVerifying = true;
      _isVerified = false;
      _verifyMessage = null;
    });

    final response = await _service.verifyAccount(
      bankCode: _selectedBank!.bankCode,
      accountName: _accountNameController.text.trim(),
      accountNumber: _accountNumberController.text.trim(),
      isMobile: _isMobileWallet,
    );

    if (!mounted) return;
    setState(() {
      _isVerifying = false;
      if (response.success) {
        _isVerified = true;
        _verifyMessage = response.message ?? 'Account verified';
      } else {
        _isVerified = false;
        _verifyMessage = response.message ?? 'Verification failed';
      }
    });
  }

  Future<void> _submitTransfer() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedBank == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a bank')),
      );
      return;
    }
    if (!_isVerified) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please verify the account first')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    final response = await _service.createTransfer(
      amount: double.parse(_amountController.text.trim()),
      destinationBank: _selectedBank!.bankCode,
      destinationBankName: _selectedBank!.bankName,
      destinationAccNo: _accountNumberController.text.trim(),
      destinationAccName: _accountNameController.text.trim(),
      isDestinationMobile: _isMobileWallet,
      transactionRemarks: _remarksController.text.trim().isEmpty
          ? 'Fund Transfer'
          : _remarksController.text.trim(),
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (response.success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(response.message ?? 'Bank transfer successful'),
          backgroundColor: AppColors.success,
        ),
      );
      _resetForm();
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop(true);
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(response.message ?? 'Bank transfer failed'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  void _resetForm() {
    _accountNameController.clear();
    _accountNumberController.clear();
    _amountController.clear();
    _remarksController.text = 'Fund Transfer';
    setState(() {
      _selectedBank = null;
      _chargePreview = null;
      _isVerified = false;
      _verifyMessage = null;
      _isMobileWallet = false;
    });
  }

  String _formatRs(double amount) {
    return 'Rs. ${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Bank Transfer'),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.textLight,
      ),
      body: _isLoadingBanks
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : RefreshIndicator(
              onRefresh: _loadBanks,
              color: AppColors.primary,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_errorMessage != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.error.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _errorMessage!,
                            style: TextStyle(color: AppColors.error),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      Text(
                        'Send money to any bank account',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Verify the account, review fees, then confirm.',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 20),
                      DropdownButtonFormField<BankModel>(
                        value: _selectedBank,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Bank',
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        items: _banks
                            .map(
                              (b) => DropdownMenuItem(
                                value: b,
                                child: Text(
                                  b.bankName.isNotEmpty
                                      ? b.bankName
                                      : b.bankCode,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (bank) {
                          setState(() {
                            _selectedBank = bank;
                            _isVerified = false;
                            _verifyMessage = null;
                          });
                        },
                        validator: (v) =>
                            v == null ? 'Please select a bank' : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _accountNameController,
                        decoration: InputDecoration(
                          labelText: 'Account holder name',
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        validator: (v) =>
                            Validators.validateRequired(v, fieldName: 'Account name'),
                        onChanged: (_) => setState(() {
                          _isVerified = false;
                          _verifyMessage = null;
                        }),
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _accountNumberController,
                        keyboardType: TextInputType.text,
                        decoration: InputDecoration(
                          labelText: 'Account number',
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        validator: (v) => Validators.validateRequired(
                          v,
                          fieldName: 'Account number',
                        ),
                        onChanged: (_) => setState(() {
                          _isVerified = false;
                          _verifyMessage = null;
                        }),
                      ),
                      const SizedBox(height: 8),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Destination is mobile wallet'),
                        value: _isMobileWallet,
                        activeColor: AppColors.secondary,
                        onChanged: (v) => setState(() {
                          _isMobileWallet = v;
                          _isVerified = false;
                          _verifyMessage = null;
                        }),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: _isVerifying ? null : _verifyAccount,
                        icon: _isVerifying
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.primary,
                                ),
                              )
                            : Icon(
                                _isVerified
                                    ? Icons.verified_rounded
                                    : Icons.fact_check_outlined,
                              ),
                        label: Text(
                          _isVerifying
                              ? 'Verifying...'
                              : (_isVerified
                                  ? 'Account Verified'
                                  : 'Verify Account'),
                        ),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: _isVerified
                              ? AppColors.success
                              : AppColors.primary,
                          side: BorderSide(
                            color: _isVerified
                                ? AppColors.success
                                : AppColors.primary,
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                      if (_verifyMessage != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _verifyMessage!,
                          style: TextStyle(
                            color: _isVerified
                                ? AppColors.success
                                : AppColors.error,
                            fontSize: 13,
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _amountController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: 'Amount (Rs.)',
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                          suffixIcon: _isCalculating
                              ? const Padding(
                                  padding: EdgeInsets.all(12),
                                  child: SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  ),
                                )
                              : null,
                        ),
                        validator: (v) => Validators.validateAmount(
                          v,
                          minAmount: AppConstants.minTopupAmount,
                        ),
                      ),
                      if (_chargePreview != null) ...[
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Column(
                            children: [
                              _feeRow('Transfer amount', _chargePreview!.amount),
                              _feeRow('Service charge', _chargePreview!.charge),
                              _feeRow('Cashback', _chargePreview!.cashback),
                              const Divider(height: 18),
                              _feeRow(
                                'Total debit',
                                _chargePreview!.totalDebited,
                                bold: true,
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _remarksController,
                        decoration: InputDecoration(
                          labelText: 'Remarks',
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: _isSubmitting ? null : _submitTransfer,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.secondary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: _isSubmitting
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(
                                _chargePreview != null
                                    ? 'Transfer ${_formatRs(_chargePreview!.totalDebited)}'
                                    : 'Confirm Transfer',
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  Widget _feeRow(String label, double amount, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              color: AppColors.textPrimary,
            ),
          ),
          Text(
            _formatRs(amount),
            style: TextStyle(
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              color: bold ? AppColors.secondary : AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
