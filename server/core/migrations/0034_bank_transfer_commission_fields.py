# Store MySewa platform commission separately from HimalPay provider charge

from django.db import migrations, models


def backfill_platform_charge(apps, schema_editor):
    """Existing rows only stored combined `charge`; treat that as collected commission."""
    BankTransferTransaction = apps.get_model('core', 'BankTransferTransaction')
    BankTransferTransaction.objects.update(platform_charge=models.F('charge'))


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0033_transaction_pin_admin_set_action'),
    ]

    operations = [
        migrations.AddField(
            model_name='banktransfertransaction',
            name='platform_charge',
            field=models.DecimalField(
                decimal_places=2,
                default=0.0,
                help_text='MySewa commission collected on this transfer',
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name='banktransfertransaction',
            name='provider_charge',
            field=models.DecimalField(
                decimal_places=2,
                default=0.0,
                help_text='HimalPay / provider fee included in charge',
                max_digits=10,
            ),
        ),
        migrations.RunPython(backfill_platform_charge, migrations.RunPython.noop),
    ]
