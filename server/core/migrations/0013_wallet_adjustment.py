# Generated manually for WalletAdjustment

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_transaction_pin'),
    ]

    operations = [
        migrations.CreateModel(
            name='WalletAdjustment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, help_text='Signed delta: positive for credit, negative for debit', max_digits=10)),
                ('adjustment_type', models.CharField(choices=[('credit', 'Credit'), ('debit', 'Debit')], max_length=10)),
                ('balance_before', models.DecimalField(decimal_places=2, max_digits=10)),
                ('balance_after', models.DecimalField(decimal_places=2, max_digits=10)),
                ('reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('reference', models.CharField(blank=True, max_length=100, null=True, unique=True)),
                ('created_by', models.ForeignKey(blank=True, help_text='Admin who performed the adjustment', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='wallet_adjustments_created', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(help_text='Denormalized wallet owner for easy querying', on_delete=django.db.models.deletion.CASCADE, related_name='wallet_adjustments', to=settings.AUTH_USER_MODEL)),
                ('wallet', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='adjustments', to='core.wallet')),
            ],
            options={
                'verbose_name': 'Wallet Adjustment',
                'verbose_name_plural': 'Wallet Adjustments',
                'ordering': ['-created_at'],
            },
        ),
    ]
