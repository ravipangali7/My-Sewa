# Merge the two 0040 leaves: wallet transfer and remittance citizenship images.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0040_wallet_transfer'),
        ('core', '0040_remittance_citizenship_images'),
    ]

    operations = [
    ]
