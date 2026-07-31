from django.db import migrations, models


def default_app_config():
    return {
        'site': {
            'site_name': 'MySewa',
            'tagline': 'Digital wallet & bill payments',
            'support_email': '',
            'support_phone': '',
            'address': '',
            'currency': 'NPR',
            'timezone': 'Asia/Kathmandu',
        },
        'payment': {
            'deposits_enabled': True,
            'topups_enabled': True,
            'transfers_enabled': True,
            'min_deposit': 100,
            'max_deposit': 100000,
            'deposit_instructions': '',
        },
        'transactions': {
            'min_topup': 10,
            'max_topup': 5000,
            'min_transfer': 10,
            'max_transfer': 100000,
            'topup_charge_percent': 0,
            'transfer_charge_enabled': True,
            'transfer_charge_flat': 0,
            'cashback_enabled': True,
            'transfer_cashback_flat': 0,
            'transfer_cashback_percent': 0,
            'daily_transfer_limit': 200000,
        },
        'notifications': {
            'email_on_deposit': True,
            'email_on_topup': False,
            'sms_on_deposit_approved': True,
            'admin_alert_email': '',
            'notify_low_balance': False,
            'low_balance_threshold': 100,
        },
        'security': {
            'require_deposit_screenshot': True,
            'max_failed_logins': 5,
            'session_timeout_minutes': 60,
            'maintenance_mode': False,
            'maintenance_message': '',
            'allow_new_registrations': True,
        },
    }


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_deposit_rejection_reason'),
    ]

    operations = [
        migrations.AddField(
            model_name='settings',
            name='config',
            field=models.JSONField(
                blank=True,
                default=default_app_config,
                help_text='Application-wide configuration',
            ),
        ),
    ]
