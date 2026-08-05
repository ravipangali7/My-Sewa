"""
KYC helpers: audit logging, denormalized user status sync, and profile locks.
"""
from datetime import date, datetime

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ..models import CustomUser, KYCAuditLog, KYCDocument, KYCSubmission

# Citizenship, license, and national ID require both Front and Back images.
DUAL_SIDE_DOCUMENT_TYPES = frozenset({
    KYCDocument.DOC_CITIZENSHIP,
    KYCDocument.DOC_DRIVING_LICENSE,
    KYCDocument.DOC_NATIONAL_ID,
})

# Passport / Other may be a single image (or front-only).
SINGLE_SIDE_DOCUMENT_TYPES = frozenset({
    KYCDocument.DOC_PASSPORT,
    KYCDocument.DOC_OTHER,
})

DOCUMENT_TYPE_LABELS = dict(KYCDocument.DOCUMENT_TYPE_CHOICES)

# Identity fields locked after KYC verification (Tasks 16–17).
PROFILE_IDENTITY_LOCKED_FIELDS = (
    'first_name',
    'last_name',
    'date_of_birth',
    'citizenship_number',
)

LOCKED_FIELD_ERROR = (
    'This field cannot be changed after KYC verification.'
)


def sync_user_kyc_from_submission(user, submission):
    """Mirror submission status / citizenship onto CustomUser for lock checks."""
    updates = {
        'kyc_status': submission.status,
        'citizenship_number': (submission.citizenship_number or '').strip(),
    }
    CustomUser.objects.filter(pk=user.pk).update(**updates)
    user.kyc_status = updates['kyc_status']
    user.citizenship_number = updates['citizenship_number']
    return user


def log_kyc_audit(
    *,
    user,
    action,
    actor=None,
    submission=None,
    old_status='',
    new_status='',
    details=None,
):
    return KYCAuditLog.objects.create(
        user=user,
        submission=submission,
        action=action,
        actor=actor,
        old_status=old_status or '',
        new_status=new_status or '',
        details=details or {},
    )


def get_latest_submission(user):
    return (
        KYCSubmission.objects.filter(user=user)
        .prefetch_related('documents')
        .order_by('-created_at')
        .first()
    )


def is_profile_locked(user):
    """Identity fields are locked when the user's KYC status is approved."""
    return getattr(user, 'kyc_status', None) == CustomUser.KYC_STATUS_APPROVED


def _normalize_identity_value(field, value):
    if field == 'date_of_birth':
        if value in (None, ''):
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        return str(value)
    if value is None:
        return ''
    return str(value).strip()


def identity_field_changed(user, field, new_value):
    """Return True if new_value differs from the user's current identity field."""
    old_norm = _normalize_identity_value(field, getattr(user, field, None))
    new_norm = _normalize_identity_value(field, new_value)
    return old_norm != new_norm


def collect_locked_field_errors(user, data):
    """
    Given a mapping of proposed field values (e.g. request data), return a
    dict of field -> error list for identity fields that would change while locked.
    """
    if not is_profile_locked(user) or not data:
        return {}
    errors = {}
    for field in PROFILE_IDENTITY_LOCKED_FIELDS:
        if field not in data:
            continue
        if identity_field_changed(user, field, data.get(field)):
            errors[field] = [LOCKED_FIELD_ERROR]
    return errors


def user_may_submit_kyc(user):
    """Users may submit when never submitted, or after a rejection. Pending/approved block."""
    if user.kyc_status in (
        CustomUser.KYC_STATUS_PENDING,
        CustomUser.KYC_STATUS_APPROVED,
    ):
        return False
    latest = get_latest_submission(user)
    if latest and latest.status == KYCSubmission.STATUS_PENDING:
        return False
    if latest and latest.status == KYCSubmission.STATUS_APPROVED:
        return False
    return True


def validate_document_sides(docs):
    """
    Enforce front/back rules for dual-sided identity documents.

    - Citizenship, driving license, national ID: require both `front` and `back`
      (cannot submit citizenship without both sides).
    - Passport / Other: accept `single` or `front` (back optional / unused).
    """
    if not docs:
        raise ValidationError({
            'documents': (
                'Upload citizenship certificate front and back images '
                '(primary KYC document).'
            ),
        })

    by_type = {}
    for doc in docs:
        doc_type = doc.get('document_type')
        side = doc.get('side') or KYCDocument.SIDE_SINGLE
        by_type.setdefault(doc_type, set()).add(side)

    if KYCDocument.DOC_CITIZENSHIP not in by_type:
        raise ValidationError({
            'documents': (
                'Citizenship certificate is required. Upload both front and back.'
            ),
        })

    errors = {}
    for doc_type, sides in by_type.items():
        label = DOCUMENT_TYPE_LABELS.get(doc_type, doc_type)
        if doc_type in DUAL_SIDE_DOCUMENT_TYPES:
            missing = []
            if KYCDocument.SIDE_FRONT not in sides:
                missing.append('front')
            if KYCDocument.SIDE_BACK not in sides:
                missing.append('back')
            if missing:
                errors[doc_type] = (
                    f'{label} requires both front and back images '
                    f'(missing: {", ".join(missing)}).'
                )
        elif doc_type in SINGLE_SIDE_DOCUMENT_TYPES:
            if not (
                KYCDocument.SIDE_SINGLE in sides
                or KYCDocument.SIDE_FRONT in sides
            ):
                errors[doc_type] = (
                    f'{label} requires a document image (single or front).'
                )

    if errors:
        raise ValidationError({'documents': errors})
    return docs


def mark_submission_reviewed(submission, *, status, reviewer, rejection_reason=''):
    old_status = submission.status
    submission.status = status
    submission.reviewed_by = reviewer
    submission.reviewed_at = timezone.now()
    if status == KYCSubmission.STATUS_REJECTED:
        submission.rejection_reason = (rejection_reason or '').strip()
    else:
        submission.rejection_reason = ''
    submission.save(
        update_fields=[
            'status', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'updated_at',
        ]
    )
    sync_user_kyc_from_submission(submission.user, submission)
    action = (
        KYCAuditLog.ACTION_APPROVED
        if status == KYCSubmission.STATUS_APPROVED
        else KYCAuditLog.ACTION_REJECTED
    )
    log_kyc_audit(
        user=submission.user,
        action=action,
        actor=reviewer,
        submission=submission,
        old_status=old_status,
        new_status=status,
        details={
            'rejection_reason': submission.rejection_reason,
            'reviewed_by_id': reviewer.pk if reviewer else None,
        },
    )
    return submission
