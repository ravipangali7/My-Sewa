# Per-service Flat vs Percentage for users and dealers.

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0056_user_service_charge'),
    ]

    operations = [
        migrations.AddField(
            model_name='userservicecharge',
            name='charge_type',
            field=models.CharField(
                choices=[('flat', 'Flat amount'), ('percent', 'Percentage')],
                default='flat',
                help_text='How this user service charge is calculated (flat Rs or percent of amount).',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='userservicecharge',
            name='charge_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='User service charge as a percent of the transaction amount.',
                max_digits=7,
            ),
        ),
        migrations.AddField(
            model_name='servicecommissionrule',
            name='charge_type',
            field=models.CharField(
                choices=[('flat', 'Flat amount'), ('percent', 'Percentage')],
                default='flat',
                help_text='How this dealer service charge is calculated (flat Rs or percent of amount).',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='servicecommissionrule',
            name='charge_percent',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Dealer service charge as a percent of the transaction amount.',
                max_digits=7,
            ),
        ),
        migrations.AlterField(
            model_name='servicecommissionrule',
            name='dealer_rate',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Flat dealer service charge in Rs when charge type is flat.',
                max_digits=12,
            ),
        ),
    ]
