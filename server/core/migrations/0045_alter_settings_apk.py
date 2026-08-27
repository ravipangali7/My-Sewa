# Generated on the VPS in parallel with 0045_hierarchy_commission_profit.
# Adds the .apk FileExtensionValidator already present on Settings.apk.
# Kept so both 0045 leaves can merge.

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0044_merge_0043_citizenship_and_dealer'),
    ]

    operations = [
        migrations.AlterField(
            model_name='settings',
            name='apk',
            field=models.FileField(
                blank=True,
                help_text='Latest Android APK used for in-app auto updates',
                max_length=255,
                null=True,
                upload_to='settings/apk/',
                validators=[django.core.validators.FileExtensionValidator(allowed_extensions=['apk'])],
            ),
        ),
    ]
