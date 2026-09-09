import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

import 'biometric_api.dart';

class BiometricResult {
  const BiometricResult({
    required this.success,
    required this.action,
    required this.authenticated,
    this.reason = '',
    this.message = '',
    this.token = '',
    this.biometricAvailable = false,
    this.canCheckBiometrics = false,
    this.isDeviceSupported = false,
    this.loginEnrolled = false,
    this.pinEnrolled = false,
    this.availableTypes = const <String>[],
  });

  final bool success;
  final String action;
  final bool authenticated;
  final String reason;
  final String message;
  final String token;
  final bool biometricAvailable;
  final bool canCheckBiometrics;
  final bool isDeviceSupported;
  final bool loginEnrolled;
  final bool pinEnrolled;
  final List<String> availableTypes;

  Map<String, dynamic> toJson() => {
        'success': success,
        'action': action,
        'authenticated': authenticated,
        if (reason.isNotEmpty) 'reason': reason,
        if (message.isNotEmpty) 'message': message,
        'biometricAvailable': biometricAvailable,
        'canCheckBiometrics': canCheckBiometrics,
        'isDeviceSupported': isDeviceSupported,
        'loginEnrolled': loginEnrolled,
        'pinEnrolled': pinEnrolled,
        'availableTypes': availableTypes,
      };
}

class BiometricService {
  BiometricService._();

  static const _deviceIdKey = 'mysewa.biometric.device_id';
  static const _secretKey = 'mysewa.biometric.secret';
  static const _userIdKey = 'mysewa.biometric.user_id';
  static const _loginKey = 'mysewa.biometric.login_enabled';
  static const _pinKey = 'mysewa.biometric.pin_enabled';

