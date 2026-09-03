import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../config/app_config.dart';
import '../config/app_constant.dart';

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.remoteVersion,
    required this.apkUrl,
    required this.localVersion,
  });

  final String remoteVersion;
  final String apkUrl;
  final String localVersion;
}

/// Compares the installed app version with Settings and installs APKs.
///
/// Local version is the semantic max of:
/// - Android [PackageInfo.version] (versionName from the installed APK)
/// - [AppConstant.appVersion] (compile-time constant that must match the build)
///
/// That prevents perpetual loops when versionName and AppConstant drift
/// (the production APK historically shipped versionName 2.0.0 with AppConstant 3.0.0).
class AppUpdateService {
  AppUpdateService._();

  static const _installChannel = MethodChannel('com.mysewa.app/app_update');
  static const _checkTimeout = Duration(seconds: 8);

  /// Returns update info when auto-update is on, remote is newer, and an APK URL exists.
  static Future<AppUpdateInfo?> checkForUpdate() async {
    if (!Platform.isAndroid) return null;

    try {
      final uri = Uri.parse(AppConfig.settingsApiUrl).replace(
        queryParameters: <String, String>{
          // Bust intermediary / device HTTP caches of a stale app_version.
          '_ts': DateTime.now().millisecondsSinceEpoch.toString(),
        },
      );
      final response = await http
          .get(
            uri,
            headers: const <String, String>{
              'Cache-Control': 'no-cache, no-store',
              'Pragma': 'no-cache',
            },
          )
          .timeout(_checkTimeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
      }

      final decoded = jsonDecode(response.body);
      if (decoded is! Map) return null;
      final data = Map<String, dynamic>.from(decoded);

      final enabled = data['auto_update_enabled'] == true;
      if (!enabled) return null;

      final remoteRaw = '${data['app_version'] ?? ''}'.trim();
      final apkUrl = '${data['apk_url'] ?? ''}'.trim();
      if (remoteRaw.isEmpty || apkUrl.isEmpty) return null;

      final localRaw = await resolveLocalVersion();
      // Equal or older remote must never re-prompt (fixes loops like 3.0.0 -> 3).
      if (!isRemoteNewer(remoteRaw, localRaw)) return null;

      return AppUpdateInfo(
        remoteVersion: displayVersion(remoteRaw),
        localVersion: displayVersion(localRaw),
        apkUrl: apkUrl,
      );
    } catch (_) {
      return null;
    }
  }

  /// Installed version used for update decisions.
  static Future<String> resolveLocalVersion() async {
    var packageVersion = '';
    try {
      final info = await PackageInfo.fromPlatform();
      packageVersion = info.version;
    } catch (_) {
      packageVersion = '';
    }
    return higherVersion(packageVersion, AppConstant.appVersion);
  }

  static Future<File> downloadApk(
    AppUpdateInfo info, {
    required void Function(double progress, int received, int total) onProgress,
  }) async {
    final client = http.Client();
    try {
      final request = http.Request('GET', Uri.parse(info.apkUrl));
      request.headers['Cache-Control'] = 'no-cache, no-store';
      request.headers['Pragma'] = 'no-cache';
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
  static String normalizeVersion(String value) {
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
    return versionParts(value).join('.');
  }

  static List<int> versionParts(String value, {int width = 3}) {
    final core = normalizeVersion(value);
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

  static int compareVersions(String a, String b) {
    final pa = versionParts(a);
    final pb = versionParts(b);
    for (var i = 0; i < pa.length; i++) {
      if (pa[i] != pb[i]) return pa[i].compareTo(pb[i]);
    }
    return 0;
  }

  /// True when [remote] is strictly newer than [local] as semver.
  static bool isRemoteNewer(String remote, String local) {
    return compareVersions(remote, local) > 0;
  }

  /// Semantic max of two version strings.
  static String higherVersion(String a, String b) {
    if (normalizeVersion(a).isEmpty) return normalizeVersion(b).isEmpty ? '' : b;
    if (normalizeVersion(b).isEmpty) return a;
    return compareVersions(a, b) >= 0 ? a : b;
  }
}
