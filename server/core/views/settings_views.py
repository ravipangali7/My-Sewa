"""
Settings views: Get QR code and bank details
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from ..models import Settings
from ..serializers import SettingsSerializer


@api_view(['GET'])
@permission_classes([AllowAny])
def get_settings(request):
    """Get QR code and bank details (public endpoint)"""
    settings = Settings.load()
    serializer = SettingsSerializer(settings, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)
