# Generated on the VPS in parallel with 0058_user_service_charge_cashback.
# Restores MinValueValidator on charge_percent / dealer_rate after 0057 omitted them.
# Kept so both 0058 leaves can merge.

from decimal import Decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0057_service_charge_type_and_split'),
    ]

    operations = [
        migrations.AlterField(
            model_name='servicecommissionrule',
            name='charge_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Dealer service charge as a percent of the transaction amount.',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='servicecommissionrule',
            name='dealer_rate',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat dealer service charge in Rs when charge type is flat.',
                max_digits=12,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AlterField(
            model_name='userservicecharge',
            name='charge_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='User service charge as a percent of the transaction amount.',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
    ]
