import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Ensures login sessions do not survive app uninstall or clear-data.
///
/// Auth lives in the embedded site's WebView `localStorage` (`mysewa_token`).
/// Android Auto Backup can restore that storage after reinstall unless we
/// disable backup and wipe WebView data when a no-backup install marker is
/// missing.
class SessionLifecycle {
  SessionLifecycle._();

  static const _channel = MethodChannel('com.mysewa.app/session_lifecycle');

  /// Returns `true` when native WebView auth storage was cleared for a fresh
  /// install / clear-data launch. Safe to call once before the first page load.
  static Future<bool> prepareFreshInstallSession() async {
    try {
      final cleared = await _channel.invokeMethod<bool>(
        'prepareFreshInstallSession',
      );
      return cleared ?? false;
    } on MissingPluginException {
      // Desktop / tests without the native channel — no-op.
      return false;
    } on PlatformException catch (error) {
      debugPrint('SessionLifecycle.prepareFreshInstallSession failed: $error');
      return false;
    }
  }
}
