# Merge the two 0043 leaves: remittance citizenship help-text (VPS) and
# dealer hierarchy / wallet freeze / commission (git).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0043_alter_remittancetransaction_citizenship_back_and_more'),
        ('core', '0043_dealer_hierarchy_freeze_commission'),
    ]

    operations = [
    ]
