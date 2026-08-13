import sys

from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        import core.signals  # noqa

        if any(cmd in sys.argv for cmd in ('migrate', 'makemigrations', 'showmigrations')):
            return
        try:
            from core.models import _ensure_authtoken_table, _ensure_electricity_bill_table

            _ensure_authtoken_table()
            _ensure_electricity_bill_table()
        except Exception:
            pass
