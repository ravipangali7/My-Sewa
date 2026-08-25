# WalletTransfer indexes were created under Django 6 auto-names (bf643e / d42619)
# when _ensure_wallet_transfer_table() built the table, or under the 0040 names
# (9c1e2a / 4b8f3c) when migrate ran. A plain RenameIndex fails if the old name
# is missing. This operation is idempotent on MariaDB.

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
        ('core', '0041_merge_wallet_transfer_and_citizenship_images'),
    ]

    operations = [
        RenameIndexIfExists(
            model_name='wallettransfer',
            new_name='core_wallet_sender__bf643e_idx',
            old_name='core_wallet_sender__9c1e2a_idx',
        ),
        RenameIndexIfExists(
            model_name='wallettransfer',
            new_name='core_wallet_recipie_d42619_idx',
            old_name='core_wallet_recipie_4b8f3c_idx',
        ),
    ]
