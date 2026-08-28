"""Legacy Sub-Agent APIs. The Sub-Agent role has been removed."""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


def _gone():
    return Response(
        {
            'error': 'Sub-Agent role removed',
            'message': 'The system now has only Admin, Dealer, and User roles.',
            'code': 'sub_agent_removed',
        },
        status=status.HTTP_410_GONE,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def agent_sub_agents(request):
    return _gone()


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def agent_sub_agent_detail(request, user_id):
    return _gone()
