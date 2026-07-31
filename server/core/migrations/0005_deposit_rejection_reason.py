from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_himalpay_topup_and_bank_transfer'),
    ]

    operations = [
        migrations.AddField(
            model_name='deposit',
            name='rejection_reason',
            field=models.TextField(
                blank=True,
                help_text='Reason provided by admin when rejecting the deposit',
                null=True,
            ),
        ),
    ]
