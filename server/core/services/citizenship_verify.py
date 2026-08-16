"""
Compare remittance (sender-provided) citizenship data against OCR from front + back images.
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Optional

from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from .bs_ad import dates_equal, normalize_date_to_ad_iso, normalize_nepali_digits
from .citizenship_ocr import CombinedCitizenshipOcr, extract_citizenship_from_images

logger = logging.getLogger(__name__)

FIELD_KEYS = ('name', 'citizenship_number', 'dob', 'issue_date', 'issue_place')
REQUIRED_FIELDS = FIELD_KEYS

FIELD_LABELS = {
    'name': 'Name',
    'citizenship_number': 'Citizenship number',
    'dob': 'Date of birth',
    'issue_date': 'Issue date',
    'issue_place': 'Issue place',
}

# Weights for overall confidence (citizenship number is critical).
FIELD_WEIGHTS = {
    'name': 0.20,
    'citizenship_number': 0.35,
    'dob': 0.20,
    'issue_date': 0.15,
    'issue_place': 0.10,
}

FUZZY_MATCH_THRESHOLD = 0.78
FUZZY_PARTIAL_THRESHOLD = 0.55
NAME_TOKEN_COVERAGE_MATCH = 0.99

TICKET_TTL_SECONDS = 30 * 60
TICKET_CACHE_PREFIX = 'remittance_citizenship'
MAX_MISMATCH_ATTEMPTS = 2

_NAME_TITLES = {
    'mr', 'mrs', 'ms', 'miss', 'sri', 'shri', 'smt', 'dr', 'er',
    'श्री', 'श्रीमती', 'सुश्री',
}

_PLACE_ALIASES = {
    'ktm': 'kathmandu',
    'kathmandu metropolitan': 'kathmandu',
    'kathmandu metropolitan city': 'kathmandu',
    'kathmandu district': 'kathmandu',
    'lalitpur metropolitan': 'lalitpur',
    'lalitpur metropolitan city': 'lalitpur',
    'patan': 'lalitpur',
    'bhaktapur municipality': 'bhaktapur',
    'pokhara lekhnath': 'kaski',
    'pokhara': 'kaski',
}


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize('NFKD', text or '')
    return ''.join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_text(value: str) -> str:
    text = _strip_accents(value or '')
    text = normalize_nepali_digits(text)
    text = text.casefold()
    text = re.sub(r'[^\w\u0900-\u097F]+', ' ', text, flags=re.UNICODE)
    return re.sub(r'\s+', ' ', text).strip()


def normalize_citizenship_number(value: str) -> str:
    text = normalize_nepali_digits(value or '')
    text = (
        text.replace('O', '0')
        .replace('o', '0')
        .replace('I', '1')
        .replace('l', '1')
        .replace('|', '1')
    )
    text = text.casefold()
    return re.sub(r'[\s\-./]', '', text)


def citizenship_numbers_equal(a: str, b: str) -> bool:
    """
    Strict identity after OCR-confusable normalization.

    Also accepts a short district-prefix miss (OCR dropped leading 1–3 digits)
    when the remaining serial is at least 8 digits.
    """
    fa = normalize_citizenship_number(a)
    oa = normalize_citizenship_number(b)
    if not fa or not oa:
        return False
    if fa == oa:
        return True
    shorter, longer = (fa, oa) if len(fa) <= len(oa) else (oa, fa)
    if len(shorter) >= 8 and longer.endswith(shorter) and (len(longer) - len(shorter)) <= 3:
        return True
    return False


def fuzzy_ratio(a: str, b: str) -> float:
    na, nb = normalize_text(a), normalize_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    sa = ' '.join(sorted(na.split()))
    sb = ' '.join(sorted(nb.split()))
    return max(
        SequenceMatcher(None, na, nb).ratio(),
        SequenceMatcher(None, sa, sb).ratio(),
    )


def _name_tokens(value: str) -> list[str]:
    tokens = [tok for tok in normalize_text(value).split() if tok and tok not in _NAME_TITLES]
    return tokens


def name_match_ratio(a: str, b: str) -> float:
    """Fuzzy name score; full token coverage of the shorter name counts as a match."""
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return 0.0
    set_a, set_b = set(ta), set(tb)
    overlap = set_a & set_b
    coverage = len(overlap) / min(len(set_a), len(set_b))
    ratio = fuzzy_ratio(' '.join(ta), ' '.join(tb))
    if coverage >= NAME_TOKEN_COVERAGE_MATCH:
        return max(ratio, 0.92)
    return max(ratio, coverage * 0.9)


def _canonical_place(value: str) -> str:
    text = normalize_text(value)
    text = re.sub(r'\b(district|municipality|metropolitan|city|office|dao)\b', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return _PLACE_ALIASES.get(text, text)


def place_match_ratio(a: str, b: str) -> float:
    na, nb = _canonical_place(a), _canonical_place(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.92
    return fuzzy_ratio(na, nb)


def _status_from_ratio(ratio: float, *, strict: bool = False) -> str:
    if strict:
        return 'match' if ratio >= 0.999 else 'mismatch'
    if ratio >= FUZZY_MATCH_THRESHOLD:
        return 'match'
    if ratio >= FUZZY_PARTIAL_THRESHOLD:
        return 'partial'
    return 'mismatch'


def compare_field(
    key: str,
    form_value: str,
    ocr_value: str,
) -> dict[str, Any]:
    form_value = (form_value or '').strip()
    ocr_value = (ocr_value or '').strip()

    result: dict[str, Any] = {
        'field': key,
        'form_value': form_value,
        'ocr_value': ocr_value,
        'status': 'missing',
        'score': 0.0,
    }

    if not form_value and not ocr_value:
        return result
    if not form_value or not ocr_value:
        return result

    if key == 'citizenship_number':
        equal = citizenship_numbers_equal(form_value, ocr_value)
        result['score'] = 1.0 if equal else 0.0
        result['status'] = 'match' if equal else 'mismatch'
        result['normalized_form'] = normalize_citizenship_number(form_value)
        result['normalized_ocr'] = normalize_citizenship_number(ocr_value)
        return result

    if key in ('dob', 'issue_date'):
        equal = dates_equal(form_value, ocr_value)
        result['score'] = 1.0 if equal else 0.0
        result['status'] = 'match' if equal else 'mismatch'
        result['normalized_form'] = normalize_date_to_ad_iso(form_value) or form_value
        result['normalized_ocr'] = normalize_date_to_ad_iso(ocr_value, prefer_bs=True) or ocr_value
        return result

    if key == 'name':
        ratio = name_match_ratio(form_value, ocr_value)
    elif key == 'issue_place':
        ratio = place_match_ratio(form_value, ocr_value)
    else:
        ratio = fuzzy_ratio(form_value, ocr_value)
    result['score'] = round(ratio, 3)
    result['status'] = _status_from_ratio(ratio, strict=False)
    return result


def overall_match_status(field_results: list[dict[str, Any]]) -> str:
    statuses = {item['field']: item['status'] for item in field_results}

    if any(statuses.get(key) == 'mismatch' for key in REQUIRED_FIELDS):
        return 'MISMATCH'

    if any(statuses.get(key) == 'missing' for key in REQUIRED_FIELDS):
        # Nothing extracted at all → mismatch; some fields read → partial.
        present = [s for s in statuses.values() if s != 'missing']
        return 'PARTIAL MATCH' if present else 'MISMATCH'

    if any(statuses.get(key) == 'partial' for key in REQUIRED_FIELDS):
        return 'PARTIAL MATCH'

    if all(statuses.get(key) == 'match' for key in REQUIRED_FIELDS):
        return 'MATCH'

    return 'PARTIAL MATCH'


def is_receive_allowed(match_status: str) -> bool:
    return (match_status or '').upper() == 'MATCH'


def field_mismatch_messages(field_results: list[dict[str, Any]]) -> list[str]:
    messages: list[str] = []
    for item in field_results:
        label = FIELD_LABELS.get(item['field'], item['field'])
        status = item.get('status')
        form_value = item.get('form_value') or '—'
        ocr_value = item.get('ocr_value') or '—'
        if status == 'mismatch':
            messages.append(
                f'{label} does not match. Remittance/form: {form_value}; '
                f'citizenship image: {ocr_value}.'
            )
        elif status == 'missing':
            if not (item.get('ocr_value') or '').strip():
                messages.append(
                    f'Could not read {label} from the citizenship images. '
                    'Upload clearer front and back photos.'
                )
            else:
                messages.append(f'{label} is missing from the remittance details.')
        elif status == 'partial':
            messages.append(
                f'{label} only partially matches. Remittance/form: {form_value}; '
                f'citizenship image: {ocr_value}.'
            )
    return messages


def summary_message(match_status: str, messages: list[str]) -> str:
    if match_status == 'MATCH':
        return 'Citizenship details match the remittance information.'
    if messages:
        return messages[0]
    if match_status == 'PARTIAL MATCH':
        return (
            'Citizenship details only partially match. '
            'Correct the form or upload clearer front and back images.'
        )
    return (
        'Citizenship details do not match the remittance information. '
        'The remittance cannot be received.'
    )


def confidence_score(field_results: list[dict[str, Any]], ocr_confidence: float) -> float:
    weighted = 0.0
    total_w = 0.0
    for item in field_results:
        key = item['field']
        w = FIELD_WEIGHTS.get(key, 0.1)
        status = item['status']
        if status == 'missing':
            score = 0.0
        else:
            score = float(item.get('score') or 0.0)
        weighted += w * score
        total_w += w
    field_score = weighted / total_w if total_w else 0.0
    ocr_c = max(0.0, min(1.0, float(ocr_confidence or 0.0)))
    return round((field_score * 0.75) + (ocr_c * 0.25), 3)


def build_form_record(
    *,
    name: str = '',
    citizenship_number: str = '',
    dob: str = '',
    issue_date: str = '',
    issue_place: str = '',
) -> dict[str, str]:
    return {
        'name': (name or '').strip(),
        'citizenship_number': (citizenship_number or '').strip(),
        'dob': (dob or '').strip(),
        'issue_date': (issue_date or '').strip(),
        'issue_place': (issue_place or '').strip(),
    }


def verification_fingerprint(form: dict[str, str]) -> dict[str, str]:
    return {
        'name': normalize_text(form.get('name') or ''),
        'citizenship_number': normalize_citizenship_number(form.get('citizenship_number') or ''),
        'dob': normalize_date_to_ad_iso(form.get('dob') or '')
        or normalize_text(form.get('dob') or ''),
        'issue_date': normalize_date_to_ad_iso(form.get('issue_date') or '')
        or normalize_text(form.get('issue_date') or ''),
        'issue_place': _canonical_place(form.get('issue_place') or ''),
    }


def ticket_key(user_id, ref_no: str) -> str:
    return f'{TICKET_CACHE_PREFIX}:{user_id}:{str(ref_no or "").strip().upper()}'


def _citizenship_image_ext(uploaded, default: str = '.jpg') -> str:
    name = getattr(uploaded, 'name', '') or ''
    ext = os.path.splitext(name)[1].lower()
    if ext == '.jpeg':
        ext = '.jpg'
    if ext in ('.jpg', '.png', '.webp', '.gif'):
        return ext
    content_type = (getattr(uploaded, 'content_type', '') or '').lower()
    if 'png' in content_type:
        return '.png'
    if 'webp' in content_type:
        return '.webp'
    return default


def citizenship_image_storage_path(user_id, ref_no: str, side: str, ext: str) -> str:
    ref = re.sub(r'[^A-Za-z0-9_-]+', '_', str(ref_no or 'unknown').strip().upper())
    return f'remittance_citizenship/{user_id}/{ref}/{side}{ext}'


def persist_citizenship_images(user_id, ref_no: str, front, back) -> dict[str, str]:
    """Keep the original uploaded citizenship photos in storage for later attach."""
    paths: dict[str, str] = {}
    for side, uploaded in (('front', front), ('back', back)):
        if not uploaded:
            continue
        try:
            uploaded.seek(0)
        except Exception:
            pass
        data = uploaded.read() if hasattr(uploaded, 'read') else uploaded
        try:
            uploaded.seek(0)
        except Exception:
            pass
        if not data:
            continue
        ext = _citizenship_image_ext(uploaded)
        name = citizenship_image_storage_path(user_id, ref_no, side, ext)
        if default_storage.exists(name):
            default_storage.delete(name)
        saved = default_storage.save(name, ContentFile(data))
        paths[side] = saved
    return paths


def store_verification_ticket(user_id, ref_no: str, result: dict[str, Any]) -> None:
    if not ref_no:
        return
    cache.set(
        ticket_key(user_id, ref_no),
        {
            'allowed': bool(result.get('allowed')),
            'match_status': result.get('match_status'),
            'fingerprint': result.get('fingerprint') or {},
            'message': result.get('message') or '',
            'attempts': int(result.get('attempt_count') or 0),
            'pending_review_allowed': bool(result.get('pending_review_allowed')),
            'ocr': result.get('ocr') or {},
            'image_paths': result.get('image_paths') or {},
        },
        TICKET_TTL_SECONDS,
    )


def apply_attempt_state(user_id, ref_no: str, result: dict[str, Any]) -> dict[str, Any]:
    """
    Count unsuccessful matches (max 2). After two mismatches the remittance
    may be submitted as pending for admin review.
    """
    prev = load_verification_ticket(user_id, ref_no) or {}
    if not result.get('image_paths') and prev.get('image_paths'):
        result['image_paths'] = prev.get('image_paths')
    if result.get('allowed'):
        attempts = 0
        pending_review = False
    else:
        attempts = int(prev.get('attempts') or 0) + 1
        pending_review = attempts >= MAX_MISMATCH_ATTEMPTS
    result['attempt_count'] = attempts
    result['max_attempts'] = MAX_MISMATCH_ATTEMPTS
    result['attempts_remaining'] = (
        0 if result.get('allowed') else max(0, MAX_MISMATCH_ATTEMPTS - attempts)
    )
    result['pending_review_allowed'] = pending_review
    if pending_review:
        result['message'] = (
            (result.get('message') or 'Citizenship details do not match.')
            + ' After 2 unsuccessful matches you can submit this remittance '
            'as pending. Admin will review and update it shortly.'
        )
    store_verification_ticket(user_id, ref_no, result)
    return result


def load_verification_ticket(user_id, ref_no: str) -> Optional[dict[str, Any]]:
    data = cache.get(ticket_key(user_id, ref_no))
    return data if isinstance(data, dict) else None


def clear_verification_ticket(user_id, ref_no: str) -> None:
    cache.delete(ticket_key(user_id, ref_no))


def receive_block_reason(
    *,
    user_id,
    ref_no: str,
    form: dict[str, str],
) -> Optional[str]:
    """
    Return a user-facing error if this remittance must not be paid out.
    None means verification passed, or two mismatches allow pending review.
    """
    ticket = load_verification_ticket(user_id, ref_no)
    if not ticket:
        return (
            'Verify citizenship front and back images before receiving this remittance.'
        )
    if ticket.get('pending_review_allowed'):
        return None
    if ticket.get('allowed') and str(ticket.get('match_status') or '').upper() == 'MATCH':
        expected = ticket.get('fingerprint') or {}
        actual = verification_fingerprint(form)
        if expected != actual:
            return (
                'Citizenship details changed after verification. '
                'Upload the images and verify again before receiving.'
            )
        return None
    remaining = max(0, MAX_MISMATCH_ATTEMPTS - int(ticket.get('attempts') or 0))
    if remaining > 0:
        return (
            ticket.get('message')
            or 'Citizenship details do not match the remittance information. '
            f'Upload clearer images and try again ({remaining} attempt remaining).'
        )
    return (
        ticket.get('message')
        or 'Citizenship details do not match the remittance information. '
        'The remittance cannot be received.'
    )


def is_pending_review_ticket(ticket: Optional[dict[str, Any]]) -> bool:
    if not ticket:
        return False
    if ticket.get('allowed') and str(ticket.get('match_status') or '').upper() == 'MATCH':
        return False
    return bool(ticket.get('pending_review_allowed'))


def verify_citizenship(
    *,
    form: dict[str, str],
    ocr: CombinedCitizenshipOcr,
) -> dict[str, Any]:
    ocr_record = {
        'name': ocr.name,
        'citizenship_number': ocr.citizenship_number,
        'dob': ocr.dob,
        'issue_date': ocr.issue_date,
        'issue_place': ocr.issue_place,
    }
    field_results = [
        compare_field(key, form.get(key, ''), ocr_record.get(key, ''))
        for key in FIELD_KEYS
    ]
    match_status = overall_match_status(field_results)
    messages = field_mismatch_messages(field_results)
    if any('do not match each other' in err for err in (ocr.errors or [])):
        match_status = 'MISMATCH'
        messages.insert(0, ocr.errors[0])
    allowed = is_receive_allowed(match_status)
    score = confidence_score(field_results, ocr.confidence)
    message = summary_message(match_status, messages)
    return {
        'match_status': match_status,
        'allowed': allowed,
        'confidence_score': score,
        'fields': field_results,
        'form': form,
        'ocr': ocr_record,
        'ocr_detail': {
            'front': ocr.front,
            'back': ocr.back,
            'confidence': ocr.confidence,
            'errors': ocr.errors,
        },
        'ocr_errors': ocr.errors,
        'ocr_confidence': ocr.confidence,
        'mismatch_messages': messages,
        'message': message,
        'fingerprint': verification_fingerprint(form),
        'extracted_from_nepali': bool(getattr(ocr, 'extracted_from_nepali', False)),
        'extracted': ocr_record,
    }


def verify_citizenship_images(
    *,
    front,
    back,
    name: str = '',
    citizenship_number: str = '',
    dob: str = '',
    issue_date: str = '',
    issue_place: str = '',
) -> dict[str, Any]:
    """End-to-end: OCR front+back, auto-fill missing English fields, then compare."""
    ocr = extract_citizenship_from_images(front, back)
    form = build_form_record(
        name=name,
        citizenship_number=citizenship_number or ocr.citizenship_number,
        dob=dob or ocr.dob,
        issue_date=issue_date or ocr.issue_date,
        issue_place=issue_place or ocr.issue_place,
    )
    return verify_citizenship(form=form, ocr=ocr)
