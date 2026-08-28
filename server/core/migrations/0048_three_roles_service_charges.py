from decimal import Decimal

from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


def convert_legacy_roles(apps, schema_editor):
    User = apps.get_model('core', 'CustomUser')
    User.objects.filter(role__in=('agent', 'sub_agent')).update(
        role='customer',
        parent_agent=None,
        assigned_sub_agent=None,
    )
    User.objects.filter(role='dealer').update(
        parent_agent=None,
        assigned_sub_agent=None,
        assigned_dealer=None,
    )
    User.objects.filter(role='customer').update(
        parent_agent=None,
        assigned_sub_agent=None,
    )


def seed_service_charges(apps, schema_editor):
    ServiceChargeConfig = apps.get_model('core', 'ServiceChargeConfig')
    Settings = apps.get_model('core', 'Settings')
    settings = Settings.objects.filter(pk=1).first()
    config = (settings.config if settings and isinstance(settings.config, dict) else {}) or {}
    tx = config.get('transactions') or {}
    commission = config.get('commission') or {}

    def dec(value, default='0'):
        try:
            return Decimal(str(value if value is not None else default))
        except Exception:
            return Decimal(default)

    topup_pct = dec(tx.get('topup_charge_percent', 0))
    transfer_flat = dec(tx.get('transfer_charge_flat', 0))
    transfer_pct = dec(tx.get('transfer_charge_percent', 0))
    dealer_pct = dec(commission.get('default_commission_rate', 0))

    types = (
        'topup', 'data_pack', 'internet', 'water', 'electricity',
        'community_electricity', 'bank_transfer', 'remittance', 'wallet_transfer',
    )
    for txn_type in types:
        system_flat = Decimal('0.00')
        system_percent = Decimal('0.0000')
        if txn_type in ('topup', 'data_pack'):
            system_percent = topup_pct
        if txn_type in ('bank_transfer', 'wallet_transfer'):
            system_flat = transfer_flat
            system_percent = transfer_pct
        ServiceChargeConfig.objects.get_or_create(
            txn_type=txn_type,
            defaults={
                'system_charge_flat': system_flat,
                'system_charge_percent': system_percent,
                'dealer_commission_flat': Decimal('0.00'),
                'dealer_commission_percent': dealer_pct,
                'himalpay_charge_flat': Decimal('0.00'),
                'himalpay_charge_percent': Decimal('0.0000'),
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_support_chat'),
    ]

    operations = [
        migrations.RunPython(convert_legacy_roles, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='customuser',
            name='role',
            field=models.CharField(
                choices=[('customer', 'User'), ('dealer', 'Dealer')],
                db_index=True,
                default='customer',
                help_text='Business role: Admin (staff) → Dealer → User. A User may optionally be assigned to a Dealer.',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='assigned_dealer',
            field=models.ForeignKey(
                blank=True,
                help_text='Optional Dealer this User belongs to. Used for commission. Not required.',
                limit_choices_to={'role': 'dealer'},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='network_users',
                to='core.customuser',
            ),
        ),
        migrations.AddField(
            model_name='wallettransfer',
            name='charge',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.AddField(
            model_name='wallettransfer',
            name='total_debited',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='wallet_credited',
            field=models.BooleanField(
                default=False,
                help_text='True when net dealer commission was credited to the Dealer wallet.',
            ),
        ),
        migrations.CreateModel(
            name='ServiceChargeConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('txn_type', models.CharField(
                    choices=[
                        ('topup', 'Mobile top-up'),
                        ('data_pack', 'Data pack'),
                        ('internet', 'Internet / WiFi'),
                        ('water', 'Water'),
                        ('electricity', 'Electricity'),
                        ('community_electricity', 'Community electricity'),
                        ('bank_transfer', 'Bank / fund transfer'),
                        ('remittance', 'Remittance'),
                        ('wallet_transfer', 'Wallet transfer'),
                    ],
                    db_index=True,
                    max_length=40,
                    unique=True,
                )),
                ('system_charge_flat', models.DecimalField(
                    decimal_places=2, default=Decimal('0.00'), max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('system_charge_percent', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('dealer_commission_flat', models.DecimalField(
                    decimal_places=2, default=Decimal('0.00'), max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('dealer_commission_percent', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('himalpay_charge_flat', models.DecimalField(
                    decimal_places=2, default=Decimal('0.00'), max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('himalpay_charge_percent', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Service Charge Config',
                'verbose_name_plural': 'Service Charge Configs',
                'ordering': ['txn_type'],
            },
        ),
        migrations.CreateModel(
            name='TransactionCharge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('txn_type', models.CharField(db_index=True, max_length=40)),
                ('txn_id', models.PositiveIntegerField()),
                ('amount', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('system_charge', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('dealer_commission', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('himalpay_charge', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('total_charges', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('cashback', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('wallet_amount', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('direction', models.CharField(
                    choices=[('debit', 'Debit'), ('credit', 'Credit')],
                    default='debit',
                    max_length=10,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('dealer', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='transaction_charges',
                    to='core.customuser',
                )),
            ],
            options={
                'verbose_name': 'Transaction Charge',
                'verbose_name_plural': 'Transaction Charges',
            },
        ),
        migrations.AddConstraint(
            model_name='transactioncharge',
            constraint=models.UniqueConstraint(fields=('txn_type', 'txn_id'), name='uniq_txn_charge_txn'),
        ),
        migrations.AddIndex(
            model_name='transactioncharge',
            index=models.Index(fields=['txn_type', '-created_at'], name='core_txnchg_type__idx'),
        ),
        migrations.AddIndex(
            model_name='transactioncharge',
            index=models.Index(fields=['dealer', '-created_at'], name='core_txnchg_dealer__idx'),
        ),
        migrations.RunPython(seed_service_charges, migrations.RunPython.noop),
    ]
