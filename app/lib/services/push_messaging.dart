import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../firebase_options.dart';
import 'fcm_log.dart';

const String kAlertChannelId = 'mysewa_alerts';
const String kAlertChannelName = 'MySewa alerts';
const String kAlertChannelDescription = 'Transaction and chat notifications';

const String kMessageChannelId = 'mysewa_messages';
const String kMessageChannelName = 'MySewa messages';
const String kMessageChannelDescription = 'Support chat and important alerts';

final FlutterLocalNotificationsPlugin _localNotifications =
    FlutterLocalNotificationsPlugin();

bool _localNotificationsReady = false;

/// Background isolate handler required by firebase_messaging.
/// Data-only messages are displayed here; notification+data messages are
/// shown by the OS when the app is backgrounded or killed.
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
  try {
    await _ensureLocalNotifications(registerTapHandler: false);
    // When FCM includes a notification payload, Android/iOS already display
    // it in the system tray. Showing another local alert would duplicate.
    if (message.notification == null) {
      await showPushNotification(message);
    }
  } catch (e) {
    FcmLog.fail('background notification display', e);
  }
}

Future<void> _ensureLocalNotifications({bool registerTapHandler = true}) async {
  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  const ios = DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  await _localNotifications.initialize(
    const InitializationSettings(android: android, iOS: ios),
    onDidReceiveNotificationResponse:
        registerTapHandler ? _onLocalNotificationTap : null,
  );
  final androidPlugin = _localNotifications
      .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
  await androidPlugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      kMessageChannelId,
      kMessageChannelName,
      description: kMessageChannelDescription,
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      showBadge: true,
    ),
  );
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
  if (registerTapHandler) {
    await androidPlugin?.requestNotificationsPermission();
  }
  _localNotificationsReady = true;
}

void _onLocalNotificationTap(NotificationResponse response) {
  final payload = (response.payload ?? '').trim();
  if (payload.isEmpty) return;
  try {
    final decoded = jsonDecode(payload);
    if (decoded is Map) {
      PushMessaging.instance._emitOpenedData(
        decoded.map((key, value) => MapEntry('$key', '$value')),
      );
      return;
    }
  } catch (_) {
    PushMessaging.instance._emitOpenedData({'event': payload});
  }
}

int _notificationId(RemoteMessage message) {
  final raw = message.data['message_id'] ?? message.messageId ?? '';
  final parsed = int.tryParse(raw.toString());
  if (parsed != null && parsed > 0) return parsed & 0x7fffffff;
  final hashed = message.hashCode & 0x7fffffff;
  if (hashed != 0) return hashed;
  return DateTime.now().millisecondsSinceEpoch.remainder(100000);
}

Future<void> showPushNotification(RemoteMessage message) async {
  if (!_localNotificationsReady) {
    await _ensureLocalNotifications(registerTapHandler: false);
  }
  final title = (message.notification?.title ??
          message.data['title'] ??
          '')
      .toString()
      .trim();
  final body = (message.notification?.body ?? message.data['body'] ?? '')
      .toString()
      .trim();
  if (title.isEmpty && body.isEmpty) return;

  String payload = '';
  try {
    payload = jsonEncode(message.data);
  } catch (_) {
    payload = message.data['event']?.toString() ?? '';
  }

  await _localNotifications.show(
    _notificationId(message),
    title.isEmpty ? 'MySewa' : title,
    body,
    const NotificationDetails(
      android: AndroidNotificationDetails(
        kMessageChannelId,
        kMessageChannelName,
        channelDescription: kMessageChannelDescription,
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        enableVibration: true,
        category: AndroidNotificationCategory.message,
        visibility: NotificationVisibility.public,
        ticker: 'MySewa',
        icon: '@mipmap/ic_launcher',
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
        sound: 'default',
      ),
    ),
    payload: payload,
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
  final StreamController<Map<String, String>> _openedController =
      StreamController<Map<String, String>>.broadcast();

  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;

  String? token;
  bool ready = false;
  Map<String, String>? _pendingOpenedData;

  Stream<String> get onToken => _tokenController.stream;
  Stream<RemoteMessage> get onForegroundMessage => _foregroundController.stream;
  Stream<Map<String, String>> get onOpenedMessage => _openedController.stream;

  String get platform {
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return 'unknown';
  }

  void _emitOpenedData(Map<String, String> data) {
    if (data.isEmpty) return;
    _pendingOpenedData = data;
    if (!_openedController.isClosed) {
      _openedController.add(data);
    }
  }

  Map<String, String>? takePendingOpenedData() {
    final data = _pendingOpenedData;
    _pendingOpenedData = null;
    return data;
  }

  Map<String, String> _dataFromMessage(RemoteMessage message) {
    return message.data.map((key, value) => MapEntry(key.toString(), value.toString()));
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

      final settings = await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );
      FcmLog.ok('$platform permission', {
        'auth': '${settings.authorizationStatus}',
      });

      if (Platform.isIOS) {
        await _waitForApnsToken(messaging);
      }

      final fetched = await refreshToken();
      if (fetched == null || fetched.isEmpty) {
        FcmLog.fail('getToken returned empty after retries');
      } else {
        FcmLog.tokenDump(fetched, platform: platform);
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
          'title': message.notification?.title ?? message.data['title'] ?? '',
          'event': message.data['event'] ?? '',
        });
        // Android does not auto-display FCM alerts while the app is open.
        // Show a heads-up local notification with sound (Messenger-style).
        // iOS uses setForegroundNotificationPresentationOptions instead.
        if (Platform.isAndroid) {
          unawaited(showPushNotification(message));
        }
        if (!_foregroundController.isClosed) {
          _foregroundController.add(message);
        }
      });

      await _openedSub?.cancel();
      _openedSub = FirebaseMessaging.onMessageOpenedApp.listen((message) {
        FcmLog.ok('opened from push', {
          'event': message.data['event'] ?? '',
        });
        _emitOpenedData(_dataFromMessage(message));
      });

      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        _emitOpenedData(_dataFromMessage(initial));
      }

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
    await _openedSub?.cancel();
  }
}
