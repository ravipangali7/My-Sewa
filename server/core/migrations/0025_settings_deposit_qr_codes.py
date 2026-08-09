from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_statement_reconcile'),
    ]

    operations = [
        migrations.AlterField(
            model_name='settings',
            name='qr_code',
            field=models.ImageField(
                blank=True,
                help_text='Bank deposit QR code image shown to customers',
                null=True,
                upload_to='settings/',
            ),
        ),
        migrations.AddField(
            model_name='settings',
            name='khalti_qr_code',
            field=models.ImageField(
                blank=True,
                help_text='Khalti deposit QR code image shown to customers',
                null=True,
                upload_to='settings/',
            ),
        ),
        migrations.AddField(
            model_name='settings',
            name='esewa_qr_code',
            field=models.ImageField(
                blank=True,
                help_text='eSewa deposit QR code image shown to customers',
                null=True,
                upload_to='settings/',
            ),
        ),
    ]
