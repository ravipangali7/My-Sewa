from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0038_settings_app_auto_update'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='wallet',
            name='transactions_blocked',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text=(
                    'When True, outbound payments (top-up, bills, fund transfer, data pack) '
                    'are blocked until a Super Admin unblocks. Used when HimalPay already '
                    'debited but MySewa did not apply the wallet movement.'
                ),
            ),
        ),
        migrations.AddField(
            model_name='wallet',
            name='blocked_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='wallet',
            name='blocked_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='wallet',
            name='blocked_merchant_txn_id',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='wallet',
            name='unblocked_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='wallet',
            name='unblocked_by',
            field=models.ForeignKey(
                blank=True,
                help_text='Admin who last unblocked this wallet.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='wallets_unblocked',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='statementreconcilerun',
            name='triggered_by',
            field=models.CharField(
                choices=[
                    ('schedule', 'Schedule'),
                    ('admin', 'Admin'),
                    ('post_txn', 'After transaction'),
                ],
                default='admin',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='statementdiscrepancy',
            name='issue_type',
            field=models.CharField(
                choices=[
                    ('status_mismatch', 'Status mismatch'),
                    ('amount_mismatch', 'Amount mismatch'),
                    ('missing_local', 'Missing in MySewa'),
                    ('missing_provider', 'Missing in HimalPay'),
                    ('wallet_not_applied', 'Wallet not applied'),
                    ('balance_mismatch', 'Before/after balance mismatch'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
    ]
