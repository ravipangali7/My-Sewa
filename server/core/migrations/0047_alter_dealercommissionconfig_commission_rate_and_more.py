# Generated on the VPS in parallel with 0047_support_chat → 0049_dealer_payout_account.
# Help-text-only; schema is unchanged. Kept so both leaves can merge.

from decimal import Decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0046_merge_0045_apk_and_hierarchy'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dealercommissionconfig',
            name='commission_rate',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Percent of transaction amount paid as gross commission to this Dealer (or downline user).',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='dealercommissionconfig',
            name='tds_rate',
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text='Percent TDS deducted from gross dealer commission. Null = use global default.',
                max_digits=7,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
    ]
