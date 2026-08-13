import 'dart:convert';
import 'dart:io';

import '../config/app_config.dart';
import 'fcm_log.dart';

enum DeviceTokenSyncStatus {
  saved,
  alreadySaved,
  skippedNoFcm,
  skippedNoAuth,
  httpError,
  networkError,
}

class DeviceTokenSyncResult {
  const DeviceTokenSyncResult(
    this.status, {
    this.statusCode,
    this.body,
    this.uri,
  });

  final DeviceTokenSyncStatus status;
  final int? statusCode;
  final String? body;
  final Uri? uri;

  bool get done =>
      status == DeviceTokenSyncStatus.saved ||
      status == DeviceTokenSyncStatus.alreadySaved;
}

class DeviceTokenApi {
  DeviceTokenApi._();

  static Uri endpoint([String? apiBaseHint]) {
    final fallback = Uri.parse('${AppConfig.apiUrl}/api/auth/device-token/');
    final trimmed = (apiBaseHint ?? '').trim();
    if (trimmed.isEmpty) return fallback;
    final parsed = Uri.tryParse(trimmed);
    if (parsed == null || parsed.host.isEmpty) return fallback;
    if (parsed.path.contains('device-token')) return parsed;
    final path = parsed.path.endsWith('/')
        ? '${parsed.path}api/auth/device-token/'
        : '${parsed.path}/api/auth/device-token/';
    return parsed.replace(path: path, query: '', fragment: '');
  }

  static Future<DeviceTokenSyncResult> register({
    required String fcmToken,
    required String authToken,
    required String platform,
    String? apiBaseHint,
    required String reason,
  }) async {
    final uri = endpoint(apiBaseHint);
    HttpClient? client;
    try {
      FcmLog.box(
        step: 'POST /api/auth/device-token/',
        status: 'SENDING',
        fields: {
          'reason': reason,
          'url': uri.toString(),
          'platform': platform,
          'auth': FcmLog.preview(authToken),
          'fcm': FcmLog.preview(fcmToken),
          'fcm_len': '${fcmToken.length}',
        },
      );

      client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 12);
      final request = await client.postUrl(uri).timeout(const Duration(seconds: 15));
      request.followRedirects = true;
      request.headers.set(HttpHeaders.authorizationHeader, 'Token $authToken');
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'application/json; charset=utf-8',
      );
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.set(
        HttpHeaders.userAgentHeader,
        'MySewaApp/flutter-fcm',
      );
      request.add(
        utf8.encode(
          jsonEncode({
            'token': fcmToken,
            'platform': platform,
          }),
        ),
      );
      final response = await request.close().timeout(const Duration(seconds: 15));
      final body = await utf8.decodeStream(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        FcmLog.box(
          step: 'POST /api/auth/device-token/',
          status: 'SAVED',
          fields: {
            'http': '${response.statusCode}',
            'reason': reason,
            'platform': platform,
            'fcm': FcmLog.preview(fcmToken),
            'body': body.length > 240 ? '${body.substring(0, 240)}…' : body,
          },
        );
        return DeviceTokenSyncResult(
          DeviceTokenSyncStatus.saved,
          statusCode: response.statusCode,
          body: body,
          uri: uri,
        );
      }

      FcmLog.box(
        step: 'POST /api/auth/device-token/',
        status: 'HTTP ${response.statusCode}',
        fields: {
          'reason': reason,
          'url': uri.toString(),
          'body': body.length > 400 ? '${body.substring(0, 400)}…' : body,
        },
      );
      return DeviceTokenSyncResult(
        DeviceTokenSyncStatus.httpError,
        statusCode: response.statusCode,
        body: body,
        uri: uri,
      );
    } catch (e) {
      FcmLog.fail('POST failed', e, {
        'reason': reason,
        'url': uri.toString(),
      });
      return DeviceTokenSyncResult(
        DeviceTokenSyncStatus.networkError,
        uri: uri,
        body: '$e',
      );
    } finally {
      client?.close(force: true);
    }
  }
}
