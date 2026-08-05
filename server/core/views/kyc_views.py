"""
User KYC views: status, submit, document upload.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import KYCAuditLog, KYCDocument, KYCSubmission
from ..serializers import (
    KYCDocumentSerializer,
    KYCDocumentUploadSerializer,
    KYCStatusSerializer,
    KYCSubmitSerializer,
)
from ..services.kyc import (
    get_latest_submission,
    is_profile_locked,
    log_kyc_audit,
    sync_user_kyc_from_submission,
    user_may_submit_kyc,
    validate_document_sides,
)


def _status_payload(user, request):
    submission = get_latest_submission(user)
    verified = is_profile_locked(user)
    data = {
        'kyc_status': user.kyc_status,
        'citizenship_number': user.citizenship_number or '',
        'kyc_verified': verified,
        'profile_locked': verified,
        'can_submit': user_may_submit_kyc(user),
        # Pass the model instance (not .data) so nested serializers
        # receive KYCDocument objects, not already-serialized dicts.
        'submission': submission,
    }
    return KYCStatusSerializer(data, context={'request': request}).data


def _parse_optional_documents(request):
    """
    Optional batch documents on submit.

    Supports either:
    - Single: file + document_type + side
    - Parallel lists: files[] / document_types[] / sides[] (or file / document_type / side getlist)
    """
    files = request.FILES.getlist('files') or request.FILES.getlist('file')
    if not files:
        return []

    types = request.data.getlist('document_types') or request.data.getlist('document_type')
    sides = request.data.getlist('sides') or request.data.getlist('side')

    docs = []
    for idx, uploaded in enumerate(files):
        doc_type = types[idx] if idx < len(types) else KYCDocument.DOC_CITIZENSHIP
        side = sides[idx] if idx < len(sides) else KYCDocument.SIDE_SINGLE
        ser = KYCDocumentUploadSerializer(data={
            'document_type': doc_type,
            'side': side or KYCDocument.SIDE_SINGLE,
            'file': uploaded,
        })
        ser.is_valid(raise_exception=True)
        docs.append(ser.validated_data)
    return docs


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_kyc_status(request):
    """Return current user's KYC status and latest submission with documents."""
    return Response(_status_payload(request.user, request), status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def submit_kyc(request):
    """
    Create a new KYC submission (or resubmit after rejection).

    Multipart fields:
    - citizenship_number (required)
    - optional document batch: file(s) + document_type(s) + side(s)
    """
    user = request.user
    if not user_may_submit_kyc(user):
        if is_profile_locked(user):
            log_kyc_audit(
                user=user,
                action=KYCAuditLog.ACTION_PROFILE_LOCK_BLOCKED,
                actor=user,
                details={'reason': 'kyc_submit_blocked_verified'},
            )
            return Response(
                {
                    'error': (
                        'KYC documents cannot be replaced after verification. '
                        'Contact support if a correction is required.'
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                'error': (
                    'KYC already submitted and is awaiting review'
                    if user.kyc_status == user.KYC_STATUS_PENDING
                    else 'KYC cannot be resubmitted in the current status'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = KYCSubmitSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    documents = validate_document_sides(_parse_optional_documents(request))
    citizenship_number = serializer.validated_data['citizenship_number']
    old_status = user.kyc_status
    now = timezone.now()

    with transaction.atomic():
        submission = KYCSubmission.objects.create(
            user=user,
            status=KYCSubmission.STATUS_PENDING,
            citizenship_number=citizenship_number,
            submitted_at=now,
        )
        created_docs = []
        for doc in documents:
            created_docs.append(
                KYCDocument.objects.create(
                    submission=submission,
                    document_type=doc['document_type'],
                    side=doc.get('side') or KYCDocument.SIDE_SINGLE,
                    file=doc['file'],
                )
            )
        sync_user_kyc_from_submission(user, submission)
        log_kyc_audit(
            user=user,
            action=KYCAuditLog.ACTION_CREATED,
            actor=user,
            submission=submission,
            old_status=old_status,
            new_status=KYCSubmission.STATUS_PENDING,
            details={
                'citizenship_number': citizenship_number,
                'document_count': len(created_docs),
            },
        )
        for doc in created_docs:
            log_kyc_audit(
                user=user,
                action=KYCAuditLog.ACTION_DOCUMENT_UPLOADED,
                actor=user,
                submission=submission,
                details={
                    'document_id': doc.id,
                    'document_type': doc.document_type,
                    'side': doc.side,
                },
            )

    user.refresh_from_db(fields=['kyc_status', 'citizenship_number'])
    return Response(
        {
            'message': 'KYC submitted successfully',
            'data': _status_payload(user, request),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def kyc_documents(request):
    """List documents for the latest submission, or upload a document to a pending one."""
    user = request.user

    if request.method == 'GET':
        submission = get_latest_submission(user)
        if not submission:
            return Response({'items': []}, status=status.HTTP_200_OK)
        docs = submission.documents.all()
        return Response(
            {
                'items': KYCDocumentSerializer(
                    docs, many=True, context={'request': request},
                ).data,
            },
            status=status.HTTP_200_OK,
        )

    # POST — upload document
    submission = get_latest_submission(user)
    if not submission:
        return Response(
            {'error': 'No KYC submission found. Submit KYC first.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if submission.status == KYCSubmission.STATUS_APPROVED or is_profile_locked(user):
        log_kyc_audit(
            user=user,
            action=KYCAuditLog.ACTION_PROFILE_LOCK_BLOCKED,
            actor=user,
            submission=submission,
            details={'reason': 'kyc_document_upload_blocked_verified'},
        )
        return Response(
            {
                'error': (
                    'KYC documents cannot be replaced after verification. '
                    'Contact support if a correction is required.'
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if submission.status != KYCSubmission.STATUS_PENDING:
        return Response(
            {'error': 'Documents can only be added while KYC is pending.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = KYCDocumentUploadSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        doc = KYCDocument.objects.create(
            submission=submission,
            document_type=serializer.validated_data['document_type'],
            side=serializer.validated_data.get('side') or KYCDocument.SIDE_SINGLE,
            file=serializer.validated_data['file'],
        )
        log_kyc_audit(
            user=user,
            action=KYCAuditLog.ACTION_DOCUMENT_UPLOADED,
            actor=user,
            submission=submission,
            details={
                'document_id': doc.id,
                'document_type': doc.document_type,
                'side': doc.side,
            },
        )

    return Response(
        {
            'message': 'Document uploaded successfully',
            'data': KYCDocumentSerializer(doc, context={'request': request}).data,
        },
        status=status.HTTP_201_CREATED,
    )
