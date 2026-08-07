"""
Authentication views: Registration, Login, Logout, Profile
"""
import logging
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate, get_user_model
from ..serializers import (
    UserSerializer,
    UserProfileSerializer,
    UserProfileUpdateSerializer,
    ChangePasswordSerializer,
    ChangePhoneSerializer,
    RequestChangePhoneOtpSerializer,
    RequestEmailChangeSerializer,
    ConfirmEmailChangeSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    SetTransactionPinSerializer,
    ChangeTransactionPinSerializer,
    ResetTransactionPinSerializer,
    VerifyTransactionPinSerializer,
    DeviceTokenSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)


def format_validation_errors(errors):
    """Format DRF validation errors into a user-friendly structure"""
    error_messages = []
    error_dict = {}
    
    # Convert DRF error dictionary to readable format
    for field, field_errors in errors.items():
        if isinstance(field_errors, list):
            # Join multiple errors for the same field
            field_error_msg = ' '.join(str(err) for err in field_errors)
            error_messages.append(f"{field.replace('_', ' ').title()}: {field_error_msg}")
            error_dict[field] = [str(err) for err in field_errors]
        else:
            # Single error (shouldn't happen with DRF, but handle it)
            error_messages.append(f"{field.replace('_', ' ').title()}: {str(field_errors)}")
            error_dict[field] = [str(field_errors)]
    
    # Create a general message
    if error_messages:
        general_message = 'Validation failed. ' + ' '.join(error_messages)
    else:
        general_message = 'Validation failed'
    
    return {
        'message': general_message,
        'errors': error_dict,
        'error_list': error_messages
    }


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    """User registration endpoint"""
    from ..services.app_config import get_app_config

    security = get_app_config().get('security') or {}
    if not security.get('allow_new_registrations', True):
        return Response({
            'error': 'registrations_disabled',
            'message': 'New registrations are currently disabled.',
            'detail': 'Please contact support if you need an account.',
        }, status=status.HTTP_403_FORBIDDEN)

    if security.get('maintenance_mode'):
        return Response({
            'error': 'maintenance_mode',
            'message': security.get('maintenance_message')
                or 'MySewa is under maintenance. Please try again later.',
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Handle username field from Flutter app - use it as phone if phone is missing
    data = request.data.copy()
    
    # If username is provided but phone is not, use username as phone
    if 'username' in data and data.get('username') and not data.get('phone'):
        data['phone'] = data['username']
    
    # Normalize phone number: strip whitespace for consistency
    if 'phone' in data and data.get('phone'):
        data['phone'] = data['phone'].strip()
    
    # Remove username from data as it's not needed (phone is the USERNAME_FIELD)
    data.pop('username', None)
    
    serializer = UserSerializer(data=data)
    if serializer.is_valid():
        user = serializer.save()
        token, created = Token.objects.get_or_create(user=user)
        try:
            from ..services.notifications import notify_welcome_signup
            notify_welcome_signup(user)
        except Exception:
            logger.exception('Welcome email failed for user %s', getattr(user, 'pk', None))
        return Response({
            'message': 'User registered successfully',
            'token': token.key,
            'user': {
                'id': user.id,
                'phone': user.phone,  # phone is the authentication field
                'email': user.email if user.email else '',
                'date_of_birth': user.date_of_birth.isoformat() if user.date_of_birth else None,
                'has_transaction_pin': bool(user.transaction_pin),
            }
        }, status=status.HTTP_201_CREATED)
    
    # Format validation errors for better frontend compatibility
    formatted_errors = format_validation_errors(serializer.errors)
    return Response(formatted_errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """
    User login endpoint - returns DRF token (uses phone as authentication field)
    Uses custom PhoneBackend for authentication with comprehensive logging
    """
    from django.core.cache import cache
    from ..services.app_config import get_app_config

    # Accept both 'phone' and 'username' for backward compatibility
    phone = request.data.get('phone') or request.data.get('username')
    password = request.data.get('password')

    logger.info(f"Login attempt received - Phone: {phone[:3]}*** (masked)" if phone else "Login attempt with empty phone")

    # Validate input
    if not phone or not password:
        logger.warning("Login attempt failed: Missing phone or password")
        return Response({
            'error': 'Phone number and password are required',
            'message': 'Phone number and password are required',
            'detail': 'Please provide both phone number and password to login'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Normalize phone number: strip whitespace
    phone = phone.strip() if phone else phone
    logger.debug(f"Normalized phone number: {phone[:3]}***")

    security = get_app_config().get('security') or {}
    max_failed = int(security.get('max_failed_logins') or 0)
    fail_key = f'failed_login:{phone}'
    if max_failed > 0:
        fails = int(cache.get(fail_key) or 0)
        if fails >= max_failed:
            return Response({
                'error': 'account_locked',
                'message': 'Too many failed login attempts. Please try again later.',
                'detail': f'Account temporarily locked after {max_failed} failed attempts.',
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    # Use Django's authenticate() with custom PhoneBackend
    # The backend will handle user lookup, active check, and password verification
    try:
        user = authenticate(request=request, username=phone, password=password)
        
        if user is not None:
            # Authentication successful
            logger.info(f"Login successful for user ID: {user.id}, Phone: {user.phone[:3]}***")
            cache.delete(fail_key)

            # Staff can always log in during maintenance; customers are blocked
            if security.get('maintenance_mode') and not (user.is_staff or user.is_superuser):
                return Response({
                    'error': 'maintenance_mode',
                    'message': security.get('maintenance_message')
                        or 'MySewa is under maintenance. Please try again later.',
                    'code': 'maintenance_mode',
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

            # Get or create token
            token, created = Token.objects.get_or_create(user=user)
            if created:
                logger.debug(f"New token created for user ID: {user.id}")
            else:
                logger.debug(f"Existing token retrieved for user ID: {user.id}")

            # Seed session activity for timeout middleware
            timeout_minutes = int(security.get('session_timeout_minutes') or 0)
            if timeout_minutes > 0:
                import time
                cache.set(
                    f'session_activity:{token.key}',
                    time.time(),
                    timeout=timeout_minutes * 60 + 300,
                )

            return Response({
                'message': 'Login successful',
                'token': token.key,
                'user': {
                    'id': user.id,
                    'phone': user.phone,
                    'email': user.email if user.email else '',
                    'first_name': user.first_name,
                    'last_name': user.last_name,
                    'is_staff': user.is_staff,
                    'is_superuser': user.is_superuser,
                    'account_status': user.account_status,
                }
            }, status=status.HTTP_200_OK)
        else:
            # Authentication failed - user not found, inactive, or wrong password
            logger.warning(f"Login failed for phone: {phone[:3]}*** - Invalid credentials")
            if max_failed > 0:
                cache.set(fail_key, int(cache.get(fail_key) or 0) + 1, timeout=60 * 30)
            
            # Try to get more specific error information
            try:
                user = User.objects.get(phone=phone)
                if not user.is_active:
                    logger.warning(f"Login failed: User {user.id} is inactive")
                    return Response({
                        'error': 'Account is inactive',
                        'message': 'Your account has been deactivated',
                        'detail': 'Your account has been deactivated. Please contact support.'
                    }, status=status.HTTP_401_UNAUTHORIZED)
                else:
                    logger.warning(f"Login failed: Incorrect password for user {user.id}")
                    return Response({
                        'error': 'Invalid credentials',
                        'message': 'Incorrect password',
                        'detail': 'The password you entered is incorrect. Please try again.'
                    }, status=status.HTTP_401_UNAUTHORIZED)
            except User.DoesNotExist:
                logger.warning(f"Login failed: User not found with phone: {phone[:3]}***")
                return Response({
                    'error': 'Invalid credentials',
                    'message': 'No user found with this phone number',
                    'detail': 'The phone number you entered is not registered. Please check and try again.'
                }, status=status.HTTP_401_UNAUTHORIZED)
            except Exception as e:
                logger.error(f"Unexpected error during login: {str(e)}")
                return Response({
                    'error': 'Invalid credentials',
                    'message': 'Authentication failed',
                    'detail': 'An unexpected error occurred during authentication. Please try again.'
                }, status=status.HTTP_401_UNAUTHORIZED)
                
    except Exception as e:
        logger.error(f"Exception during authentication: {str(e)}", exc_info=True)
        return Response({
            'error': 'Authentication error',
            'message': 'An error occurred during authentication',
            'detail': 'An error occurred during authentication. Please try again.'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    """User logout endpoint - deletes token"""
    try:
        request.user.auth_token.delete()
        return Response({
            'message': 'Logout successful'
        }, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({
            'error': 'Logout failed'
        }, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def profile(request):
    """Get or update current user's profile information (supports avatar upload)"""
    if request.method == 'GET':
        serializer = UserProfileSerializer(request.user, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    # PUT or PATCH
    from ..models import KYCAuditLog
    from ..services.kyc import (
        PROFILE_IDENTITY_LOCKED_FIELDS,
        collect_locked_field_errors,
        is_profile_locked,
        log_kyc_audit,
    )

    user = request.user
    before = {
        field: getattr(user, field)
        for field in ('email', 'first_name', 'last_name', 'date_of_birth', 'citizenship_number')
    }
    before['avatar'] = bool(user.avatar)

    serializer = UserProfileUpdateSerializer(
        user, data=request.data, partial=True
    )
    if not serializer.is_valid():
        # Audit blocked attempts to change locked identity fields.
        if is_profile_locked(user):
            proposed = {
                field: request.data.get(field)
                for field in PROFILE_IDENTITY_LOCKED_FIELDS
                if field in request.data
            }
            lock_errors = collect_locked_field_errors(user, proposed)
            if lock_errors:
                log_kyc_audit(
                    user=user,
                    action=KYCAuditLog.ACTION_PROFILE_LOCK_BLOCKED,
                    actor=user,
                    details={
                        'fields': list(lock_errors.keys()),
                        'attempted': {
                            k: str(v) if v is not None else None
                            for k, v in proposed.items()
                        },
                    },
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    serializer.save()
    user.refresh_from_db()
    changed = {}
    for field, old in before.items():
        if field == 'avatar':
            new_val = bool(user.avatar)
        else:
            new_val = getattr(user, field)
        if old != new_val:
            changed[field] = {
                'from': str(old) if old is not None else None,
                'to': str(new_val) if new_val is not None else None,
            }
    if changed:
        log_kyc_audit(
            user=user,
            action=KYCAuditLog.ACTION_PROFILE_UPDATED,
            actor=user,
            details={'changed_fields': changed},
        )

    profile_serializer = UserProfileSerializer(
        user, context={'request': request}
    )
    return Response({
        'message': 'Profile updated successfully',
        'user': profile_serializer.data
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """Change the authenticated user's password"""
    serializer = ChangePasswordSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(serializer.validated_data['current_password']):
        return Response({
            'message': 'Current password is incorrect',
            'errors': {'current_password': ['Current password is incorrect']},
        }, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(serializer.validated_data['new_password'])
    user.save()
    # Keep existing session token valid after password change
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)

    return Response({
        'message': 'Password changed successfully',
        'token': token.key,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_change_phone_otp(request):
    """
    Verify password + new phone, then email an OTP to the current registered email.
    """
    import secrets
    from django.conf import settings as dj_settings
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.notifications import mask_email, send_phone_change_otp
    from ..services.security import log_security_event

    serializer = RequestChangePhoneOtpSerializer(
        data=request.data, context={'request': request},
    )
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(serializer.validated_data['current_password']):
        return Response({
            'message': 'Current password is incorrect',
            'errors': {'current_password': ['Current password is incorrect']},
        }, status=status.HTTP_400_BAD_REQUEST)

    email = (user.email or '').strip()
    if not email:
        return Response({
            'message': (
                'No email is registered for this account. '
                'Add and verify an email before changing your phone number.'
            ),
            'errors': {
                'email': [
                    'No registered email on this account. Update your email first.',
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    new_phone = serializer.validated_data['new_phone']
    otp = f'{secrets.randbelow(1_000_000):06d}'
    otp_timeout = int(getattr(dj_settings, 'PHONE_CHANGE_OTP_TIMEOUT', 120))
    cache.set(
        f'phone_change_otp:{user.pk}',
        {'otp': str(otp), 'new_phone': new_phone},
        timeout=otp_timeout,
    )

    sent = send_phone_change_otp(email, otp, new_phone)
    if not sent:
        logger.error('Failed to send phone change OTP for user_id=%s', user.pk)
        cache.delete(f'phone_change_otp:{user.pk}')
        return Response({
            'message': 'Unable to send verification code. Please try again later.',
            'errors': {'email': ['Unable to send verification code. Please try again later.']},
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    email_hint = mask_email(email)
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_PHONE_CHANGE_OTP_SENT,
        request=request,
        details={'email_hint': email_hint, 'new_phone': new_phone},
    )

    payload = {
        'message': (
            f'A verification code has been sent to {email_hint}. '
            'Enter the code to finish changing your phone number.'
        ),
        'email_hint': email_hint,
        'expires_in': otp_timeout,
    }
    if getattr(dj_settings, 'DEBUG', False):
        payload['debug_otp'] = otp
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_phone(request):
    """Change the authenticated user's phone number (password + email OTP)."""
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.security import log_security_event

    serializer = ChangePhoneSerializer(
        data=request.data, context={'request': request}
    )
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(serializer.validated_data['current_password']):
        return Response({
            'message': 'Current password is incorrect',
            'errors': {'current_password': ['Current password is incorrect']},
        }, status=status.HTTP_400_BAD_REQUEST)

    cached = cache.get(f'phone_change_otp:{user.pk}')
    if not cached or not isinstance(cached, dict):
        return Response({
            'message': 'OTP expired. Please request a new code.',
            'errors': {'otp': ['OTP expired']},
        }, status=status.HTTP_400_BAD_REQUEST)

    if str(cached.get('otp') or '') != str(serializer.validated_data['otp']):
        return Response({
            'message': 'Invalid verification code',
            'errors': {'otp': ['Invalid verification code']},
        }, status=status.HTTP_400_BAD_REQUEST)

    new_phone = serializer.validated_data['new_phone']
    if cached.get('new_phone') != new_phone:
        return Response({
            'message': 'Phone number does not match the verification request. Start again.',
            'errors': {'new_phone': ['Phone number does not match the verification request.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    old_phone = user.phone
    user.phone = new_phone
    user.save()  # username synced to phone in model.save()
    cache.delete(f'phone_change_otp:{user.pk}')

    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_PHONE_CHANGED,
        request=request,
        details={'old_phone': old_phone, 'new_phone': new_phone},
    )

    profile_serializer = UserProfileSerializer(user, context={'request': request})
    return Response({
        'message': 'Phone number updated successfully',
        'user': profile_serializer.data,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_email_change(request):
    """Send an OTP to the current registered email to start an email change request."""
    import secrets
    from django.conf import settings as dj_settings
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.notifications import mask_email, send_email_change_otp
    from ..services.security import log_security_event

    serializer = RequestEmailChangeSerializer(
        data=request.data, context={'request': request},
    )
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(serializer.validated_data['current_password']):
        return Response({
            'message': 'Current password is incorrect',
            'errors': {'current_password': ['Current password is incorrect']},
        }, status=status.HTTP_400_BAD_REQUEST)

    email = (user.email or '').strip()
    if not email:
        return Response({
            'message': (
                'No email is registered for this account. '
                'Contact support to add an email before changing it.'
            ),
            'errors': {
                'email': [
                    'No registered email on this account.',
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    new_email = serializer.validated_data['new_email']
    otp = f'{secrets.randbelow(1_000_000):06d}'
    cache.set(
        f'email_change:{user.pk}',
        {'otp': otp, 'new_email': new_email},
        timeout=60 * 15,
    )

    sent = send_email_change_otp(email, otp, new_email)
    if not sent:
        logger.error('Failed to send email change OTP for user_id=%s', user.pk)
        return Response({
            'message': 'Unable to send verification code. Please try again later.',
            'errors': {'email': ['Unable to send verification code. Please try again later.']},
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    email_hint = mask_email(email)
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_EMAIL_CHANGE_OTP_SENT,
        request=request,
        details={'email_hint': email_hint, 'new_email': new_email},
    )

    payload = {
        'message': (
            f'A verification code has been sent to {email_hint}. '
            'Enter the code to confirm your new email address.'
        ),
        'email_hint': email_hint,
    }
    if getattr(dj_settings, 'DEBUG', False):
        payload['debug_otp'] = otp
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_email_change(request):
    """Confirm pending email change with the OTP sent to the registered email."""
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.security import log_security_event

    serializer = ConfirmEmailChangeSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    cached = cache.get(f'email_change:{user.pk}')
    if not cached or not isinstance(cached, dict):
        return Response({
            'message': 'Verification code expired or not requested. Please request a new code.',
            'errors': {'otp': ['Verification code expired or not requested.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    if cached.get('otp') != serializer.validated_data['otp']:
        return Response({
            'message': 'Invalid verification code',
            'errors': {'otp': ['Invalid verification code']},
        }, status=status.HTTP_400_BAD_REQUEST)

    new_email = (cached.get('new_email') or '').strip().lower()
    if not new_email:
        cache.delete(f'email_change:{user.pk}')
        return Response({
            'message': 'Email change request is invalid. Please start again.',
            'errors': {'otp': ['Email change request is invalid.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
        cache.delete(f'email_change:{user.pk}')
        return Response({
            'message': 'This email address is already registered.',
            'errors': {'new_email': ['This email address is already registered.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    old_email = user.email
    user.email = new_email
    user.save(update_fields=['email'])
    cache.delete(f'email_change:{user.pk}')

    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_EMAIL_CHANGED,
        request=request,
        details={'old_email': old_email, 'new_email': new_email},
    )

    profile_serializer = UserProfileSerializer(user, context={'request': request})
    return Response({
        'message': 'Email address updated successfully',
        'user': profile_serializer.data,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    """
    Request a password-reset OTP for a phone number.
    OTP is emailed to the user's registered address when the account exists
    and has an email. Unknown / inactive phones get a generic response.
    """
    import secrets
    from django.conf import settings as dj_settings
    from django.core.cache import cache

    from ..services.notifications import mask_email, send_password_reset_otp

    serializer = ForgotPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    phone = serializer.validated_data['phone']
    generic = {
        'message': (
            'If an account exists for this phone number with a registered email, '
            'a verification code has been sent. Enter the code to reset your password.'
        ),
    }

    try:
        user = User.objects.get(phone=phone)
    except User.DoesNotExist:
        return Response(generic, status=status.HTTP_200_OK)

    if not user.is_active:
        return Response(generic, status=status.HTTP_200_OK)

    email = (user.email or '').strip()
    if not email:
        return Response({
            'message': (
                'No email is registered for this account. '
                'Please contact support to reset your password.'
            ),
            'errors': {
                'email': [
                    'No registered email on this account. Contact support to reset your password.'
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    otp = f'{secrets.randbelow(1_000_000):06d}'
    cache.set(f'password_reset_otp:{phone}', otp, timeout=60 * 15)

    sent = send_password_reset_otp(email, otp)
    if not sent:
        logger.error('Failed to send password reset OTP email for phone %s***', phone[:3])
        return Response({
            'message': 'Unable to send verification code. Please try again later.',
            'errors': {'email': ['Unable to send verification code. Please try again later.']},
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    email_hint = mask_email(email)
    logger.info('Password reset OTP emailed to %s for phone %s***', email_hint, phone[:3])

    payload = {
        'message': (
            f'A verification code has been sent to {email_hint}. '
            'Enter the code to reset your password.'
        ),
        'email_hint': email_hint,
    }
    if getattr(dj_settings, 'DEBUG', False):
        payload['debug_otp'] = otp

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password(request):
    """Reset password using phone + OTP + date of birth from forgot_password."""
    from django.core.cache import cache

    serializer = ResetPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    phone = serializer.validated_data['phone']
    otp = serializer.validated_data['otp'].strip()
    date_of_birth = serializer.validated_data['date_of_birth']
    cached = cache.get(f'password_reset_otp:{phone}')

    identity_failed = {
        'message': (
            'Unable to verify your identity. '
            'Please check your details and try again.'
        ),
        'errors': {
            'date_of_birth': [
                'Unable to verify your identity. '
                'Please check your details and try again.'
            ],
        },
    }

    if not cached:
        return Response({
            'message': (
                'Verification code has expired or was not requested. '
                'Please request a new code.'
            ),
            'errors': {
                'otp': [
                    'Verification code has expired or was not requested. '
                    'Please request a new code.'
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    if str(cached) != otp:
        return Response({
            'message': (
                'Incorrect verification code. '
                'Please check the code sent to your email and try again.'
            ),
            'errors': {
                'otp': [
                    'Incorrect verification code. '
                    'Please check the code sent to your email and try again.'
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(phone=phone)
    except User.DoesNotExist:
        return Response({
            'message': (
                'Unable to reset password for this account. '
                'Please request a new verification code.'
            ),
            'errors': {
                'phone': [
                    'Unable to reset password for this account. '
                    'Please request a new verification code.'
                ],
            },
        }, status=status.HTTP_400_BAD_REQUEST)

    if not user.is_active:
        return Response({
            'message': 'Your account has been deactivated. Please contact support.',
            'errors': {'phone': ['Your account has been deactivated. Please contact support.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    # Exact AD date match; missing DOB on account fails generically (no leak).
    if user.date_of_birth is None or user.date_of_birth != date_of_birth:
        return Response(identity_failed, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(serializer.validated_data['new_password'])
    user.save()
    cache.delete(f'password_reset_otp:{phone}')
    # Invalidate existing sessions
    Token.objects.filter(user=user).delete()

    return Response({
        'message': 'Password reset successfully. You can now log in with your new password.',
    }, status=status.HTTP_200_OK)


def _pin_reset_otp_available(user) -> bool:
    return bool((getattr(user, 'email', None) or '').strip())


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def set_transaction_pin(request):
    """Set transaction PIN for authenticated users who do not yet have one."""
    from django.contrib.auth.hashers import make_password
    from ..models import SecurityAuditLog
    from ..services.security import log_security_event

    user = request.user
    if user.transaction_pin:
        return Response({
            'message': 'Transaction PIN is already set.',
            'errors': {'transaction_pin': ['Transaction PIN is already set.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    serializer = SetTransactionPinSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    user.transaction_pin = make_password(serializer.validated_data['transaction_pin'])
    user.save(update_fields=['transaction_pin'])
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_TRANSACTION_PIN_SET,
        request=request,
    )
    logger.info('Transaction PIN set for user_id=%s', user.pk)

    return Response({
        'message': 'Transaction PIN set successfully',
        'has_pin': True,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_transaction_pin(request):
    """Change transaction PIN after verifying the current PIN."""
    from django.contrib.auth.hashers import make_password
    from ..models import SecurityAuditLog
    from ..services.pin import verify_transaction_pin
    from ..services.security import log_security_event

    user = request.user
    if not user.transaction_pin:
        return Response({
            'message': 'Transaction PIN is not set. Please set a PIN first.',
            'errors': {'current_pin': ['Transaction PIN is not set.']},
            'code': 'pin_not_set',
        }, status=status.HTTP_400_BAD_REQUEST)

    serializer = ChangeTransactionPinSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    if not verify_transaction_pin(user, serializer.validated_data['current_pin']):
        return Response({
            'message': 'Current transaction PIN is incorrect',
            'errors': {'current_pin': ['Current transaction PIN is incorrect']},
        }, status=status.HTTP_400_BAD_REQUEST)

    user.transaction_pin = make_password(serializer.validated_data['transaction_pin'])
    user.save(update_fields=['transaction_pin'])
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_TRANSACTION_PIN_CHANGED,
        request=request,
        details={'method': 'current_pin'},
    )
    logger.info('Transaction PIN changed for user_id=%s', user.pk)

    return Response({
        'message': 'Transaction PIN changed successfully',
        'has_pin': True,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_transaction_pin_reset_otp(request):
    """
    Email a one-time code so the authenticated user can reset their
    transaction PIN without knowing the current PIN.
    Available only when the account has a registered email.
    """
    import secrets
    from django.conf import settings as dj_settings
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.notifications import mask_email, send_transaction_pin_reset_otp
    from ..services.security import log_security_event

    user = request.user
    if not user.transaction_pin:
        return Response({
            'message': 'Transaction PIN is not set. Please set a PIN first.',
            'errors': {'transaction_pin': ['Transaction PIN is not set.']},
            'code': 'pin_not_set',
            'otp_available': False,
        }, status=status.HTTP_400_BAD_REQUEST)

    email = (user.email or '').strip()
    if not email:
        return Response({
            'message': (
                'Email OTP is not available for this account. '
                'Reset your PIN using your account password instead.'
            ),
            'errors': {
                'email': [
                    'No registered email on this account. Use your account password to reset the PIN.'
                ],
            },
            'otp_available': False,
        }, status=status.HTTP_400_BAD_REQUEST)

    otp = f'{secrets.randbelow(1_000_000):06d}'
    cache.set(f'pin_reset_otp:{user.pk}', otp, timeout=60 * 15)

    sent = send_transaction_pin_reset_otp(email, otp)
    if not sent:
        logger.error('Failed to send transaction PIN reset OTP for user_id=%s', user.pk)
        return Response({
            'message': 'Unable to send verification code. Please try again later.',
            'errors': {'email': ['Unable to send verification code. Please try again later.']},
            'otp_available': True,
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    email_hint = mask_email(email)
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_TRANSACTION_PIN_RESET_OTP_SENT,
        request=request,
        details={'email_hint': email_hint},
    )
    logger.info(
        'Transaction PIN reset OTP emailed to %s for user_id=%s',
        email_hint,
        user.pk,
    )

    payload = {
        'message': (
            f'A verification code has been sent to {email_hint}. '
            'Enter the code with your new transaction PIN.'
        ),
        'email_hint': email_hint,
        'otp_available': True,
    }
    if getattr(dj_settings, 'DEBUG', False):
        payload['debug_otp'] = otp

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reset_transaction_pin(request):
    """
    Reset transaction PIN after verifying account password, or email OTP
    when the account has a registered email (OTP enabled).
    """
    from django.contrib.auth.hashers import make_password
    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.security import log_security_event

    user = request.user
    if not user.transaction_pin:
        return Response({
            'message': 'Transaction PIN is not set. Please set a PIN first.',
            'errors': {'transaction_pin': ['Transaction PIN is not set.']},
            'code': 'pin_not_set',
            'otp_available': _pin_reset_otp_available(user),
        }, status=status.HTTP_400_BAD_REQUEST)

    serializer = ResetTransactionPinSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        formatted['otp_available'] = _pin_reset_otp_available(user)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    password = serializer.validated_data['current_password']
    otp = serializer.validated_data['otp']
    method = None

    if password:
        if not user.check_password(password):
            logger.warning(
                'Failed transaction PIN reset (bad password) for user_id=%s',
                user.pk,
            )
            return Response({
                'message': 'Account password is incorrect',
                'errors': {'current_password': ['Account password is incorrect']},
                'otp_available': _pin_reset_otp_available(user),
            }, status=status.HTTP_400_BAD_REQUEST)
        method = 'password'
    else:
        if not _pin_reset_otp_available(user):
            return Response({
                'message': (
                    'Email OTP is not available for this account. '
                    'Reset your PIN using your account password instead.'
                ),
                'errors': {
                    'otp': [
                        'Email OTP is not enabled for this account. Use your account password.'
                    ],
                },
                'otp_available': False,
            }, status=status.HTTP_400_BAD_REQUEST)

        cached = cache.get(f'pin_reset_otp:{user.pk}')
        if not cached:
            return Response({
                'message': (
                    'Verification code has expired or was not requested. '
                    'Please request a new code.'
                ),
                'errors': {
                    'otp': [
                        'Verification code has expired or was not requested. '
                        'Please request a new code.'
                    ],
                },
                'otp_available': True,
            }, status=status.HTTP_400_BAD_REQUEST)

        if str(cached) != otp:
            logger.warning(
                'Failed transaction PIN reset (bad OTP) for user_id=%s',
                user.pk,
            )
            return Response({
                'message': (
                    'Incorrect verification code. '
                    'Please check the code sent to your email and try again.'
                ),
                'errors': {
                    'otp': [
                        'Incorrect verification code. '
                        'Please check the code sent to your email and try again.'
                    ],
                },
                'otp_available': True,
            }, status=status.HTTP_400_BAD_REQUEST)
        method = 'otp'
        cache.delete(f'pin_reset_otp:{user.pk}')

    user.transaction_pin = make_password(serializer.validated_data['transaction_pin'])
    user.save(update_fields=['transaction_pin'])
    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_TRANSACTION_PIN_RESET,
        request=request,
        details={'method': method},
    )
    logger.info(
        'Transaction PIN reset for user_id=%s via %s',
        user.pk,
        method,
    )

    return Response({
        'message': 'Transaction PIN reset successfully',
        'has_pin': True,
        'otp_available': _pin_reset_otp_available(user),
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def has_transaction_pin(request):
    """Return whether the authenticated user has a transaction PIN set."""
    return Response({
        'has_pin': bool(request.user.transaction_pin),
        'otp_available': _pin_reset_otp_available(request.user),
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_transaction_pin(request):
    """Client-side pre-check that the submitted transaction PIN is correct."""
    from ..services.pin import transaction_pin_gate

    serializer = VerifyTransactionPinSerializer(data=request.data)
    if not serializer.is_valid():
        formatted = format_validation_errors(serializer.errors)
        return Response(formatted, status=status.HTTP_400_BAD_REQUEST)

    failed = transaction_pin_gate(
        request.user, serializer.validated_data['transaction_pin']
    )
    if failed:
        return failed

    return Response({
        'valid': True,
        'message': 'Transaction PIN verified',
    }, status=status.HTTP_200_OK)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def device_token(request):
    """
    POST  — register / refresh an FCM or web push device token.
    DELETE — unregister by token (body or query: token=...).
    """
    from ..models import DeviceToken

    if request.method == 'POST':
        serializer = DeviceTokenSerializer(
            data=request.data, context={'request': request},
        )
        if not serializer.is_valid():
            formatted = format_validation_errors(serializer.errors)
            return Response(formatted, status=status.HTTP_400_BAD_REQUEST)
        obj = serializer.save()
        return Response({
            'message': 'Device token registered',
            'token': obj.token,
            'platform': obj.platform,
            'updated_at': obj.updated_at.isoformat() if obj.updated_at else None,
        }, status=status.HTTP_200_OK)

    token = (
        (request.data.get('token') if hasattr(request, 'data') else None)
        or request.query_params.get('token')
        or ''
    )
    token = str(token).strip()
    if not token:
        return Response({
            'message': 'token is required',
            'errors': {'token': ['This field is required.']},
        }, status=status.HTTP_400_BAD_REQUEST)

    deleted, _ = DeviceToken.objects.filter(user=request.user, token=token).delete()
    if not deleted:
        # Also allow unregistered tokens that belong to this user by exact match only
        return Response({
            'message': 'Device token not found',
        }, status=status.HTTP_404_NOT_FOUND)

    return Response({'message': 'Device token unregistered'}, status=status.HTTP_200_OK)
