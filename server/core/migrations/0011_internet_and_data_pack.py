# Generated manually for InternetBillTransaction and DataPackTransaction

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_remittance_transaction'),
    ]

    operations = [
        migrations.CreateModel(
            name='InternetBillTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('isp_id', models.CharField(max_length=50)),
                ('isp_name', models.CharField(max_length=100)),
                ('customer_id', models.CharField(max_length=100)),
                ('customer_name', models.CharField(blank=True, default='', max_length=200)),
                ('package_name', models.CharField(blank=True, default='', max_length=255)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[MinValueValidator(0.01)])),
                ('pay_service', models.CharField(max_length=80)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('success', 'Success'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('merchant_txn_id', models.CharField(max_length=100, unique=True)),
                ('service_hub_txn_id', models.CharField(blank=True, max_length=100, null=True)),
                ('reference_id', models.CharField(blank=True, max_length=100, null=True)),
                ('charge', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('cashback', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('total_debited', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('inquiry_response', models.JSONField(blank=True, default=dict)),
                ('pay_payload', models.JSONField(blank=True, default=dict)),
                ('provider_response', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='internet_bills', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Internet Bill Transaction',
                'verbose_name_plural': 'Internet Bill Transactions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='DataPackTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('operator', models.CharField(choices=[('NTC', 'NTC'), ('NCELL', 'NCELL')], max_length=10)),
                ('mobile_number', models.CharField(max_length=50)),
                ('package_name', models.CharField(blank=True, default='', max_length=255)),
                ('package_id', models.CharField(blank=True, default='', max_length=50)),
                ('product_code', models.CharField(blank=True, default='', max_length=100)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[MinValueValidator(0.01)])),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('success', 'Success'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('merchant_txn_id', models.CharField(max_length=100, unique=True)),
                ('service_hub_txn_id', models.CharField(blank=True, max_length=100, null=True)),
                ('reference_id', models.CharField(blank=True, max_length=100, null=True)),
                ('charge', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('cashback', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('total_debited', models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                ('inquiry_response', models.JSONField(blank=True, default=dict)),
                ('provider_response', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='data_pack_transactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Data Pack Transaction',
                'verbose_name_plural': 'Data Pack Transactions',
                'ordering': ['-created_at'],
            },
        ),
    ]
