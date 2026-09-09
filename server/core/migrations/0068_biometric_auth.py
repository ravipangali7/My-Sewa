from django.db import migrations, models
import django.db.models.deletion


class AddFieldIfMissing(migrations.AddField):
    """Skip when the column already exists (parallel 0068 already applied)."""

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


class CreateModelIfMissing(migrations.CreateModel):
    """Skip when the table already exists (parallel 0068 already applied)."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        if model._meta.db_table in schema_editor.connection.introspection.table_names():
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class AddIndexIfMissing(migrations.AddIndex):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        table = model._meta.db_table
        with schema_editor.connection.cursor() as cursor:
            constraints = schema_editor.connection.introspection.get_constraints(cursor, table)
        if self.index.name in constraints:
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0067_rename_core_checko_user_id_8b6f2a_idx_core_checko_user_id_d81a4a_idx'),
    ]

    operations = [
        AddFieldIfMissing(
            model_name='customuser',
            name='login_biometric_enabled',
            field=models.BooleanField(
                default=False,
                help_text='User preference: allow biometric login on enrolled devices. No biometric templates are stored.',
            ),
        ),
        AddFieldIfMissing(
            model_name='customuser',
            name='transaction_pin_biometric_enabled',
            field=models.BooleanField(
                default=False,
                help_text='User preference: allow biometric confirmation instead of typing the transaction PIN. No biometric templates are stored.',
            ),
        ),
        migrations.AlterField(
            model_name='securityauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('transaction_pin_set', 'Transaction PIN Set'),
                    ('transaction_pin_changed', 'Transaction PIN Changed'),
                    ('transaction_pin_reset', 'Transaction PIN Reset'),
                    ('transaction_pin_reset_otp_sent', 'Transaction PIN Reset OTP Sent'),
                    ('transaction_pin_admin_set', 'Transaction PIN Admin Set'),
                    ('phone_change_otp_sent', 'Phone Change OTP Sent'),
                    ('phone_changed', 'Phone Changed'),
                    ('email_change_otp_sent', 'Email Change OTP Sent'),
                    ('email_changed', 'Email Changed'),
                    ('login_otp_sent', 'Login OTP Sent'),
                    ('login_otp_verified', 'Login OTP Verified'),
                    ('dealer_created', 'Dealer Created'),
                    ('dealer_updated', 'Dealer Updated'),
                    ('dealer_status_changed', 'Dealer Status Changed'),
                    ('sub_agent_created', 'Sub-Agent Created'),
                    ('customer_mapped', 'Customer Mapped'),
                    ('customer_reassigned', 'Customer Reassigned'),
                    ('commission_changed', 'Commission Changed'),
                    ('tds_changed', 'TDS Changed'),
                    ('wallet_frozen', 'Wallet Frozen'),
                    ('wallet_unfrozen', 'Wallet Unfrozen'),
                    ('api_access_enabled', 'API Access Enabled'),
                    ('api_access_disabled', 'API Access Disabled'),
                    ('api_key_regenerated', 'API Key Regenerated'),
                    ('api_key_viewed', 'API Key Viewed'),
                    ('biometric_login', 'Biometric Login'),
                    ('biometric_login_enabled', 'Biometric Login Enabled'),
                    ('biometric_login_disabled', 'Biometric Login Disabled'),
                    ('biometric_pin_enabled', 'Transaction PIN Biometric Enabled'),
                    ('biometric_pin_disabled', 'Transaction PIN Biometric Disabled'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
        CreateModelIfMissing(
            name='BiometricDevice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('device_id', models.UUIDField(db_index=True, unique=True)),
                ('secret_hash', models.CharField(max_length=128)),
                ('login_enabled', models.BooleanField(default=False)),
                ('pin_enabled', models.BooleanField(default=False)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='biometric_devices',
                    to='core.customuser',
                )),
            ],
            options={
                'verbose_name': 'Biometric Device',
                'verbose_name_plural': 'Biometric Devices',
                'ordering': ['-updated_at'],
            },
        ),
        CreateModelIfMissing(
            name='BiometricAssertion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('purpose', models.CharField(
                    choices=[('transaction_pin', 'Transaction PIN')],
                    db_index=True,
                    default='transaction_pin',
                    max_length=32,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='biometric_assertions',
                    to='core.customuser',
                )),
            ],
            options={
                'verbose_name': 'Biometric Assertion',
                'verbose_name_plural': 'Biometric Assertions',
            },
        ),
        AddIndexIfMissing(
            model_name='biometricassertion',
            index=models.Index(
                fields=['user', 'purpose', 'used_at', 'expires_at'],
                name='core_biomet_user_id_purpose_idx',
            ),
        ),
    ]
