import django.core.validators
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0078_customuser_api_partner_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='api_deposit_percent',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Custom Deposit API percentage cut for this user (default 2.50% if not set).',
                max_digits=5,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(Decimal('0')),
                    django.core.validators.MaxValueValidator(Decimal('100')),
                ],
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='api_withdraw_percent',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Custom Withdraw API percentage cut for this user (default 3.00% if not set).',
                max_digits=5,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(Decimal('0')),
                    django.core.validators.MaxValueValidator(Decimal('100')),
                ],
            ),
        ),
        migrations.AlterField(
            model_name='platformservicefeeconfig',
            name='payment_api_deposit_percent',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('2.50'),
                help_text='Percentage fee deducted from Payment API deposits (payins).',
                max_digits=5,
                validators=[
                    django.core.validators.MinValueValidator(Decimal('0')),
                    django.core.validators.MaxValueValidator(Decimal('100')),
                ],
            ),
        ),
        migrations.AlterField(
            model_name='platformservicefeeconfig',
            name='payment_api_withdraw_percent',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('3.00'),
                help_text='Percentage fee deducted from Payment API withdrawals (payouts).',
                max_digits=5,
                validators=[
                    django.core.validators.MinValueValidator(Decimal('0')),
                    django.core.validators.MaxValueValidator(Decimal('100')),
                ],
            ),
        ),
    ]
