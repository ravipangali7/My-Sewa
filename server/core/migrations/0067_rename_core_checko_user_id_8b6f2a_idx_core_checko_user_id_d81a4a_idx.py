# CheckoutSession indexes were created as core_checko_user_id_8b6f2a_idx when
# migrate 0065 ran, or as core_checko_user_id_d81a4a_idx when
# _ensure_checkout_session_table() built the table with Django's auto-name.
# A plain RenameIndex fails on MariaDB if the old name is missing.

from django.db import migrations


class RenameIndexIfExists(migrations.RenameIndex):
    """Rename an index when the old name exists; no-op if already renamed."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        table = model._meta.db_table
        connection = schema_editor.connection
        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(cursor, table)
        if self.new_name in constraints:
            return
        if self.old_name in constraints:
            super().database_forwards(app_label, schema_editor, from_state, to_state)
            return
        for index in model._meta.indexes:
            if index.name == self.new_name:
                schema_editor.add_index(model, index)
                return


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0066_api_fund_transfer'),
    ]

    operations = [
        RenameIndexIfExists(
            model_name='checkoutsession',
            new_name='core_checko_user_id_d81a4a_idx',
            old_name='core_checko_user_id_8b6f2a_idx',
        ),
    ]
