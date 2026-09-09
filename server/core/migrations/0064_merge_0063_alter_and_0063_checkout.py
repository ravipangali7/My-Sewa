# Merge the two 0063 leaves: Settings app_version help_text (VPS) and
# Himal Pay Checkout deposit fields (git).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0063_alter_settings_app_version_and_more'),
        ('core', '0063_deposit_himalpay_checkout'),
    ]

    operations = [
    ]
