"""
Settings views: Get QR code, bank details, and public app configuration
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.db.utils import OperationalError, ProgrammingError
from ..models import Settings, _ensure_settings_app_update_columns, _ensure_settings_table, default_app_config
from ..serializers import SettingsSerializer
from ..services.app_config import public_config


def _fallback_settings_payload():
    return {
        'id': 1,
        'qr_code': None,
        'qr_code_url': None,
        'khalti_qr_code': None,
        'khalti_qr_code_url': None,
        'esewa_qr_code': None,
        'esewa_qr_code_url': None,
        'logo': None,
        'logo_url': None,
        'auto_update_enabled': False,
        'app_version': '',
        'apk': None,
        'apk_url': None,
        'bank_details': {},
        'config': public_config(default_app_config()),
        'created_at': None,
        'updated_at': None,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def get_settings(request):
    """Get QR code, bank details, and public configuration for clients."""
    try:
        _ensure_settings_table()
        _ensure_settings_app_update_columns()
        settings_obj = Settings.load()
        data = SettingsSerializer(settings_obj, context={'request': request}).data
        data['config'] = public_config(settings_obj.get_config())
        return Response(data, status=status.HTTP_200_OK)
    except (OperationalError, ProgrammingError):
        return Response(_fallback_settings_payload(), status=status.HTTP_200_OK)
