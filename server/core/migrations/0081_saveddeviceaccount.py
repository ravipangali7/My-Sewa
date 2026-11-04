from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0080_alter_customuser_can_api_payin_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='SavedDeviceAccount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('device_id', models.CharField(db_index=True, max_length=128)),
                ('device_secret_hash', models.CharField(max_length=128)),
                ('device_name', models.CharField(blank=True, default='', max_length=128)),
                ('platform', models.CharField(blank=True, default='web', max_length=32)),
                ('last_login_at', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='saved_device_accounts', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Saved Device Account',
                'verbose_name_plural': 'Saved Device Accounts',
            },
        ),
        migrations.AddIndex(
            model_name='saveddeviceaccount',
            index=models.Index(fields=['device_id', 'user'], name='core_saveddev_idx'),
        ),
        migrations.AddConstraint(
            model_name='saveddeviceaccount',
            constraint=models.UniqueConstraint(fields=('user', 'device_id'), name='uniq_user_saved_device'),
        ),
    ]
