from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0034_bank_transfer_commission_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='can_fund_transfer',
            field=models.BooleanField(
                db_index=True,
                default=True,
                help_text='When enabled, this user can perform fund transfers.',
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='can_wallet_adjust',
            field=models.BooleanField(
                db_index=True,
                default=True,
                help_text='When enabled, this user can perform wallet adjustments (manual load / debit).',
            ),
        ),
    ]
