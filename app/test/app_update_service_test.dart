import 'package:flutter_test/flutter_test.dart';
import 'package:mysewa/services/app_update_service.dart';

void main() {
  group('AppUpdateService semver', () {
    test('3 / 3.0 / 3.0.0 are equal', () {
      expect(AppUpdateService.compareVersions('3', '3.0.0'), 0);
      expect(AppUpdateService.compareVersions('3.0', '3.0.0'), 0);
      expect(AppUpdateService.compareVersions('3.0.0', '3'), 0);
      expect(AppUpdateService.isRemoteNewer('3', '3.0.0'), isFalse);
      expect(AppUpdateService.isRemoteNewer('3.0.0', '3'), isFalse);
      expect(AppUpdateService.displayVersion('3'), '3.0.0');
      expect(AppUpdateService.displayVersion('3.0'), '3.0.0');
    });

    test('only newer remote triggers update', () {
      expect(AppUpdateService.isRemoteNewer('3.0.1', '3.0.0'), isTrue);
      expect(AppUpdateService.isRemoteNewer('3.1', '3.0.0'), isTrue);
      expect(AppUpdateService.isRemoteNewer('4', '3.0.0'), isTrue);
      expect(AppUpdateService.isRemoteNewer('3.0.0', '3.0.1'), isFalse);
      expect(AppUpdateService.isRemoteNewer('2.9.9', '3.0.0'), isFalse);
      expect(AppUpdateService.isRemoteNewer('3.0.0', '3.0.0'), isFalse);
    });

    test('higherVersion picks semantic max (versionName vs AppConstant drift)', () {
      expect(AppUpdateService.higherVersion('2.0.0', '3.0.0'), '3.0.0');
      expect(AppUpdateService.higherVersion('3.0.0', '2.0.0'), '3.0.0');
      expect(AppUpdateService.higherVersion('3.0.1', '3.0.0'), '3.0.1');
      expect(AppUpdateService.higherVersion('', '3.0.0'), '3.0.0');
    });

    test('normalizes build metadata and v-prefix', () {
      expect(AppUpdateService.normalizeVersion('v3.0.0+2'), '3.0.0');
      expect(AppUpdateService.displayVersion('v3.1-beta'), '3.1.0');
    });
  });
}
