# Generated on the VPS in parallel with 0043_dealer_hierarchy_freeze_commission.
# Help-text-only; schema is unchanged. Kept so both 0043 leaves can merge.

import core.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0042_rename_core_wallet_sender__9c1e2a_idx_core_wallet_sender__bf643e_idx_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='remittancetransaction',
            name='citizenship_back',
            field=models.ImageField(blank=True, help_text='Beneficiary citizenship back image submitted with the remittance payout.', null=True, upload_to=core.models.remittance_citizenship_back_upload),
        ),
        migrations.AlterField(
            model_name='remittancetransaction',
            name='citizenship_front',
            field=models.ImageField(blank=True, help_text='Beneficiary citizenship front image submitted with the remittance payout.', null=True, upload_to=core.models.remittance_citizenship_front_upload),
        ),
    ]
