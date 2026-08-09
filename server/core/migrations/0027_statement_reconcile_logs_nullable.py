from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0026_statement_reconcile_himalpay_logs'),
    ]

    operations = [
        migrations.AlterField(
            model_name='statementreconcilerun',
            name='himalpay_statement_logs',
            field=models.JSONField(blank=True, default=list, null=True),
        ),
    ]
