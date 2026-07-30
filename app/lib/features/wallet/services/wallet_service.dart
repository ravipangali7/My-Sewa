import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../models/wallet_model.dart';
import '../../../core/constants/app_constants.dart';

/// Wallet service
class WalletService {
  final ApiService _apiService = ApiService();

  /// Get wallet balance
  Future<ApiResponse<WalletModel>> getBalance() async {
    return await _apiService.get<WalletModel>(
      '${AppConstants.apiPrefix}/api/wallet/balance/',
      fromJson: (json) => WalletModel.fromJson(json),
      requireAuth: true,
    );
  }

  /// Get transaction history
  Future<ApiResponse<Map<String, dynamic>>> getTransactionHistory() async {
    return await _apiService.get<Map<String, dynamic>>(
      '${AppConstants.apiPrefix}/api/wallet/transactions/',
      fromJson: (json) => json as Map<String, dynamic>,
      requireAuth: true,
    );
  }
}
