"""
Reconcile HimalPay reseller statement against MySewa transactions.

Usage:
  python manage.py reconcile_himalpay_statement
  python manage.py reconcile_himalpay_statement --date 2026-08-09
  python manage.py reconcile_himalpay_statement --from 2026-08-01 --to 2026-08-09
"""
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import StatementReconcileRun
from core.services.himalpay import HimalPayError
from core.services.statement_reconcile import (
    default_reconcile_dates,
    run_statement_reconcile,
)


def _parse_day(value: str):
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError as exc:
        raise CommandError(f'Invalid date {value!r}; use YYYY-MM-DD') from exc


class Command(BaseCommand):
    help = 'Compare HimalPay reseller statement with MySewa transactions for a date range'

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            type=str,
            help='Single local calendar day (YYYY-MM-DD). Defaults to today.',
        )
        parser.add_argument(
            '--from',
            dest='from_date',
            type=str,
            help='Start date YYYY-MM-DD (inclusive)',
        )
        parser.add_argument(
            '--to',
            dest='to_date',
            type=str,
            help='End date YYYY-MM-DD (inclusive)',
        )

    def handle(self, *args, **options):
        day = options.get('date')
        from_raw = options.get('from_date')
        to_raw = options.get('to_date')

        if day and (from_raw or to_raw):
            raise CommandError('Use either --date or --from/--to, not both.')

        if from_raw or to_raw:
            if not from_raw or not to_raw:
                raise CommandError('Both --from and --to are required together.')
            from_date = _parse_day(from_raw)
            to_date = _parse_day(to_raw)
        elif day:
            from_date = to_date = _parse_day(day)
        else:
            from_date, to_date = default_reconcile_dates(timezone.localdate())

        self.stdout.write(
            f'Reconciling HimalPay statement {from_date} → {to_date} …'
        )
        try:
            run = run_statement_reconcile(
                from_date=from_date,
                to_date=to_date,
                triggered_by=StatementReconcileRun.TRIGGER_SCHEDULE,
            )
        except HimalPayError as exc:
            raise CommandError(f'HimalPay error: {exc}') from exc
        except Exception as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(
            f'Run #{run.pk}: status={run.status} hp_entries={run.hp_entries} '
            f'matched={run.matched} open={run.issues_open} new={run.issues_new}'
        ))
        if run.error_message:
            self.stderr.write(run.error_message)
