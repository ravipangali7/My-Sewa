# Merge the two leaves: VPS 0047_alter_dealercommissionconfig… and
# git 0047_support_chat → 0048_three_roles_service_charges → 0049_dealer_payout_account.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_alter_dealercommissionconfig_commission_rate_and_more'),
        ('core', '0049_dealer_payout_account'),
    ]

    operations = [
    ]
