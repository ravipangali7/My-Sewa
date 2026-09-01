# System Charge wallet adjustment kind for Super Admin leftover.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0060_device_token_length'),
    ]

    operations = [
        migrations.AlterField(
            model_name='walletadjustment',
            name='kind',
            field=models.CharField(
                choices=[
                    ('manual', 'Manual load / debit'),
                    ('cashback', 'Cashback'),
                    ('dealer_commission', 'Dealer commission'),
                    ('system_charge', 'System charge'),
                ],
                db_index=True,
                default='manual',
                help_text=(
                    'manual = admin load; cashback = user rebate; '
                    'dealer_commission = dealer earning; '
                    'system_charge = Super Admin leftover.'
                ),
                max_length=20,
            ),
        ),
    ]
