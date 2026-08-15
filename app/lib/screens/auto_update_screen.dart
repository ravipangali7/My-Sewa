import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/app_config.dart';
import '../services/app_update_service.dart';

enum _UpdatePhase { preparing, downloading, installing, failed }

class AutoUpdateScreen extends StatefulWidget {
  const AutoUpdateScreen({super.key, required this.info});

  final AppUpdateInfo info;

  @override
  State<AutoUpdateScreen> createState() => _AutoUpdateScreenState();
}

class _AutoUpdateScreenState extends State<AutoUpdateScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  _UpdatePhase _phase = _UpdatePhase.preparing;
  double _progress = 0;
  int _received = 0;
  int _total = 0;
  String? _error;
  File? _apkFile;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_start());
    });
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _phase = _UpdatePhase.downloading;
      _progress = 0;
      _received = 0;
      _total = 0;
      _error = null;
    });

    try {
      final file = await AppUpdateService.downloadApk(
        widget.info,
        onProgress: (progress, received, total) {
          if (!mounted) return;
          setState(() {
            _progress = progress;
            _received = received;
            _total = total;
          });
        },
      );
      if (!mounted) return;
      _apkFile = file;
      setState(() {
        _phase = _UpdatePhase.installing;
        _progress = 1;
      });
      await AppUpdateService.installApk(file);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _UpdatePhase.failed;
        _error = error.toString().replaceFirst('StateError: ', '');
      });
    }
  }

  Future<void> _retry() async {
    final existing = _apkFile;
    if (existing != null && await existing.exists() && _progress >= 1) {
      setState(() {
        _phase = _UpdatePhase.installing;
        _error = null;
      });
      try {
        await AppUpdateService.installApk(existing);
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _phase = _UpdatePhase.failed;
          _error = error.toString().replaceFirst('StateError: ', '');
        });
      }
      return;
    }
    await _start();
  }

  String get _statusTitle {
    switch (_phase) {
      case _UpdatePhase.preparing:
        return 'Preparing update';
      case _UpdatePhase.downloading:
        return 'Downloading update';
      case _UpdatePhase.installing:
        return 'Installing update';
      case _UpdatePhase.failed:
        return 'Update paused';
    }
  }

  String get _statusSubtitle {
    switch (_phase) {
      case _UpdatePhase.preparing:
        return 'Checking the latest MySewa build.';
      case _UpdatePhase.downloading:
        return 'Please keep the app open until the download finishes.';
      case _UpdatePhase.installing:
        return 'Confirm the Android installer to finish updating.';
      case _UpdatePhase.failed:
        return _error ?? 'Something went wrong while updating.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final percent = (_progress * 100).clamp(0, 100).round();
    final failed = _phase == _UpdatePhase.failed;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
        systemNavigationBarColor: Color(AppConfig.brandDark),
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        body: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(AppConfig.brandDark),
                Color(AppConfig.brand),
                Color(AppConfig.ocean),
              ],
              stops: [0.0, 0.55, 1.0],
            ),
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 28),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  AnimatedBuilder(
                    animation: _pulse,
                    builder: (context, child) {
                      final scale = 1 + (_pulse.value * 0.04);
                      return Transform.scale(scale: scale, child: child);
                    },
                    child: Container(
                      width: 92,
                      height: 92,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(26),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.18),
                            blurRadius: 28,
                            offset: const Offset(0, 12),
                          ),
                        ],
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Image.asset(
                        'assets/logo.png',
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    _statusTitle,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _statusSubtitle,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.82),
                      fontSize: 15,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 36),
                  _ProgressRing(
                    progress: failed ? 0 : _progress,
                    percent: failed ? 0 : percent,
                    failed: failed,
                  ),
                  const SizedBox(height: 28),
                  _VersionChip(
                    from: widget.info.localVersion,
                    to: widget.info.remoteVersion,
                  ),
                  const SizedBox(height: 18),
                  if (!failed) ...[
                    _LinearTrack(progress: _progress),
                    const SizedBox(height: 10),
                    Text(
                      _sizeLabel(),
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.78),
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                  if (failed) ...[
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _retry,
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(AppConfig.brandDark),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: const Text(
                          'Retry update',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                      ),
                    ),
                  ],
                  const Spacer(flex: 3),
                  Text(
                    'MySewa ${widget.info.localVersion} → ${widget.info.remoteVersion}',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.55),
                      fontSize: 12,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _sizeLabel() {
    if (_phase == _UpdatePhase.installing) {
      return 'Opening installer…';
    }
    if (_total <= 0) {
      return _received <= 0 ? 'Starting download…' : _formatBytes(_received);
    }
    return '${_formatBytes(_received)} / ${_formatBytes(_total)}';
  }

  String _formatBytes(int bytes) {
    if (bytes <= 0) return '0 MB';
    final mb = bytes / (1024 * 1024);
    return '${mb.toStringAsFixed(mb >= 10 ? 0 : 1)} MB';
  }
}

class _VersionChip extends StatelessWidget {
  const _VersionChip({required this.from, required this.to});

  final String from;
  final String to;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            from,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Icon(
              Icons.arrow_forward_rounded,
              size: 16,
              color: Colors.white.withValues(alpha: 0.8),
            ),
          ),
          Text(
            to,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _LinearTrack extends StatelessWidget {
  const _LinearTrack({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: 8,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: Colors.white.withValues(alpha: 0.18)),
            FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: progress.clamp(0.0, 1.0),
              child: const ColoredBox(color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProgressRing extends StatelessWidget {
  const _ProgressRing({
    required this.progress,
    required this.percent,
    required this.failed,
  });

  final double progress;
  final int percent;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 168,
      height: 168,
      child: CustomPaint(
        painter: _RingPainter(progress: progress, failed: failed),
        child: Center(
          child: failed
              ? const Icon(
                  Icons.error_outline_rounded,
                  color: Colors.white,
                  size: 46,
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '$percent%',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 36,
                        fontWeight: FontWeight.w800,
                        height: 1,
                        letterSpacing: -0.8,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'complete',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.progress, required this.failed});

  final double progress;
  final bool failed;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (math.min(size.width, size.height) / 2) - 8;
    final track = Paint()
      ..color = Colors.white.withValues(alpha: 0.16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, track);

    if (failed) return;

    final sweep = 2 * math.pi * progress.clamp(0.0, 1.0);
    final arc = Paint()
      ..shader = const SweepGradient(
        colors: [Colors.white70, Colors.white],
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      sweep,
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.failed != failed;
  }
}
