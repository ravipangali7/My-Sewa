# Generated manually for WaterBillTransaction and CommunityElectricityTransaction

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_customuser_nickname_business_name'),
    ]

    operations = [
        migrations.CreateModel(
            name='WaterBillTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('connection_no', models.CharField(max_length=50)),
                ('customer_code', models.CharField(max_length=50)),
                ('counter', models.CharField(max_length=100)),
                ('customer_name', models.CharField(blank=True, default='', max_length=200)),
                ('session_id', models.CharField(blank=True, default='', max_length=100)),
                ('payment_type', models.CharField(blank=True, default='Bill Payment', max_length=50)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[MinValueValidator(0.01)])),
                ('pay_service', models.CharField(default='KUKL_PAY', max_length=80)),
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
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='water_bills', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Water Bill Transaction',
                'verbose_name_plural': 'Water Bill Transactions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='CommunityElectricityTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform_id', models.CharField(max_length=50)),
                ('platform_name', models.CharField(max_length=100)),
                ('service_slug', models.CharField(blank=True, default='', max_length=150)),
                ('counter_code', models.CharField(blank=True, default='', max_length=100)),
                ('customer_ref', models.CharField(help_text='customer_number / customer_code / customer_no / consumer_no', max_length=100)),
                ('consumer_id', models.CharField(blank=True, default='', max_length=50)),
                ('customer_name', models.CharField(blank=True, default='', max_length=200)),
                ('month', models.IntegerField(blank=True, null=True)),
                ('session_id', models.CharField(blank=True, default='', max_length=100)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[MinValueValidator(0.01)])),
                ('pay_service', models.CharField(max_length=80)),
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
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='community_electricity_bills', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Community Electricity Transaction',
                'verbose_name_plural': 'Community Electricity Transactions',
                'ordering': ['-created_at'],
            },
        ),
    ]