  static final LocalAuthentication _auth = LocalAuthentication();
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(storageNamespace: 'mysewa_biometric'),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  static Future<BiometricResult> availability({String action = 'availability'}) async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      final types = await _auth.getAvailableBiometrics();
      final enrolled = types.isNotEmpty;
      final available = supported && canCheck && enrolled;
      final loginEnrolled = await _flag(_loginKey);
      final pinEnrolled = await _flag(_pinKey);
      return BiometricResult(
        success: true,
        action: action,
        authenticated: false,
        biometricAvailable: available,
        canCheckBiometrics: canCheck,
        isDeviceSupported: supported,
        loginEnrolled: loginEnrolled,
        pinEnrolled: pinEnrolled,
        availableTypes: types.map(_typeName).toList(),
        reason: available
            ? ''
            : (!supported
                ? 'not_supported'
                : (!canCheck
                    ? 'not_available'
                    : (enrolled ? '' : 'not_enrolled'))),
        message: available
            ? ''
            : (!supported
                ? 'This device does not support biometric authentication.'
                : (!canCheck
                    ? 'Biometric authentication is unavailable on this device.'
                    : 'No fingerprint or Face ID is enrolled on this device.')),
      );
    } on PlatformException catch (error) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: 'not_available',
        message: _platformMessage(error),
      );
    }
  }

  static Future<BiometricResult> handle({
    required String action,
    required String authToken,
    String? apiBaseHint,
    String? userId,
    String reason = '',
  }) async {
    switch (action) {
      case 'availability':
      case 'check':
        return availability();
      case 'login':
        return login(apiBaseHint: apiBaseHint);
      case 'enable_login':
        return enable(
          purpose: 'login',
          authToken: authToken,
          apiBaseHint: apiBaseHint,
          userId: userId,
        );
      case 'disable_login':
        return disable(
          purpose: 'login',
          authToken: authToken,
          apiBaseHint: apiBaseHint,
        );
      case 'transaction_pin':
      case 'verify_transaction_pin':
        return verifyTransactionPin(
          authToken: authToken,
          apiBaseHint: apiBaseHint,
          reason: reason,
        );
      case 'enable_transaction_pin':
        return enable(
          purpose: 'transaction_pin',
          authToken: authToken,
          apiBaseHint: apiBaseHint,
          userId: userId,
        );
      case 'disable_transaction_pin':
        return disable(
          purpose: 'transaction_pin',
          authToken: authToken,
          apiBaseHint: apiBaseHint,
        );
      default:
        return BiometricResult(
          success: false,
          action: action,
          authenticated: false,
          reason: 'invalid_action',
          message: 'Unknown biometric request.',
        );
    }
  }

  static Future<BiometricResult> login({String? apiBaseHint}) async {
    final cap = await availability(action: 'login');
    if (!cap.biometricAvailable) return cap;
    if (!cap.loginEnrolled) {
      return BiometricResult(
        success: false,
        action: 'login',
        authenticated: false,
        reason: 'not_enabled',
        message: 'Enable biometric login from Profile after you sign in.',
        biometricAvailable: cap.biometricAvailable,
        availableTypes: cap.availableTypes,
      );
    }
    final prompt = await _authenticate(
      reason: 'Confirm it’s you to sign in to MySewa.',
    );
    if (!prompt.success) {
      return BiometricResult(
        success: false,
        action: 'login',
        authenticated: false,
        reason: prompt.reason,
        message: prompt.message,
        biometricAvailable: cap.biometricAvailable,
        loginEnrolled: true,
        availableTypes: cap.availableTypes,
      );
    }
    final creds = await _readCredentials();
    if (creds == null) {
      return const BiometricResult(
        success: false,
        action: 'login',
        authenticated: false,
        reason: 'not_enabled',
        message: 'Enable biometric login from Profile after you sign in.',
      );
    }
    final api = await BiometricApi.post(
      path: '/api/auth/biometric-login/',
      apiBaseHint: apiBaseHint,
      body: {
        'device_id': creds.deviceId,
        'secret': creds.secret,
      },
    );
    if (!api.ok || api.token.isEmpty) {
      return BiometricResult(
        success: false,
        action: 'login',
        authenticated: false,
        reason: api.reason.isNotEmpty ? api.reason : 'authentication_failed',
        message: api.message.isNotEmpty
            ? api.message
            : 'Biometric login failed. Please sign in with your password.',
        biometricAvailable: cap.biometricAvailable,
        loginEnrolled: true,
      );
    }
    return BiometricResult(
      success: true,
      action: 'login',
      authenticated: true,
      token: api.token,
      biometricAvailable: cap.biometricAvailable,
      loginEnrolled: true,
      pinEnrolled: cap.pinEnrolled,
      availableTypes: cap.availableTypes,
    );
  }

  static Future<BiometricResult> enable({
    required String purpose,
    required String authToken,
    String? apiBaseHint,
    String? userId,
  }) async {
    final action = purpose == 'login' ? 'enable_login' : 'enable_transaction_pin';
    if (authToken.trim().isEmpty) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: 'session_expired',
        message: 'Please sign in again to enable biometric authentication.',
      );
    }
    final cap = await availability(action: action);
    if (!cap.biometricAvailable) return cap;
    final prompt = await _authenticate(
      reason: purpose == 'login'
          ? 'Confirm it’s you to enable biometric login.'
          : 'Confirm it’s you to enable biometric transaction confirmation.',
    );
    if (!prompt.success) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: prompt.reason,
        message: prompt.message,
        biometricAvailable: cap.biometricAvailable,
        availableTypes: cap.availableTypes,
      );
    }
    final creds = await _ensureCredentials(userId: userId);
    final api = await BiometricApi.post(
      path: '/api/auth/biometric/enable/',
      authToken: authToken,
      apiBaseHint: apiBaseHint,
      body: {
        'device_id': creds.deviceId,
        'secret': creds.secret,
        'purpose': purpose,
      },
    );
    if (!api.ok) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: api.reason.isNotEmpty ? api.reason : 'backend_failed',
        message: api.message.isNotEmpty
            ? api.message
            : 'Could not save biometric preference. Please try again.',
        biometricAvailable: cap.biometricAvailable,
      );
    }
    if (purpose == 'login') {
      await _storage.write(key: _loginKey, value: '1');
    } else {
      await _storage.write(key: _pinKey, value: '1');
    }
    if ((userId ?? '').trim().isNotEmpty) {
      await _storage.write(key: _userIdKey, value: userId!.trim());
    }
    return BiometricResult(
      success: true,
      action: action,
      authenticated: true,
      biometricAvailable: true,
      loginEnrolled: purpose == 'login' ? true : cap.loginEnrolled,
      pinEnrolled: purpose == 'transaction_pin' ? true : cap.pinEnrolled,
      availableTypes: cap.availableTypes,
      message: purpose == 'login'
          ? 'Biometric login enabled successfully.'
          : 'Transaction PIN biometric enabled successfully.',
    );
  }

  static Future<BiometricResult> disable({
    required String purpose,
    required String authToken,
    String? apiBaseHint,
  }) async {
    final action = purpose == 'login' ? 'disable_login' : 'disable_transaction_pin';
    final creds = await _readCredentials();
    if (authToken.trim().isNotEmpty) {
      final api = await BiometricApi.post(
        path: '/api/auth/biometric/disable/',
        authToken: authToken,
        apiBaseHint: apiBaseHint,
        body: {
          'purpose': purpose,
          if (creds != null) 'device_id': creds.deviceId,
        },
      );
      if (!api.ok) {
        return BiometricResult(
          success: false,
          action: action,
          authenticated: false,
          reason: api.reason.isNotEmpty ? api.reason : 'backend_failed',
          message: api.message.isNotEmpty
              ? api.message
              : 'Could not update biometric preference. Please try again.',
        );
      }
    }
    if (purpose == 'login') {
      await _storage.write(key: _loginKey, value: '0');
    } else {
      await _storage.write(key: _pinKey, value: '0');
    }
    final loginEnrolled = await _flag(_loginKey);
    final pinEnrolled = await _flag(_pinKey);
    if (!loginEnrolled && !pinEnrolled) {
      await _storage.delete(key: _secretKey);
    }
    return BiometricResult(
      success: true,
      action: action,
      authenticated: false,
      loginEnrolled: loginEnrolled,
      pinEnrolled: pinEnrolled,
      message: purpose == 'login'
          ? 'Biometric login disabled.'
          : 'Transaction PIN biometric disabled.',
    );
  }

  static Future<BiometricResult> verifyTransactionPin({
    required String authToken,
    String? apiBaseHint,
    String reason = '',
  }) async {
    const action = 'transaction_pin';
    if (authToken.trim().isEmpty) {
      return const BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: 'session_expired',
        message: 'Your session expired. Please sign in again.',
      );
    }
    final cap = await availability(action: action);
    if (!cap.biometricAvailable) return cap;
    if (!cap.pinEnrolled) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: 'not_enabled',
        message: 'Enable transaction PIN biometric from Profile first.',
        biometricAvailable: cap.biometricAvailable,
      );
    }
    final prompt = await _authenticate(
      reason: reason.trim().isEmpty
          ? 'Confirm this transaction with fingerprint or Face ID.'
          : reason.trim(),
    );
    if (!prompt.success) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: prompt.reason,
        message: prompt.message,
        biometricAvailable: cap.biometricAvailable,
        pinEnrolled: true,
      );
    }
    final creds = await _readCredentials();
    if (creds == null) {
      return const BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: 'not_enabled',
        message: 'Enable transaction PIN biometric from Profile first.',
      );
    }
    final api = await BiometricApi.post(
      path: '/api/auth/biometric/assertion/',
      authToken: authToken,
      apiBaseHint: apiBaseHint,
      body: {
        'device_id': creds.deviceId,
        'secret': creds.secret,
        'purpose': 'transaction_pin',
      },
    );
    if (!api.ok) {
      return BiometricResult(
        success: false,
        action: action,
        authenticated: false,
        reason: api.reason.isNotEmpty ? api.reason : 'backend_failed',
        message: api.message.isNotEmpty
            ? api.message
            : 'Biometric confirmation failed. Please use your transaction PIN.',
        pinEnrolled: true,
      );
    }
    return BiometricResult(
      success: true,
      action: action,
      authenticated: true,
      pinEnrolled: true,
      biometricAvailable: true,
    );
  }

  static Future<({bool success, String reason, String message})> _authenticate({
    required String reason,
  }) async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
          useErrorDialogs: true,
          sensitiveTransaction: true,
        ),
      );
      if (ok) {
        return (success: true, reason: '', message: '');
      }
      return (
        success: false,
        reason: 'authentication_failed',
        message: 'Biometric authentication failed. Please try again.',
      );
    } on PlatformException catch (error) {
      return (
        success: false,
        reason: _platformReason(error),
        message: _platformMessage(error),
      );
    }
  }

  static String _platformReason(PlatformException error) {
    switch (error.code) {
      case auth_error.notAvailable:
        return 'not_available';
      case auth_error.notEnrolled:
        return 'not_enrolled';
      case auth_error.lockedOut:
      case auth_error.permanentlyLockedOut:
        return 'locked_out';
      default:
        final lowered = error.code.toLowerCase();
        if (lowered.contains('cancel')) return 'cancelled';
        if (lowered.contains('lock')) return 'locked_out';
        if (lowered.contains('passcode')) return 'not_enrolled';
        return 'authentication_failed';
    }
  }

  static String _platformMessage(PlatformException error) {
    switch (_platformReason(error)) {
      case 'cancelled':
        return '';
      case 'not_available':
        return 'Biometric authentication is unavailable on this device.';
      case 'not_enrolled':
        return 'No fingerprint or Face ID is enrolled on this device.';
      case 'locked_out':
        return 'Too many failed attempts. Use your password or PIN, then try again.';
      default:
        return 'Biometric authentication failed. Please try again.';
    }
  }

  static String _typeName(BiometricType type) {
    switch (type) {
      case BiometricType.face:
        return 'face';
      case BiometricType.fingerprint:
        return 'fingerprint';
      case BiometricType.iris:
        return 'iris';
      case BiometricType.strong:
        return 'strong';
      case BiometricType.weak:
        return 'weak';
    }
  }

  static Future<bool> _flag(String key) async {
    final value = (await _storage.read(key: key) ?? '').trim();
    return value == '1' || value.toLowerCase() == 'true';
  }

  static Future<({String deviceId, String secret})?> _readCredentials() async {
    final deviceId = (await _storage.read(key: _deviceIdKey) ?? '').trim();
    final secret = (await _storage.read(key: _secretKey) ?? '').trim();
    if (deviceId.isEmpty || secret.isEmpty) return null;
    return (deviceId: deviceId, secret: secret);
  }

  static Future<({String deviceId, String secret})> _ensureCredentials({
    String? userId,
  }) async {
    final storedUser = (await _storage.read(key: _userIdKey) ?? '').trim();
    final nextUser = (userId ?? '').trim();
    if (nextUser.isNotEmpty && storedUser.isNotEmpty && storedUser != nextUser) {
      await _storage.delete(key: _deviceIdKey);
      await _storage.delete(key: _secretKey);
      await _storage.write(key: _loginKey, value: '0');
      await _storage.write(key: _pinKey, value: '0');
    }
    var deviceId = (await _storage.read(key: _deviceIdKey) ?? '').trim();
    var secret = (await _storage.read(key: _secretKey) ?? '').trim();
    if (deviceId.isEmpty) {
      deviceId = _uuidV4();
      await _storage.write(key: _deviceIdKey, value: deviceId);
    }
    if (secret.isEmpty) {
      secret = _randomSecret();
      await _storage.write(key: _secretKey, value: secret);
    }
    if (nextUser.isNotEmpty) {
      await _storage.write(key: _userIdKey, value: nextUser);
    }
    return (deviceId: deviceId, secret: secret);
  }

  static String _uuidV4() {
    final rand = Random.secure();
    final bytes = List<int>.generate(16, (_) => rand.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  static String _randomSecret() {
    final rand = Random.secure();
    final bytes = List<int>.generate(48, (_) => rand.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }
}
