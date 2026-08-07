from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_deposit_manual_load_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='SecurityAuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(
                    choices=[
                        ('transaction_pin_set', 'Transaction PIN Set'),
                        ('transaction_pin_changed', 'Transaction PIN Changed'),
                        ('transaction_pin_reset', 'Transaction PIN Reset'),
                        ('transaction_pin_reset_otp_sent', 'Transaction PIN Reset OTP Sent'),
                    ],
                    db_index=True,
                    max_length=40,
                )),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=512)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='security_audit_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Security Audit Log',
                'verbose_name_plural': 'Security Audit Logs',
                'ordering': ['-created_at'],
            },
        ),
    ]
