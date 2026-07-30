import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../models/topup_model.dart';
import '../../../core/constants/app_constants.dart';
import 'dart:io' show Platform;

/// Topup service
class TopupService {
  final ApiService _apiService = ApiService();

  String _getPlatform() {
    if (Platform.isAndroid) return AppConstants.platformAndroid;
    if (Platform.isIOS) return AppConstants.platformIOS;
    return AppConstants.platformWeb;
  }

  /// Topup NTC
  Future<ApiResponse<TopupModel>> topupNTC({
    required String mobileNumber,
    required double amount,
  }) async {
    final response = await _apiService.post<TopupModel>(
      '${AppConstants.apiPrefix}/api/topup/ntc/',
      {
        'mobile_number': mobileNumber,
        'amount': amount.toString(),
        'product_id': AppConstants.productIdNTC,
        'created_platform': _getPlatform(),
      },
      fromJson: (json) {
        if (json is Map<String, dynamic> && json.containsKey('data')) {
          return TopupModel.fromJson(json['data']);
        }
        return TopupModel.fromJson(json);
      },
      requireAuth: true,
    );

    return response;
  }

  /// Topup NCELL
  Future<ApiResponse<TopupModel>> topupNCELL({
    required String mobileNumber,
    required double amount,
  }) async {
    final response = await _apiService.post<TopupModel>(
      '${AppConstants.apiPrefix}/api/topup/ncell/',
      {
        'mobile_number': mobileNumber,
        'amount': amount.toString(),
        'product_id': AppConstants.productIdNCELL,
        'created_platform': _getPlatform(),
      },
      fromJson: (json) {
        if (json is Map<String, dynamic> && json.containsKey('data')) {
          return TopupModel.fromJson(json['data']);
        }
        return TopupModel.fromJson(json);
      },
      requireAuth: true,
    );

    return response;
  }

  /// Get topup history
  Future<ApiResponse<List<TopupModel>>> getTopupHistory() async {
    final response = await _apiService.get<List<TopupModel>>(
      '${AppConstants.apiPrefix}/api/topup/history/',
      fromJson: (json) {
        if (json is List) {
          return json.map((item) => TopupModel.fromJson(item)).toList();
        }
        return [];
      },
      requireAuth: true,
    );

    return response;
  }
}
