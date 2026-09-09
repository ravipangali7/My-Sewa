import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

/// Saves a file into a location the system Files / Downloads app can see.
class DownloadStorage {
  DownloadStorage._();

  static const _channel = MethodChannel('com.mysewa.app/downloads');

  static Future<({bool public, String path})> save({
    required String filename,
    required String mime,
    required List<int> bytes,
  }) async {
    final data = Uint8List.fromList(bytes);
    try {
      final saved = await _channel.invokeMethod<String>('saveToDownloads', {
        'filename': filename,
        'mime': mime,
        'bytes': data,
      });
      if (saved != null && saved.trim().isNotEmpty) {
        return (public: true, path: saved.trim());
      }
    } catch (_) {}

    final file = await _writeFallback(filename, data);
    return (public: false, path: file.path);
  }

  static Future<File> _writeFallback(String filename, Uint8List bytes) async {
    Directory dir = await getApplicationDocumentsDirectory();
    if (Platform.isAndroid) {
      try {
        final downloads = await getDownloadsDirectory();
        if (downloads != null) dir = downloads;
      } catch (_) {}
    }
    final folder = Directory('${dir.path}${Platform.pathSeparator}MySewa');
    if (!await folder.exists()) {
      await folder.create(recursive: true);
    }
    final file = File('${folder.path}${Platform.pathSeparator}$filename');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }
}
