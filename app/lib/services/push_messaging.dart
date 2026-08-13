import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Background isolate handler required by firebase_messaging.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
  } catch (_) {}
}

/// Loads the FCM token as soon as the native app starts, then streams
/// refreshes so the WebView can POST the token to Django.
class PushMessaging {
  PushMessaging._();
  static final PushMessaging instance = PushMessaging._();

  final StreamController<String> _tokenController =
      StreamController<String>.broadcast();
  final StreamController<RemoteMessage> _foregroundController =
      StreamController<RemoteMessage>.broadcast();

  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;

  String? token;
  bool ready = false;

  Stream<String> get onToken => _tokenController.stream;
  Stream<RemoteMessage> get onForegroundMessage => _foregroundController.stream;

  String get platform {
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return 'unknown';
  }

  Future<void> init() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      if (Platform.isIOS) {
        await _waitForApnsToken(messaging);
      }

      await refreshToken();

      await _refreshSub?.cancel();
      _refreshSub = messaging.onTokenRefresh.listen((value) {
        final next = value.trim();
        if (next.isEmpty) return;
        token = next;
        if (!_tokenController.isClosed) _tokenController.add(next);
      });

      await _foregroundSub?.cancel();
      _foregroundSub = FirebaseMessaging.onMessage.listen((message) {
        if (!_foregroundController.isClosed) {
          _foregroundController.add(message);
        }
      });

      ready = true;
    } catch (e, st) {
      debugPrint('PushMessaging.init failed: $e\n$st');
      ready = false;
    }
  }

  Future<void> _waitForApnsToken(FirebaseMessaging messaging) async {
    for (var i = 0; i < 12; i++) {
      try {
        final apns = await messaging.getAPNSToken();
        if (apns != null && apns.isNotEmpty) return;
      } catch (_) {}
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
  }

  Future<String?> refreshToken() async {
    try {
      final messaging = FirebaseMessaging.instance;
      if (Platform.isIOS) {
        await _waitForApnsToken(messaging);
      }
      final value = (await messaging.getToken())?.trim();
      if (value == null || value.isEmpty) return token;
      token = value;
      if (!_tokenController.isClosed) _tokenController.add(value);
      return value;
    } catch (e) {
      debugPrint('PushMessaging.refreshToken failed: $e');
      return token;
    }
  }

  Future<void> dispose() async {
    await _refreshSub?.cancel();
    await _foregroundSub?.cancel();
  }
}
