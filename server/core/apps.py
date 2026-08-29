import sys

from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        import core.signals  # noqa

        if any(cmd in sys.argv for cmd in ('migrate', 'makemigrations', 'showmigrations')):
            return
        try:
            from core.models import (
                _ensure_authtoken_table,
                _ensure_electricity_bill_table,
                _ensure_remittance_citizenship_columns,
                _ensure_settings_app_update_columns,
                _ensure_settings_table,
                _ensure_support_chat_attachment_columns,
                _ensure_support_chat_tables,
                _ensure_wallet_transfer_table,
            )

            _ensure_authtoken_table()
            _ensure_settings_table()
            _ensure_settings_app_update_columns()
            _ensure_electricity_bill_table()
            _ensure_remittance_citizenship_columns()
            _ensure_wallet_transfer_table()
            _ensure_support_chat_tables()
            _ensure_support_chat_attachment_columns()
        except Exception:
            pass
