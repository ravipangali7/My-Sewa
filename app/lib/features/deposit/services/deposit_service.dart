import 'dart:io';
import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../models/deposit_model.dart';
import '../../../core/constants/app_constants.dart';

/// Deposit service
class DepositService {
  final ApiService _apiService = ApiService();

  /// Create deposit request
  Future<ApiResponse<DepositModel>> createDeposit({
    required double amount,
    required File screenshotFile,
    String? note,
  }) async {
    final fileBytes = await screenshotFile.readAsBytes();
    final fileName = screenshotFile.path.split('/').last;

    final response = await _apiService.postMultipart<DepositModel>(
      '${AppConstants.apiPrefix}/api/deposit/create/',
      {
        'amount': amount.toString(),
        if (note != null) 'note': note,
      },
      'screenshot_proof',
      fileBytes,
      fileName,
      fromJson: (json) => DepositModel.fromJson(json),
      requireAuth: true,
    );

    return response;
  }

  /// Get deposit list
  Future<ApiResponse<List<DepositModel>>> getDeposits() async {
    final response = await _apiService.get<List<DepositModel>>(
      '${AppConstants.apiPrefix}/api/deposit/list/',
      fromJson: (json) {
        if (json is List) {
          return json.map((item) => DepositModel.fromJson(item)).toList();
        }
        return [];
      },
      requireAuth: true,
    );

    return response;
  }
}
