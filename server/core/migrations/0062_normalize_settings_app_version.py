from django.db import migrations


def normalize_settings_app_version(apps, schema_editor):
    Settings = apps.get_model('core', 'Settings')
    try:
        from core.services.app_version import normalize_app_version
    except Exception:
        return

    for row in Settings.objects.all():
        normalized = normalize_app_version(getattr(row, 'app_version', '') or '')[:32]
        if normalized != (row.app_version or ''):
            Settings.objects.filter(pk=row.pk).update(app_version=normalized)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0061_system_charge_wallet_kind'),
    ]

    operations = [
        migrations.RunPython(normalize_settings_app_version, noop_reverse),
    ]
