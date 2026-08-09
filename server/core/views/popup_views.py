"""Authenticated user endpoints for home-screen popups."""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import HomePopup
from ..serializers import HomePopupSerializer
from ..services.home_popup import get_active_popup_for_user, record_popup_shown


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def active_home_popup(request):
    """Return the next eligible home popup for the current user, if any."""
    popup = get_active_popup_for_user(request.user)
    if not popup:
        return Response({'popup': None})
    return Response({
        'popup': HomePopupSerializer(popup, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def record_home_popup_shown(request, popup_id):
    """Record that the home popup was shown to the current user."""
    try:
        popup = HomePopup.objects.get(pk=popup_id, is_active=True)
    except HomePopup.DoesNotExist:
        return Response({'detail': 'Popup not found.'}, status=status.HTTP_404_NOT_FOUND)

    recorded = record_popup_shown(popup, request.user)
    if not recorded:
        return Response(
            {
                'detail': 'Popup display limit reached for this 24-hour period.',
                'recorded': False,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    return Response({'recorded': True, 'message': 'Popup view recorded.'})
