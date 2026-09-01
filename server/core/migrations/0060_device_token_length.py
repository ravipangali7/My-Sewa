from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0059_merge_0058_alter_and_0058_cashback'),
    ]

    operations = [
        migrations.AlterField(
            model_name='devicetoken',
            name='token',
            field=models.CharField(db_index=True, max_length=1024, unique=True),
        ),
    ]
