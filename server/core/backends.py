"""
Custom authentication backend for phone-based authentication
"""
import logging
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model

User = get_user_model()
logger = logging.getLogger(__name__)


class PhoneBackend(ModelBackend):
    """
    Custom authentication backend that authenticates users using phone number.
    Since username is set to phone in the user model's save method,
    we can authenticate using either phone or username field.
    """
    
    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        Authenticate a user using phone number or username.
        
        Args:
            request: The HTTP request object
            username: Can be phone number or username (both are the same)
            password: The user's password
            **kwargs: Additional keyword arguments
            
        Returns:
            User object if authentication succeeds, None otherwise
        """
        if username is None:
            username = kwargs.get('phone') or kwargs.get(User.USERNAME_FIELD)
        
        if username is None or password is None:
            return None
        
        # Normalize username/phone (strip whitespace)
        username = username.strip() if username else username
        
        logger.debug(f"PhoneBackend: Attempting authentication for phone: {username[:3]}***")
        
        try:
            # Try to find user by phone (which is the USERNAME_FIELD)
            user = User.objects.get(phone=username)
            logger.debug(f"PhoneBackend: User found by phone - ID: {user.id}")
        except User.DoesNotExist:
            # Fallback: try to find by username (which should equal phone)
            try:
                user = User.objects.get(username=username)
                logger.debug(f"PhoneBackend: User found by username - ID: {user.id}")
            except User.DoesNotExist:
                # User not found
                logger.debug(f"PhoneBackend: User not found for phone: {username[:3]}***")
                return None
        except User.MultipleObjectsReturned:
            # Shouldn't happen if phone is unique, but handle it
            logger.warning(f"PhoneBackend: Multiple users found for phone: {username[:3]}***")
            user = User.objects.filter(phone=username).first()
        
        # Check if user is active
        if not user.is_active:
            logger.debug(f"PhoneBackend: User {user.id} is inactive")
            return None
        
        # Verify password
        if user.check_password(password):
            logger.debug(f"PhoneBackend: Password verified for user {user.id}")
            return user
        else:
            logger.debug(f"PhoneBackend: Password verification failed for user {user.id}")
        
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

