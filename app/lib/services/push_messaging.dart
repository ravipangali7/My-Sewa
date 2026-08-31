import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../firebase_options.dart';
import 'fcm_log.dart';

const String kAlertChannelId = 'mysewa_alerts';
const String kAlertChannelName = 'MySewa alerts';
const String kAlertChannelDescription = 'Transaction and chat notifications';

final FlutterLocalNotificationsPlugin _localNotifications =
    FlutterLocalNotificationsPlugin();

/// Background isolate handler required by firebase_messaging.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      try {
        await Firebase.initializeApp(
          options: DefaultFirebaseOptions.currentPlatform,
        );
      } catch (_) {
        await Firebase.initializeApp();
      }
    }
  } catch (e) {
    FcmLog.fail('background Firebase init', e);
  }
}

Future<void> _ensureLocalNotifications() async {
  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  const ios = DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  await _localNotifications.initialize(
    const InitializationSettings(android: android, iOS: ios),
  );
  final androidPlugin = _localNotifications
      .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
  await androidPlugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      kAlertChannelId,
      kAlertChannelName,
      description: kAlertChannelDescription,
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      showBadge: true,
    ),
  );
}

Future<void> showForegroundPushNotification(RemoteMessage message) async {
  final title = (message.notification?.title ??
          message.data['title'] ??
          '')
      .toString()
      .trim();
  final body = (message.notification?.body ?? message.data['body'] ?? '')
      .toString()
      .trim();
  if (title.isEmpty && body.isEmpty) return;

  final id = message.hashCode & 0x7fffffff;
  await _localNotifications.show(
    id == 0 ? DateTime.now().millisecondsSinceEpoch.remainder(100000) : id,
    title.isEmpty ? 'MySewa' : title,
    body,
    const NotificationDetails(
      android: AndroidNotificationDetails(
        kAlertChannelId,
        kAlertChannelName,
        channelDescription: kAlertChannelDescription,
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        enableVibration: true,
        category: AndroidNotificationCategory.message,
        visibility: NotificationVisibility.public,
        ticker: 'MySewa',
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
        sound: 'default',
      ),
    ),
    payload: message.data['event']?.toString(),
  );
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
    FcmLog.banner('APP OPEN — FETCH FCM TOKEN');
    try {
      if (Firebase.apps.isEmpty) {
        try {
          await Firebase.initializeApp(
            options: DefaultFirebaseOptions.currentPlatform,
          );
          FcmLog.ok('Firebase.initializeApp (DefaultFirebaseOptions)');
        } catch (e) {
          FcmLog.wait('options init failed, trying native defaults', {
            'error': '$e',
          });
          await Firebase.initializeApp();
          FcmLog.ok('Firebase.initializeApp (native google-services)');
        }
      } else {
        FcmLog.ok('Firebase already initialized', {
          'apps': '${Firebase.apps.length}',
        });
      }

      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      await _ensureLocalNotifications();

      final messaging = FirebaseMessaging.instance;
      await messaging.setAutoInitEnabled(true);
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      if (Platform.isIOS) {
        final settings = await messaging.requestPermission(
          alert: true,
          announcement: false,
          badge: true,
          carPlay: false,
          criticalAlert: false,
          provisional: false,
          sound: true,
        );
        FcmLog.ok('iOS permission', {
          'auth': '${settings.authorizationStatus}',
        });
        await _waitForApnsToken(messaging);
      }

      final fetched = await refreshToken();
      if (fetched == null || fetched.isEmpty) {
        FcmLog.fail('getToken returned empty after retries');
      } else {
        FcmLog.tokenDump(fetched, platform: platform);
      }

      if (!Platform.isIOS) {
        unawaited(
          messaging.requestPermission(
            alert: true,
            announcement: false,
            badge: true,
            carPlay: false,
            criticalAlert: false,
            provisional: false,
            sound: true,
          ).then((settings) {
            FcmLog.ok('Android permission', {
              'auth': '${settings.authorizationStatus}',
            });
          }),
        );
      }

      await _refreshSub?.cancel();
      _refreshSub = messaging.onTokenRefresh.listen((value) {
        final next = value.trim();
        if (next.isEmpty) return;
        token = next;
        FcmLog.box(
          step: 'TOKEN REFRESH',
          status: 'NEW',
          fields: {
            'platform': platform,
            'preview': FcmLog.preview(next),
            'full': next,
          },
        );
        if (!_tokenController.isClosed) _tokenController.add(next);
      });

      await _foregroundSub?.cancel();
      _foregroundSub = FirebaseMessaging.onMessage.listen((message) {
        FcmLog.ok('foreground push', {
          'title': message.notification?.title ?? '',
        });
        // Android does not auto-display FCM alerts while the app is open.
        // Show a heads-up local notification with sound (Messenger-style).
        if (Platform.isAndroid) {
          unawaited(showForegroundPushNotification(message));
        }
        if (!_foregroundController.isClosed) {
          _foregroundController.add(message);
        }
      });

      ready = token != null && token!.isNotEmpty;
      FcmLog.ok('PushMessaging.init done', {
        'ready': '$ready',
        'platform': platform,
      });
    } catch (e, st) {
      ready = false;
      FcmLog.fail('PushMessaging.init crashed', e);
      // ignore: avoid_print
      print('[MYSEWA-FCM] $st');
    }
  }

  Future<void> _waitForApnsToken(FirebaseMessaging messaging) async {
    for (var i = 0; i < 12; i++) {
      try {
        final apns = await messaging.getAPNSToken();
        if (apns != null && apns.isNotEmpty) {
          FcmLog.ok('APNs token ready', {
            'preview': FcmLog.preview(apns),
          });
          return;
        }
      } catch (e) {
        FcmLog.wait('APNs poll failed', {'attempt': '${i + 1}', 'error': '$e'});
      }
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    FcmLog.fail('APNs token not available after waiting');
  }

  Future<String?> refreshToken() async {
    for (var i = 0; i < 8; i++) {
      try {
        final messaging = FirebaseMessaging.instance;
        if (Platform.isIOS) {
          await _waitForApnsToken(messaging);
        }
        FcmLog.wait('calling FirebaseMessaging.getToken()', {
          'attempt': '${i + 1}/8',
        });
        final value = (await messaging.getToken())?.trim();
        if (value != null && value.isNotEmpty) {
          token = value;
          if (!_tokenController.isClosed) _tokenController.add(value);
          return value;
        }
        FcmLog.wait('getToken returned empty', {'attempt': '${i + 1}/8'});
      } catch (e) {
        FcmLog.fail('getToken attempt ${i + 1}/8', e);
      }
      await Future<void>.delayed(Duration(milliseconds: 500 * (i + 1)));
    }
    return token;
  }

  Future<void> dispose() async {
    await _refreshSub?.cancel();
    await _foregroundSub?.cancel();
  }
}
