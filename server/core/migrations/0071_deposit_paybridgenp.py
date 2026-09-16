# Generated manually for PayBridgeNP deposit provider.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0070_api_bank_transfer'),
    ]

    operations = [
        migrations.AlterField(
            model_name='deposit',
            name='provider',
            field=models.CharField(
                choices=[
                    ('manual', 'Manual'),
                    ('himalpay_checkout', 'Himal Pay Checkout'),
                    ('paybridgenp', 'PayBridgeNP'),
                ],
                db_index=True,
                default='manual',
                help_text=(
                    'manual = screenshot proof; himalpay_checkout = N-Cash Checkout; '
                    'paybridgenp = PayBridgeNP hosted checkout'
                ),
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name='deposit',
            name='process_id',
            field=models.CharField(
                blank=True,
                help_text='Provider session id (HimalPay process_id or PayBridgeNP cs_…)',
                max_length=80,
                null=True,
                unique=True,
            ),
        ),
        migrations.AlterField(
            model_name='deposit',
            name='purchase_order_identifier',
            field=models.CharField(
                blank=True,
                help_text='Internal order / Checkout purchase_order_identifier',
                max_length=120,
                null=True,
                unique=True,
            ),
        ),
    ]
