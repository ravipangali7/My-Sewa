# Merge the two 0068 biometric leaves:
# 0068_biometric_auth (git) and 0068_customuser_login_biometric_enabled_and_more
# (auto-generated on another clone / the server).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0068_biometric_auth'),
        ('core', '0068_customuser_login_biometric_enabled_and_more'),
    ]

    operations = [
    ]
