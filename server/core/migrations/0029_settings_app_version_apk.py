from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0028_login_otp_security_actions'),
    ]

    operations = [
        migrations.AddField(
            model_name='settings',
            name='app_version',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Latest Android app version string compared with Flutter appVersion',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='settings',
            name='apk',
            field=models.FileField(
                blank=True,
                help_text='Latest Android APK used for in-app updates',
                null=True,
                upload_to='settings/apk/',
            ),
        ),
    ]
