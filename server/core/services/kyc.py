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
    """
    Admin-only review step. KYC never auto-verifies — only Approve or Reject
    (reject requires a reason) may leave Pending.
    """
    if submission.status != KYCSubmission.STATUS_PENDING:
        raise ValidationError(
            f'KYC submission is already {submission.status}'
        )
    if status not in (
        KYCSubmission.STATUS_APPROVED,
        KYCSubmission.STATUS_REJECTED,
    ):
        raise ValidationError('Review status must be approved or rejected.')

    reason = (rejection_reason or '').strip()
    if status == KYCSubmission.STATUS_REJECTED and not reason:
        raise ValidationError({'rejection_reason': 'Rejection reason is required.'})

    old_status = submission.status
    submission.status = status
    submission.reviewed_by = reviewer
    submission.reviewed_at = timezone.now()
    submission.rejection_reason = (
        reason if status == KYCSubmission.STATUS_REJECTED else ''
    )
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


def update_pending_kyc_submission(
    submission,
    *,
    actor,
    citizenship_number=None,
    first_name=None,
    last_name=None,
    date_of_birth=None,
):
    """
    Super Admin / staff correction of a pending KYC before approve/reject.
    Updates citizenship on the submission and identity fields on the user
    so approval can proceed without forcing the user to resubmit.
    """
    if submission.status != KYCSubmission.STATUS_PENDING:
        raise ValidationError(
            f'Only pending KYC submissions can be edited (currently {submission.status}).'
        )

    user = submission.user
    changes = {}

    if citizenship_number is not None:
        number = (citizenship_number or '').strip()
        if len(number) < 3:
            raise ValidationError({'citizenship_number': 'Citizenship number is required.'})
        if number != (submission.citizenship_number or '').strip():
            changes['citizenship_number'] = {
                'old': submission.citizenship_number,
                'new': number,
            }
            submission.citizenship_number = number
            submission.save(update_fields=['citizenship_number', 'updated_at'])

    user_updates = {}
    if first_name is not None:
        value = (first_name or '').strip()
        if value != (user.first_name or '').strip():
            changes['first_name'] = {'old': user.first_name, 'new': value}
            user_updates['first_name'] = value
    if last_name is not None:
        value = (last_name or '').strip()
        if value != (user.last_name or '').strip():
            changes['last_name'] = {'old': user.last_name, 'new': value}
            user_updates['last_name'] = value
    if date_of_birth is not None:
        # Allow clearing with empty string → None; accept ISO date strings.
        new_dob = date_of_birth
        if isinstance(new_dob, str):
            raw = new_dob.strip()
            if not raw:
                new_dob = None
            else:
                try:
                    new_dob = date.fromisoformat(raw)
                except ValueError as exc:
                    raise ValidationError(
                        {'date_of_birth': 'Enter date of birth as YYYY-MM-DD.'}
                    ) from exc
        if new_dob != user.date_of_birth:
            changes['date_of_birth'] = {
                'old': str(user.date_of_birth) if user.date_of_birth else None,
                'new': str(new_dob) if new_dob else None,
            }
            user_updates['date_of_birth'] = new_dob

    if user_updates:
        for key, value in user_updates.items():
            setattr(user, key, value)
        user.save(update_fields=[*user_updates.keys()])

    # Keep denormalized citizenship in sync even if only name/DOB changed.
    sync_user_kyc_from_submission(user, submission)

    if changes:
        log_kyc_audit(
            user=user,
            action=KYCAuditLog.ACTION_UPDATED,
            actor=actor,
            submission=submission,
            old_status=submission.status,
            new_status=submission.status,
            details={'admin_corrections': changes},
        )

    return submission
