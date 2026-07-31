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
        return Response({
            'message': 'User registered successfully',
            'token': token.key,
            'user': {
                'id': user.id,
                'phone': user.phone,  # phone is the authentication field
                'email': user.email if user.email else ''
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
    # Accept both 'phone' and 'username' for backward compatibility
    phone = request.data.get('phone') or request.data.get('username')
    password = request.data.get('password')

    logger.info(f"Login attempt received - Phone: {phone[:3]}*** (masked)")

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

    # Use Django's authenticate() with custom PhoneBackend
    # The backend will handle user lookup, active check, and password verification
    try:
        user = authenticate(request=request, username=phone, password=password)
        
        if user is not None:
            # Authentication successful
            logger.info(f"Login successful for user ID: {user.id}, Phone: {user.phone[:3]}***")
            
            # Get or create token
            token, created = Token.objects.get_or_create(user=user)
            if created:
                logger.debug(f"New token created for user ID: {user.id}")
            else:
                logger.debug(f"Existing token retrieved for user ID: {user.id}")
            
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
                }
            }, status=status.HTTP_200_OK)
        else:
            # Authentication failed - user not found, inactive, or wrong password
            logger.warning(f"Login failed for phone: {phone[:3]}*** - Invalid credentials")
            
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
    else:  # PUT or PATCH
        serializer = UserProfileUpdateSerializer(
            request.user, data=request.data, partial=True
        )
        if serializer.is_valid():
            serializer.save()
            profile_serializer = UserProfileSerializer(
                request.user, context={'request': request}
            )
            return Response({
                'message': 'Profile updated successfully',
                'user': profile_serializer.data
            }, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


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
def change_phone(request):
    """Change the authenticated user's phone number (requires current password)"""
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

    user.phone = serializer.validated_data['new_phone']
    user.save()  # username synced to phone in model.save()

    profile_serializer = UserProfileSerializer(user, context={'request': request})
    return Response({
        'message': 'Phone number updated successfully',
        'user': profile_serializer.data,
    }, status=status.HTTP_200_OK)
