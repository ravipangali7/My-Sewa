import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../config/app_config.dart';
import '../config/app_constant.dart';

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.remoteVersion,
    required this.apkUrl,
  });

  final String remoteVersion;
  final String apkUrl;

  String get localVersion => AppUpdateService.displayVersion(AppConstant.appVersion);
}

/// Compares [AppConstant.appVersion] with DB Settings and installs APKs.
class AppUpdateService {
  AppUpdateService._();

  static const _installChannel = MethodChannel('com.mysewa.app/app_update');
  static const _checkTimeout = Duration(seconds: 8);

  /// Returns update info when auto-update is on, remote is newer, and an APK URL exists.
  ///
  /// Versions are compared as semver tuples so `3`, `3.0`, and `3.0.0` are equal.
  /// Only a *newer* remote version triggers an update (not merely a different string).
  static Future<AppUpdateInfo?> checkForUpdate() async {
    if (!Platform.isAndroid) return null;

    try {
      final response = await http
          .get(Uri.parse(AppConfig.settingsApiUrl))
          .timeout(_checkTimeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
      }

      final decoded = jsonDecode(response.body);
      if (decoded is! Map) return null;
      final data = Map<String, dynamic>.from(decoded);

      final enabled = data['auto_update_enabled'] == true;
      if (!enabled) return null;

      final remoteVersion = _normalizeVersion('${data['app_version'] ?? ''}');
      final apkUrl = '${data['apk_url'] ?? ''}'.trim();
      if (remoteVersion.isEmpty || apkUrl.isEmpty) return null;

      final localVersion = _normalizeVersion(AppConstant.appVersion);
      // Equal or older remote must never re-prompt (fixes loops like 3.0.0 -> 3).
      if (!_isRemoteNewer(remoteVersion, localVersion)) return null;

      return AppUpdateInfo(
        remoteVersion: displayVersion(remoteVersion),
        apkUrl: apkUrl,
      );
    } catch (_) {
      return null;
    }
  }

  static Future<File> downloadApk(
    AppUpdateInfo info, {
    required void Function(double progress, int received, int total) onProgress,
  }) async {
    final client = http.Client();
    try {
      final request = http.Request('GET', Uri.parse(info.apkUrl));
      final response = await client.send(request);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('Could not download the update (HTTP ${response.statusCode}).');
      }

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/mysewa-update.apk');
      if (await file.exists()) {
        await file.delete();
      }

      final sink = file.openWrite();
      final total = response.contentLength ?? 0;
      var received = 0;
      onProgress(0, 0, total);

      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        final progress = total > 0 ? (received / total).clamp(0.0, 1.0) : 0.0;
        onProgress(progress, received, total);
      }
      await sink.flush();
      await sink.close();

      onProgress(1, received, total > 0 ? total : received);
      return file;
    } finally {
      client.close();
    }
  }

  static Future<void> installApk(File file) async {
    try {
      final installed = await _installChannel.invokeMethod<bool>(
        'installApk',
        <String, dynamic>{'path': file.path},
      );
      if (installed != true) {
        throw StateError(
          'Allow installing apps from MySewa in Android settings, then tap Retry.',
        );
      }
    } on PlatformException catch (error) {
      throw StateError(error.message ?? 'Could not open the installer.');
    } on MissingPluginException {
      throw StateError('Installer is not available on this platform.');
    }
  }

  /// Strip junk; keep the dotted numeric core (before `-` / `+`).
  static String _normalizeVersion(String value) {
    var version = value.trim();
    if (version.toLowerCase().startsWith('v') && version.length > 1) {
      version = version.substring(1).trim();
    }
    if (version.isEmpty) return '';

    final core = version.split('+').first.split('-').first.trim();
    return core;
  }

  /// Pad to major.minor.patch for display / logging.
  static String displayVersion(String value) {
    final parts = _versionParts(value);
    return parts.join('.');
  }

  static List<int> _versionParts(String value, {int width = 3}) {
    final core = _normalizeVersion(value);
    if (core.isEmpty) {
      return List<int>.filled(width, 0);
    }

    final parts = <int>[];
    for (final piece in core.split('.').take(width)) {
      final match = RegExp(r'^(\d+)').firstMatch(piece.trim());
      parts.add(match != null ? int.parse(match.group(1)!) : 0);
    }
    while (parts.length < width) {
      parts.add(0);
    }
    return parts;
  }

  /// True when [remote] is strictly newer than [local] as semver.
  static bool _isRemoteNewer(String remote, String local) {
    final remoteParts = _versionParts(remote);
    final localParts = _versionParts(local);
    for (var i = 0; i < remoteParts.length; i++) {
      if (remoteParts[i] != localParts[i]) {
        return remoteParts[i] > localParts[i];
      }
    }
    return false;
  }
}
