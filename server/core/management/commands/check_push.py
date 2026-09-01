"""
Diagnose Firebase / FCM configuration without printing secrets.

  python manage.py check_push
  python manage.py check_push --phone 98XXXXXXXX
  python manage.py check_push --phone 98XXXXXXXX --send
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.services.push import (
    is_push_configured,
    push_mode,
    push_status,
    send_push_to_user,
)


class Command(BaseCommand):
    help = 'Show Firebase push status and optionally send a test notification.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--phone',
            help='Look up DeviceToken rows for this account phone number.',
        )
        parser.add_argument(
            '--send',
            action='store_true',
            help='Send a test FCM notification to --phone (requires credentials).',
        )

    def handle(self, *args, **options):
        status = push_status()
        self.stdout.write(f"configured: {status.get('configured')}")
        self.stdout.write(f"mode: {status.get('mode')}")
        self.stdout.write(f"project_id: {status.get('project_id') or '-'}")
        self.stdout.write(f"real_device_tokens: {status.get('device_count', 0)}")
        self.stdout.write(f"stub_tokens: {status.get('stub_count', 0)}")
        self.stdout.write(f"users_with_tokens: {status.get('user_count', 0)}")
        for row in status.get('platform_counts') or []:
            self.stdout.write(f"  platform {row.get('platform')}: {row.get('count')}")

        if not is_push_configured():
            self.stderr.write(
                self.style.WARNING(
                    'Firebase is not configured. Place firebase-service.json on the '
                    'server or set FIREBASE_CREDENTIALS_PATH / FIREBASE_CREDENTIALS_JSON.'
                )
            )

        phone = (options.get('phone') or '').strip()
        if not phone:
            if options.get('send'):
                raise CommandError('--send requires --phone')
            return

        User = get_user_model()
        user = User.objects.filter(phone=phone).first()
        if user is None:
            raise CommandError(f'No user with phone {phone}')

        tokens = list(user.device_tokens.values_list('token', 'platform', 'updated_at'))
        self.stdout.write(f'user_id: {user.pk}')
        self.stdout.write(f'tokens: {len(tokens)}')
        for token, platform, updated_at in tokens:
            suffix = token[-8:] if token else ''
            self.stdout.write(
                f'  …{suffix} platform={platform} updated={updated_at} len={len(token or "")}'
            )

        if not options.get('send'):
            return
        if push_mode() == 'none':
            raise CommandError('Cannot send: Firebase credentials are missing.')
        sent = send_push_to_user(
            user,
            'MySewa test notification',
            'Firebase push is working on this device.',
            {
                'event': 'support_chat',
                'type': 'support_message',
                'screen': 'support_chat',
            },
        )
        self.stdout.write(self.style.SUCCESS(f'sent: {sent}'))
        if sent == 0:
            raise CommandError('Firebase was contacted but no device received the message.')
