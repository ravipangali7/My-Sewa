# Generated manually for CustomUser.transaction_pin

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0011_internet_and_data_pack'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='transaction_pin',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Hashed transaction PIN (4–6 digits). Empty if not set.',
                max_length=128,
            ),
        ),
    ]
