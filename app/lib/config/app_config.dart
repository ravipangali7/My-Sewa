class AppConfig {
  static const String appName = 'MySewa';
  static const String webUrl = 'https://mysewa.sewabyapar.com/';
  static const String host = 'mysewa.sewabyapar.com';
  /// Public settings endpoint used for version / APK update checks.
  static const String settingsApiUrl = 'https://mysewa.sewabyapar.com/api/settings/';
  /// Lightweight same-origin asset used to confirm real reachability
  /// (link-layer "online" alone can still fail DNS/HTTP).
  static const String reachabilityProbePath = '/favicon.png';

  static const int brand = 0xFF0A7A4B;
  static const int brandDark = 0xFF065F3A;
  static const int brandSoft = 0xFFE8F6EF;
  static const int ocean = 0xFF0B3B7A;
  static const int bg = 0xFFF2F2F7;
  static const int label = 0xFF1C1C1E;
  static const int secondary = 0xFF8E8E93;
}
