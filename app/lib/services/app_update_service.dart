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
}

/// Compares [AppConstant.appVersion] with DB Settings and installs APKs.
class AppUpdateService {
  AppUpdateService._();

  static const _installChannel = MethodChannel('com.mysewa.app/app_update');

  /// Returns update info when remote version differs and an APK URL exists.
  static Future<AppUpdateInfo?> checkForUpdate() async {
    if (!Platform.isAndroid) return null;

    try {
      final response = await http
          .get(Uri.parse(AppConfig.settingsApiUrl))
          .timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) return null;

      final decoded = jsonDecode(response.body);
      if (decoded is! Map) return null;

      final remoteVersion = '${decoded['app_version'] ?? ''}'.trim();
      final apkUrl = '${decoded['apk_url'] ?? ''}'.trim();

      if (remoteVersion.isEmpty || apkUrl.isEmpty) return null;
      if (remoteVersion == AppConstant.appVersion) return null;

      return AppUpdateInfo(remoteVersion: remoteVersion, apkUrl: apkUrl);
    } catch (_) {
      return null;
    }
  }

  /// Downloads [apkUrl] to app storage and launches the system installer.
  static Future<void> downloadAndInstall(
    String apkUrl, {
    void Function(double progress)? onProgress,
  }) async {
    if (!Platform.isAndroid) {
      throw StateError('APK updates are only supported on Android');
    }

    final uri = Uri.parse(apkUrl);
    final request = http.Request('GET', uri);
    final streamed = await request.send().timeout(const Duration(minutes: 5));
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      throw HttpException(
        'Download failed (${streamed.statusCode})',
        uri: uri,
      );
    }

    final total = streamed.contentLength ?? 0;
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/mysewa-update.apk');
    final sink = file.openWrite();
    var received = 0;

    try {
      await for (final chunk in streamed.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0 && onProgress != null) {
          onProgress(received / total);
        }
      }
      await sink.flush();
    } finally {
      await sink.close();
    }

    onProgress?.call(1);

    try {
      final installed = await _installChannel.invokeMethod<bool>(
        'installApk',
        <String, dynamic>{'path': file.path},
      );
      if (installed != true) {
        throw StateError(
          'Allow installs from this app in Android settings, then tap Update again.',
        );
      }
    } on PlatformException catch (error) {
      throw StateError(error.message ?? 'Could not open the installer.');
    } on MissingPluginException {
      throw StateError('Installer is not available on this platform.');
    }
  }
}
