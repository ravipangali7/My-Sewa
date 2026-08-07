from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0021_security_audit_log'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='nickname',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Display / profile nickname (editable after KYC).',
                max_length=60,
            ),
        ),
        migrations.AddField(
            model_name='customuser',
            name='business_name',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Business or shop name shown on the profile.',
                max_length=120,
            ),
        ),
    ]
