# Generated manually for optional deposit screenshot proof

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_settings_config'),
    ]

    operations = [
        migrations.AlterField(
            model_name='deposit',
            name='screenshot_proof',
            field=models.ImageField(
                blank=True,
                help_text='Screenshot proof of payment (required when security.require_deposit_screenshot is on)',
                null=True,
                upload_to='deposits/',
            ),
        ),
    ]
