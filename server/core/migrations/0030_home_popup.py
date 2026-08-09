from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0029_settings_app_version_apk'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='HomePopup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(blank=True, default='', max_length=200)),
                ('body', models.TextField(blank=True, default='')),
                ('image', models.ImageField(blank=True, help_text='Optional image shown in the home popup', null=True, upload_to='popups/')),
                ('max_per_24h', models.PositiveIntegerField(default=1, help_text='Maximum times each user may see this popup within a 24-hour window', validators=[django.core.validators.MinValueValidator(1)])),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('sort_order', models.IntegerField(default=0, help_text='Lower values are shown first when multiple popups are active')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Home Popup',
                'verbose_name_plural': 'Home Popups',
                'ordering': ['sort_order', '-id'],
            },
        ),
        migrations.CreateModel(
            name='HomePopupImpression',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('window_started_at', models.DateTimeField(help_text='Start of the current 24-hour counting window for this user')),
                ('view_count', models.PositiveIntegerField(default=0)),
                ('last_shown_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('popup', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='impressions', to='core.homepopup')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='popup_impressions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Home Popup Impression',
                'verbose_name_plural': 'Home Popup Impressions',
            },
        ),
        migrations.AddIndex(
            model_name='homepopupimpression',
            index=models.Index(fields=['popup', 'user'], name='core_homepo_popup_i_7a2c1d_idx'),
        ),
        migrations.AddConstraint(
            model_name='homepopupimpression',
            constraint=models.UniqueConstraint(fields=('popup', 'user'), name='uniq_home_popup_impression_user'),
        ),
    ]
