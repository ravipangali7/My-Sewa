import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../config/app_config.dart';
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
  WebViewController? _controller;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  bool _isReady = false;
  bool _isOnline = true;
  bool _isChecking = false;
  bool _showSplash = true;
  bool _pageReady = false;
  bool _exitDialogOpen = false;
  bool _isHandlingDownload = false;
  DateTime? _splashStartedAt;
  DateTime? _lastResumeBridgeSyncAt;

  static const _minSplashDuration = Duration(milliseconds: 900);
  static const _resumeBridgeSyncMinGap = Duration(milliseconds: 700);

  /// Ask the embedded web app to refetch data (pull-to-refresh / live updates).
  static const _dispatchAppResumeJs = '''
(function() {
  try {
    window.dispatchEvent(new CustomEvent('mysewa-app-resume'));
  } catch (e) {}
})();
''';

  /// Exposes a download bridge the web app can call from JS.
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
    window.MySewaNative.hasBridge = true;
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
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
  );
  document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
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
    _bootstrap();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _isOnline && _controller != null) {
      final now = DateTime.now();
      final last = _lastResumeBridgeSyncAt;
      if (last == null || now.difference(last) >= _resumeBridgeSyncMinGap) {
        _lastResumeBridgeSyncAt = now;
        unawaited(_controller!.runJavaScript(_dispatchAppResumeJs));
        unawaited(_controller!.runJavaScript(_installNativeBridgeJs));
      }
    }
  }

  Future<void> _bootstrap() async {
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
    _splashStartedAt ??= DateTime.now();

    final defaultUa = await controller.getUserAgent() ?? '';
    await controller.setUserAgent('$defaultUa MySewaApp/1.0');

    await controller.addJavaScriptChannel(
      'MySewaBridge',
      onMessageReceived: (message) {
        unawaited(_handleNativeBridgeMessage(message.message));
      },
    );

    await controller.setNavigationDelegate(
      NavigationDelegate(
        onPageFinished: (_) async {
          await controller.runJavaScript(_disableZoomJs);
          await controller.runJavaScript(_installNativeBridgeJs);
          if (mounted) {
            final padding = MediaQuery.paddingOf(context);
            await controller.runJavaScript(_safeAreaCssJs(padding));
          }
          if (!mounted) return;
          _pageReady = true;
          await _dismissSplashWhenReady();
        },
        onPageStarted: (_) async {
          await controller.runJavaScript(_installNativeBridgeJs);
        },
        onWebResourceError: (error) async {
          // Blob/data "downloads" must never leave the user on an error page.
          final failing = error.url ?? '';
          if (failing.startsWith('blob:') || failing.startsWith('data:')) {
            return;
          }
          if (error.isForMainFrame != true) return;
          final online = await _hasConnection();
          if (!mounted) return;
          if (!online) {
            setState(() {
              _isOnline = false;
              _showSplash = false;
            });
            return;
          }
          // Main-frame failure with connectivity — reveal WebView (error/login).
          _pageReady = true;
          await _dismissSplashWhenReady();
        },
        onNavigationRequest: (request) async {
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;

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
      await android.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (request) async {
          return const GeolocationPermissionsResponse(
            allow: true,
            retain: true,
          );
        },
        onHidePrompt: () {},
      );
    }

    if (controller.platform is WebKitWebViewController) {
      final webkit = controller.platform as WebKitWebViewController;
      await webkit.setAllowsBackForwardNavigationGestures(true);
    }

    final online = await _hasConnection();
    if (!mounted) return;

    _controller = controller;
    setState(() {
      _isReady = true;
      _isOnline = online;
    });

    if (online) {
      await controller.loadRequest(Uri.parse(AppConfig.webUrl));
    }
  }

  Future<List<String>> _androidFileSelector(FileSelectorParams params) async {
    final type = params.acceptTypes.any((t) => t.contains('image'))
        ? FileType.image
        : FileType.any;

    final result = await FilePicker.pickFiles(
      allowMultiple: params.mode == FileSelectorMode.openMultiple,
      type: type,
      withData: false,
    );

    if (result == null) return [];
    return result.files
        .where((f) => f.path != null)
        .map((f) => Uri.file(f.path!).toString())
        .toList();
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
    if (_isHandlingDownload) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final type = decoded['type']?.toString();
      if (type != 'download') return;

      final filename = _sanitizeFilename(
        decoded['filename']?.toString() ?? 'MySewa_file.pdf',
      );
      final base64Data = decoded['base64']?.toString() ?? '';
      final mime = decoded['mime']?.toString() ?? 'application/octet-stream';
      if (base64Data.isEmpty) return;
      _isHandlingDownload = true;
      final bytes = await compute(_decodeBase64InBackground, base64Data);
      await _saveAndShareBytes(bytes, filename, mime);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save the file. Please try again.')),
      );
    } finally {
      _isHandlingDownload = false;
    }
  }

  String _sanitizeFilename(String name) {
    final cleaned = name.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_').trim();
    if (cleaned.isEmpty) return 'MySewa_file.pdf';
    return cleaned.length > 120 ? cleaned.substring(0, 120) : cleaned;
  }

  Future<void> _saveAndShareBytes(
    List<int> bytes,
    String filename,
    String mime,
  ) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);

    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: mime, name: filename)],
        subject: filename,
        text: 'MySewa statement',
      ),
    );
  }

  Future<bool> _hasConnection() async {
    final results = await Connectivity().checkConnectivity();
    return results.any((r) => r != ConnectivityResult.none);
  }

  void _watchConnectivity() {
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) async {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (!mounted) return;

      if (!online) {
        setState(() => _isOnline = false);
        return;
      }

      final wasOffline = !_isOnline;
      setState(() => _isOnline = true);
      if (wasOffline) {
        await _controller?.reload();
      }
    });
  }

  Future<void> _onRetry() async {
    setState(() => _isChecking = true);
    final online = await _hasConnection();
    if (!mounted) return;
    setState(() {
      _isChecking = false;
      _isOnline = online;
      if (online) {
        _pageReady = false;
        _showSplash = true;
        _splashStartedAt = DateTime.now();
      }
    });
    if (online) {
      await _controller?.loadRequest(Uri.parse(AppConfig.webUrl));
    }
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
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
          body: !_isOnline
              ? NoInternetScreen(onRetry: _onRetry, isChecking: _isChecking)
              : Stack(
                  fit: StackFit.expand,
                  children: [
                    if (_isReady && _controller != null)
                      WebViewWidget(controller: _controller!),
                    if (_showSplash) _buildSplash(),
                  ],
                ),
        ),
      ),
    );
  }
}
