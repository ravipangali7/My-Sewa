# Generated manually for Payin / Wallet Load API (PayBridgeNP).

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0071_deposit_paybridgenp'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='can_api_payin',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text=(
                    'When enabled (and is_api_user), this account may call the Payin / Wallet Load API '
                    'to initiate PayBridgeNP checkout that credits another MySewa user\'s wallet.'
                ),
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='source',
            field=models.CharField(
                choices=[('app', 'App'), ('api', 'API')],
                db_index=True,
                default='app',
                help_text='Whether this deposit was created from the app or the Payin API.',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='client_reference',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Client-supplied idempotency/reference for API payin deposits.',
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='initiated_by',
            field=models.ForeignKey(
                blank=True,
                help_text='API user that initiated this payin (wallet credit still goes to user).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='initiated_deposits',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='apiidempotencyrecord',
            name='deposit',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='api_idempotency_records',
                to='core.deposit',
            ),
        ),
        migrations.CreateModel(
            name='ApiPayinLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reference', models.CharField(blank=True, default='', max_length=64)),
                ('receiver', models.CharField(blank=True, default='', max_length=80)),
                ('amount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('status', models.CharField(
                    choices=[('success', 'Success'), ('failed', 'Failed'), ('pending', 'Pending')],
                    db_index=True,
                    max_length=20,
                )),
                ('error_code', models.CharField(blank=True, default='', max_length=64)),
                ('error_message', models.CharField(blank=True, default='', max_length=255)),
                ('transaction_id', models.CharField(blank=True, default='', max_length=120)),
                ('order_id', models.CharField(blank=True, default='', max_length=120)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=512)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('deposit', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='api_payin_logs',
                    to='core.deposit',
                )),
                ('user', models.ForeignKey(
                    blank=True,
                    help_text='Authenticated API user when known. Null for invalid-key attempts.',
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='api_payin_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'API Payin Log',
                'verbose_name_plural': 'API Payin Logs',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='apipayinlog',
            index=models.Index(fields=['user', '-created_at'], name='core_apipayinlog_user_idx'),
        ),
        migrations.AddIndex(
            model_name='apipayinlog',
            index=models.Index(fields=['status', '-created_at'], name='core_apipayinlog_status_idx'),
        ),
    ]
