# Generated manually for DeviceToken (FCM / web push registration)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0014_transaction_wallet_balances'),
    ]

    operations = [
        migrations.CreateModel(
            name='DeviceToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token', models.CharField(db_index=True, max_length=512, unique=True)),
                ('platform', models.CharField(
                    choices=[
                        ('android', 'Android'),
                        ('ios', 'iOS'),
                        ('web', 'Web'),
                        ('unknown', 'Unknown'),
                    ],
                    default='unknown',
                    max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='device_tokens',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Device Token',
                'verbose_name_plural': 'Device Tokens',
                'ordering': ['-updated_at'],
            },
        ),
    ]
