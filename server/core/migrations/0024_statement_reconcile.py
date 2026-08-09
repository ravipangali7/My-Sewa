# Generated manually for StatementReconcileRun / StatementDiscrepancy

from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0023_water_and_community_electricity'),
    ]

    operations = [
        migrations.CreateModel(
            name='StatementReconcileRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_date', models.DateField()),
                ('to_date', models.DateField()),
                ('triggered_by', models.CharField(choices=[('schedule', 'Schedule'), ('admin', 'Admin')], default='admin', max_length=20)),
                ('status', models.CharField(choices=[('running', 'Running'), ('success', 'Success'), ('failed', 'Failed')], default='running', max_length=20)),
                ('hp_entries', models.PositiveIntegerField(default=0)),
                ('matched', models.PositiveIntegerField(default=0)),
                ('issues_open', models.PositiveIntegerField(default=0)),
                ('issues_new', models.PositiveIntegerField(default=0)),
                ('himalpay_balance_paisa', models.BigIntegerField(blank=True, null=True)),
                ('himalpay_bonus_balance_paisa', models.BigIntegerField(blank=True, null=True)),
                ('himalpay_balance_rupees', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('error_message', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('triggered_by_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='statement_reconcile_runs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Statement Reconcile Run',
                'verbose_name_plural': 'Statement Reconcile Runs',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='StatementDiscrepancy',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('issue_type', models.CharField(choices=[('status_mismatch', 'Status mismatch'), ('amount_mismatch', 'Amount mismatch'), ('missing_local', 'Missing in MySewa'), ('missing_provider', 'Missing in HimalPay'), ('wallet_not_applied', 'Wallet not applied')], db_index=True, max_length=40)),
                ('status', models.CharField(choices=[('open', 'Open'), ('resolved', 'Resolved'), ('ignored', 'Ignored')], db_index=True, default='open', max_length=20)),
                ('transaction_uuid', models.CharField(blank=True, db_index=True, default='', max_length=100)),
                ('merchant_txn_id', models.CharField(blank=True, db_index=True, default='', max_length=100)),
                ('wallet_service_name', models.CharField(blank=True, default='', max_length=80)),
                ('direction', models.CharField(blank=True, default='', max_length=10)),
                ('hp_status', models.CharField(blank=True, default='', max_length=20)),
                ('hp_amount', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=14)),
                ('hp_net_amount', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=14)),
                ('local_status', models.CharField(blank=True, default='', max_length=20)),
                ('local_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('txn_type', models.CharField(blank=True, choices=[('topup', 'Top-up'), ('data_pack', 'Data pack'), ('internet', 'Internet'), ('water', 'Water'), ('community_electricity', 'Community electricity'), ('bank_transfer', 'Bank transfer'), ('remittance', 'Remittance')], default='', max_length=40)),
                ('txn_id', models.PositiveIntegerField(blank=True, null=True)),
                ('himalpay_snapshot', models.JSONField(blank=True, default=dict)),
                ('suggested_adjustment_type', models.CharField(blank=True, choices=[('credit', 'Manual Load (Add Fund)'), ('debit', 'Debit')], default='', max_length=10)),
                ('suggested_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('reason', models.TextField(blank=True, default='')),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('resolution_adjustment', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='statement_discrepancies', to='core.walletadjustment')),
                ('resolved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='statement_discrepancies_resolved', to=settings.AUTH_USER_MODEL)),
                ('run', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='discrepancies', to='core.statementreconcilerun')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='statement_discrepancies', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Statement Discrepancy',
                'verbose_name_plural': 'Statement Discrepancies',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='statementdiscrepancy',
            index=models.Index(fields=['status', 'issue_type'], name='core_statem_status_4f0a8a_idx'),
        ),
        migrations.AddIndex(
            model_name='statementdiscrepancy',
            index=models.Index(fields=['transaction_uuid', 'issue_type', 'status'], name='core_statem_transac_7c2e1b_idx'),
        ),
    ]
