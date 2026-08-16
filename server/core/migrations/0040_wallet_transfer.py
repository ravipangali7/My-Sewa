from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0039_wallet_transaction_block_statement'),
    ]

    operations = [
        migrations.AlterField(
            model_name='customuser',
            name='can_wallet_adjust',
            field=models.BooleanField(
                db_index=True,
                default=True,
                help_text=(
                    'When enabled, this user can transfer wallet balance to another MySewa user. '
                    'Staff with this enabled can also perform admin wallet adjustments (manual load / debit).'
                ),
            ),
        ),
        migrations.CreateModel(
            name='WalletTransfer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(
                    decimal_places=2,
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0.01'))],
                )),
                ('remarks', models.CharField(blank=True, default='', max_length=255)),
                ('status', models.CharField(
                    choices=[('success', 'Success'), ('failed', 'Failed')],
                    default='success',
                    max_length=20,
                )),
                ('reference', models.CharField(max_length=100, unique=True)),
                ('sender_balance_before', models.DecimalField(decimal_places=2, max_digits=12)),
                ('sender_balance_after', models.DecimalField(decimal_places=2, max_digits=12)),
                ('recipient_balance_before', models.DecimalField(decimal_places=2, max_digits=12)),
                ('recipient_balance_after', models.DecimalField(decimal_places=2, max_digits=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('recipient', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='wallet_transfers_received',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('sender', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='wallet_transfers_sent',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Wallet Transfer',
                'verbose_name_plural': 'Wallet Transfers',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='wallettransfer',
            index=models.Index(fields=['sender', '-created_at'], name='core_wallet_sender__9c1e2a_idx'),
        ),
        migrations.AddIndex(
            model_name='wallettransfer',
            index=models.Index(fields=['recipient', '-created_at'], name='core_wallet_recipie_4b8f3c_idx'),
        ),
    ]
