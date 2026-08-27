# Merge the two 0045 leaves: Settings APK validator (VPS) and
# hierarchy commission / Super Admin profit (git).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0045_alter_settings_apk'),
        ('core', '0045_hierarchy_commission_profit'),
    ]

    operations = [
    ]
