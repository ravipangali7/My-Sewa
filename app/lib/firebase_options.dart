import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Android options sourced from `android/app/google-services.json`.
/// iOS still needs `GoogleService-Info.plist` in the Runner target.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError(
        'DefaultFirebaseOptions are not configured for web.',
      );
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        throw UnsupportedError(
          'iOS Firebase options missing. Add GoogleService-Info.plist.',
        );
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported on this platform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyDB6n-jC9XXJAEe6MtvEbCexoQA17wmCF0',
    appId: '1:531906257221:android:49c83d5722663fec249e2c',
    messagingSenderId: '531906257221',
    projectId: 'my-sewa',
    storageBucket: 'my-sewa.firebasestorage.app',
  );
}
