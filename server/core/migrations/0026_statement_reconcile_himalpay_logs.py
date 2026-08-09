from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_settings_deposit_qr_codes'),
    ]

    operations = [
        migrations.AddField(
            model_name='statementreconcilerun',
            name='himalpay_statement_logs',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
