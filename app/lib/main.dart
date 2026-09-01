import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'config/app_config.dart';
import 'firebase_options.dart';
import 'screens/webview_screen.dart';
import 'services/fcm_log.dart';
import 'services/push_messaging.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  FcmLog.banner('COLD START');
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (_) {
    try {
      await Firebase.initializeApp();
    } catch (e) {
      FcmLog.fail('Firebase.initializeApp in main', e);
    }
  }
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  // Fetch FCM token before the WebView loads so it can be POSTed as soon
  // as a logged-in session is visible in localStorage.
  await PushMessaging.instance.init();
  runApp(const MySewaApp());
}

class MySewaApp extends StatelessWidget {
  const MySewaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(AppConfig.brand),
          primary: const Color(AppConfig.brand),
          surface: const Color(AppConfig.bg),
        ),
        scaffoldBackgroundColor: const Color(AppConfig.brandSoft),
      ),
      home: const WebViewScreen(),
    );
  }
}
