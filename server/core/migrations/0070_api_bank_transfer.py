from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0069_merge_0068_biometric'),
    ]

    operations = [
        migrations.AddField(
            model_name='banktransfertransaction',
            name='source',
            field=models.CharField(
                choices=[('app', 'App'), ('api', 'API')],
                db_index=True,
                default='app',
                help_text='Whether this bank transfer was created from the app or the Bank Transfer API.',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='banktransfertransaction',
            name='client_reference',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Client-supplied idempotency/reference for API bank transfers.',
                max_length=64,
            ),
        ),
    ]
