# Generated manually for UserFeeConfig (per-user transfer/top-up charge overrides)

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0015_device_token'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserFeeConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'transfer_charge_enabled',
                    models.BooleanField(
                        blank=True,
                        help_text='null = use global Settings.config',
                        null=True,
                    ),
                ),
                (
                    'transfer_charge_flat',
                    models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
                ),
                (
                    'transfer_charge_percent',
                    models.DecimalField(blank=True, decimal_places=4, max_digits=7, null=True),
                ),
                (
                    'topup_charge_percent',
                    models.DecimalField(blank=True, decimal_places=4, max_digits=7, null=True),
                ),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'user',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='fee_config',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'verbose_name': 'User Fee Config',
                'verbose_name_plural': 'User Fee Configs',
            },
        ),
    ]
