"""
Diagnose SMTP configuration and optionally send a test message.

  python manage.py test_smtp
  python manage.py test_smtp --to you@example.com
"""
from django.core.management.base import BaseCommand, CommandError

from core.services.smtp import (
    FALLBACK_SMTP,
    format_from_address,
    get_smtp_config,
    send_smtp_email,
)


class Command(BaseCommand):
    help = 'Show resolved SMTP config and optionally send a test email.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--to',
            help='Recipient for a live test email (defaults to the SMTP username).',
        )
        parser.add_argument(
            '--send',
            action='store_true',
            help='Actually send a test email (otherwise only prints resolved config).',
        )

    def handle(self, *args, **options):
        cfg = get_smtp_config()
        self.stdout.write(f"enabled: {cfg.get('enabled')}")
        self.stdout.write(f"host: {cfg.get('host')}")
        self.stdout.write(f"port: {cfg.get('port')}")
        self.stdout.write(f"encryption: {cfg.get('encryption')}")
        self.stdout.write(f"smtp_email: {cfg.get('smtp_email')}")
        self.stdout.write(f"from: {format_from_address(cfg)}")
        self.stdout.write(f"password_set: {bool(cfg.get('smtp_password'))}")
        self.stdout.write(
            f"using_builtin_fallback: "
            f"{(cfg.get('smtp_email') or '').lower() == FALLBACK_SMTP['smtp_email'].lower()}"
        )

        if not options['send'] and not options.get('to'):
            self.stdout.write(self.style.WARNING(
                'Pass --send (and optionally --to) to deliver a test message.'
            ))
            return

        to_email = (options.get('to') or cfg.get('smtp_email') or '').strip()
        if not to_email:
            raise CommandError('No recipient: pass --to or configure smtp_email.')

        ok = send_smtp_email(
            subject='[MySewa] SMTP test',
            text_body=(
                'This is a MySewa SMTP diagnostic message.\n'
                f'From: {format_from_address(cfg)}\n'
                f'Host: {cfg.get("host")}:{cfg.get("port")}\n'
            ),
            recipients=[to_email],
            fail_silently=False,
        )
        if ok:
            self.stdout.write(self.style.SUCCESS(f'Test email accepted by SMTP for {to_email}'))
        else:
            raise CommandError(f'SMTP did not accept the test email for {to_email}')
