/// Application constants
class AppConstants {
  // API Configuration
  static const String baseUrl =
      'http://192.168.101.3:8000'; // Change to your backend URL
  static const String apiPrefix = '';
  static const Duration apiTimeout = Duration(seconds: 30);

  // Storage Keys
  static const String tokenKey = 'auth_token';
  static const String userKey = 'user_data';

  // Validation
  static const int minPasswordLength = 8;
  static const double minDepositAmount = 100.0;
  static const double minTopupAmount = 10.0;
  static const int mobileNumberLength = 10;

  // Product IDs
  static const int productIdNTC = 1;
  static const int productIdNCELL = 2;

  // Deposit Status
  static const String depositStatusPending = 'pending';
  static const String depositStatusApproved = 'approved';
  static const String depositStatusRejected = 'rejected';

  // Topup Status
  static const String topupStatusPending = 'pending';
  static const String topupStatusSuccess = 'success';
  static const String topupStatusFailed = 'failed';

  // Platform
  static const String platformAndroid = 'Android';
  static const String platformIOS = 'iOS';
  static const String platformWeb = 'Web';
}
