# Generated manually — restore Android auto-update fields on Settings (idempotent)

from django.db import migrations, models


def _existing_columns(schema_editor, table):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        return {
            col.name
            for col in connection.introspection.get_table_description(cursor, table)
        }


def add_auto_update_fields(apps, schema_editor):
    table = 'core_settings'
    connection = schema_editor.connection
    existing = _existing_columns(schema_editor, table)
    statements = []
    vendor = connection.vendor

    if 'auto_update_enabled' not in existing:
        if vendor == 'mysql':
            statements.append(
                "ALTER TABLE core_settings ADD COLUMN auto_update_enabled tinyint(1) NOT NULL DEFAULT 0"
            )
        elif vendor == 'sqlite':
            statements.append(
                "ALTER TABLE core_settings ADD COLUMN auto_update_enabled bool NOT NULL DEFAULT 0"
            )
        else:
            statements.append(
                "ALTER TABLE core_settings ADD COLUMN auto_update_enabled boolean NOT NULL DEFAULT FALSE"
            )

    if 'app_version' not in existing:
        statements.append(
            "ALTER TABLE core_settings ADD COLUMN app_version varchar(32) NOT NULL DEFAULT ''"
        )

    if 'apk' not in existing:
        statements.append(
            "ALTER TABLE core_settings ADD COLUMN apk varchar(255) NULL"
        )

    with connection.cursor() as cursor:
        for sql in statements:
            cursor.execute(sql)


def remove_auto_update_fields(apps, schema_editor):
    table = 'core_settings'
    connection = schema_editor.connection
    existing = _existing_columns(schema_editor, table)
    vendor = connection.vendor
    with connection.cursor() as cursor:
        for name in ('apk', 'app_version', 'auto_update_enabled'):
            if name not in existing:
                continue
            if vendor == 'sqlite':
                continue
            cursor.execute(f"ALTER TABLE core_settings DROP COLUMN {name}")


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0037_push_notification'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='settings',
                    name='auto_update_enabled',
                    field=models.BooleanField(
                        default=False,
                        help_text='When enabled, the Android app downloads and installs the APK if versions differ',
                    ),
                ),
                migrations.AddField(
                    model_name='settings',
                    name='app_version',
                    field=models.CharField(
                        blank=True,
                        default='',
                        help_text='Latest Android app version string compared with Flutter AppConstant.appVersion',
                        max_length=32,
                    ),
                ),
                migrations.AddField(
                    model_name='settings',
                    name='apk',
                    field=models.FileField(
                        blank=True,
                        help_text='Latest Android APK used for in-app auto updates',
                        max_length=255,
                        null=True,
                        upload_to='settings/apk/',
                    ),
                ),
            ],
            database_operations=[
                migrations.RunPython(add_auto_update_fields, remove_auto_update_fields),
            ],
        ),
    ]
