"""
Custom authentication backend for phone- and email-based authentication
"""
import logging
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model

User = get_user_model()
logger = logging.getLogger(__name__)


def _looks_like_email(value: str) -> bool:
    return '@' in (value or '')


class PhoneBackend(ModelBackend):
    """
    Custom authentication backend that authenticates users using phone number
    or email address. Phone remains the USERNAME_FIELD; email is an alternate
    login identifier.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        Authenticate a user using phone number, email, or username.

        Args:
            request: The HTTP request object
            username: Phone number, email, or username
            password: The user's password
            **kwargs: Additional keyword arguments (may include phone/email)

        Returns:
            User object if authentication succeeds, None otherwise
        """
        if username is None:
            username = (
                kwargs.get('phone')
                or kwargs.get('email')
                or kwargs.get(User.USERNAME_FIELD)
            )

        if username is None or password is None:
            return None

        username = username.strip() if username else username
        if not username:
            return None

        user = None
        if _looks_like_email(username):
            logger.debug(
                "PhoneBackend: Attempting authentication for email: %s***",
                username[:3],
            )
            matches = list(User.objects.filter(email__iexact=username)[:2])
            if len(matches) > 1:
                logger.warning(
                    "PhoneBackend: Multiple users found for email: %s***",
                    username[:3],
                )
            user = matches[0] if matches else None
            if user:
                logger.debug("PhoneBackend: User found by email - ID: %s", user.id)
            else:
                logger.debug(
                    "PhoneBackend: User not found for email: %s***",
                    username[:3],
                )
                return None
        else:
            logger.debug(
                "PhoneBackend: Attempting authentication for phone: %s***",
                username[:3],
            )
            try:
                user = User.objects.get(phone=username)
                logger.debug("PhoneBackend: User found by phone - ID: %s", user.id)
            except User.DoesNotExist:
                try:
                    user = User.objects.get(username=username)
                    logger.debug(
                        "PhoneBackend: User found by username - ID: %s", user.id
                    )
                except User.DoesNotExist:
                    logger.debug(
                        "PhoneBackend: User not found for phone: %s***",
                        username[:3],
                    )
                    return None
            except User.MultipleObjectsReturned:
                logger.warning(
                    "PhoneBackend: Multiple users found for phone: %s***",
                    username[:3],
                )
                user = User.objects.filter(phone=username).first()

        if user is None:
            return None

        if not user.is_active:
            logger.debug("PhoneBackend: User %s is inactive", user.id)
            return None

        if user.check_password(password):
            logger.debug("PhoneBackend: Password verified for user %s", user.id)
            return user

        logger.debug(
            "PhoneBackend: Password verification failed for user %s", user.id
        )
        return None

    def get_user(self, user_id):
        """
        Retrieve a user by ID.

        Args:
            user_id: The user's ID

        Returns:
            User object if found, None otherwise
        """
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

        return user if user.is_active else None
