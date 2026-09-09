# Generated on the VPS in parallel with 0063_deposit_himalpay_checkout.
# Updates Settings.app_version / auto_update_enabled help_text after 0062.
# Kept so both 0063 leaves can merge.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0062_normalize_settings_app_version'),
    ]

    operations = [
        migrations.AlterField(
            model_name='settings',
            name='app_version',
            field=models.CharField(
                blank=True,
                default='',
                help_text=(
                    'Latest Android app semver (e.g. 3.0.1). Compared with '
                    'Flutter AppConstant.appVersion; equal forms like 3 and '
                    '3.0.0 do not re-prompt'
                ),
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name='settings',
            name='auto_update_enabled',
            field=models.BooleanField(
                default=False,
                help_text=(
                    'When enabled, the Android app downloads and installs the '
                    'APK if the remote version is newer'
                ),
            ),
        ),
    ]
