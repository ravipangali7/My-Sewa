# Generated manually for ElectricityBillTransaction (NEA)

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0030_home_popup'),
    ]

    operations = [
        migrations.CreateModel(
            name='ElectricityBillTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sc_no', models.CharField(max_length=50)),
                ('consumer_id', models.CharField(max_length=50)),
                ('office_code', models.CharField(max_length=100)),
                ('office_name', models.CharField(blank=True, default='', max_length=200)),
                ('customer_name', models.CharField(blank=True, default='', max_length=200)),
                ('session_id', models.CharField(blank=True, default='', max_length=100)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[MinValueValidator(0.01)])),
                ('pay_service', models.CharField(default='NEA_PAY', max_length=80)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('success', 'Success'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('merchant_txn_id', models.CharField(max_length=100, unique=True)),
                ('service_hub_txn_id', models.CharField(blank=True, max_length=100, null=True)),
                ('reference_id', models.CharField(blank=True, max_length=100, null=True)),
                ('charge', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('cashback', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('total_debited', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('balance_before', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('balance_after', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('inquiry_response', models.JSONField(blank=True, default=dict)),
                ('pay_payload', models.JSONField(blank=True, default=dict)),
                ('provider_response', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='electricity_bills', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Electricity Bill Transaction',
                'verbose_name_plural': 'Electricity Bill Transactions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AlterField(
            model_name='statementdiscrepancy',
            name='txn_type',
            field=models.CharField(
                blank=True,
                choices=[
                    ('topup', 'Top-up'),
                    ('data_pack', 'Data pack'),
                    ('internet', 'Internet'),
                    ('water', 'Water'),
                    ('electricity', 'Electricity'),
                    ('community_electricity', 'Community electricity'),
                    ('bank_transfer', 'Bank transfer'),
                    ('remittance', 'Remittance'),
                ],
                default='',
                max_length=40,
            ),
        ),
    ]
