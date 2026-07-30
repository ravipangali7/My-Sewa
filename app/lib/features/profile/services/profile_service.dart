import 'dart:io';
import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../../auth/models/user_model.dart';
import '../../../core/constants/app_constants.dart';

/// Profile service for user profile management
class ProfileService {
  final ApiService _apiService = ApiService();

  /// Get user profile
  Future<ApiResponse<UserModel>> getProfile() async {
    return await _apiService.get<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/profile/',
      fromJson: (json) => UserModel.fromJson(json),
      requireAuth: true,
    );
  }

  /// Update user profile (email, first_name, last_name)
  Future<ApiResponse<UserModel>> updateProfile({
    String? email,
    String? firstName,
    String? lastName,
  }) async {
    final Map<String, dynamic> data = {};
    if (email != null) data['email'] = email;
    if (firstName != null) data['first_name'] = firstName;
    if (lastName != null) data['last_name'] = lastName;

    return await _apiService.put<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/profile/',
      data,
      fromJson: (json) {
        if (json is Map<String, dynamic> && json.containsKey('user')) {
          return UserModel.fromJson(json['user']);
        }
        return UserModel.fromJson(json);
      },
      requireAuth: true,
    );
  }

  /// Upload / update profile avatar
  Future<ApiResponse<UserModel>> updateAvatar(File imageFile) async {
    final fileBytes = await imageFile.readAsBytes();
    final fileName = imageFile.path.split(RegExp(r'[\\/]')).last;

    return await _apiService.putMultipart<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/profile/',
      {},
      fileField: 'avatar',
      fileBytes: fileBytes,
      fileName: fileName,
      fromJson: (json) {
        if (json is Map<String, dynamic> && json.containsKey('user')) {
          return UserModel.fromJson(json['user']);
        }
        return UserModel.fromJson(json);
      },
      requireAuth: true,
    );
  }

  /// Change password — returns new auth token on success
  Future<ApiResponse<String>> changePassword({
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) async {
    final response = await _apiService.post<String>(
      '${AppConstants.apiPrefix}/api/auth/change-password/',
      {
        'current_password': currentPassword,
        'new_password': newPassword,
        'confirm_password': confirmPassword,
      },
      fromJson: (json) {
        if (json is Map && json['token'] != null) {
          return json['token'].toString();
        }
        return '';
      },
      requireAuth: true,
    );

    // Persist rotated token so the session stays valid after password change
    if (response.success) {
      final token = response.data;
      if (token != null && token.isNotEmpty) {
        await _apiService.saveToken(token);
      }
    }

    return response;
  }

  /// Change phone number (requires current password)
  Future<ApiResponse<UserModel>> changePhone({
    required String newPhone,
    required String currentPassword,
  }) async {
    return await _apiService.post<UserModel>(
      '${AppConstants.apiPrefix}/api/auth/change-phone/',
      {
        'new_phone': newPhone,
        'current_password': currentPassword,
      },
      fromJson: (json) {
        if (json is Map<String, dynamic> && json.containsKey('user')) {
          return UserModel.fromJson(json['user']);
        }
        return UserModel.fromJson(json);
      },
      requireAuth: true,
    );
  }
}
