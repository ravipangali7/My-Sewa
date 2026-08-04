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
  bool _bridgeInstalled = false;
  final Set<String> _dispatchedPaymentOutcomeKeys = <String>{};
  DateTime? _splashStartedAt;
  DateTime? _lastResumeBridgeSyncAt;

  static const _minSplashDuration = Duration(milliseconds: 900);
  static const _resumeBridgeSyncMinGap = Duration(milliseconds: 700);
  static const _connectivityDebounce = Duration(milliseconds: 250);

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
    // Avoid first-paint stutter by decoding splash asset before initial frames.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(precacheImage(const AssetImage('assets/logo.png'), context));
    });
    _bootstrap();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _isOnline &&
        _controller != null) {
      final now = DateTime.now();
      final last = _lastResumeBridgeSyncAt;
      if (last == null || now.difference(last) >= _resumeBridgeSyncMinGap) {
        _lastResumeBridgeSyncAt = now;
        unawaited(_controller!.runJavaScript(_dispatchAppResumeJs));
        if (!_bridgeInstalled) {
          _bridgeInstalled = true;
          unawaited(_controller!.runJavaScript(_installNativeBridgeJs));
        }
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
          final currentUrl = await controller.currentUrl();
          if (currentUrl != null) {
            final uri = Uri.tryParse(currentUrl);
            if (uri != null) {
              await _dispatchPaymentOutcomeToWeb(uri);
            }
          }
          await controller.runJavaScript(_disableZoomJs);
          if (!_bridgeInstalled) {
            _bridgeInstalled = true;
            await controller.runJavaScript(_installNativeBridgeJs);
          }
          if (mounted) {
            final padding = MediaQuery.paddingOf(context);
            await controller.runJavaScript(_safeAreaCssJs(padding));
          }
          if (!mounted) return;
          _pageReady = true;
          await _dismissSplashWhenReady();
        },
        onPageStarted: (_) {},
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
    _webViewWidget = _createWebViewWidget(controller);
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

  WebViewWidget _createWebViewWidget(WebViewController controller) {
    if (WebViewPlatform.instance is AndroidWebViewPlatform) {
      final params = AndroidWebViewWidgetCreationParams(
        controller: controller.platform as AndroidWebViewController,
        // Texture-backed composition is usually smoother than full hybrid
        // composition for scrolling and transitions.
        displayWithHybridComposition: false,
      );
      return WebViewWidget.fromPlatformCreationParams(params: params);
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
    if (_isHandlingDownload) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final type = decoded['type']?.toString().toLowerCase() ?? 'download';
      const allowedTypes = {
        'download',
        'receipt',
        'transaction_receipt',
        'transactionreceipt',
        'payment_receipt',
        'paymentreceipt',
      };
      if (!allowedTypes.contains(type)) return;

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
      await _saveReceiptBytes(bytes, filename, mime);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not save the file. Please try again.'),
        ),
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

  Future<void> _saveReceiptBytes(
    List<int> bytes,
    String filename,
    String mime,
  ) async {
    final root = await getApplicationDocumentsDirectory();
    final folder = Directory('${root.path}/MySewa/receipts');
    if (!await folder.exists()) {
      await folder.create(recursive: true);
    }
    final file = File('${folder.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);

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

    final path = uri.path.toLowerCase();
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

  Future<bool> _hasConnection() async {
    final results = await _connectivity.checkConnectivity();
    return results.any((r) => r != ConnectivityResult.none);
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
          final online = results.any((r) => r != ConnectivityResult.none);
          if (!mounted || online == _isOnline) return;

          if (!online) {
            setState(() => _isOnline = false);
            return;
          }

          setState(() => _isOnline = true);
          await _controller?.reload();
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
                      RepaintBoundary(child: _webViewWidget!),
                    if (_showSplash)
                      IgnorePointer(
                        child: RepaintBoundary(child: _buildSplash()),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
