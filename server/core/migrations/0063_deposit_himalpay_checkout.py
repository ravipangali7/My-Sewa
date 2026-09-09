from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0062_normalize_settings_app_version'),
    ]

    operations = [
        migrations.AddField(
            model_name='deposit',
            name='currency',
            field=models.CharField(blank=True, default='NPR', max_length=10),
        ),
        migrations.AddField(
            model_name='deposit',
            name='provider',
            field=models.CharField(
                choices=[
                    ('manual', 'Manual'),
                    ('himalpay_checkout', 'Himal Pay Checkout'),
                ],
                db_index=True,
                default='manual',
                help_text='manual = screenshot proof; himalpay_checkout = N-Cash Merchant Checkout',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='purchase_order_identifier',
            field=models.CharField(
                blank=True,
                help_text='Globally unique Checkout purchase_order_identifier',
                max_length=120,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='process_id',
            field=models.CharField(
                blank=True,
                help_text='Himal Pay Checkout process_id',
                max_length=64,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='payment_url',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='deposit',
            name='expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='deposit',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='deposit',
            name='verification_status',
            field=models.CharField(
                choices=[
                    ('unverified', 'Unverified'),
                    ('verified', 'Verified'),
                    ('mismatch', 'Amount / order mismatch'),
                    ('failed', 'Verification failed'),
                ],
                db_index=True,
                default='unverified',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='verified_amount',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='deposit',
            name='provider_payload',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='deposit',
            name='failure_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='deposit',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('processing', 'Processing'),
                    ('approved', 'Approved'),
                    ('rejected', 'Rejected'),
                    ('failed', 'Failed'),
                    ('cancelled', 'Cancelled'),
                    ('expired', 'Expired'),
                    ('refunded', 'Refunded'),
                ],
                default='pending',
                max_length=20,
            ),
        ),
    ]
