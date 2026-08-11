"""
Compare remittance citizenship form data against OCR-extracted citizenship fields.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from .bs_ad import dates_equal, normalize_date_to_ad_iso, normalize_nepali_digits
from .citizenship_ocr import CombinedCitizenshipOcr, extract_citizenship_from_images

FIELD_KEYS = ('name', 'citizenship_number', 'dob', 'issue_date', 'issue_place')

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
    text = text.casefold()
    return re.sub(r'[\s\-./]', '', text)


def fuzzy_ratio(a: str, b: str) -> float:
    na, nb = normalize_text(a), normalize_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    # Token-sort style: compare sorted tokens to tolerate name order differences.
    sa = ' '.join(sorted(na.split()))
    sb = ' '.join(sorted(nb.split()))
    return max(
        SequenceMatcher(None, na, nb).ratio(),
        SequenceMatcher(None, sa, sb).ratio(),
    )


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
        result['status'] = 'missing'
        result['score'] = 0.0
        return result
    if not form_value or not ocr_value:
        result['status'] = 'missing'
        result['score'] = 0.0
        return result

    if key == 'citizenship_number':
        fa = normalize_citizenship_number(form_value)
        oa = normalize_citizenship_number(ocr_value)
        score = 1.0 if fa and fa == oa else 0.0
        result['score'] = score
        result['status'] = 'match' if score == 1.0 else 'mismatch'
        result['normalized_form'] = fa
        result['normalized_ocr'] = oa
        return result

    if key in ('dob', 'issue_date'):
        equal = dates_equal(form_value, ocr_value)
        result['score'] = 1.0 if equal else 0.0
        result['status'] = 'match' if equal else 'mismatch'
        result['normalized_form'] = normalize_date_to_ad_iso(form_value) or form_value
        result['normalized_ocr'] = normalize_date_to_ad_iso(ocr_value, prefer_bs=True) or ocr_value
        return result

    # name / issue_place — fuzzy
    ratio = fuzzy_ratio(form_value, ocr_value)
    result['score'] = round(ratio, 3)
    result['status'] = _status_from_ratio(ratio, strict=False)
    return result


def overall_match_status(field_results: list[dict[str, Any]]) -> str:
    statuses = {item['field']: item['status'] for item in field_results}
    # Hard fail on citizenship number mismatch.
    if statuses.get('citizenship_number') == 'mismatch':
        return 'MISMATCH'

    present = [s for s in statuses.values() if s != 'missing']
    if not present:
        return 'MISMATCH'

    if all(s == 'match' for s in present) and statuses.get('citizenship_number') == 'match':
        # Require the critical ID number; other missing fields → partial.
        missing_optional = [
            k for k in ('name', 'dob', 'issue_date', 'issue_place')
            if statuses.get(k) == 'missing'
        ]
        if missing_optional:
            return 'PARTIAL MATCH'
        return 'MATCH'

    if any(s == 'mismatch' for s in present):
        # Soft mismatches on fuzzy fields with matching citizenship → partial
        hard = statuses.get('citizenship_number') == 'mismatch'
        date_mismatch = (
            statuses.get('dob') == 'mismatch' or statuses.get('issue_date') == 'mismatch'
        )
        if hard or date_mismatch:
            return 'MISMATCH'
        return 'PARTIAL MATCH'

    if any(s == 'partial' for s in present) or any(s == 'missing' for s in statuses.values()):
        return 'PARTIAL MATCH'

    return 'MATCH'


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
    score = confidence_score(field_results, ocr.confidence)
    return {
        'match_status': match_status,
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
    """End-to-end: OCR front+back, then compare against form fields."""
    ocr = extract_citizenship_from_images(front, back)
    form = build_form_record(
        name=name,
        citizenship_number=citizenship_number,
        dob=dob,
        issue_date=issue_date,
        issue_place=issue_place,
    )
    return verify_citizenship(form=form, ocr=ocr)
