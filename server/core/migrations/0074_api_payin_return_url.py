from django.db import migrations, models


class AddFieldIfMissing(migrations.AddField):
    """Skip when the column already exists (e.g. added manually or by a prior deploy)."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        table = model._meta.db_table
        field = model._meta.get_field(self.name)
        column = field.column
        with schema_editor.connection.cursor() as cursor:
            description = schema_editor.connection.introspection.get_table_description(
                cursor, table
            )
        existing = {getattr(col, 'name', col[0]) for col in description}
        if column in existing:
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0073_api_payin_developer_webhook'),
    ]

    operations = [
        AddFieldIfMissing(
            model_name='customuser',
            name='api_return_url',
            field=models.URLField(
                blank=True,
                default='',
                help_text=(
                    "Optional player browser return URL after a successful API Payin. "
                    "Use a game/app page (not the webhook API). Leave empty to show "
                    "MySewa's Payment Successful page."
                ),
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='api_webhook_url',
            field=models.URLField(
                blank=True,
                default='',
                help_text=(
                    "Developer callback URL for Payin (PayBridgeNP) results. "
                    "MySewa POSTs the verified payment outcome here after wallet credit. "
                    "Mapped via deposit.initiated_by — never taken from client redirect alone. "
                    "This is server-to-server only; the player browser is never sent here."
                ),
                max_length=500,
            ),
        ),
    ]
