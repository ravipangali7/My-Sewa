"""
Settings views: Get QR code, bank details, and public app configuration
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from ..models import Settings
from ..serializers import SettingsSerializer
from ..services.app_config import public_config


@api_view(['GET'])
@permission_classes([AllowAny])
def get_settings(request):
    """Get QR code, bank details, and public configuration for clients."""
    settings_obj = Settings.load()
    data = SettingsSerializer(settings_obj, context={'request': request}).data
    data['config'] = public_config(settings_obj.get_config())
    return Response(data, status=status.HTTP_200_OK)
