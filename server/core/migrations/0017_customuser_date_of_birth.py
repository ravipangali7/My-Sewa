from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0016_user_fee_config'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='date_of_birth',
            field=models.DateField(
                blank=True,
                help_text='Date of birth (AD). Required for new registrations; nullable for legacy users.',
                null=True,
            ),
        ),
    ]
