# Parallel leaf created by `makemigrations` on another environment.
# Schema lives in 0068_biometric_auth; this file is a no-op so both names
# exist in the graph and can be merged.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0067_rename_core_checko_user_id_8b6f2a_idx_core_checko_user_id_d81a4a_idx'),
    ]

    operations = [
    ]
