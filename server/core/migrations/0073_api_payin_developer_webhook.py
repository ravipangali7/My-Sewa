from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0072_api_payin'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='api_webhook_url',
            field=models.URLField(
                blank=True,
                default='',
                help_text=(
                    'Developer callback URL for Payin (PayBridgeNP) results. '
                    'MySewa POSTs the verified payment outcome here after wallet credit. '
                    'Mapped via deposit.initiated_by — never taken from client redirect alone.'
                ),
                max_length=500,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='developer_webhook_delivered_at',
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                help_text='When the developer Payin webhook was delivered successfully (idempotent).',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='developer_webhook_attempts',
            field=models.PositiveIntegerField(
                default=0,
                help_text='Number of developer webhook delivery attempts.',
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='developer_webhook_last_error',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Last developer webhook delivery error (truncated).',
                max_length=255,
            ),
        ),
        migrations.CreateModel(
            name='ApiPayinWebhookLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('url', models.URLField(max_length=500)),
                ('status', models.CharField(
                    choices=[
                        ('success', 'Success'),
                        ('failed', 'Failed'),
                        ('skipped', 'Skipped'),
                    ],
                    db_index=True,
                    max_length=20,
                )),
                ('http_status', models.PositiveIntegerField(blank=True, null=True)),
                ('request_payload', models.JSONField(blank=True, default=dict)),
                ('response_body', models.TextField(blank=True, default='')),
                ('error_message', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('deposit', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='developer_webhook_logs',
                    to='core.deposit',
                )),
                ('developer', models.ForeignKey(
                    help_text='API user (initiated_by) that owns the webhook URL.',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='api_payin_webhook_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'API Payin Webhook Log',
                'verbose_name_plural': 'API Payin Webhook Logs',
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['developer', '-created_at'], name='core_apipayinwh_dev_idx'),
                    models.Index(fields=['deposit', '-created_at'], name='core_apipayinwh_dep_idx'),
                ],
            },
        ),
    ]
