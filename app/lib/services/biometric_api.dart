import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../config/app_config.dart';

class BiometricApiResponse {
  const BiometricApiResponse({
    required this.statusCode,
    required this.body,
  });

  final int statusCode;
  final Map<String, dynamic> body;

  bool get ok => statusCode >= 200 && statusCode < 300;

  String get reason => '${body['reason'] ?? ''}'.trim();

  String get message {
    final value = body['message'] ?? body['detail'] ?? body['error'];
    if (value is String && value.trim().isNotEmpty) return value.trim();
    return '';
  }

  String get token => '${body['token'] ?? ''}'.trim();
}

class BiometricApi {
  BiometricApi._();

  static Uri resolve(String path, [String? apiBaseHint]) {
    final normalized = path.startsWith('/') ? path : '/$path';
    final fallback = Uri.parse('${AppConfig.apiUrl}$normalized');
    final trimmed = (apiBaseHint ?? '').trim();
    if (trimmed.isEmpty) return fallback;
    final parsed = Uri.tryParse(trimmed);
    if (parsed == null || parsed.host.isEmpty) return fallback;
    final spaHost = Uri.tryParse(AppConfig.webUrl)?.host ?? AppConfig.host;
    if (parsed.host == AppConfig.host || parsed.host == spaHost) {
      return fallback;
    }
    return Uri(
      scheme: parsed.scheme.isEmpty ? fallback.scheme : parsed.scheme,
      host: parsed.host,
      port: parsed.hasPort ? parsed.port : null,
      path: normalized,
    );
  }

  static Future<BiometricApiResponse> post({
    required String path,
    required Map<String, dynamic> body,
    String? authToken,
    String? apiBaseHint,
  }) async {
    final uri = resolve(path, apiBaseHint);
    HttpClient? client;
    try {
      client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 15);
      final request = await client.postUrl(uri).timeout(const Duration(seconds: 20));
      request.followRedirects = true;
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'application/json; charset=utf-8',
      );
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.set(HttpHeaders.userAgentHeader, 'MySewaApp/flutter-biometric');
      final token = (authToken ?? '').trim();
      if (token.isNotEmpty) {
        request.headers.set(HttpHeaders.authorizationHeader, 'Token $token');
      }
      request.add(utf8.encode(jsonEncode(body)));
      final response = await request.close().timeout(const Duration(seconds: 20));
      final raw = await response.transform(utf8.decoder).join();
      Map<String, dynamic> parsed = {};
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          parsed = decoded;
        } else if (decoded is Map) {
          parsed = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {
        parsed = {'message': raw.trim()};
      }
      return BiometricApiResponse(statusCode: response.statusCode, body: parsed);
    } on SocketException {
      return const BiometricApiResponse(
        statusCode: 0,
        body: {
          'reason': 'network_unavailable',
          'message': 'Network unavailable. Please check your connection.',
        },
      );
    } on HandshakeException {
      return const BiometricApiResponse(
        statusCode: 0,
        body: {
          'reason': 'network_unavailable',
          'message': 'Network unavailable. Please check your connection.',
        },
      );
    } on TimeoutException {
      return const BiometricApiResponse(
        statusCode: 0,
        body: {
          'reason': 'network_unavailable',
          'message': 'Network unavailable. Please check your connection.',
        },
      );
    } catch (error) {
      return BiometricApiResponse(
        statusCode: 0,
        body: {
          'reason': 'network_unavailable',
          'message': 'Could not reach MySewa. Please try again.',
          'detail': error.toString(),
        },
      );
    } finally {
      client?.close(force: true);
    }
  }
}
