# Generated manually — remove in-app Android update fields from Settings

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0031_electricity_bill'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='settings',
            name='apk',
        ),
        migrations.RemoveField(
            model_name='settings',
            name='app_version',
        ),
    ]
