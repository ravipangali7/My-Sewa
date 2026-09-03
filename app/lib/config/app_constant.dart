/// Local app constants used by the native Flutter shell.
class AppConstant {
  AppConstant._();

  /// Installed app semver. Bump when shipping an APK, and set Settings.app_version
  /// to the same (or older) value. Prefer full `major.minor.patch` (e.g. 3.0.0).
  /// Auto-update runs only when the remote version is strictly newer.
  static const String appVersion = '3.0.0';
}
