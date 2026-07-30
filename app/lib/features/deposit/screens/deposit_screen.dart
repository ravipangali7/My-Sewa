import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/validators.dart';
import '../../../core/constants/app_constants.dart';
import '../services/deposit_service.dart';
import '../../settings/services/settings_service.dart';
import '../../settings/models/settings_model.dart';

class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key});

  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _noteController = TextEditingController();
  final DepositService _depositService = DepositService();
  final SettingsService _settingsService = SettingsService();
  final ImagePicker _imagePicker = ImagePicker();

  SettingsModel? _settings;
  File? _screenshotFile;
  bool _isLoading = false;
  bool _isLoadingSettings = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    try {
      final response = await _settingsService.getSettings();
      if (response.success && response.data != null) {
        setState(() => _settings = response.data);
      }
    } catch (e) {
      // Handle error
    } finally {
      if (mounted) {
        setState(() => _isLoadingSettings = false);
      }
    }
  }

  Future<void> _pickImage() async {
    final image = await _imagePicker.pickImage(source: ImageSource.gallery);
    if (image != null) {
      setState(() => _screenshotFile = File(image.path));
    }
  }

  Future<void> _submitDeposit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_screenshotFile == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a screenshot')),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final response = await _depositService.createDeposit(
        amount: double.parse(_amountController.text),
        screenshotFile: _screenshotFile!,
        note: _noteController.text.trim().isEmpty
            ? null
            : _noteController.text.trim(),
      );

      if (response.success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Deposit request submitted successfully'),
            backgroundColor: AppColors.success,
          ),
        );
        Navigator.of(context).pop();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(response.message ?? 'Deposit request failed'),
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
        title: const Text('Fund Transfer'),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.textLight,
      ),
      body: _isLoadingSettings
          ? Center(
              child: CircularProgressIndicator(
                color: AppColors.primary,
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20.0),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // QR Code Display
                    if (_settings?.qrCodeUrl != null)
                      Card(
                        elevation: 4,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                AppColors.primaryLight.withOpacity(0.1),
                                AppColors.surface,
                              ],
                            ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.qr_code_scanner,
                                      color: AppColors.primary,
                                      size: 28,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Scan QR Code to Pay',
                                      style: TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 24),
                                Container(
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                    boxShadow: [
                                      BoxShadow(
                                        color: AppColors.shadowLight,
                                        blurRadius: 10,
                                        offset: const Offset(0, 4),
                                      ),
                                    ],
                                  ),
                                  child: Image.network(
                                    _settings!.qrCodeUrl!,
                                    height: 220,
                                    width: 220,
                                    fit: BoxFit.contain,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    if (_settings?.qrCodeUrl != null) const SizedBox(height: 20),
                    // Bank Details
                    if (_settings?.bankDetails != null)
                      Card(
                        elevation: 4,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                AppColors.primaryLight.withOpacity(0.1),
                                AppColors.surface,
                              ],
                            ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(
                                      Icons.account_balance,
                                      color: AppColors.primary,
                                      size: 28,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Bank Details',
                                      style: TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 20),
                                ...(_settings!.bankDetails as Map<String, dynamic>)
                                    .entries
                                    .map((entry) => Container(
                                          margin: const EdgeInsets.only(bottom: 12),
                                          padding: const EdgeInsets.all(16),
                                          decoration: BoxDecoration(
                                            color: AppColors.background,
                                            borderRadius: BorderRadius.circular(12),
                                            border: Border.all(
                                              color: AppColors.border,
                                              width: 1,
                                            ),
                                          ),
                                          child: Row(
                                            mainAxisAlignment:
                                                MainAxisAlignment.spaceBetween,
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  entry.key,
                                                  style: TextStyle(
                                                    fontWeight: FontWeight.w600,
                                                    color: AppColors.textPrimary,
                                                    fontSize: 15,
                                                  ),
                                                ),
                                              ),
                                              Expanded(
                                                child: Text(
                                                  entry.value.toString(),
                                                  textAlign: TextAlign.end,
                                                  style: TextStyle(
                                                    color: AppColors.textSecondary,
                                                    fontSize: 15,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        )),
                              ],
                            ),
                          ),
                        ),
                      ),
                    if (_settings?.bankDetails != null) const SizedBox(height: 20),
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
                            minAmount: AppConstants.minDepositAmount,
                          ),
                    ),
                    const SizedBox(height: 20),
                    // Screenshot Upload
                    InkWell(
                      onTap: _pickImage,
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: _screenshotFile == null
                                ? AppColors.border
                                : AppColors.success,
                            width: _screenshotFile == null ? 1 : 2,
                          ),
                          borderRadius: BorderRadius.circular(12),
                          color: _screenshotFile == null
                              ? AppColors.surface
                              : AppColors.success.withOpacity(0.1),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: (_screenshotFile == null
                                        ? AppColors.textSecondary
                                        : AppColors.success)
                                    .withOpacity(0.1),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                _screenshotFile == null
                                    ? Icons.add_photo_alternate
                                    : Icons.check_circle,
                                color: _screenshotFile == null
                                    ? AppColors.textSecondary
                                    : AppColors.success,
                                size: 28,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _screenshotFile == null
                                        ? 'Upload Screenshot Proof'
                                        : 'Screenshot Selected',
                                    style: TextStyle(
                                      color: _screenshotFile == null
                                          ? AppColors.textSecondary
                                          : AppColors.textPrimary,
                                      fontWeight: FontWeight.w600,
                                      fontSize: 15,
                                    ),
                                  ),
                                  if (_screenshotFile != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text(
                                        _screenshotFile!.path.split('/').last,
                                        style: TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 12,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            if (_screenshotFile != null)
                              Icon(
                                Icons.check_circle,
                                color: AppColors.success,
                                size: 24,
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    // Note Input
                    TextFormField(
                      controller: _noteController,
                      decoration: InputDecoration(
                        labelText: 'Note (Optional)',
                        labelStyle: TextStyle(color: AppColors.textSecondary),
                        prefixIcon: Icon(Icons.note, color: AppColors.primary),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 32),
                    // Submit Button
                    Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppColors.primary,
                            AppColors.primaryDark,
                          ],
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primary.withOpacity(0.4),
                            blurRadius: 12,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _submitDeposit,
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
                            : const Text(
                                'Submit Deposit Request',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.5,
                                ),
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
