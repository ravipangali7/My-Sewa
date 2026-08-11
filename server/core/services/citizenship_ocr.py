"""
Citizenship certificate OCR: extract structured fields from front + back images.

Uses Tesseract (pytesseract) with English + Nepali language packs when available.
Falls back to English-only OCR if `nep` is not installed.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from io import BytesIO
from typing import Any, BinaryIO, Optional, Union

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .bs_ad import normalize_date_to_ad_iso, normalize_nepali_digits

logger = logging.getLogger(__name__)

FileLike = Union[BinaryIO, bytes]


@dataclass
class CitizenshipOcrFields:
    name: str = ''
    citizenship_number: str = ''
    dob: str = ''
    issue_date: str = ''
    issue_place: str = ''
    raw_text: str = ''
    confidence: float = 0.0
    errors: list[str] = field(default_factory=list)
    language_hint: str = ''

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CombinedCitizenshipOcr:
    name: str = ''
    citizenship_number: str = ''
    dob: str = ''
    issue_date: str = ''
    issue_place: str = ''
    front: dict[str, Any] = field(default_factory=dict)
    back: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _open_image(data: FileLike) -> Image.Image:
    if isinstance(data, (bytes, bytearray)):
        raw = bytes(data)
    else:
        raw = data.read()
        try:
            data.seek(0)
        except Exception:
            pass
    img = Image.open(BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    return img.convert('RGB')


def _preprocess(img: Image.Image) -> Image.Image:
    """Light preprocessing to improve Tesseract accuracy on scanned IDs."""
    gray = ImageOps.grayscale(img)
    # Upscale small images
    w, h = gray.size
    if max(w, h) < 1200:
        scale = 1200 / max(w, h)
        gray = gray.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    gray = ImageOps.autocontrast(gray)
    gray = ImageEnhance.Contrast(gray).enhance(1.4)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray


def _tesseract_available() -> tuple[bool, str]:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False, 'pytesseract is not installed'
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
    except Exception as exc:  # pragma: no cover - env dependent
        return False, f'Tesseract OCR engine is not available: {exc}'
    return True, ''


def _ocr_image(img: Image.Image) -> tuple[str, float, list[str]]:
    """Run Tesseract and return (text, mean_confidence 0-1, errors)."""
    ok, err = _tesseract_available()
    if not ok:
        return '', 0.0, [err]

    import pytesseract

    errors: list[str] = []
    processed = _preprocess(img)
    # Prefer nep+eng when Nepali pack exists; fall back to eng.
    langs_to_try = ('nep+eng', 'eng+nep', 'eng')
    last_text = ''
    last_conf = 0.0

    for lang in langs_to_try:
        try:
            data = pytesseract.image_to_data(
                processed,
                lang=lang,
                output_type=pytesseract.Output.DICT,
                config='--psm 6',
            )
            words = []
            confs = []
            for text, conf in zip(data.get('text', []), data.get('conf', [])):
                token = (text or '').strip()
                if not token:
                    continue
                words.append(token)
                try:
                    c = float(conf)
                except (TypeError, ValueError):
                    c = -1
                if c >= 0:
                    confs.append(c)
            text = ' '.join(words)
            if not text.strip():
                text = pytesseract.image_to_string(processed, lang=lang, config='--psm 6')
            mean_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
            if text.strip():
                return text, mean_conf, errors
            last_text, last_conf = text, mean_conf
        except pytesseract.TesseractError as exc:
            errors.append(f'OCR lang={lang} failed: {exc}')
            continue
        except Exception as exc:  # pragma: no cover
            errors.append(f'OCR lang={lang} error: {exc}')
            continue

    if not last_text.strip():
        errors.append('No text could be extracted from the citizenship image')
    return last_text, last_conf, errors


_CITIZENSHIP_NO_PATTERNS = [
    re.compile(
        r'(?:citizenship\s*(?:certificate\s*)?(?:no\.?|number|#)|'
        r'certificate\s*(?:no\.?|number|#)|'
        r'registration\s*(?:no\.?|number|#)|'
        r'reg\.?\s*no\.?|'
        r'नागरिकता\s*(?:नं\.?|नम्बर)|'
        r'प्रमाणपत्र\s*(?:नं\.?|नम्बर)|'
        r'दर्ता\s*(?:नं\.?|नम्बर))'
        r'[\s:#\-]*([A-Za-z0-9०-९][A-Za-z0-9०-९\-/\.]{2,30})',
        re.IGNORECASE,
    ),
    re.compile(r'(?<!\d)(\d{1,3}[-/]\d{1,3}[-/]\d{2,6})(?!\d)'),
    re.compile(r'(?<!\d)(\d{5,12})(?!\d)'),
]

_CITIZENSHIP_NO_STOPWORDS = {
    'certificate', 'citizenship', 'registration', 'number', 'nepal', 'government',
    'name', 'date', 'birth', 'issue', 'place', 'district', 'sex', 'gender',
}

_NAME_PATTERNS = [
    re.compile(
        r'(?:full\s*name|name|नाम|नाम थर|holder)[:\s]+([A-Za-z][A-Za-z\s.]{2,60}|[\u0900-\u097F\s]{3,60})',
        re.IGNORECASE,
    ),
]

_DOB_PATTERNS = [
    re.compile(
        r'(?:date\s*of\s*birth|dob|birth\s*date|जन्म\s*मिति|जन्ममिति)[:\s]*([0-9०-९./\-\s]{6,20})',
        re.IGNORECASE,
    ),
]

_ISSUE_DATE_PATTERNS = [
    re.compile(
        r'(?:date\s*of\s*issue|issue\s*date|issued\s*on|जारी\s*मिति|जारीमिति)[:\s]*([0-9०-९./\-\s]{6,20})',
        re.IGNORECASE,
    ),
]

_ISSUE_PLACE_PATTERNS = [
    re.compile(
        r'(?:place\s*of\s*issue|issued\s*(?:from|by|at)|issuing\s*(?:district|office|authority)|'
        r'जारी\s*(?:जिल्ला|स्थान|कार्यालय)|जिल्ला)[:\s]+([A-Za-z][A-Za-z\s.]{2,40}|[\u0900-\u097F\s]{2,40})',
        re.IGNORECASE,
    ),
]

_DISTRICT_HINTS = [
    'Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Kaski', 'Chitwan', 'Morang',
    'Sunsari', 'Jhapa', 'Rupandehi', 'Banke', 'Kailali', 'Kanchanpur', 'Dang',
    'Makwanpur', 'Parsa', 'Bara', 'Rautahat', 'Sarlahi', 'Mahottari', 'Dhanusha',
    'Siraha', 'Saptari', 'Udayapur', 'Dhankuta', 'Ilam', 'Panchthar', 'Taplejung',
    'Sindhupalchok', 'Kavre', 'Nuwakot', 'Dhading', 'Gorkha', 'Tanahun', 'Syangja',
    'Palpa', 'Gulmi', 'Arghakhanchi', 'Kapilvastu', 'Nawalparasi', 'Bardiya',
    'Surkhet', 'Dailekh', 'Jumla', 'Humla', 'Dolpa', 'Mustang', 'Myagdi', 'Baglung',
    'Parbat', 'Lamjung', 'Manang', 'Rasuwa', 'Sindhuli', 'Ramechhap', 'Dolakha',
    'Solukhumbu', 'Okhaldhunga', 'Khotang', 'Bhojpur', 'Sankhuwasabha', 'Terhathum',
    'काठमाडौं', 'ललितपुर', 'भक्तपुर', 'कास्की', 'चितवन', 'मोरङ', 'झापा',
]


def _first_match(patterns: list[re.Pattern[str]], text: str) -> str:
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m.group(1).strip(' :-\n\t.,;')
    return ''


def _extract_issue_place(text: str) -> str:
    place = _first_match(_ISSUE_PLACE_PATTERNS, text)
    if place:
        return re.sub(r'\s+', ' ', place).strip()
    # Fallback: known district name appearing in text
    lower = text.lower()
    for district in _DISTRICT_HINTS:
        if district.lower() in lower:
            return district
    return ''


def _clean_citizenship_number(raw: str) -> str:
    raw = normalize_nepali_digits(raw or '')
    raw = re.sub(r'\s+', '', raw)
    raw = raw.strip(':-.,;')
    if not raw:
        return ''
    if raw.casefold() in _CITIZENSHIP_NO_STOPWORDS:
        return ''
    # Citizenship / registration numbers always include at least one digit.
    if not re.search(r'\d', raw):
        return ''
    return raw


def _extract_citizenship_number(text: str) -> str:
    for pat in _CITIZENSHIP_NO_PATTERNS:
        for m in pat.finditer(text):
            cleaned = _clean_citizenship_number(m.group(1))
            if cleaned:
                return cleaned
    return ''


def _clean_name(raw: str) -> str:
    raw = re.sub(r'\s+', ' ', (raw or '').strip())
    # Drop trailing labels accidentally captured
    raw = re.split(r'\b(?:DOB|Date|Citizenship|Sex|Gender|Address)\b', raw, maxsplit=1)[0]
    return raw.strip(' :-')


def parse_citizenship_text(text: str, *, side: str = '') -> CitizenshipOcrFields:
    """Parse OCR text from one citizenship side into structured fields."""
    errors: list[str] = []
    if not (text or '').strip():
        errors.append(f'Empty OCR text{" for " + side if side else ""}')
        return CitizenshipOcrFields(errors=errors)

    normalized = normalize_nepali_digits(text)
    has_nepali = bool(re.search(r'[\u0900-\u097F]', text))
    language_hint = 'nepali+english' if has_nepali else 'english'

    name = _clean_name(_first_match(_NAME_PATTERNS, text) or _first_match(_NAME_PATTERNS, normalized))
    citizenship_number = _extract_citizenship_number(normalized)
    dob_raw = _first_match(_DOB_PATTERNS, normalized)
    issue_raw = _first_match(_ISSUE_DATE_PATTERNS, normalized)
    issue_place = _extract_issue_place(text) or _extract_issue_place(normalized)

    dob = ''
    if dob_raw:
        dob = (
            normalize_date_to_ad_iso(dob_raw, prefer_bs=True)
            or normalize_date_to_ad_iso(dob_raw, prefer_bs=False)
            or normalize_nepali_digits(dob_raw).strip()
        )

    issue_date = ''
    if issue_raw:
        issue_date = (
            normalize_date_to_ad_iso(issue_raw, prefer_bs=True)
            or normalize_date_to_ad_iso(issue_raw, prefer_bs=False)
            or normalize_nepali_digits(issue_raw).strip()
        )

    filled = sum(
        1
        for v in (name, citizenship_number, dob, issue_date, issue_place)
        if v
    )
    if filled == 0:
        errors.append(f'Could not extract citizenship fields{" from " + side if side else ""}')

    # Heuristic confidence from field coverage (OCR engine conf layered by caller).
    field_conf = filled / 5.0
    return CitizenshipOcrFields(
        name=name,
        citizenship_number=citizenship_number,
        dob=dob,
        issue_date=issue_date,
        issue_place=issue_place,
        raw_text=text[:4000],
        confidence=round(field_conf, 3),
        errors=errors,
        language_hint=language_hint,
    )


def ocr_citizenship_side(data: FileLike, *, side: str) -> CitizenshipOcrFields:
    try:
        img = _open_image(data)
    except Exception as exc:
        return CitizenshipOcrFields(errors=[f'Invalid {side} image: {exc}'])

    text, engine_conf, errors = _ocr_image(img)
    parsed = parse_citizenship_text(text, side=side)
    parsed.errors = [*errors, *parsed.errors]
    # Blend engine confidence with field coverage.
    if engine_conf > 0:
        parsed.confidence = round((engine_conf * 0.55) + (parsed.confidence * 0.45), 3)
    return parsed


def _prefer(*values: str) -> str:
    for v in values:
        if (v or '').strip():
            return v.strip()
    return ''


def extract_citizenship_from_images(
    front: FileLike,
    back: FileLike,
) -> CombinedCitizenshipOcr:
    """
    OCR both sides and merge into one structured citizenship record.
    Front typically holds name / number / DOB; back often holds issue date / place.
    """
    front_result = ocr_citizenship_side(front, side='front')
    back_result = ocr_citizenship_side(back, side='back')

    combined = CombinedCitizenshipOcr(
        name=_prefer(front_result.name, back_result.name),
        citizenship_number=_prefer(
            front_result.citizenship_number, back_result.citizenship_number
        ),
        dob=_prefer(front_result.dob, back_result.dob),
        issue_date=_prefer(back_result.issue_date, front_result.issue_date),
        issue_place=_prefer(
            back_result.issue_place,
            front_result.issue_place,
        ),
        front=front_result.to_dict(),
        back=back_result.to_dict(),
        confidence=round(
            (front_result.confidence + back_result.confidence) / 2.0,
            3,
        ),
        errors=[*front_result.errors, *back_result.errors],
    )
    return combined
