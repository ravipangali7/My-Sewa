import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/constants/app_constants.dart';
import '../models/api_response.dart';

/// Base API service with token management and error handling
class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String? _token;
  final String baseUrl = AppConstants.baseUrl;

  /// Get current token
  String? get token => _token;

  /// Initialize token from storage
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(AppConstants.tokenKey);
  }

  /// Save token to storage
  Future<void> saveToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(AppConstants.tokenKey, token);
  }

  /// Remove token from storage
  Future<void> removeToken() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(AppConstants.tokenKey);
  }

  /// Get authorization headers
  Map<String, String> _getHeaders({bool includeAuth = true}) {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (includeAuth && _token != null) {
      headers['Authorization'] = 'Token $_token';
    }
    return headers;
  }

  /// GET request
  Future<ApiResponse<T>> get<T>(
    String endpoint, {
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$endpoint');
      final response = await http
          .get(url, headers: _getHeaders(includeAuth: requireAuth))
          .timeout(AppConstants.apiTimeout);

      return _handleResponse<T>(response, fromJson);
    } catch (e) {
      return ApiResponse<T>(
        success: false,
        message: 'Network error: ${e.toString()}',
      );
    }
  }

  /// POST request
  Future<ApiResponse<T>> post<T>(
    String endpoint,
    Map<String, dynamic> data, {
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$endpoint');
      final response = await http
          .post(
            url,
            headers: _getHeaders(includeAuth: requireAuth),
            body: jsonEncode(data),
          )
          .timeout(AppConstants.apiTimeout);

      return _handleResponse<T>(response, fromJson);
    } catch (e) {
      return ApiResponse<T>(
        success: false,
        message: 'Network error: ${e.toString()}',
      );
    }
  }

  /// PUT request
  Future<ApiResponse<T>> put<T>(
    String endpoint,
    Map<String, dynamic> data, {
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$endpoint');
      final response = await http
          .put(
            url,
            headers: _getHeaders(includeAuth: requireAuth),
            body: jsonEncode(data),
          )
          .timeout(AppConstants.apiTimeout);

      return _handleResponse<T>(response, fromJson);
    } catch (e) {
      return ApiResponse<T>(
        success: false,
        message: 'Network error: ${e.toString()}',
      );
    }
  }

  /// POST request with multipart (for file uploads)
  Future<ApiResponse<T>> postMultipart<T>(
    String endpoint,
    Map<String, String> fields,
    String fileField,
    List<int> fileBytes,
    String fileName, {
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    return _multipart<T>(
      'POST',
      endpoint,
      fields,
      fileField: fileField,
      fileBytes: fileBytes,
      fileName: fileName,
      fromJson: fromJson,
      requireAuth: requireAuth,
    );
  }

  /// PUT/PATCH request with multipart (for profile avatar uploads)
  Future<ApiResponse<T>> putMultipart<T>(
    String endpoint,
    Map<String, String> fields, {
    String? fileField,
    List<int>? fileBytes,
    String? fileName,
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    return _multipart<T>(
      'PUT',
      endpoint,
      fields,
      fileField: fileField,
      fileBytes: fileBytes,
      fileName: fileName,
      fromJson: fromJson,
      requireAuth: requireAuth,
    );
  }

  Future<ApiResponse<T>> _multipart<T>(
    String method,
    String endpoint,
    Map<String, String> fields, {
    String? fileField,
    List<int>? fileBytes,
    String? fileName,
    T Function(dynamic)? fromJson,
    bool requireAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$endpoint');
      final request = http.MultipartRequest(method, url);

      request.headers.addAll(_getHeaders(includeAuth: requireAuth));
      request.headers.remove('Content-Type');

      request.fields.addAll(fields);

      if (fileField != null && fileBytes != null && fileName != null) {
        request.files.add(
          http.MultipartFile.fromBytes(
            fileField,
            fileBytes,
            filename: fileName,
          ),
        );
      }

      final streamedResponse =
          await request.send().timeout(AppConstants.apiTimeout);
      final response = await http.Response.fromStream(streamedResponse);

      return _handleResponse<T>(response, fromJson);
    } catch (e) {
      return ApiResponse<T>(
        success: false,
        message: 'Network error: ${e.toString()}',
      );
    }
  }

  /// Handle HTTP response
  ApiResponse<T> _handleResponse<T>(
    http.Response response,
    T Function(dynamic)? fromJson,
  ) {
    try {
      // Handle empty response body
      if (response.body.isEmpty) {
        return ApiResponse<T>(
          success: false,
          message: 'Empty response from server',
        );
      }
      
      // Try to decode JSON
      dynamic jsonData;
      try {
        jsonData = jsonDecode(response.body);
      } catch (e) {
        // Server returned HTML (e.g. Django debug page) or other non-JSON
        return ApiResponse<T>(
          success: false,
          message: _friendlyNonJsonError(response),
        );
      }
      
      final bool isSuccess = response.statusCode >= 200 && response.statusCode < 300;
      
      // Use ApiResponse.fromJson for both success and error cases
      // This ensures consistent error parsing using the updated logic
      try {
        return ApiResponse.fromJson(jsonData, fromJson, isSuccess: isSuccess);
      } catch (e) {
        // If fromJson fails, return error
        return ApiResponse<T>(
          success: false,
          message: 'Failed to parse response data: ${e.toString()}',
        );
      }
    } catch (e) {
      // If JSON parsing fails, try to extract error message from response body
      String errorMessage = 'Failed to parse response: ${e.toString()}';
      if (response.body.isNotEmpty) {
        try {
          // Try to extract a simple error message
          final body = response.body.toLowerCase();
          if (body.contains('error') || body.contains('message')) {
            errorMessage = 'Server error: ${response.body.substring(0, response.body.length > 200 ? 200 : response.body.length)}';
          }
        } catch (_) {
          // Ignore parsing errors in error handling
        }
      }
      
      return ApiResponse<T>(
        success: false,
        message: errorMessage,
      );
    }
  }

  /// User-facing message when the server returns HTML/plain text instead of JSON.
  String _friendlyNonJsonError(http.Response response) {
    final body = response.body;
    final lower = body.toLowerCase();

    if (lower.contains('no such column')) {
      return 'Server database is out of date. Ask an admin to run migrations.';
    }
    if (lower.contains('<!doctype') || lower.contains('<html')) {
      return 'Server error (${response.statusCode}). Please try again.';
    }
    if (response.statusCode >= 500) {
      return 'Server error (${response.statusCode}). Please try again.';
    }
    return 'Unexpected server response (${response.statusCode}). Please try again.';
  }
}
