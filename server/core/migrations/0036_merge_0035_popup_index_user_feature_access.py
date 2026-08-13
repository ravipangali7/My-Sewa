# Merge the two 0035 leaves: popup index rename (VPS) and user feature access (git)

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0035_rename_core_homepo_popup_i_7a2c1d_idx_core_homepo_popup_i_c3de12_idx'),
        ('core', '0035_user_feature_access'),
    ]

    operations = [
    ]
