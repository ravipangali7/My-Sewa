import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/validators.dart';
import '../../../core/constants/app_constants.dart';
import '../services/topup_service.dart';
import '../models/topup_model.dart';

class TopupScreen extends StatefulWidget {
  const TopupScreen({super.key});

  @override
  State<TopupScreen> createState() => _TopupScreenState();
}

class _TopupScreenState extends State<TopupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _mobileController = TextEditingController();
  final _amountController = TextEditingController();
  final TopupService _topupService = TopupService();

  int _selectedProduct = AppConstants.productIdNTC; // 1 for NTC, 2 for NCELL
  bool _isLoading = false;

  @override
  void dispose() {
    _mobileController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _handleTopup() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final response = _selectedProduct == AppConstants.productIdNTC
          ? await _topupService.topupNTC(
              mobileNumber: _mobileController.text.trim(),
              amount: double.parse(_amountController.text),
            )
          : await _topupService.topupNCELL(
              mobileNumber: _mobileController.text.trim(),
              amount: double.parse(_amountController.text),
            );

      if (response.success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(response.message ?? 'Topup successful'),
            backgroundColor: AppColors.success,
          ),
        );
        Navigator.of(context).pop();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(response.message ?? 'Topup failed'),
              backgroundColor: AppColors.error,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: ${e.toString()}'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('NTC / NCELL Top-up'),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.textLight,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Provider Selection
              Row(
                children: [
                  Icon(
                    Icons.phone_android,
                    color: AppColors.primary,
                    size: 28,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Select Provider',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => setState(() => _selectedProduct = AppConstants.productIdNTC),
                      borderRadius: BorderRadius.circular(16),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: _selectedProduct == AppConstants.productIdNTC
                              ? AppColors.ntcColor.withOpacity(0.15)
                              : AppColors.surface,
                          border: Border.all(
                            color: _selectedProduct == AppConstants.productIdNTC
                                ? AppColors.ntcColor
                                : AppColors.border,
                            width: _selectedProduct == AppConstants.productIdNTC ? 2.5 : 1.5,
                          ),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: _selectedProduct == AppConstants.productIdNTC
                              ? [
                                  BoxShadow(
                                    color: AppColors.ntcColor.withOpacity(0.3),
                                    blurRadius: 12,
                                    offset: const Offset(0, 6),
                                  ),
                                ]
                              : [],
                        ),
                        child: Column(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppColors.ntcColor.withOpacity(0.2),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.phone_android,
                                color: AppColors.ntcColor,
                                size: 36,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'NTC',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppColors.ntcColor,
                                fontSize: 16,
                              ),
                            ),
                            if (_selectedProduct == AppConstants.productIdNTC)
                              Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Icon(
                                  Icons.check_circle,
                                  color: AppColors.ntcColor,
                                  size: 20,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: InkWell(
                      onTap: () => setState(() => _selectedProduct = AppConstants.productIdNCELL),
                      borderRadius: BorderRadius.circular(16),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: _selectedProduct == AppConstants.productIdNCELL
                              ? AppColors.ncellColor.withOpacity(0.15)
                              : AppColors.surface,
                          border: Border.all(
                            color: _selectedProduct == AppConstants.productIdNCELL
                                ? AppColors.ncellColor
                                : AppColors.border,
                            width: _selectedProduct == AppConstants.productIdNCELL ? 2.5 : 1.5,
                          ),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: _selectedProduct == AppConstants.productIdNCELL
                              ? [
                                  BoxShadow(
                                    color: AppColors.ncellColor.withOpacity(0.3),
                                    blurRadius: 12,
                                    offset: const Offset(0, 6),
                                  ),
                                ]
                              : [],
                        ),
                        child: Column(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppColors.ncellColor.withOpacity(0.2),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.phone_android,
                                color: AppColors.ncellColor,
                                size: 36,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'NCELL',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppColors.ncellColor,
                                fontSize: 16,
                              ),
                            ),
                            if (_selectedProduct == AppConstants.productIdNCELL)
                              Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Icon(
                                  Icons.check_circle,
                                  color: AppColors.ncellColor,
                                  size: 20,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              // Mobile Number Input
              TextFormField(
                controller: _mobileController,
                decoration: InputDecoration(
                  labelText: 'Mobile Number',
                  labelStyle: TextStyle(color: AppColors.textSecondary),
                  prefixIcon: Icon(Icons.phone, color: AppColors.primary),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                keyboardType: TextInputType.phone,
                validator: Validators.validateMobileNumber,
              ),
              const SizedBox(height: 20),
              // Amount Input
              TextFormField(
                controller: _amountController,
                decoration: InputDecoration(
                  labelText: 'Amount (Rs.)',
                  labelStyle: TextStyle(color: AppColors.textSecondary),
                  prefixIcon: Icon(Icons.currency_rupee, color: AppColors.primary),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                keyboardType: TextInputType.number,
                validator: (value) => Validators.validateAmount(
                      value,
                      minAmount: AppConstants.minTopupAmount,
                    ),
              ),
              const SizedBox(height: 32),
              // Submit Button
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: _selectedProduct == AppConstants.productIdNTC
                        ? [
                            AppColors.ntcColor,
                            AppColors.ntcColor.withOpacity(0.8),
                          ]
                        : [
                            AppColors.ncellColor,
                            AppColors.ncellColor.withOpacity(0.8),
                          ],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: (_selectedProduct == AppConstants.productIdNTC
                              ? AppColors.ntcColor
                              : AppColors.ncellColor)
                          .withOpacity(0.4),
                      blurRadius: 12,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _handleTopup,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: AppColors.textLight,
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.phone_android, size: 24),
                            const SizedBox(width: 8),
                            Text(
                              'Topup ${_selectedProduct == AppConstants.productIdNTC ? "NTC" : "NCELL"}',
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}
