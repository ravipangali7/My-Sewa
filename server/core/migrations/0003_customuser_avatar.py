from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_alter_customuser_managers'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='avatar',
            field=models.ImageField(
                blank=True,
                help_text='Profile picture',
                null=True,
                upload_to='avatars/',
            ),
        ),
    ]
