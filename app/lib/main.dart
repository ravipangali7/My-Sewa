import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'config/app_config.dart';
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
