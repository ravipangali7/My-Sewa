"""
Custom management command to create a superuser with phone number
Usage: python manage.py createsuperadmin
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.db import IntegrityError

User = get_user_model()


class Command(BaseCommand):
    help = 'Create a superuser with phone number'

    def add_arguments(self, parser):
        parser.add_argument(
            '--phone',
            type=str,
            help='Phone number for the superuser',
        )
        parser.add_argument(
            '--password',
            type=str,
            help='Password for the superuser',
        )
        parser.add_argument(
            '--email',
            type=str,
            help='Email for the superuser (optional)',
        )
        parser.add_argument(
            '--noinput',
            action='store_true',
            help='Do not prompt for input (requires --phone and --password)',
        )

    def handle(self, *args, **options):
        phone = options.get('phone')
        password = options.get('password')
        email = options.get('email')
        noinput = options.get('noinput')

        if noinput:
            if not phone or not password:
                self.stdout.write(
                    self.style.ERROR('Error: --phone and --password are required when using --noinput')
                )
                return
        else:
            # Interactive mode
            if not phone:
                phone = self.get_input('Phone number: ')
            if not password:
                password = self.get_password()
            if not email:
                email = self.get_input('Email (optional, press Enter to skip): ', required=False)

        # Validate phone
        if not phone or phone.strip() == '':
            self.stdout.write(self.style.ERROR('Error: Phone number is required'))
            return

        phone = phone.strip()

        # Check if user already exists
        if User.objects.filter(phone=phone).exists():
            self.stdout.write(
                self.style.ERROR(f'Error: A user with phone number "{phone}" already exists')
            )
            return

        try:
            # Create superuser
            user = User.objects.create_superuser(
                phone=phone,
                password=password,
                email=email if email else '',
            )
            self.stdout.write(
                self.style.SUCCESS(f'Superuser created successfully with phone: {phone}')
            )
        except IntegrityError as e:
            self.stdout.write(
                self.style.ERROR(f'Error creating superuser: {str(e)}')
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Unexpected error: {str(e)}')
            )

    def get_input(self, prompt, required=True):
        """Get input from user"""
        while True:
            value = input(prompt).strip()
            if value or not required:
                return value
            self.stdout.write(self.style.WARNING('This field is required. Please try again.'))

    def get_password(self):
        """Get password from user with confirmation"""
        import getpass
        while True:
            password = getpass.getpass('Password: ')
            if not password:
                self.stdout.write(self.style.WARNING('Password cannot be empty. Please try again.'))
                continue
            
            password2 = getpass.getpass('Password (again): ')
            if password != password2:
                self.stdout.write(self.style.ERROR('Passwords do not match. Please try again.'))
                continue
            
            return password

