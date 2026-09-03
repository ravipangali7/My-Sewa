/// Local app constants used by the native Flutter shell.
class AppConstant {
  AppConstant._();

  /// Must match `version:` in pubspec.yaml (the part before `+`) and the APK
  /// versionName. Set admin Settings.app_version to this same value when uploading.
  /// Auto-update runs only when the remote Settings version is strictly newer.
  static const String appVersion = '5.0.0';
}
