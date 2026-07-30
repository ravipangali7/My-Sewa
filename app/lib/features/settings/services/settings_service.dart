import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../models/settings_model.dart';
import '../../../core/constants/app_constants.dart';

/// Settings service
class SettingsService {
  final ApiService _apiService = ApiService();

  /// Get settings (QR code and bank details)
  Future<ApiResponse<SettingsModel>> getSettings() async {
    return await _apiService.get<SettingsModel>(
      '${AppConstants.apiPrefix}/api/settings/',
      fromJson: (json) => SettingsModel.fromJson(json),
      requireAuth: false, // Public endpoint
    );
  }
}
