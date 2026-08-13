import 'package:flutter/foundation.dart';

/// High-visibility FCM logs for `flutter run` / Logcat.
///
/// Filter the terminal with:  MYSEWA-FCM
class FcmLog {
  FcmLog._();

  static const tag = 'MYSEWA-FCM';
  static const _bar = '════════════════════════════════════════════════════════';
  static const _thin = '────────────────────────────────────────────────────────';

  static void banner(String title) {
    _emit('');
    _emit(_bar);
    _emit('  MYSEWA FCM  ·  $title');
    _emit(_bar);
  }

  static void box({
    required String step,
    required String status,
    Map<String, String> fields = const {},
  }) {
    _emit('');
    _emit(_bar);
    _emit('  MYSEWA FCM  ·  $step');
    _emit(_thin);
    _emit('  status     $status');
    for (final entry in fields.entries) {
      _emit('  ${_pad(entry.key)} ${entry.value}');
    }
    _emit(_bar);
  }

  static void ok(String message, [Map<String, String> fields = const {}]) {
    _line('OK', message, fields);
  }

  static void wait(String message, [Map<String, String> fields = const {}]) {
    _line('WAIT', message, fields);
  }

  static void skip(String message, [Map<String, String> fields = const {}]) {
    _line('SKIP', message, fields);
  }

  static void fail(String message, [Object? error, Map<String, String> fields = const {}]) {
    final merged = <String, String>{...fields};
    if (error != null) merged['error'] = '$error';
    _line('FAIL', message, merged);
  }

  static void tokenDump(String? token, {String platform = ''}) {
    if (token == null || token.isEmpty) {
      box(step: 'TOKEN', status: 'MISSING', fields: {'platform': platform});
      return;
    }
    box(
      step: 'TOKEN',
      status: 'READY',
      fields: {
        'platform': platform,
        'length': '${token.length}',
        'preview': preview(token),
        'full': token,
      },
    );
  }

  static String preview(String value, {int head = 12, int tail = 8}) {
    final text = value.trim();
    if (text.length <= head + tail + 1) return text;
    return '${text.substring(0, head)}…${text.substring(text.length - tail)}';
  }

  static String _pad(String key) => key.padRight(10);

  static void _line(String level, String message, Map<String, String> fields) {
    _emit('[$level] $message');
    for (final entry in fields.entries) {
      _emit('         ${_pad(entry.key)} ${entry.value}');
    }
  }

  static void _emit(String line) {
    final text = line.isEmpty ? '[$tag]' : '[$tag] $line';
    // `print` (not debugPrint) so Android does not throttle these lines.
    // ignore: avoid_print
    print(text);
    if (kDebugMode && text.length > 900) {
      debugPrint(text);
    }
  }
}
