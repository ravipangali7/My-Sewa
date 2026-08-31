# Per-user, per-service charges for Commission Setup.

import django.core.validators
import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0055_support_chat_attachments'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserServiceCharge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('txn_type', models.CharField(db_index=True, max_length=40)),
                ('charge_flat', models.DecimalField(
                    decimal_places=2,
                    default=Decimal('0.00'),
                    help_text='Flat service charge in Rs for this user on this service.',
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='service_charges',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'User Service Charge',
                'verbose_name_plural': 'User Service Charges',
            },
        ),
        migrations.AddIndex(
            model_name='userservicecharge',
            index=models.Index(fields=['user', 'txn_type'], name='core_usrchg_user_txn_idx'),
        ),
        migrations.AddConstraint(
            model_name='userservicecharge',
            constraint=models.UniqueConstraint(
                fields=('user', 'txn_type'),
                name='uniq_user_service_charge_txn',
            ),
        ),
    ]
