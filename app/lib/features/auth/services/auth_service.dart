import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../models/user_model.dart';
import '../../../core/constants/app_constants.dart';

/// Authentication service
class AuthService {
  final ApiService _apiService = ApiService();

  /// Register new user - phone number is used as username
  Future<ApiResponse<UserModel>> register({
    required String phone,
    String? email,
    required String password,
    required String password2,
    String? firstName,
    String? lastName,
  }) async {
    final response = await _apiService.post<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/register/',
      {
        'phone': phone,
        'username': phone, // Backend expects username field
        if (email != null && email.isNotEmpty) 'email': email,
        'password': password,
        'password2': password2,
        if (firstName != null) 'first_name': firstName,
        if (lastName != null) 'last_name': lastName,
      },
      fromJson: (json) => UserModel.fromJson(json),
      requireAuth: false,
    );

    if (response.success && response.data?.token != null) {
      await _apiService.saveToken(response.data!.token!);
    }

    return response;
  }

  /// Login user - phone number is used as username
  Future<ApiResponse<UserModel>> login({
    required String phone,
    required String password,
  }) async {
    final response = await _apiService.post<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/login/',
      {
        'username': phone, // Backend expects username field (which is phone)
        'password': password,
      },
      fromJson: (json) => UserModel.fromJson(json),
      requireAuth: false,
    );

    if (response.success && response.data?.token != null) {
      await _apiService.saveToken(response.data!.token!);
    }

    return response;
  }

  /// Logout user
  Future<void> logout() async {
    await _apiService.post(
      '${AppConstants.apiPrefix}/api/auth/logout/',
      {},
      requireAuth: true,
    );
    await _apiService.removeToken();
  }

  /// Check if user is authenticated
  Future<bool> isAuthenticated() async {
    await _apiService.init();
    return _apiService.token != null;
  }
}
