# Generated manually for Commission & Charge setup.

from decimal import Decimal

import django.core.validators
from django.db import migrations, models


def infer_charge_types(apps, schema_editor):
    ServiceChargeConfig = apps.get_model('core', 'ServiceChargeConfig')
    zero = Decimal('0.00')
    for row in ServiceChargeConfig.objects.all():
        if (row.system_charge_percent or zero) > 0 and (row.system_charge_flat or zero) == 0:
            row.user_charge_type = 'percent'
        else:
            row.user_charge_type = 'flat'
        if (row.dealer_commission_percent or zero) > 0 and (row.dealer_commission_flat or zero) == 0:
            row.dealer_charge_type = 'percent'
        else:
            row.dealer_charge_type = 'flat'
        row.save(update_fields=['user_charge_type', 'dealer_charge_type'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0052_flat_dealer_commission'),
    ]

    operations = [
        migrations.AddField(
            model_name='userfeeconfig',
            name='cashback_flat',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat cashback in Rs credited to this user after a successful transaction.',
                max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='servicechargeconfig',
            name='user_charge_type',
            field=models.CharField(
                choices=[('flat', 'Flat amount'), ('percent', 'Percentage')],
                default='flat',
                help_text='How the User service charge is calculated.',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='servicechargeconfig',
            name='dealer_charge_type',
            field=models.CharField(
                choices=[('flat', 'Flat amount'), ('percent', 'Percentage')],
                default='flat',
                help_text='How the network fee is calculated for dealer-network customers.',
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name='servicechargeconfig',
            name='system_charge_flat',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat User service charge in Rs (when type is flat).',
                max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='servicechargeconfig',
            name='system_charge_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='User service charge as a percent of the transaction amount.',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='servicechargeconfig',
            name='dealer_commission_flat',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat network fee in Rs. Applied when the User has an assigned Dealer.',
                max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='servicechargeconfig',
            name='dealer_commission_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Network fee as a percent of the transaction amount (when type is percent).',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='walletadjustment',
            name='kind',
            field=models.CharField(
                choices=[
                    ('manual', 'Manual load / debit'),
                    ('cashback', 'Cashback'),
                    ('dealer_commission', 'Dealer commission'),
                ],
                db_index=True,
                default='manual',
                help_text='manual = admin load; cashback = user rebate; dealer_commission = dealer earning.',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='walletadjustment',
            name='source_txn_type',
            field=models.CharField(blank=True, default='', max_length=40),
        ),
        migrations.AddField(
            model_name='walletadjustment',
            name='source_txn_id',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='walletadjustment',
            index=models.Index(
                fields=['kind', 'source_txn_type', 'source_txn_id'],
                name='core_walletadj_src_idx',
            ),
        ),
        migrations.AddField(
            model_name='transactioncharge',
            name='cashback_credited',
            field=models.BooleanField(
                default=False,
                help_text='True when the user cashback has been posted as a separate wallet credit.',
            ),
        ),
        migrations.RunPython(infer_charge_types, migrations.RunPython.noop),
    ]
