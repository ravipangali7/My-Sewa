import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../config/app_constant.dart';
import '../services/app_update_service.dart';

/// Shows Update Available when [info] is non-null. Returns true if the user skipped.
Future<void> promptAppUpdateIfNeeded(
  BuildContext context,
  AppUpdateInfo? info,
) async {
  if (info == null || !context.mounted) return;

  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) {
      return _UpdateAvailableDialog(info: info);
    },
  );
}

class _UpdateAvailableDialog extends StatefulWidget {
  const _UpdateAvailableDialog({required this.info});

  final AppUpdateInfo info;

  @override
  State<_UpdateAvailableDialog> createState() => _UpdateAvailableDialogState();
}

class _UpdateAvailableDialogState extends State<_UpdateAvailableDialog> {
  bool _downloading = false;
  double _progress = 0;
  String? _error;

  Future<void> _onUpdate() async {
    if (_downloading) return;
    setState(() {
      _downloading = true;
      _progress = 0;
      _error = null;
    });

    try {
      await AppUpdateService.downloadAndInstall(
        widget.info.apkUrl,
        onProgress: (value) {
          if (!mounted) return;
          setState(() => _progress = value.clamp(0, 1));
        },
      );
      // Installer opened — leave dialog open so user can Skip if they cancel install.
      if (mounted) {
        setState(() => _downloading = false);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text(
        'Update Available',
        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'A newer version of ${AppConfig.appName} is available '
            '(${widget.info.remoteVersion}). You are on ${AppConstant.appVersion}.',
            style: const TextStyle(height: 1.4),
          ),
          if (_downloading) ...[
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: _progress > 0 && _progress < 1 ? _progress : null,
              color: const Color(AppConfig.brand),
              backgroundColor: const Color(AppConfig.brandSoft),
            ),
            const SizedBox(height: 8),
            Text(
              _progress >= 1
                  ? 'Opening installer…'
                  : 'Downloading… ${(_progress * 100).clamp(0, 100).toStringAsFixed(0)}%',
              style: const TextStyle(
                fontSize: 13,
                color: Color(AppConfig.secondary),
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(
                fontSize: 13,
                height: 1.35,
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _downloading ? null : () => Navigator.of(context).pop(),
          child: const Text('Skip'),
        ),
        FilledButton(
          onPressed: _downloading ? null : _onUpdate,
          style: FilledButton.styleFrom(
            backgroundColor: const Color(AppConfig.brand),
          ),
          child: Text(_downloading ? 'Updating…' : 'Update'),
        ),
      ],
    );
  }
}
