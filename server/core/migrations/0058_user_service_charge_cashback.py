# Per-service customer cashback (customer commission) and Active/Inactive status.

from decimal import Decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0057_service_charge_type_and_split'),
    ]

    operations = [
        migrations.AddField(
            model_name='userservicecharge',
            name='cashback_type',
            field=models.CharField(
                choices=[('flat', 'Flat amount'), ('percent', 'Percentage')],
                default='flat',
                help_text='How customer cashback (customer commission) is calculated.',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='userservicecharge',
            name='cashback_flat',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat customer cashback in Rs for this user on this service.',
                max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='userservicecharge',
            name='cashback_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Customer cashback as a percent of the transaction amount.',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='userservicecharge',
            name='is_active',
            field=models.BooleanField(
                default=True,
                help_text='Inactive setups skip this user service charge and cashback.',
            ),
        ),
    ]
