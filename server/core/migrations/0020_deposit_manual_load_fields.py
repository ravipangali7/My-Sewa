# Generated manually for Manual Wallet Load form fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0019_kyc_audit_action_choices'),
    ]

    operations = [
        migrations.AddField(
            model_name='deposit',
            name='transaction_id',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Bank / payment transaction ID provided by the user',
                max_length=120,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='deposit_date',
            field=models.DateField(
                blank=True,
                help_text='Date the user deposited funds to the company account',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='deposit',
            name='bank_name',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Optional bank name used for the deposit',
                max_length=120,
            ),
        ),
        migrations.AlterField(
            model_name='deposit',
            name='note',
            field=models.TextField(blank=True, help_text='Optional remarks from user', null=True),
        ),
    ]
