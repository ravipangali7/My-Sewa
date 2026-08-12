# Generated manually — audit action for admin-set transaction PIN

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0032_remove_settings_app_update'),
    ]

    operations = [
        migrations.AlterField(
            model_name='securityauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('transaction_pin_set', 'Transaction PIN Set'),
                    ('transaction_pin_changed', 'Transaction PIN Changed'),
                    ('transaction_pin_reset', 'Transaction PIN Reset'),
                    ('transaction_pin_reset_otp_sent', 'Transaction PIN Reset OTP Sent'),
                    ('transaction_pin_admin_set', 'Transaction PIN Admin Set'),
                    ('phone_change_otp_sent', 'Phone Change OTP Sent'),
                    ('phone_changed', 'Phone Changed'),
                    ('email_change_otp_sent', 'Email Change OTP Sent'),
                    ('email_changed', 'Email Changed'),
                    ('login_otp_sent', 'Login OTP Sent'),
                    ('login_otp_verified', 'Login OTP Verified'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
    ]
