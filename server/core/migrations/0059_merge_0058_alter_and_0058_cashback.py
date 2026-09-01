# Merge the two 0058 leaves: VPS validator alters and git user cashback fields.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0058_alter_servicecommissionrule_charge_percent_and_more'),
        ('core', '0058_user_service_charge_cashback'),
    ]

    operations = [
    ]
