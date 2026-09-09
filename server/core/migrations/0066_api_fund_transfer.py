from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0065_checkoutsession'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='is_api_user',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text='When True, this user may authenticate to the Fund Transfer API with an API key.',
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='api_key',
            field=models.CharField(
                blank=True,
                help_text='Unique API credential. Empty for non-API users. Never log this value.',
                max_length=80,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='api_key_created_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When the first API key was issued for this user.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='api_key_updated_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When the API key was last generated or regenerated.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='api_last_used_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When this API key last authenticated successfully.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='wallettransfer',
            name='source',
            field=models.CharField(
                choices=[('app', 'App'), ('api', 'API')],
                db_index=True,
                default='app',
                help_text='Whether this transfer was created from the app or the Fund Transfer API.',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='wallettransfer',
            name='client_reference',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Client-supplied idempotency/reference for API transfers.',
                max_length=64,
            ),
        ),
        migrations.CreateModel(
            name='ApiIdempotencyRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reference', models.CharField(max_length=64)),
                ('status', models.CharField(
                    choices=[('processing', 'Processing'), ('completed', 'Completed')],
                    db_index=True,
                    default='processing',
                    max_length=20,
                )),
                ('response_payload', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='api_idempotency_records',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('wallet_transfer', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='api_idempotency_records',
                    to='core.wallettransfer',
                )),
            ],
            options={
                'verbose_name': 'API Idempotency Record',
                'verbose_name_plural': 'API Idempotency Records',
                'constraints': [
                    models.UniqueConstraint(fields=('user', 'reference'), name='core_apiidemp_user_ref_uniq'),
                ],
            },
        ),
        migrations.CreateModel(
            name='ApiFundTransferLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reference', models.CharField(blank=True, default='', max_length=64)),
                ('receiver', models.CharField(blank=True, default='', max_length=80)),
                ('amount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('status', models.CharField(
                    choices=[('success', 'Success'), ('failed', 'Failed')],
                    db_index=True,
                    max_length=20,
                )),
                ('error_code', models.CharField(blank=True, default='', max_length=64)),
                ('error_message', models.CharField(blank=True, default='', max_length=255)),
                ('transaction_id', models.CharField(blank=True, default='', max_length=100)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=512)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    blank=True,
                    help_text='Authenticated API user when known. Null for invalid-key attempts.',
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='api_fund_transfer_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('wallet_transfer', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='api_fund_transfer_logs',
                    to='core.wallettransfer',
                )),
            ],
            options={
                'verbose_name': 'API Fund Transfer Log',
                'verbose_name_plural': 'API Fund Transfer Logs',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='apifundtransferlog',
            index=models.Index(fields=['user', '-created_at'], name='core_apiftlog_user_idx'),
        ),
        migrations.AddIndex(
            model_name='apifundtransferlog',
            index=models.Index(fields=['status', '-created_at'], name='core_apiftlog_status_idx'),
        ),
        migrations.AlterField(
            model_name='securityauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('transaction_pin_set', 'Transaction PIN Set'),
                    ('transaction_pin_changed', 'Transaction PIN Changed'),
                    ('transaction_pin_reset', 'Transaction PIN Reset'),
                    ('transaction_pin_reset_otp_sent', 'Transaction PIN Reset OTP Sent'),
                    ('transaction_pin_admin_set', 'Transaction PIN Admin Set'),
                    ('phone_change_otp_sent', 'Phone Change OTP Sent'),
                    ('phone_changed', 'Phone Changed'),
                    ('email_change_otp_sent', 'Email Change OTP Sent'),
                    ('email_changed', 'Email Changed'),
                    ('login_otp_sent', 'Login OTP Sent'),
                    ('login_otp_verified', 'Login OTP Verified'),
                    ('dealer_created', 'Dealer Created'),
                    ('dealer_updated', 'Dealer Updated'),
                    ('dealer_status_changed', 'Dealer Status Changed'),
                    ('sub_agent_created', 'Sub-Agent Created'),
                    ('customer_mapped', 'Customer Mapped'),
                    ('customer_reassigned', 'Customer Reassigned'),
                    ('commission_changed', 'Commission Changed'),
                    ('tds_changed', 'TDS Changed'),
                    ('wallet_frozen', 'Wallet Frozen'),
                    ('wallet_unfrozen', 'Wallet Unfrozen'),
                    ('api_access_enabled', 'API Access Enabled'),
                    ('api_access_disabled', 'API Access Disabled'),
                    ('api_key_regenerated', 'API Key Regenerated'),
                    ('api_key_viewed', 'API Key Viewed'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
    ]
