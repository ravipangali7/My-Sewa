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
        from ..models import _ensure_authtoken_table
        _ensure_authtoken_table()
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
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


def _looks_like_email(value: str) -> bool:
    return '@' in (value or '')


ACCOUNT_DEACTIVATED_MESSAGE = (
    'Your account has been deleted/deactivated. Please contact support.'
)


def _account_deactivated_response():
    return Response({
        'error': 'account_deactivated',
        'message': ACCOUNT_DEACTIVATED_MESSAGE,
        'detail': ACCOUNT_DEACTIVATED_MESSAGE,
    }, status=status.HTTP_401_UNAUTHORIZED)


def _deactivate_user_account(user) -> None:
    """Soft-delete: disable the account and revoke sessions, keep all data."""
    from django.core.cache import cache

    user.is_active = False
    user.save(update_fields=['is_active'])
    old_keys = list(Token.objects.filter(user=user).values_list('key', flat=True))
    Token.objects.filter(user=user).delete()
    for old_key in old_keys:
        cache.delete(f'session_activity:{old_key}')
    _invalidate_login_otp_for_user(user.pk)


def _find_user_by_login_identifier(identifier: str):
    """Look up a user by email or phone for login error messaging."""
    if _looks_like_email(identifier):
        return User.objects.filter(email__iexact=identifier).first()
    return User.objects.filter(phone=identifier).first()


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """
    Step 1 of login: verify email/phone + password.
    When security.otp_login_enabled is True, send a one-time code and require
    POST /api/auth/verify-login-otp/ before issuing a token.
    When disabled, issue the auth token immediately after password check.
    """
    from django.core.cache import cache
    from ..services.app_config import get_app_config

    # Accept identifier / email / phone / username for web + Flutter clients
    identifier = (
        request.data.get('identifier')
        or request.data.get('email')
        or request.data.get('phone')
        or request.data.get('username')
    )
    password = request.data.get('password')

    logger.info(
        f"Login attempt received - Identifier: {identifier[:3]}*** (masked)"
        if identifier
        else "Login attempt with empty identifier"
    )

    if not identifier or not password:
        logger.warning("Login attempt failed: Missing identifier or password")
        return Response({
            'error': 'Email/phone and password are required',
            'message': 'Email or phone number and password are required',
            'detail': 'Please provide your email or phone number and password to login',
        }, status=status.HTTP_400_BAD_REQUEST)

    identifier = identifier.strip()
    login_via = 'email' if _looks_like_email(identifier) else 'phone'
    preferred_channel = 'email' if login_via == 'email' else 'sms'
    logger.debug(f"Normalized login identifier ({login_via}): {identifier[:3]}***")

    security = get_app_config().get('security') or {}
    max_failed = int(security.get('max_failed_logins') or 0)
    fail_key = f'failed_login:{identifier.lower() if login_via == "email" else identifier}'
    if max_failed > 0:
        fails = int(cache.get(fail_key) or 0)
        if fails >= max_failed:
            return Response({
                'error': 'account_locked',
                'message': 'Too many failed login attempts. Please try again later.',
                'detail': f'Account temporarily locked after {max_failed} failed attempts.',
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    try:
        user = authenticate(request=request, username=identifier, password=password)

        if user is not None:
            logger.info(
                f"Credentials verified for user ID: {user.id}, via {login_via}"
            )
            cache.delete(fail_key)

            if security.get('maintenance_mode') and not (user.is_staff or user.is_superuser):
                return Response({
                    'error': 'maintenance_mode',
                    'message': security.get('maintenance_message')
                        or 'MySewa is under maintenance. Please try again later.',
                    'code': 'maintenance_mode',
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

            otp_login_enabled = security.get('otp_login_enabled', True)
            if not otp_login_enabled:
                logger.info(
                    'OTP login disabled — issuing token for user_id=%s',
                    user.id,
                )
                return _issue_login_token_response(
                    request, user, otp_verified=False
                )

            return _start_login_otp_challenge(
                request,
                user,
                preferred_channel=preferred_channel,
                login_via=login_via,
            )
        else:
            logger.warning(
                f"Login failed for {login_via}: {identifier[:3]}*** - Invalid credentials"
            )
            if max_failed > 0:
                cache.set(fail_key, int(cache.get(fail_key) or 0) + 1, timeout=60 * 30)

            try:
                existing = _find_user_by_login_identifier(identifier)
                if existing is None:
                    label = 'email address' if login_via == 'email' else 'phone number'
                    logger.warning(
                        f"Login failed: User not found with {login_via}: {identifier[:3]}***"
                    )
                    return Response({
                        'error': 'Invalid credentials',
                        'message': f'No user found with this {label}',
                        'detail': (
                            f'The {label} you entered is not registered. '
                            'Please check and try again.'
                        ),
                    }, status=status.HTTP_401_UNAUTHORIZED)
                if not existing.is_active:
                    logger.warning(f"Login failed: User {existing.id} is inactive")
                    return _account_deactivated_response()
                logger.warning(f"Login failed: Incorrect password for user {existing.id}")
                return Response({
                    'error': 'Invalid credentials',
                    'message': 'Incorrect password',
                    'detail': 'The password you entered is incorrect. Please try again.',
                }, status=status.HTTP_401_UNAUTHORIZED)
            except Exception as e:
                logger.error(f"Unexpected error during login: {str(e)}")
                return Response({
                    'error': 'Invalid credentials',
                    'message': 'Authentication failed',
                    'detail': 'An unexpected error occurred during authentication. Please try again.',
                }, status=status.HTTP_401_UNAUTHORIZED)

    except Exception as e:
        logger.error(f"Exception during authentication: {str(e)}", exc_info=True)
        return Response({
            'error': 'Authentication error',
            'message': 'An error occurred during authentication',
            'detail': 'An error occurred during authentication. Please try again.',
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _login_otp_timeout() -> int:
    from django.conf import settings as dj_settings
    return int(getattr(dj_settings, 'LOGIN_OTP_TIMEOUT', 300))


def _login_otp_max_attempts() -> int:
    from django.conf import settings as dj_settings
    return int(getattr(dj_settings, 'LOGIN_OTP_MAX_ATTEMPTS', 5))


def _invalidate_login_otp_for_user(user_id: int) -> None:
    from django.core.cache import cache

    old_challenge = cache.get(f'login_otp_by_user:{user_id}')
    if old_challenge:
        cache.delete(f'login_otp:{old_challenge}')
    cache.delete(f'login_otp_by_user:{user_id}')


def _start_login_otp_challenge(
    request,
    user,
    *,
    reuse_challenge_id: str | None = None,
    preferred_channel: str | None = None,
    login_via: str | None = None,
):
    """Generate OTP, deliver via preferred channel, and return the challenge payload."""
    import secrets
    import uuid

    from django.core.cache import cache

    from ..models import SecurityAuditLog
    from ..services.notifications import send_login_otp
    from ..services.security import log_security_event

    timeout = _login_otp_timeout()
    expires_minutes = max(1, timeout // 60)
    otp = f'{secrets.randbelow(1_000_000):06d}'
    challenge_id = reuse_challenge_id or str(uuid.uuid4())
    channel = (preferred_channel or '').strip().lower() or None
    via = (login_via or '').strip().lower() or None
    if via not in ('email', 'phone'):
        via = 'email' if channel == 'email' else 'phone' if channel == 'sms' else None

    _invalidate_login_otp_for_user(user.pk)

    import time as _time

    cache.set(
        f'login_otp:{challenge_id}',
        {
            'otp': otp,
            'user_id': user.pk,
            'attempts': 0,
            'expires_at': _time.time() + timeout,
            'preferred_channel': channel,
            'login_via': via,
        },
        timeout=timeout,
    )
    cache.set(f'login_otp_by_user:{user.pk}', challenge_id, timeout=timeout)

    delivery = send_login_otp(
        user,
        otp,
        expires_minutes=expires_minutes,
        preferred_channel=channel,
    )
    if not delivery.get('channels'):
        _invalidate_login_otp_for_user(user.pk)
        logger.error(
            'Failed to send login OTP for user_id=%s channel=%s',
            user.pk,
            channel or 'any',
        )
        if channel == 'email':
            fail_message = (
                'Unable to send a verification code to your email. '
                'Please try again later or contact support.'
            )
            fail_detail = 'OTP delivery failed for email channel.'
        elif channel == 'sms':
            fail_message = (
                'Unable to send a verification code to your phone. '
                'Please try again later or contact support.'
            )
            fail_detail = 'OTP delivery failed for SMS channel.'
        else:
            fail_message = (
                'Unable to send a verification code to your email or phone. '
                'Please try again later or contact support.'
            )
            fail_detail = 'OTP delivery failed for both email and SMS channels.'
        return Response({
            'error': 'otp_delivery_failed',
            'message': fail_message,
            'detail': fail_detail,
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    log_security_event(
        user=user,
        action=SecurityAuditLog.ACTION_LOGIN_OTP_SENT,
        request=request,
        details={
            'channels': delivery.get('channels') or [],
            'email_hint': delivery.get('email_hint'),
            'phone_hint': delivery.get('phone_hint'),
            'preferred_channel': channel,
            'login_via': via,
        },
    )

    channel_parts = []
    if delivery.get('email_hint'):
        channel_parts.append(delivery['email_hint'])
    if delivery.get('phone_hint'):
        channel_parts.append(delivery['phone_hint'])
    destinations = ' and '.join(channel_parts) if channel_parts else 'your registered contacts'

    if channel == 'sms' or via == 'phone':
        if delivery.get('phone_hint') and delivery.get('email_hint'):
            message = (
                f'A verification code has been sent to your phone ({delivery["phone_hint"]}) '
                f'and email ({delivery["email_hint"]}). '
                'Enter the code to finish signing in.'
            )
        elif delivery.get('phone_hint'):
            message = (
                f'A verification code has been sent to your phone ({delivery["phone_hint"]}). '
                'Enter the code to finish signing in.'
            )
        else:
            message = (
                f'A verification code has been sent to {destinations}. '
                'Enter the code to finish signing in.'
            )
    elif channel == 'email' or via == 'email':
        message = (
            f'A verification code has been sent to your email ({destinations}). '
            'Enter the code to finish signing in.'
        )
    else:
        message = (
            f'A verification code has been sent to {destinations}. '
            'Enter the code to finish signing in.'
        )

    payload = {
        'requires_otp': True,
        'message': message,
        'challenge_id': challenge_id,
        'expires_in': timeout,
        'channels': delivery.get('channels') or [],
        'email_hint': delivery.get('email_hint'),
        'phone_hint': delivery.get('phone_hint'),
        'login_via': via,
        'preferred_channel': channel,
    }
    # Never expose the login OTP in the API response — it is delivered only via
    # email/SMS so the code cannot appear on the login page UI.
    logger.info(
        'Login OTP sent via %s for user_id=%s (login_via=%s)',
        ','.join(delivery.get('channels') or []),
        user.pk,
        via,
    )
    return Response(payload, status=status.HTTP_200_OK)


def _issue_login_token_response(request, user, *, otp_verified: bool = True):
    """Issue DRF token after successful login (shared by Admin + User)."""
    import time

    from django.core.cache import cache

    from ..models import SecurityAuditLog, _ensure_authtoken_table
    from ..services.app_config import get_app_config
    from ..services.security import log_security_event

    _ensure_authtoken_table()
    # Always rotate so a token restored from backup/old installs cannot stay valid
    # after a fresh credential (+ OTP when enabled) login on this (or another) device.
    old_keys = list(Token.objects.filter(user=user).values_list('key', flat=True))
    Token.objects.filter(user=user).delete()
    for old_key in old_keys:
        cache.delete(f'session_activity:{old_key}')
    token = Token.objects.create(user=user)
    logger.debug('Rotated auth token for user ID: %s', user.id)

    security = get_app_config().get('security') or {}
    timeout_minutes = int(security.get('session_timeout_minutes') or 0)
    if timeout_minutes > 0:
        cache.set(
            f'session_activity:{token.key}',
            time.time(),
            timeout=timeout_minutes * 60 + 300,
        )

    if otp_verified:
        log_security_event(
            user=user,
            action=SecurityAuditLog.ACTION_LOGIN_OTP_VERIFIED,
            request=request,
            details={'is_staff': bool(user.is_staff or user.is_superuser)},
        )

    return Response({
        'message': 'Login successful',
        'requires_otp': False,
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


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_login_otp(request):
    """
    Step 2 of login: verify the OTP from email/SMS and issue the auth token.
    Used by both Admin and User accounts.
    """
    from django.core.cache import cache

    challenge_id = (request.data.get('challenge_id') or '').strip()
    otp = (request.data.get('otp') or '').strip()

    if not challenge_id or not otp:
        return Response({
            'error': 'otp_required',
            'message': 'Verification code and challenge id are required.',
            'detail': 'Provide challenge_id and otp to complete login.',
        }, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'login_otp:{challenge_id}'
    pending = cache.get(cache_key)
    if not pending:
        return Response({
            'error': 'otp_expired',
            'message': 'Verification code has expired or was not requested. Please sign in again.',
            'detail': 'Login OTP challenge not found or expired.',
        }, status=status.HTTP_400_BAD_REQUEST)

    attempts = int(pending.get('attempts') or 0)
    max_attempts = _login_otp_max_attempts()
    if attempts >= max_attempts:
        user_id = pending.get('user_id')
        _invalidate_login_otp_for_user(user_id)
        return Response({
            'error': 'otp_locked',
            'message': 'Too many incorrect codes. Please sign in again to request a new code.',
            'detail': f'Maximum OTP attempts ({max_attempts}) exceeded.',
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    if str(pending.get('otp')) != otp:
        import time as _time

        pending['attempts'] = attempts + 1
        remaining = max_attempts - pending['attempts']
        expires_at = float(pending.get('expires_at') or 0)
        timeout = max(1, int(expires_at - _time.time())) if expires_at else _login_otp_timeout()
        cache.set(cache_key, pending, timeout=timeout)
        return Response({
            'error': 'invalid_otp',
            'message': 'Incorrect verification code. Please try again.',
            'detail': f'Invalid OTP. {max(0, remaining)} attempt(s) remaining.',
            'attempts_remaining': max(0, remaining),
        }, status=status.HTTP_400_BAD_REQUEST)

    user_id = pending.get('user_id')
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        _invalidate_login_otp_for_user(user_id)
        return Response({
            'error': 'invalid_credentials',
            'message': 'Unable to complete login. Please sign in again.',
        }, status=status.HTTP_401_UNAUTHORIZED)

    if not user.is_active:
        _invalidate_login_otp_for_user(user_id)
        return _account_deactivated_response()

    _invalidate_login_otp_for_user(user.pk)
    logger.info('Login OTP verified for user_id=%s', user.pk)
    return _issue_login_token_response(request, user)


@api_view(['POST'])
@permission_classes([AllowAny])
def resend_login_otp(request):
    """Resend login OTP for an existing challenge (Admin + User)."""
    from django.core.cache import cache

    challenge_id = (request.data.get('challenge_id') or '').strip()
    if not challenge_id:
        return Response({
            'error': 'challenge_required',
            'message': 'Challenge id is required to resend the verification code.',
        }, status=status.HTTP_400_BAD_REQUEST)

    pending = cache.get(f'login_otp:{challenge_id}')
    if not pending:
        return Response({
            'error': 'otp_expired',
            'message': 'Verification session expired. Please sign in again.',
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(pk=pending.get('user_id'))
    except User.DoesNotExist:
        _invalidate_login_otp_for_user(pending.get('user_id'))
        return Response({
            'error': 'invalid_credentials',
            'message': 'Unable to resend code. Please sign in again.',
        }, status=status.HTTP_401_UNAUTHORIZED)

    if not user.is_active:
        _invalidate_login_otp_for_user(user.pk)
        return _account_deactivated_response()

    # Simple resend throttle: one resend per 30 seconds per challenge
    throttle_key = f'login_otp_resend:{challenge_id}'
    if cache.get(throttle_key):
        return Response({
            'error': 'resend_too_soon',
            'message': 'Please wait a moment before requesting another code.',
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(throttle_key, 1, timeout=30)

    preferred_channel = pending.get('preferred_channel')
    login_via = pending.get('login_via')
    return _start_login_otp_challenge(
        request,
        user,
        reuse_challenge_id=challenge_id,
        preferred_channel=preferred_channel,
        login_via=login_via,
    )


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


@api_view(['GET'])
@permission_classes([AllowAny])
def delete_account(request, phone, password):
    """
    Soft-delete (deactivate) an account via GET /api/auth/delete-account/<phone>/<password>/.
    Retains all user data; the account can no longer log in.
    """
    from urllib.parse import unquote

    phone = unquote(phone or '').strip()
    password = unquote(password or '')

    if not phone or not password:
        return Response({
            'error': 'phone_and_password_required',
            'message': 'Phone number and password are required to delete an account.',
        }, status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.filter(phone=phone).first()
    if user is None or not user.check_password(password):
        return Response({
            'error': 'invalid_credentials',
            'message': 'Invalid phone number or password.',
            'detail': 'Could not delete account. Please check your phone number and password.',
        }, status=status.HTTP_401_UNAUTHORIZED)

    if not user.is_active:
        return Response({
            'message': ACCOUNT_DEACTIVATED_MESSAGE,
            'detail': 'Account is already deactivated.',
        }, status=status.HTTP_200_OK)

    _deactivate_user_account(user)
    logger.info('Account soft-deleted (deactivated) for user_id=%s phone=%s***', user.pk, phone[:3])
    return Response({
        'message': 'Your account has been deleted/deactivated successfully.',
        'detail': 'Your account data has been retained but the account is no longer active.',
    }, status=status.HTTP_200_OK)


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def profile(request):
    """Get or update current user's profile information (supports avatar upload)"""
    if request.method == 'GET':
        from django.db.utils import OperationalError, ProgrammingError
        try:
            serializer = UserProfileSerializer(request.user, context={'request': request})
            return Response(serializer.data, status=status.HTTP_200_OK)
        except (OperationalError, ProgrammingError):
            user = request.user
            return Response({
                'id': user.id,
                'phone': getattr(user, 'phone', ''),
                'email': getattr(user, 'email', '') or '',
                'first_name': getattr(user, 'first_name', '') or '',
                'last_name': getattr(user, 'last_name', '') or '',
                'nickname': getattr(user, 'nickname', '') or '',
                'business_name': getattr(user, 'business_name', '') or '',
                'date_of_birth': None,
                'avatar': None,
                'avatar_url': None,
                'is_active': bool(getattr(user, 'is_active', True)),
                'is_staff': bool(getattr(user, 'is_staff', False)),
                'is_superuser': bool(getattr(user, 'is_superuser', False)),
                'account_status': getattr(user, 'account_status', 'active'),
                'kyc_status': getattr(user, 'kyc_status', 'pending'),
                'citizenship_number': '',
                'kyc_verified': False,
                'profile_locked': False,
                'has_transaction_pin': bool(getattr(user, 'transaction_pin', None)),
                'date_joined': None,
                'last_login': None,
            }, status=status.HTTP_200_OK)

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
            'message': ACCOUNT_DEACTIVATED_MESSAGE,
            'errors': {'phone': [ACCOUNT_DEACTIVATED_MESSAGE]},
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
            raw_token = str((request.data or {}).get('token') or '')
            logger.warning(
                'Device token rejected user_id=%s platform=%s errors=%s token=…%s len=%s',
                getattr(request.user, 'pk', None),
                (request.data or {}).get('platform'),
                formatted,
                raw_token[-8:] if raw_token else '',
                len(raw_token),
            )
            return Response(formatted, status=status.HTTP_400_BAD_REQUEST)
        obj = serializer.save()
        logger.info(
            'Device token registered user_id=%s platform=%s token=…%s len=%s',
            getattr(request.user, 'pk', None),
            obj.platform,
            obj.token[-8:] if obj.token else '',
            len(obj.token or ''),
        )
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
    logger.info(
        'Device token unregistered user_id=%s token=…%s deleted=%s',
        getattr(request.user, 'pk', None),
        token[-8:] if token else '',
        deleted,
    )
    return Response({'message': 'Device token unregistered'}, status=status.HTTP_200_OK)
