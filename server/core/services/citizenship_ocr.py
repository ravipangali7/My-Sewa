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


def _ocr_pass(img: Image.Image, lang: str, psm: int) -> tuple[str, float]:
    import pytesseract

    config = f'--psm {psm}'
    data = pytesseract.image_to_data(
        img,
        lang=lang,
        output_type=pytesseract.Output.DICT,
        config=config,
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
        text = pytesseract.image_to_string(img, lang=lang, config=config)
    mean_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return text, mean_conf


def _ocr_image(img: Image.Image) -> tuple[str, float, list[str]]:
    """Run Tesseract and return (text, mean_confidence 0-1, errors).

    Tries Nepali+English first, then extra page-segmentation modes if the
    first pass yields little structured text.
    """
    ok, err = _tesseract_available()
    if not ok:
        return '', 0.0, [err]

    import pytesseract

    errors: list[str] = []
    processed = _preprocess(img)
    langs_to_try = ('nep+eng', 'eng+nep', 'eng')
    psms = (6, 4, 11)
    best_text = ''
    best_conf = 0.0
    best_filled = -1

    for lang in langs_to_try:
        for psm in psms:
            try:
                text, mean_conf = _ocr_pass(processed, lang, psm)
            except pytesseract.TesseractError as exc:
                errors.append(f'OCR lang={lang} psm={psm} failed: {exc}')
                continue
            except Exception as exc:  # pragma: no cover
                errors.append(f'OCR lang={lang} psm={psm} error: {exc}')
                continue
            if not (text or '').strip():
                continue
            filled = _field_fill_count(parse_citizenship_text(text))
            # Prefer more extracted fields; break early on a strong read.
            if filled > best_filled or (filled == best_filled and mean_conf > best_conf):
                best_text, best_conf, best_filled = text, mean_conf, filled
            if filled >= 4:
                return best_text, best_conf, errors
        if best_filled >= 3:
            break

    if not (best_text or '').strip():
        errors.append('No text could be extracted from the citizenship image')
    return best_text, best_conf, errors


_CITIZENSHIP_NO_PATTERNS = [
    re.compile(
        r'(?:citizenship\s*(?:certificate\s*)?(?:no\.?|number|#)|'
        r'certificate\s*(?:no\.?|number|#)|'
        r'registration\s*(?:no\.?|number|#)|'
        r'reg\.?\s*no\.?|'
        r'cit\.?\s*no\.?|'
        r'नागरिकता\s*(?:प्रमाणपत्र\s*)?(?:नं\.?|नम्बर)|'
        r'प्रमाणपत्र\s*(?:नं\.?|नम्बर)|'
        r'दर्ता\s*(?:नं\.?|नम्बर))'
        r'[\s:#\-]*([A-Za-z0-9०-९][A-Za-z0-9०-९\-/\.]{2,30})',
        re.IGNORECASE,
    ),
    # District-year-serial style: 28-01-75-01234 or 12-34-56789
    re.compile(r'(?<!\d)(\d{1,3}[-/]\d{1,4}[-/]\d{1,4}(?:[-/]\d{1,8})?)(?!\d)'),
    re.compile(r'(?<!\d)(\d{5,12})(?!\d)'),
]

_CITIZENSHIP_NO_STOPWORDS = {
    'certificate', 'citizenship', 'registration', 'number', 'nepal', 'government',
    'name', 'date', 'birth', 'issue', 'place', 'district', 'sex', 'gender',
}

_NAME_STOPWORDS = {
    'nepal', 'government', 'citizenship', 'certificate', 'national', 'identity',
    'federal', 'democratic', 'republic', 'ministry', 'home', 'affairs',
    'नागरिकता', 'प्रमाणपत्र', 'नेपाल', 'सरकार',
}

_NAME_PATTERNS = [
    re.compile(
        r'(?:full\s*name|holder(?:\'s)?\s*name|name\s*in\s*english|'
        r'name|नाम थर|नाम)'
        r'[:\s]+([A-Za-z][A-Za-z .]{2,60}|[\u0900-\u097F ]{3,60})',
        re.IGNORECASE,
    ),
    re.compile(
        r'(?:full\s*name|holder(?:\'s)?\s*name|name|नाम थर|नाम)[:\s]*[\r\n]+\s*'
        r'([A-Za-z][A-Za-z .]{2,60}|[\u0900-\u097F ]{3,60})',
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
        r'जारी\s*(?:जिल्ला|स्थान|कार्यालय)|जिल्ला)[:\s]+([A-Za-z][A-Za-z. ]{2,40}|[\u0900-\u097F ]{2,40})',
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


def _looks_like_date_token(raw: str) -> bool:
    """Reject DOB/issue dates accidentally captured as a citizenship number."""
    text = normalize_nepali_digits(raw or '').strip()
    if re.match(r'^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$', text):
        return True
    if re.match(r'^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$', text):
        return True
    digits = re.sub(r'\D', '', text)
    if len(digits) == 8:
        year = int(digits[:4])
        if 1900 <= year <= 2100:
            month = int(digits[4:6])
            if 1 <= month <= 12:
                return True
    return False


def _clean_citizenship_number(raw: str) -> str:
    raw = normalize_nepali_digits(raw or '')
    # OCR often reads 0/O and 1/I/l in numeric IDs.
    raw = raw.replace('O', '0').replace('o', '0').replace('I', '1').replace('l', '1')
    raw = re.sub(r'\s+', '', raw)
    raw = raw.strip(':-.,;')
    if not raw:
        return ''
    if raw.casefold() in _CITIZENSHIP_NO_STOPWORDS:
        return ''
    if not re.search(r'\d', raw):
        return ''
    if _looks_like_date_token(raw):
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
    raw = re.split(
        r'\b(?:DOB|Date|Citizenship|Sex|Gender|Address|Nationality|Occupation)\b',
        raw,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    raw = raw.strip(' :-')
    if raw.casefold() in _NAME_STOPWORDS:
        return ''
    return raw


def _fallback_name(text: str) -> str:
    """Pick an ALL-CAPS / title-case person name line when labels are missing."""
    for line in (text or '').splitlines():
        candidate = _clean_name(line)
        if not candidate:
            continue
        lower = candidate.casefold()
        if any(stop in lower for stop in _NAME_STOPWORDS):
            continue
        if re.search(r'\d', candidate):
            continue
        words = candidate.split()
        if 2 <= len(words) <= 5 and all(
            re.match(r"^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F'.-]*$", w) for w in words
        ):
            if candidate.isupper() or all(w[:1].isupper() for w in words):
                return candidate
    return ''


def _field_fill_count(parsed: CitizenshipOcrFields) -> int:
    return sum(
        1
        for v in (
            parsed.name,
            parsed.citizenship_number,
            parsed.dob,
            parsed.issue_date,
            parsed.issue_place,
        )
        if v
    )


def parse_citizenship_text(text: str, *, side: str = '') -> CitizenshipOcrFields:
    """Parse OCR text from one citizenship side into structured fields."""
    errors: list[str] = []
    if not (text or '').strip():
        errors.append(f'Empty OCR text{" for " + side if side else ""}')
        return CitizenshipOcrFields(errors=errors)

    normalized = normalize_nepali_digits(text)
    has_nepali = bool(re.search(r'[\u0900-\u097F]', text))
    language_hint = 'nepali+english' if has_nepali else 'english'

    name = _clean_name(
        _first_match(_NAME_PATTERNS, text) or _first_match(_NAME_PATTERNS, normalized)
    ) or _fallback_name(text) or _fallback_name(normalized)
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


def _numbers_conflict(a: str, b: str) -> bool:
    fa = re.sub(r'[\s\-./]', '', normalize_nepali_digits(a or '')).casefold()
    oa = re.sub(r'[\s\-./]', '', normalize_nepali_digits(b or '')).casefold()
    if not fa or not oa:
        return False
    if fa == oa:
        return False
    shorter, longer = (fa, oa) if len(fa) <= len(oa) else (oa, fa)
    if len(shorter) >= 8 and longer.endswith(shorter) and (len(longer) - len(shorter)) <= 3:
        return False
    return True


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
    merged_text = '\n'.join(
        part for part in (front_result.raw_text, back_result.raw_text) if part
    )
    merged_parsed = (
        parse_citizenship_text(merged_text, side='combined')
        if merged_text
        else CitizenshipOcrFields()
    )

    errors = [*front_result.errors, *back_result.errors]
    if _numbers_conflict(front_result.citizenship_number, back_result.citizenship_number):
        errors.append(
            'Front and back citizenship numbers do not match each other. '
            'Upload the front and back of the same certificate.'
        )

    combined = CombinedCitizenshipOcr(
        name=_prefer(front_result.name, back_result.name, merged_parsed.name),
        citizenship_number=_prefer(
            front_result.citizenship_number,
            back_result.citizenship_number,
            merged_parsed.citizenship_number,
        ),
        dob=_prefer(front_result.dob, back_result.dob, merged_parsed.dob),
        issue_date=_prefer(
            back_result.issue_date,
            front_result.issue_date,
            merged_parsed.issue_date,
        ),
        issue_place=_prefer(
            back_result.issue_place,
            front_result.issue_place,
            merged_parsed.issue_place,
        ),
        front=front_result.to_dict(),
        back=back_result.to_dict(),
        confidence=round(
            (front_result.confidence + back_result.confidence) / 2.0,
            3,
        ),
        errors=errors,
    )
    if not combined.citizenship_number and not combined.name:
        errors.append(
            'Could not read name or citizenship number from the uploaded images. '
            'Use clearer, well-lit photos of both sides.'
        )
        combined.errors = errors
    return combined
