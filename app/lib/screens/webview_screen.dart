import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../config/app_config.dart';
import '../config/app_constant.dart';
import '../services/app_update_service.dart';
import '../services/device_token_api.dart';
import '../services/fcm_log.dart';
import '../services/push_messaging.dart';
import '../services/session_lifecycle.dart';
import 'auto_update_screen.dart';
import 'no_internet_screen.dart';

List<int> _decodeBase64InBackground(String value) {
  return base64Decode(value);
}

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen>
    with WidgetsBindingObserver {
  final Connectivity _connectivity = Connectivity();
  WebViewController? _controller;
  WebViewWidget? _webViewWidget;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  bool _isReady = false;
  bool _isOnline = true;
  bool _isChecking = false;
  bool _showSplash = true;
  bool _pageReady = false;
  bool _exitDialogOpen = false;
  bool _isHandlingDownload = false;
  bool _isRecovering = false;
  bool _offlineBlankLoaded = false;
  bool _updating = false;
  AppUpdateInfo? _updateInfo;
  int _reachabilitySeq = 0;
  final Set<String> _dispatchedPaymentOutcomeKeys = <String>{};
  DateTime? _splashStartedAt;
  DateTime? _lastResumeBridgeSyncAt;
  StreamSubscription<String>? _fcmTokenSub;
  StreamSubscription<dynamic>? _fcmForegroundSub;
  Timer? _fcmPollTimer;
  bool _fcmSyncBusy = false;
  String? _apiBaseHint;
  String? _lastPostedFcm;
  String? _lastPostedAuth;

  static const _minSplashDuration = Duration(milliseconds: 900);
  static const _resumeBridgeSyncMinGap = Duration(milliseconds: 700);
  static const _connectivityDebounce = Duration(milliseconds: 800);
  static const _probeTimeout = Duration(seconds: 4);

  /// Ask the embedded web app to refetch data (pull-to-refresh / live updates).
  static const _dispatchAppResumeJs = '''
(function() {
  try {
    window.dispatchEvent(new CustomEvent('mysewa-app-resume'));
  } catch (e) {}
})();
''';

  /// Unregister service workers + wipe Cache Storage so SPA assets refresh.
  static const _bustWebCachesJs = '''
(function() {
  try {
    if (window.caches && caches.keys) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).catch(function() {});
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(r) { try { r.unregister(); } catch (e) {} });
      }).catch(function() {});
    }
  } catch (e) {}
})();
''';

  /// Exposes download + push-token bridges the web app can call from JS.
  ///
  /// Push flow:
  /// 1. Native fetches the FCM token on app open (PushMessaging.init).
  /// 2. After each page load we dispatch `mysewa-fcm-token` into the WebView.
  /// 3. React POSTs the token to /api/auth/device-token/ (unique per token).
  static const _installNativeBridgeJs = '''
(function() {
  try {
    window.MySewaNative = window.MySewaNative || {};
    window.MySewaNative.downloadFile = function(payload) {
      try {
        if (window.MySewaBridge && window.MySewaBridge.postMessage) {
          window.MySewaBridge.postMessage(
            typeof payload === 'string' ? payload : JSON.stringify(payload)
          );
          return true;
        }
      } catch (e) {}
      return false;
    };
    window.MySewaNative.requestPushToken = function() {
      try {
        if (window.MySewaBridge && window.MySewaBridge.postMessage) {
          window.MySewaBridge.postMessage(JSON.stringify({ type: 'request_push_token' }));
          return true;
        }
      } catch (e) {}
      return false;
    };
    window.MySewaNative.requestCamera = function() {
      try {
        if (window.MySewaBridge && window.MySewaBridge.postMessage) {
          window.MySewaBridge.postMessage(JSON.stringify({ type: 'request_camera' }));
          return true;
        }
      } catch (e) {}
      return false;
    };
    window.MySewaNative.hasBridge = true;
    window.MySewaNative.hasPushBridge = true;
  } catch (e) {}
})();
''';

  /// Keeps zoom locked while preserving `viewport-fit=cover` so CSS
  /// `env(safe-area-inset-*)` works for status / nav / home-indicator insets.
  static const _disableZoomJs = '''
(function() {
  var meta = document.querySelector('meta[name=viewport]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content'
  );
  document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
})();
''';

  /// Android/iOS WebView often traps touch scroll inside nested
  /// overflow shells. Never set overflow-x:hidden — CSS pairs it to
  /// overflow-y:auto and gestures get swallowed on non-scrolling boxes.
  ///
  /// Only fix overflow traps. Do NOT force height/min-height inline:
  /// that inflates document scrollHeight past real content and leaves
  /// large blank overscroll on Profile and every other page.
  static const _unlockWebViewScrollJs = '''
(function() {
  function ensureStyle() {
    var styleId = 'mysewa-webview-scroll-fix';
    if (document.getElementById(styleId)) return;
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      'html.mysewa-native,html{height:auto!important;min-height:0!important;',
      'max-height:none!important;overflow-x:clip!important;overflow-y:auto!important;',
      '-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;',
      'overscroll-behavior-y:none!important;}',
      'html.mysewa-native body,body{height:auto!important;min-height:0!important;',
      'max-height:none!important;overflow-x:clip!important;overflow-y:visible!important;',
      '-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;',
      'overscroll-behavior-y:none!important;}'
    ].join('');
    document.head.appendChild(style);
  }

  function releaseOverflowTrap(el) {
    if (!el || el.nodeType !== 1) return;
    var cs = window.getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') return;
    // Clear stale height locks from older unlock scripts (blank overscroll).
    if (el.style.getPropertyValue('height') || el.style.getPropertyValue('min-height') || el.style.getPropertyValue('max-height')) {
      el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('max-height');
    }
    if (cs.overflowX !== 'hidden') return;
    // clip does NOT pair to overflow-y:auto (unlike hidden).
    el.style.setProperty('overflow-x', 'clip', 'important');
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
      var maxH = cs.maxHeight;
      if (!maxH || maxH === 'none' || maxH === 'auto') {
        el.style.setProperty('overflow-y', 'visible', 'important');
      }
    }
  }

  function apply() {
    try {
      ensureStyle();
      try { document.documentElement.classList.add('mysewa-native'); } catch (e) {}

      var mains = document.getElementsByTagName('main');
      if (mains.length === 0) {
        var top = document.body && document.body.firstElementChild;
        releaseOverflowTrap(top);
        return;
      }

      for (var m = 0; m < Math.min(mains.length, 4); m++) {
        var node = mains[m];
        while (node && node !== document.body) {
          releaseOverflowTrap(node);
          node = node.parentElement;
        }
      }
    } catch (e) {}
  }

  apply();
  setTimeout(apply, 100);
  setTimeout(apply, 400);

  if (!window.__mysewaScrollUnlockHooked) {
    window.__mysewaScrollUnlockHooked = true;
    var schedule = function() {
      setTimeout(apply, 50);
      setTimeout(apply, 250);
    };
    window.addEventListener('popstate', schedule);
    window.addEventListener('pageshow', schedule);
    ['pushState', 'replaceState'].forEach(function(key) {
      var original = history[key];
      if (typeof original !== 'function') return;
      history[key] = function() {
        var result = original.apply(this, arguments);
        schedule();
        return result;
      };
    });
  }
})();
''';

  String _safeAreaCssJs(EdgeInsets padding) {
    final top = padding.top;
    final right = padding.right;
    final bottom = padding.bottom;
    final left = padding.left;
    return '''
(function() {
  var root = document.documentElement;
  root.style.setProperty('--flutter-safe-top', '${top}px');
  root.style.setProperty('--flutter-safe-right', '${right}px');
  root.style.setProperty('--flutter-safe-bottom', '${bottom}px');
  root.style.setProperty('--flutter-safe-left', '${left}px');
  if (!document.getElementById('mysewa-safe-area')) {
    var style = document.createElement('style');
    style.id = 'mysewa-safe-area';
    style.textContent = ':root{--safe-area-top:max(env(safe-area-inset-top,0px),var(--flutter-safe-top,0px));--safe-area-right:max(env(safe-area-inset-right,0px),var(--flutter-safe-right,0px));--safe-area-bottom:max(env(safe-area-inset-bottom,0px),var(--flutter-safe-bottom,0px));--safe-area-left:max(env(safe-area-inset-left,0px),var(--flutter-safe-left,0px));}';
    document.head.appendChild(style);
  }
})();
''';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _splashStartedAt = DateTime.now();
    // Avoid first-paint stutter by decoding splash asset before initial frames.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(precacheImage(const AssetImage('assets/logo.png'), context));
    });
    _fcmTokenSub = PushMessaging.instance.onToken.listen((_) {
      unawaited(_deliverFcmTokenToWeb());
      unawaited(_syncDeviceToken(reason: 'token-stream'));
    });
    _fcmForegroundSub = PushMessaging.instance.onForegroundMessage.listen((message) {
      unawaited(_deliverForegroundPushToWeb(message));
    });
    if (PushMessaging.instance.token != null) {
      unawaited(_syncDeviceToken(reason: 'token-already-fetched'));
    }
    _bootstrap();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;

    if (!_isOnline) {
      unawaited(_recoverIfReachable());
      return;
    }

    if (_controller == null) return;

    final now = DateTime.now();
    final last = _lastResumeBridgeSyncAt;
    if (last == null || now.difference(last) >= _resumeBridgeSyncMinGap) {
      _lastResumeBridgeSyncAt = now;
      unawaited(_safeControllerCall((c) async {
        await c.runJavaScript(_dispatchAppResumeJs);
        await c.runJavaScript(_installNativeBridgeJs);
        await _deliverFcmTokenToWeb();
        _startFcmPoller('app-resume');
      }));
    }
  }

  Future<void> _bootstrap() async {
    // Wipe restored WebView auth storage before the site can hydrate a token.
    await SessionLifecycle.prepareFreshInstallSession();
    // Always clear HTTP / SW caches on cold start so site updates show fresh.
    await SessionLifecycle.clearWebResourceCache();
    if (!mounted) return;

    final update = await AppUpdateService.checkForUpdate();
    if (!mounted) return;
    if (update != null) {
      setState(() {
        _updating = true;
        _updateInfo = update;
        _showSplash = false;
      });
      return;
    }

    await _initWebView();
    _watchConnectivity();
  }

  Future<void> _initWebView() async {
    late final PlatformWebViewControllerCreationParams params;

    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller = WebViewController.fromPlatformCreationParams(params);

    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setBackgroundColor(const Color(AppConfig.brandSoft));
    await controller.enableZoom(false);
    // Plugin-level HTTP / Cache API wipe (login storage is left alone).
    await controller.clearCache();
    _splashStartedAt ??= DateTime.now();

    final defaultUa = await controller.getUserAgent() ?? '';
    await controller.setUserAgent('$defaultUa MySewaApp/${AppConstant.appVersion}');

    await controller.addJavaScriptChannel(
      'MySewaBridge',
      onMessageReceived: (message) {
        unawaited(_handleNativeBridgeMessage(message.message));
      },
    );

    await controller.setNavigationDelegate(
      NavigationDelegate(
        onPageFinished: (_) async {
          final currentUrl = await controller.currentUrl();
          if (currentUrl != null) {
            final uri = Uri.tryParse(currentUrl);
            if (uri != null) {
              await _dispatchPaymentOutcomeToWeb(uri);
            }
          }
          await controller.runJavaScript(_disableZoomJs);
          await controller.runJavaScript(_unlockWebViewScrollJs);
          await controller.runJavaScript(_bustWebCachesJs);
          await controller.runJavaScript(_installNativeBridgeJs);
          // First thing after the SPA is ready: send the FCM token to React
          // and persist it to the API if the user is already logged in.
          await _deliverFcmTokenToWeb();
          _startFcmPoller('page-finished');
          if (mounted) {
            final padding = MediaQuery.paddingOf(context);
            await controller.runJavaScript(_safeAreaCssJs(padding));
          }
          if (!mounted) return;
          _pageReady = true;
          await _dismissSplashWhenReady();
        },
        onPageStarted: (url) {
          // A real navigation means we are past the about:blank clear.
          if (url.isNotEmpty && url != 'about:blank') {
            _offlineBlankLoaded = false;
          }
        },
        onWebResourceError: (error) async {
          // Blob/data "downloads" must never leave the user on an error page.
          final failing = error.url ?? '';
          if (failing.startsWith('blob:') || failing.startsWith('data:')) {
            return;
          }
          if (failing == 'about:blank') return;
          if (error.isForMainFrame != true) return;

          // DNS / connect / timeout failures must never show Chromium's
          // "Web page not available" screen — stay on branded offline UI.
          if (_isNetworkLoadError(error) || _isAppHostFailure(failing)) {
            await _enterOfflineMode();
            return;
          }

          final hasLink = await _hasLinkLayer();
          if (!mounted) return;
          if (!hasLink) {
            await _enterOfflineMode();
            return;
          }

          // Non-network main-frame failure — reveal WebView content.
          _pageReady = true;
          await _dismissSplashWhenReady();
        },
        onNavigationRequest: (request) async {
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;
          await _dispatchPaymentOutcomeToWeb(uri);

          final scheme = uri.scheme.toLowerCase();

          // Never navigate the WebView to blob:/data: — downloads go via bridge.
          if (scheme == 'blob' || scheme == 'data') {
            return NavigationDecision.prevent;
          }

          if (_isAppHost(uri)) {
            return NavigationDecision.navigate;
          }

          if (_shouldOpenExternally(uri)) {
            await _openExternal(uri);
            return NavigationDecision.prevent;
          }

          if (scheme == 'http' || scheme == 'https') {
            // Treat likely file downloads as external opens instead of in-app nav.
            if (_looksLikeDownload(uri)) {
              await _openExternal(uri);
              return NavigationDecision.prevent;
            }
            await _openExternal(uri);
            return NavigationDecision.prevent;
          }

          return NavigationDecision.prevent;
        },
      ),
    );

    if (controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      AndroidWebViewController.enableDebugging(false);
      await android.setMediaPlaybackRequiresUserGesture(false);
      await android.setTextZoom(100);
      await android.setOnShowFileSelector(_androidFileSelector);
      await android.setOnPlatformPermissionRequest((request) async {
        final needsCamera = request.types.contains(
          WebViewPermissionResourceType.camera,
        );
        final needsMic = request.types.contains(
          WebViewPermissionResourceType.microphone,
        );
        var allow = true;
        if (needsCamera || needsMic) {
          allow = await SessionLifecycle.requestCameraPermission();
        }
        if (allow) {
          await request.grant();
        } else {
          await request.deny();
        }
      });
      // Avoid plugin-side nullability crash in some Android WebView callback
      // paths by not wiring optional geolocation prompt callbacks.
    }

    if (controller.platform is WebKitWebViewController) {
      final webkit = controller.platform as WebKitWebViewController;
      await webkit.setAllowsBackForwardNavigationGestures(true);
    }

    final online = await _probeReachability();
    if (!mounted) return;

    _controller = controller;
    _webViewWidget = _createWebViewWidget(controller);
    setState(() {
      _isReady = true;
      _isOnline = online;
      if (!online) _showSplash = false;
    });

    if (online) {
      await controller.loadRequest(
        _freshWebUri(),
        headers: const <String, String>{
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      );
    } else {
      await _clearWebViewToBlank(controller);
    }
  }

  /// Cache-busts the shell document so WebView cannot reuse a stale index.html.
  Uri _freshWebUri() {
    final base = Uri.parse(AppConfig.webUrl);
    final params = Map<String, String>.from(base.queryParameters);
    params['_app_cache_bust'] =
        DateTime.now().millisecondsSinceEpoch.toString();
    return base.replace(queryParameters: params);
  }

  Future<List<String>> _androidFileSelector(FileSelectorParams params) async {
    final accepts = params.acceptTypes.map((t) => t.toLowerCase()).toList();
    final wantsImage = accepts.any((t) => t.contains('image'));
    final wantsVideo = accepts.any((t) => t.contains('video'));
    final capture = params.isCaptureEnabled;

    if (capture) {
      final granted = await SessionLifecycle.requestCameraPermission();
      if (!granted) return <String>[];
      final picker = ImagePicker();
      if (wantsVideo && !wantsImage) {
        final file = await picker.pickVideo(
          source: ImageSource.camera,
          maxDuration: const Duration(minutes: 3),
        );
        if (file == null) return <String>[];
        return <String>[Uri.file(file.path).toString()];
      }
      final file = await picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 85,
      );
      if (file == null) return <String>[];
      return <String>[Uri.file(file.path).toString()];
    }

    var type = FileType.any;
    if (wantsImage && wantsVideo) {
      type = FileType.media;
    } else if (wantsImage && !wantsVideo) {
      type = FileType.image;
    } else if (wantsVideo && !wantsImage) {
      type = FileType.video;
    }

    final result = await FilePicker.pickFiles(type: type);

    if (result == null) return <String>[];
    return result.files
        .where((f) => f.path != null)
        .map((f) => Uri.file(f.path!).toString())
        .toList();
  }

  WebViewWidget _createWebViewWidget(WebViewController controller) {
    if (WebViewPlatform.instance is AndroidWebViewPlatform) {
      // Prefer default Android composition path. In some runtime/plugin combos
      // the texture-backed path can surface null platform callback payloads.
      return WebViewWidget(controller: controller);
    }

    return WebViewWidget(controller: controller);
  }

  bool _isAppHost(Uri uri) {
    final scheme = uri.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') return false;
    final host = uri.host.toLowerCase();
    return host == AppConfig.host || host.endsWith('.${AppConfig.host}');
  }

  bool _looksLikeDownload(Uri uri) {
    final path = uri.path.toLowerCase();
    const exts = ['.pdf', '.png', '.jpg', '.jpeg', '.csv', '.xlsx', '.zip'];
    return exts.any(path.endsWith);
  }

  bool _shouldOpenExternally(Uri uri) {
    const schemes = {
      'tel',
      'mailto',
      'sms',
      'whatsapp',
      'geo',
      'intent',
      'market',
    };
    return schemes.contains(uri.scheme.toLowerCase());
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  Future<void> _handleNativeBridgeMessage(String raw) async {
    var isFileOp = false;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final type = decoded['type']?.toString().toLowerCase() ?? 'download';

      if (type == 'request_push_token' || type == 'push_token_request') {
        await _deliverFcmTokenToWeb(forceRefresh: true);
        _startFcmPoller('js-request-push-token');
        return;
      }

      if (type == 'request_camera' || type == 'camera_permission') {
        final granted = await SessionLifecycle.requestCameraPermission();
        await _safeControllerCall((c) async {
          await c.runJavaScript('''
(function() {
  try {
    window.dispatchEvent(new CustomEvent('mysewa-camera-permission', {
      detail: { granted: ${granted ? 'true' : 'false'} }
    }));
  } catch (e) {}
})();
''');
        });
        return;
      }

      if (type == 'auth_ready' || type == 'session_ready' || type == 'login') {
        final apiBase =
            decoded['apiBase']?.toString() ?? decoded['api_base']?.toString();
        if (apiBase != null && apiBase.trim().isNotEmpty) {
          _apiBaseHint = apiBase.trim();
        }
        // Always persist after a fresh login, even if this FCM token was
        // posted earlier (logout deletes it; DRF auth tokens are reused).
        _lastPostedFcm = null;
        _lastPostedAuth = null;
        FcmLog.banner('LOGIN / AUTH READY');
        await _deliverFcmTokenToWeb(forceRefresh: true);
        _startFcmPoller('auth-ready');
        return;
      }

      if (_isHandlingDownload) return;

      final isShare = type == 'share';
      const allowedTypes = {
        'download',
        'share',
        'receipt',
        'transaction_receipt',
        'transactionreceipt',
        'payment_receipt',
        'paymentreceipt',
      };
      if (!allowedTypes.contains(type)) return;

      isFileOp = true;

      final payload = Map<String, dynamic>.from(decoded.cast<String, dynamic>());
      final mime = payload['mime']?.toString() ?? 'application/octet-stream';
      final status = payload['status']?.toString().toLowerCase();
      final transactionId = payload['transactionId']?.toString();
      final base64Data =
          payload['base64']?.toString() ??
          payload['data']?.toString() ??
          payload['contentBase64']?.toString() ??
          '';
      if (base64Data.isEmpty) return;
      final filename = _buildReceiptFilename(
        rawName: payload['filename']?.toString(),
        mime: mime,
        status: status,
        transactionId: transactionId,
      );
      _isHandlingDownload = true;
      final bytes = await compute(_decodeBase64InBackground, base64Data);
      if (isShare) {
        await _shareReceiptBytes(bytes, filename, mime);
      } else {
        await _saveReceiptBytes(bytes, filename, mime);
      }
    } catch (_) {
      if (!isFileOp || !mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not save the file. Please try again.'),
        ),
      );
    } finally {
      _isHandlingDownload = false;
    }
  }

  String _jsStringResult(dynamic raw) {
    if (raw == null) return '';
    var text = raw.toString().trim();
    if (text.isEmpty || text == 'null' || text == 'undefined') return '';
    for (var i = 0; i < 2; i++) {
      if ((text.startsWith('"') && text.endsWith('"')) ||
          (text.startsWith("'") && text.endsWith("'"))) {
        try {
          final decoded = jsonDecode(text);
          if (decoded is String) {
            text = decoded.trim();
            continue;
          }
        } catch (_) {
          text = text.substring(1, text.length - 1).trim();
          continue;
        }
      }
      break;
    }
    return text;
  }

  void _startFcmPoller(String reason) {
    _fcmPollTimer?.cancel();
    FcmLog.ok('poller start', {'reason': reason});
    unawaited(_syncDeviceToken(reason: reason));
    var ticks = 0;
    _fcmPollTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      ticks += 1;
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (ticks > 20) {
        timer.cancel();
        FcmLog.wait('poller stopped after 40s — retry on login/resume');
        return;
      }
      unawaited(_syncDeviceToken(reason: '$reason#poll$ticks'));
    });
  }

  Map<String, String> _parseWebAuthPayload(dynamic raw) {
    if (raw is Map) {
      return {
        'token': '${raw['token'] ?? ''}',
        'apiBase': '${raw['apiBase'] ?? raw['api_base'] ?? ''}',
      };
    }
    var text = _jsStringResult(raw);
    if (text.isEmpty) return const {'token': '', 'apiBase': ''};
    try {
      var decoded = jsonDecode(text);
      if (decoded is String) {
        text = decoded.trim();
        decoded = jsonDecode(text);
      }
      if (decoded is Map) {
        return {
          'token': '${decoded['token'] ?? ''}',
          'apiBase': '${decoded['apiBase'] ?? decoded['api_base'] ?? ''}',
        };
      }
    } catch (_) {
      // Fall through: treat a bare string as the auth token only when it
      // does not look like JSON leftover from WebView quoting.
      if (!text.startsWith('{') && !text.startsWith('"')) {
        return {'token': text, 'apiBase': ''};
      }
    }
    return const {'token': '', 'apiBase': ''};
  }

  Future<({String authToken, String apiBase})> _readWebAuth() async {
    final controller = _controller;
    if (controller == null || !_isReady) {
      FcmLog.skip('WebView not ready — cannot read mysewa_token');
      return (authToken: '', apiBase: _apiBaseHint ?? '');
    }
    try {
      final raw = await controller.runJavaScriptReturningResult(r'''
(function() {
  try {
    var token = '';
    try { token = String(window.localStorage.getItem('mysewa_token') || ''); } catch (e) {}
    if (!token) {
      try { token = String(window.sessionStorage.getItem('mysewa_token') || ''); } catch (e2) {}
    }
    var apiBase = '';
    try { apiBase = String(window.__mysewaApiBase || ''); } catch (e3) {}
    return JSON.stringify({ token: token, apiBase: apiBase });
  } catch (e) {
    return '{"token":"","apiBase":""}';
  }
})();
''');
      final parsed = _parseWebAuthPayload(raw);
      return (
        authToken: parsed['token']?.trim() ?? '',
        apiBase: parsed['apiBase']?.trim() ?? '',
      );
    } catch (e) {
      FcmLog.fail('reading mysewa_token from WebView', e);
      return (authToken: '', apiBase: _apiBaseHint ?? '');
    }
  }

  /// Persist the FCM token from the native shell so registration does not
  /// depend on React having already attached its CustomEvent listener.
  Future<DeviceTokenSyncResult> _syncDeviceToken({required String reason}) async {
    if (_fcmSyncBusy) {
      FcmLog.wait('sync already in flight — skip overlap', {'reason': reason});
      return const DeviceTokenSyncResult(DeviceTokenSyncStatus.alreadySaved);
    }
    _fcmSyncBusy = true;
    try {
      return await _syncDeviceTokenNow(reason: reason);
    } finally {
      _fcmSyncBusy = false;
    }
  }

  Future<DeviceTokenSyncResult> _syncDeviceTokenNow({required String reason}) async {
    var fcmToken = PushMessaging.instance.token?.trim() ?? '';
    if (fcmToken.isEmpty) {
      FcmLog.wait('no FCM token yet — refreshing', {'reason': reason});
      fcmToken = (await PushMessaging.instance.refreshToken())?.trim() ?? '';
    }
    if (fcmToken.isEmpty) {
      FcmLog.skip('still no FCM token', {'reason': reason});
      return const DeviceTokenSyncResult(DeviceTokenSyncStatus.skippedNoFcm);
    }

    final webAuth = await _readWebAuth();
    final authToken = webAuth.authToken;
    if (webAuth.apiBase.isNotEmpty) {
      _apiBaseHint = webAuth.apiBase;
    }
    if (authToken.isEmpty) {
      FcmLog.skip('user not logged in (no mysewa_token)', {
        'reason': reason,
        'fcm': FcmLog.preview(fcmToken),
        'webview_ready': '$_isReady',
      });
      return const DeviceTokenSyncResult(DeviceTokenSyncStatus.skippedNoAuth);
    }
    if (_lastPostedFcm == fcmToken && _lastPostedAuth == authToken) {
      _fcmPollTimer?.cancel();
      FcmLog.ok('already saved this FCM token for this session', {
        'reason': reason,
      });
      return const DeviceTokenSyncResult(DeviceTokenSyncStatus.alreadySaved);
    }

    final result = await DeviceTokenApi.register(
      fcmToken: fcmToken,
      authToken: authToken,
      platform: PushMessaging.instance.platform,
      apiBaseHint: _apiBaseHint,
      reason: reason,
    );
    if (result.status == DeviceTokenSyncStatus.saved) {
      _lastPostedFcm = fcmToken;
      _lastPostedAuth = authToken;
      _fcmPollTimer?.cancel();
    }
    return result;
  }

  /// Inject the real FCM token into the WebView so React can save it via API.
  Future<void> _deliverFcmTokenToWeb({bool forceRefresh = false}) async {
    var token = PushMessaging.instance.token;
    if (forceRefresh || token == null || token.isEmpty) {
      token = await PushMessaging.instance.refreshToken();
    }
    if (token == null || token.isEmpty) {
      FcmLog.skip('cannot inject FCM token into WebView — token missing');
      return;
    }
    final platform = PushMessaging.instance.platform;
    final tokenJson = jsonEncode(token);
    final platformJson = jsonEncode(platform);
    final controller = _controller;
    if (controller == null || !_isReady) {
      FcmLog.skip('cannot inject FCM token — WebView not ready');
      return;
    }
    try {
      await controller.runJavaScript('''
(function() {
  try {
    window.__mysewaFcmToken = $tokenJson;
    window.__mysewaFcmPlatform = $platformJson;
    window.dispatchEvent(new CustomEvent('mysewa-fcm-token', {
      detail: { token: $tokenJson, platform: $platformJson, stub: false }
    }));
  } catch (e) {}
})();
''');
      FcmLog.ok('injected FCM token into WebView', {
        'platform': platform,
        'preview': FcmLog.preview(token),
      });
    } catch (e) {
      FcmLog.fail('inject FCM token into WebView', e);
    }
  }

  Future<void> _deliverForegroundPushToWeb(dynamic message) async {
    try {
      final notification = message.notification;
      final title = notification?.title?.toString() ?? '';
      final body = notification?.body?.toString() ?? '';
      final data = <String, String>{};
      final rawData = message.data;
      if (rawData is Map) {
        rawData.forEach((key, value) {
          data['$key'] = '$value';
        });
      }
      if (title.isEmpty && body.isEmpty && data.isEmpty) return;
      final titleJson = jsonEncode(title);
      final bodyJson = jsonEncode(body);
      final dataJson = jsonEncode(data);
      await _safeControllerCall((c) async {
        await c.runJavaScript('''
(function() {
  try {
    window.dispatchEvent(new CustomEvent('mysewa-push-received', {
      detail: { title: $titleJson, body: $bodyJson, data: $dataJson }
    }));
  } catch (e) {}
})();
''');
      });
    } catch (_) {}
  }

  String _sanitizeFilename(String name) {
    final cleaned = name.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_').trim();
    if (cleaned.isEmpty) return 'MySewa_file.pdf';
    return cleaned.length > 120 ? cleaned.substring(0, 120) : cleaned;
  }

  String _normalizeStatusForFilename(String? status) {
    if (status == null || status.isEmpty) return 'unknown';
    if (status.contains('success') || status == 'ok') return 'success';
    if (status.contains('fail') || status.contains('error')) return 'failed';
    return 'unknown';
  }

  String _extensionFromMime(String mime) {
    final value = mime.toLowerCase();
    if (value.contains('pdf')) return 'pdf';
    if (value.contains('png')) return 'png';
    if (value.contains('jpeg') || value.contains('jpg')) return 'jpg';
    if (value.contains('json')) return 'json';
    if (value.contains('csv')) return 'csv';
    return 'bin';
  }

  bool _hasKnownExtension(String name) {
    final lowered = name.toLowerCase();
    const exts = [
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.csv',
      '.json',
      '.txt',
      '.zip',
      '.xlsx',
    ];
    return exts.any(lowered.endsWith);
  }

  String _buildReceiptFilename({
    required String? rawName,
    required String mime,
    required String? status,
    required String? transactionId,
  }) {
    final ext = _extensionFromMime(mime);
    final now = DateTime.now();
    final stamp =
        '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}_${now.hour.toString().padLeft(2, '0')}${now.minute.toString().padLeft(2, '0')}${now.second.toString().padLeft(2, '0')}';
    final normalizedStatus = _normalizeStatusForFilename(status);
    final normalizedTxn = (transactionId ?? '')
        .replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '')
        .trim();

    if (rawName != null && rawName.trim().isNotEmpty) {
      final sanitized = _sanitizeFilename(rawName);
      return _hasKnownExtension(sanitized) ? sanitized : '$sanitized.$ext';
    }

    final txnPart = normalizedTxn.isEmpty ? '' : '_$normalizedTxn';
    return 'receipt_$normalizedStatus${txnPart}_$stamp.$ext';
  }

  Future<File> _writeReceiptFile(List<int> bytes, String filename) async {
    final root = await getApplicationDocumentsDirectory();
    final folder = Directory('${root.path}/MySewa/receipts');
    if (!await folder.exists()) {
      await folder.create(recursive: true);
    }
    final file = File('${folder.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<void> _shareReceiptBytes(
    List<int> bytes,
    String filename,
    String mime,
  ) async {
    final file = await _writeReceiptFile(bytes, filename);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: mime, name: filename)],
        subject: filename,
        text: 'MySewa statement',
      ),
    );
  }

  Future<void> _saveReceiptBytes(
    List<int> bytes,
    String filename,
    String mime,
  ) async {
    final file = await _writeReceiptFile(bytes, filename);

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Receipt downloaded: $filename'),
        action: SnackBarAction(
          label: 'Share',
          onPressed: () {
            unawaited(
              SharePlus.instance.share(
                ShareParams(
                  files: [XFile(file.path, mimeType: mime, name: filename)],
                  subject: filename,
                  text: 'MySewa receipt',
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  String? _detectPaymentOutcome(Uri uri) {
    final path = uri.path.toLowerCase();

    // Statement/history pages must always open as-is regardless of status.
    // Do not infer payment outcomes from these URLs.
    final isStatementPath =
        path.contains('statement') ||
        (path.contains('history') && path.contains('transaction'));
    if (isStatementPath) return null;

    String? fromValue(String? value) {
      if (value == null) return null;
      final normalized = value.toLowerCase();
      if (normalized.contains('success') ||
          normalized == 'ok' ||
          normalized == 'completed') {
        return 'success';
      }
      if (normalized.contains('fail') ||
          normalized.contains('error') ||
          normalized == 'cancelled') {
        return 'failed';
      }
      return null;
    }

    for (final key in ['status', 'payment_status', 'transaction_status']) {
      final detected = fromValue(uri.queryParameters[key]);
      if (detected != null) return detected;
    }

    final isPaymentLike =
        path.contains('payment') || path.contains('transaction');
    if (!isPaymentLike) return null;
    if (path.contains('success') || path.contains('complete')) return 'success';
    if (path.contains('fail') || path.contains('error') || path.contains('cancel')) {
      return 'failed';
    }
    return null;
  }

  Future<void> _dispatchPaymentOutcomeToWeb(Uri uri) async {
    final status = _detectPaymentOutcome(uri);
    if (status == null || _controller == null) return;

    final key = '${status}_${uri.toString()}';
    if (_dispatchedPaymentOutcomeKeys.contains(key)) return;
    _dispatchedPaymentOutcomeKeys.add(key);

    final urlJson = jsonEncode(uri.toString());
    final statusJson = jsonEncode(status);
    await _controller!.runJavaScript('''
(function() {
  try {
    window.dispatchEvent(new CustomEvent('mysewa-payment-result', {
      detail: { status: $statusJson, url: $urlJson }
    }));
  } catch (e) {}
})();
''');
  }

  Future<bool> _hasLinkLayer() async {
    final results = await _connectivity.checkConnectivity();
    return results.any((r) => r != ConnectivityResult.none);
  }

  /// True for main-frame failures that mean the site is unreachable
  /// (covers `net::ERR_NAME_NOT_RESOLVED` even when Wi‑Fi appears up).
  bool _isNetworkLoadError(WebResourceError error) {
    switch (error.errorType) {
      case WebResourceErrorType.hostLookup:
      case WebResourceErrorType.connect:
      case WebResourceErrorType.timeout:
      case WebResourceErrorType.io:
      case WebResourceErrorType.unknown:
        return true;
      case WebResourceErrorType.authentication:
      case WebResourceErrorType.badUrl:
      case WebResourceErrorType.failedSslHandshake:
      case WebResourceErrorType.file:
      case WebResourceErrorType.fileNotFound:
      case WebResourceErrorType.proxyAuthentication:
      case WebResourceErrorType.redirectLoop:
      case WebResourceErrorType.tooManyRequests:
      case WebResourceErrorType.unsafeResource:
      case WebResourceErrorType.unsupportedAuthScheme:
      case WebResourceErrorType.unsupportedScheme:
      case WebResourceErrorType.webContentProcessTerminated:
      case WebResourceErrorType.webViewInvalidated:
      case WebResourceErrorType.javaScriptExceptionOccurred:
      case WebResourceErrorType.javaScriptResultTypeIsUnsupported:
      case null:
        break;
    }

    final desc = error.description.toLowerCase();
    const markers = <String>[
      'err_name_not_resolved',
      'err_internet_disconnected',
      'err_address_unreachable',
      'err_connection_timed_out',
      'err_connection_refused',
      'err_connection_reset',
      'err_network_changed',
      'err_timed_out',
      'err_failed',
      'name_not_resolved',
      'host lookup',
      'network is unreachable',
      'failed to connect',
      'net::err_',
    ];
    return markers.any(desc.contains);
  }

  bool _isAppHostFailure(String failingUrl) {
    if (failingUrl.isEmpty) return true;
    final uri = Uri.tryParse(failingUrl);
    if (uri == null) return false;
    return _isAppHost(uri);
  }

  /// Confirms the app host is actually reachable (DNS + HTTP).
  /// Link-layer alone is not enough — Wi‑Fi can be up with no DNS.
  Future<bool> _probeReachability() async {
    if (!await _hasLinkLayer()) return false;

    HttpClient? client;
    try {
      client = HttpClient()..connectionTimeout = _probeTimeout;
      final uri = Uri.https(
        AppConfig.host,
        AppConfig.reachabilityProbePath,
        <String, String>{'_online': '${DateTime.now().millisecondsSinceEpoch}'},
      );
      final request = await client.getUrl(uri).timeout(_probeTimeout);
      request.followRedirects = true;
      final response = await request.close().timeout(_probeTimeout);
      // Any HTTP response means the network path works.
      await response.drain<void>().timeout(_probeTimeout);
      return true;
    } catch (_) {
      return false;
    } finally {
      client?.close(force: true);
    }
  }

  Future<void> _clearWebViewToBlank([WebViewController? controller]) async {
    if (_offlineBlankLoaded) return;
    _offlineBlankLoaded = true;
    final target = controller ?? _controller;
    if (target == null) return;
    try {
      await target.loadRequest(Uri.parse('about:blank'));
    } catch (_) {
      _offlineBlankLoaded = false;
    }
  }

  /// Sticky offline overlay. WebView stays mounted underneath; Chromium's
  /// default error page is cleared so it never flashes through.
  Future<void> _enterOfflineMode() async {
    if (!mounted) return;
    final alreadyOffline = !_isOnline && !_showSplash;
    if (!alreadyOffline) {
      setState(() {
        _isOnline = false;
        _showSplash = false;
        _isChecking = false;
        _isRecovering = false;
      });
    } else if (_isChecking || _isRecovering) {
      setState(() {
        _isChecking = false;
        _isRecovering = false;
      });
    }
    await _clearWebViewToBlank();
  }

  /// Probe then reload only when the host is truly reachable. Safe to call
  /// repeatedly while offline for long periods — failed probes stay offline
  /// without revealing the WebView error page.
  Future<void> _recoverIfReachable({bool userInitiated = false}) async {
    if (!mounted) return;
    if (_isRecovering) {
      // Keep the Try Again spinner visible if a background recover is running.
      if (userInitiated && !_isChecking) {
        setState(() => _isChecking = true);
      }
      return;
    }

    final seq = ++_reachabilitySeq;
    _isRecovering = true;
    if (userInitiated) {
      setState(() => _isChecking = true);
    }

    final ok = await _probeReachability();
    if (!mounted || seq != _reachabilitySeq) {
      _isRecovering = false;
      return;
    }

    if (!ok) {
      _isRecovering = false;
      setState(() {
        _isOnline = false;
        _showSplash = false;
        _isChecking = false;
      });
      await _clearWebViewToBlank();
      return;
    }

    setState(() {
      _isOnline = true;
      _isChecking = false;
      _pageReady = false;
      _showSplash = true;
      _splashStartedAt = DateTime.now();
      _offlineBlankLoaded = false;
    });
    _isRecovering = false;

    await _safeControllerCall(
      (c) => c.loadRequest(
        _freshWebUri(),
        headers: const <String, String>{
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      ),
    );
  }

  void _watchConnectivity() {
    _connectivitySub = _connectivity.onConnectivityChanged
        .distinct(listEquals)
        .transform(
          StreamTransformer<
            List<ConnectivityResult>,
            List<ConnectivityResult>
          >.fromBind(
            (stream) => stream.asyncMap((event) async {
              await Future<void>.delayed(_connectivityDebounce);
              return event;
            }),
          ),
        )
        .listen((results) async {
          final hasLink = results.any((r) => r != ConnectivityResult.none);
          if (!mounted) return;

          if (!hasLink) {
            // Keep WebView mounted under the offline overlay so Android
            // platform callbacks (e.g. onLoadResource) do not hit a disposed
            // InstanceManager entry and crash with a null check.
            await _enterOfflineMode();
            return;
          }

          // Link restored — only recover while sticky-offline, and only after
          // a real reachability probe (avoids flashing Chromium error pages).
          if (!_isOnline) {
            await _recoverIfReachable();
          }
        });
  }

  /// Runs a controller call only while the platform WebView is still alive.
  Future<void> _safeControllerCall(
    Future<void> Function(WebViewController controller) action,
  ) async {
    final controller = _controller;
    if (!mounted || controller == null || !_isReady) return;
    try {
      await action(controller);
    } catch (_) {
      // Ignore races where the native WebView was torn down mid-call.
    }
  }

  Future<void> _onRetry() async {
    await _recoverIfReachable(userInitiated: true);
  }

  Future<void> _dismissSplashWhenReady() async {
    if (!_pageReady || !_showSplash) return;

    final started = _splashStartedAt ?? DateTime.now();
    final elapsed = DateTime.now().difference(started);
    final remaining = _minSplashDuration - elapsed;
    if (remaining > Duration.zero) {
      await Future<void>.delayed(remaining);
    }
    if (!mounted || !_pageReady) return;
    setState(() => _showSplash = false);
  }

  Widget _buildSplash() {
    return ColoredBox(
      color: const Color(AppConfig.brandSoft),
      child: Center(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: Image.asset(
            'assets/logo.png',
            width: 112,
            height: 112,
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }

  Future<void> _handleBack() async {
    if (_updating) return;
    if (!_isOnline) {
      await _confirmExit();
      return;
    }

    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
      return;
    }

    await _confirmExit();
  }

  Future<void> _confirmExit() async {
    if (_exitDialogOpen || !mounted) return;
    _exitDialogOpen = true;

    final shouldExit = await showDialog<bool>(
      context: context,
      barrierDismissible: true,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            'Exit ${AppConfig.appName}?',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
          ),
          content: const Text(
            'Are you sure you want to close the app?',
            style: TextStyle(height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(AppConfig.brand),
              ),
              child: const Text('Exit'),
            ),
          ],
        );
      },
    );

    _exitDialogOpen = false;

    if (shouldExit == true) {
      SystemNavigator.pop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connectivitySub?.cancel();
    _fcmTokenSub?.cancel();
    _fcmForegroundSub?.cancel();
    _fcmPollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_updating && _updateInfo != null) {
      return PopScope(
        canPop: false,
        child: AutoUpdateScreen(info: _updateInfo!),
      );
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _handleBack();
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
          systemNavigationBarColor: Colors.transparent,
          systemNavigationBarIconBrightness: Brightness.dark,
          systemNavigationBarDividerColor: Colors.transparent,
        ),
        child: Scaffold(
          backgroundColor: const Color(AppConfig.brandSoft),
          // Edge-to-edge WebView: system insets are applied inside the web UI
          // via viewport-fit=cover + CSS env()/--safe-area-* (AdminShell / UserShell).
          // Native SafeArea wraps only non-web chrome so branded pages can paint
          // full-bleed under the status bar when they opt in.
          //
          // Always keep WebViewWidget in the tree once created. Replacing it
          // with NoInternetScreen disposes the Android platform view while
          // WebViewClient callbacks can still arrive → null bang in pigeon.
          resizeToAvoidBottomInset: true,
          body: Stack(
            fit: StackFit.expand,
            children: [
              if (_isReady && _webViewWidget != null)
                RepaintBoundary(child: _webViewWidget!),
              if (_showSplash && _isOnline)
                IgnorePointer(
                  child: RepaintBoundary(child: _buildSplash()),
                ),
              if (!_isOnline)
                NoInternetScreen(onRetry: _onRetry, isChecking: _isChecking),
            ],
          ),
        ),
      ),
    );
  }
}
