from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0053_commission_charge_setup'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WalletBalanceIssue',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fingerprint', models.CharField(
                    db_index=True,
                    help_text='Stable id for this txn/user side, e.g. topup:12 or wallet_transfer:9:sender',
                    max_length=80,
                    unique=True,
                )),
                ('txn_type', models.CharField(
                    choices=[
                        ('topup', 'Top-up'),
                        ('data_pack', 'Data pack'),
                        ('internet', 'Internet'),
                        ('water', 'Water'),
                        ('electricity', 'Electricity'),
                        ('community_electricity', 'Community electricity'),
                        ('bank_transfer', 'Bank transfer'),
                        ('remittance', 'Remittance'),
                        ('deposit', 'Deposit'),
                        ('wallet_transfer', 'Wallet transfer'),
                        ('wallet_adjustment', 'Wallet adjustment'),
                    ],
                    db_index=True,
                    max_length=40,
                )),
                ('txn_id', models.PositiveIntegerField()),
                ('party', models.CharField(
                    blank=True,
                    default='',
                    help_text='sender/recipient for wallet transfers; empty otherwise',
                    max_length=16,
                )),
                ('direction', models.CharField(
                    choices=[('debit', 'Debit'), ('credit', 'Credit')],
                    max_length=10,
                )),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('balance_before', models.DecimalField(decimal_places=2, max_digits=12)),
                ('recorded_balance_after', models.DecimalField(
                    decimal_places=2,
                    help_text='After-balance stored on the transaction (system-displayed)',
                    max_digits=12,
                )),
                ('expected_balance_after', models.DecimalField(
                    decimal_places=2,
                    help_text='balance_before ± amount',
                    max_digits=12,
                )),
                ('current_wallet_balance', models.DecimalField(
                    decimal_places=2,
                    help_text='Live wallet balance at last scan',
                    max_digits=12,
                )),
                ('txn_at', models.DateTimeField(db_index=True)),
                ('txn_reference', models.CharField(blank=True, default='', max_length=120)),
                ('txn_status', models.CharField(blank=True, default='', max_length=20)),
                ('service_name', models.CharField(blank=True, default='', max_length=80)),
                ('description', models.TextField(blank=True, default='')),
                ('txn_snapshot', models.JSONField(blank=True, default=dict)),
                ('suggested_adjustment_type', models.CharField(
                    blank=True,
                    choices=[('credit', 'Manual Load (Add Fund)'), ('debit', 'Debit')],
                    default='',
                    max_length=10,
                )),
                ('suggested_amount', models.DecimalField(
                    blank=True, decimal_places=2, max_digits=12, null=True,
                )),
                ('status', models.CharField(
                    choices=[('open', 'Open'), ('resolved', 'Resolved'), ('ignored', 'Ignored')],
                    db_index=True,
                    default='open',
                    max_length=20,
                )),
                ('reason', models.TextField(blank=True, default='')),
                ('detected_at', models.DateTimeField(auto_now_add=True)),
                ('shared_at', models.DateTimeField(blank=True, null=True)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('email_sent_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('resolution_adjustment', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='wallet_balance_issues',
                    to='core.walletadjustment',
                )),
                ('resolved_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='wallet_balance_issues_resolved',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('shared_by', models.ForeignKey(
                    blank=True,
                    help_text='Super Admin who confirmed Issue Share',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='wallet_balance_issues_shared',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='wallet_balance_issues',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Wallet Balance Issue',
                'verbose_name_plural': 'Wallet Balance Issues',
                'ordering': ['-txn_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='walletbalanceissue',
            index=models.Index(fields=['status', 'txn_at'], name='core_wbi_status_txn_idx'),
        ),
        migrations.AddIndex(
            model_name='walletbalanceissue',
            index=models.Index(fields=['user', 'status'], name='core_wbi_user_status_idx'),
        ),
    ]
