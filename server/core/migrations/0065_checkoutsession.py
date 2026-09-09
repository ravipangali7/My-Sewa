from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0064_merge_0063_alter_and_0063_checkout'),
    ]

    operations = [
        migrations.CreateModel(
            name='CheckoutSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[django.core.validators.MinValueValidator(0.01)])),
                ('currency', models.CharField(blank=True, default='NPR', max_length=10)),
                ('status', models.CharField(
                    choices=[
                        ('awaiting_payment', 'Awaiting payment'),
                        ('settled', 'Settled'),
                        ('failed', 'Failed'),
                        ('cancelled', 'Cancelled'),
                        ('expired', 'Expired'),
                    ],
                    db_index=True,
                    default='awaiting_payment',
                    max_length=20,
                )),
                ('purchase_order_identifier', models.CharField(max_length=120, unique=True)),
                ('process_id', models.CharField(blank=True, max_length=64, null=True, unique=True)),
                ('payment_url', models.TextField(blank=True, default='')),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('provider_payload', models.JSONField(blank=True, default=dict)),
                ('failure_reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('deposit', models.OneToOneField(
                    blank=True,
                    help_text='Created only after Himal Pay confirms payment.status=completed',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='checkout_session',
                    to='core.deposit',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='checkout_sessions',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Checkout session',
                'verbose_name_plural': 'Checkout sessions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='checkoutsession',
            index=models.Index(fields=['user', 'status', 'amount'], name='core_checko_user_id_8b6f2a_idx'),
        ),
    ]
