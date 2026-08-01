import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../config/app_config.dart';
import 'no_internet_screen.dart';

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  WebViewController? _controller;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  bool _isReady = false;
  bool _isOnline = true;
  bool _isChecking = false;
  bool _isLoading = true;
  bool _exitDialogOpen = false;
  double _progress = 0;

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
    _bootstrap();
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
    await controller.setBackgroundColor(const Color(AppConfig.bg));
    await controller.enableZoom(false);

    final defaultUa = await controller.getUserAgent() ?? '';
    await controller.setUserAgent('$defaultUa MySewaApp/1.0');

    await controller.setNavigationDelegate(
      NavigationDelegate(
        onProgress: (progress) {
          if (!mounted) return;
          setState(() {
            _progress = progress / 100;
            _isLoading = progress < 100;
          });
        },
        onPageStarted: (_) {
          if (!mounted) return;
          setState(() {
            _isLoading = true;
            _progress = 0;
          });
        },
        onPageFinished: (_) async {
          await controller.runJavaScript(_disableZoomJs);
          if (mounted) {
            final padding = MediaQuery.paddingOf(context);
            await controller.runJavaScript(_safeAreaCssJs(padding));
          }
          if (!mounted) return;
          setState(() {
            _isLoading = false;
            _progress = 1;
          });
        },
        onWebResourceError: (error) async {
          if (error.isForMainFrame != true) return;
          final online = await _hasConnection();
          if (!mounted) return;
          if (!online) {
            setState(() => _isOnline = false);
          }
        },
        onNavigationRequest: (request) async {
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;

          if (_isAppHost(uri)) {
            return NavigationDecision.navigate;
          }

          if (_shouldOpenExternally(uri)) {
            await _openExternal(uri);
            return NavigationDecision.prevent;
          }

          if (uri.scheme == 'http' || uri.scheme == 'https') {
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
    final host = uri.host.toLowerCase();
    return host.isEmpty ||
        host == AppConfig.host ||
        host.endsWith('.${AppConfig.host}');
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
    });
    if (online) {
      await _controller?.loadRequest(Uri.parse(AppConfig.webUrl));
    }
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
    _connectivitySub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;

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
          backgroundColor: const Color(AppConfig.bg),
          // Edge-to-edge WebView: system insets are applied inside the web UI
          // via viewport-fit=cover + CSS env()/--safe-area-* (AdminShell / UserShell).
          // Native SafeArea wraps only non-web chrome so branded pages can paint
          // full-bleed under the status bar when they opt in.
          body: !_isOnline
              ? NoInternetScreen(onRetry: _onRetry, isChecking: _isChecking)
              : !_isReady || _controller == null
                  ? const SafeArea(
                      child: Center(
                        child: CircularProgressIndicator(
                          color: Color(AppConfig.brand),
                        ),
                      ),
                    )
                  : Stack(
                      fit: StackFit.expand,
                      children: [
                        WebViewWidget(controller: _controller!),
                        if (_isLoading)
                          Positioned(
                            top: topInset,
                            left: 0,
                            right: 0,
                            child: LinearProgressIndicator(
                              value: _progress > 0 && _progress < 1
                                  ? _progress
                                  : null,
                              minHeight: 2.5,
                              backgroundColor: Colors.transparent,
                              color: const Color(AppConfig.brand),
                            ),
                          ),
                      ],
                    ),
        ),
      ),
    );
  }
}
