"""
Convert Devanagari (Nepali) citizenship text into English.

Prefers known district names, then romanizes remaining Nepali words so
OCR can fill name / issue district when the English side is unreadable.
"""
from __future__ import annotations

import re
import unicodedata

DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]')

# Official 77 districts (Nepali → English). Longer spellings first.
_DISTRICT_PAIRS = (
    ('सिन्धुपाल्चोक', 'Sindhupalchok'),
    ('काभ्रेपलान्चोक', 'Kavrepalanchok'),
    ('नवलपरासी पूर्व', 'Nawalparasi East'),
    ('नवलपरासी पश्चिम', 'Nawalparasi West'),
    ('रुकुम पूर्व', 'Rukum East'),
    ('रुकुम पश्चिम', 'Rukum West'),
    ('संखुवासभा', 'Sankhuwasabha'),
    ('सोलुखुम्बु', 'Solukhumbu'),
    ('ओखलढुंगा', 'Okhaldhunga'),
    ('उदयपुर', 'Udayapur'),
    ('धनकुटा', 'Dhankuta'),
    ('तेह्रथुम', 'Terhathum'),
    ('पाँचथर', 'Panchthar'),
    ('ताप्लेजुङ', 'Taplejung'),
    ('ताप्लेजुंग', 'Taplejung'),
    ('भोजपुर', 'Bhojpur'),
    ('खोटाङ', 'Khotang'),
    ('सुनसरी', 'Sunsari'),
    ('मोरङ', 'Morang'),
    ('झापा', 'Jhapa'),
    ('सप्तरी', 'Saptari'),
    ('सिराहा', 'Siraha'),
    ('धनुषा', 'Dhanusha'),
    ('महोत्तरी', 'Mahottari'),
    ('सर्लाही', 'Sarlahi'),
    ('रौतहट', 'Rautahat'),
    ('बारा', 'Bara'),
    ('पर्सा', 'Parsa'),
    ('मकवानपुर', 'Makwanpur'),
    ('चितवन', 'Chitwan'),
    ('धादिङ', 'Dhading'),
    ('नुवाकोट', 'Nuwakot'),
    ('रसुवा', 'Rasuwa'),
    ('दोलखा', 'Dolakha'),
    ('रामेछाप', 'Ramechhap'),
    ('सिन्धुली', 'Sindhuli'),
    ('काठमाडौँ', 'Kathmandu'),
    ('काठमाडौं', 'Kathmandu'),
    ('काठमाण्डौ', 'Kathmandu'),
    ('ललितपुर', 'Lalitpur'),
    ('भक्तपुर', 'Bhaktapur'),
    ('काभ्रे', 'Kavre'),
    ('गोरखा', 'Gorkha'),
    ('लमजुङ', 'Lamjung'),
    ('तनहुँ', 'Tanahun'),
    ('तनहुन', 'Tanahun'),
    ('कास्की', 'Kaski'),
    ('स्याङ्जा', 'Syangja'),
    ('मनाङ', 'Manang'),
    ('मुस्ताङ', 'Mustang'),
    ('म्याग्दी', 'Myagdi'),
    ('बागलुङ', 'Baglung'),
    ('पर्वत', 'Parbat'),
    ('नवलपरासी', 'Nawalparasi'),
    ('पाल्पा', 'Palpa'),
    ('गुल्मी', 'Gulmi'),
    ('अर्घाखाँची', 'Arghakhanchi'),
    ('कपिलवस्तु', 'Kapilvastu'),
    ('रुपन्देही', 'Rupandehi'),
    ('दाङ', 'Dang'),
    ('प्युठान', 'Pyuthan'),
    ('रोल्पा', 'Rolpa'),
    ('रुकुम', 'Rukum'),
    ('बाँके', 'Banke'),
    ('बर्दिया', 'Bardiya'),
    ('सुर्खेत', 'Surkhet'),
    ('दैलेख', 'Dailekh'),
    ('जाजरकोट', 'Jajarkot'),
    ('डोल्पा', 'Dolpa'),
    ('जुम्ला', 'Jumla'),
    ('कालिकोट', 'Kalikot'),
    ('मुगु', 'Mugu'),
    ('हुम्ला', 'Humla'),
    ('सल्यान', 'Salyan'),
    ('कैलाली', 'Kailali'),
    ('कञ्चनपुर', 'Kanchanpur'),
    ('डडेल्धुरा', 'Dadeldhura'),
    ('बैतडी', 'Baitadi'),
    ('दार्चुला', 'Darchula'),
    ('डोटी', 'Doti'),
    ('अछाम', 'Achham'),
    ('बझाङ', 'Bajhang'),
    ('बाजुरा', 'Bajura'),
    ('इलाम', 'Ilam'),
)

_DISTRICT_NP = {np: en for np, en in _DISTRICT_PAIRS}
_DISTRICT_EN_LOWER = {en.casefold(): en for _, en in _DISTRICT_PAIRS}
_DISTRICT_EN_LOWER.update({
    'ktm': 'Kathmandu',
    'kathmandu district': 'Kathmandu',
    'lalitpur district': 'Lalitpur',
    'pokhara': 'Kaski',
    'patan': 'Lalitpur',
})

_INDEPENDENT_VOWELS = {
    'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u',
    'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
}

_MATRAS = {
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
    'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
}

_CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'w',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
    'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
}

_NUKTA_MAP = {
    'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f',
}

_SKIP_PLACE_WORDS = {
    'जिल्ला', 'स्थान', 'कार्यालय', 'प्रमाणपत्र', 'नागरिकता', 'नेपाल', 'सरकार',
    'district', 'office', 'place', 'issue',
}


def has_devanagari(value: str) -> bool:
    return bool(DEVANAGARI_RE.search(value or ''))


def is_latin_text(value: str) -> bool:
    text = (value or '').strip()
    if not text:
        return False
    if has_devanagari(text):
        return False
    return bool(re.search(r'[A-Za-z]', text))


def _norm_key(value: str) -> str:
    text = unicodedata.normalize('NFC', value or '')
    text = re.sub(r'[\s\-.,/]+', ' ', text).strip()
    return text


def lookup_district(value: str) -> str:
    """Map a Nepali or messy English district string to canonical English."""
    raw = _norm_key(value)
    if not raw:
        return ''
    cleaned = re.sub(
        r'\b(जिल्ला|district|municipality|metropolitan|city|office|dao)\b',
        '',
        raw,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(' :-')
    if cleaned in _DISTRICT_NP:
        return _DISTRICT_NP[cleaned]
    lower = cleaned.casefold()
    if lower in _DISTRICT_EN_LOWER:
        return _DISTRICT_EN_LOWER[lower]
    for np_name, en_name in _DISTRICT_PAIRS:
        if np_name and np_name in raw:
            return en_name
    return ''


def _title_words(value: str) -> str:
    parts = [p for p in re.split(r'\s+', (value or '').strip()) if p]
    titled = []
    for part in parts:
        if re.fullmatch(r'[A-Za-z][A-Za-z\'.-]*', part):
            titled.append(part[:1].upper() + part[1:].lower())
        else:
            titled.append(part)
    return ' '.join(titled)


def transliterate_devanagari(value: str) -> str:
    """Romanize Nepali Devanagari using common name/place spelling."""
    text = unicodedata.normalize('NFC', value or '')
    if not text:
        return ''
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ''

        pair = ch + nxt
        if pair in _NUKTA_MAP:
            cons = _NUKTA_MAP[pair]
            i += 2
            vowel, consumed = _take_vowel(text, i)
            i += consumed
            out.append(cons + vowel)
            continue
        if pair in _CONSONANTS:
            cons = _CONSONANTS[pair]
            i += 2
            vowel, consumed = _take_vowel(text, i)
            i += consumed
            out.append(cons + vowel)
            continue

        if ch in _INDEPENDENT_VOWELS:
            out.append(_INDEPENDENT_VOWELS[ch])
            i += 1
            continue
        if ch in _CONSONANTS:
            cons = _CONSONANTS[ch]
            i += 1
            vowel, consumed = _take_vowel(text, i)
            i += consumed
            out.append(cons + vowel)
            continue
        if ch in ('ं', 'ँ'):
            out.append('n')
            i += 1
            continue
        if ch == 'ः':
            out.append('h')
            i += 1
            continue
        if ch in ('।', '॥'):
            out.append(' ')
            i += 1
            continue
        if ch.isspace() or ch in '-–—,./':
            out.append(' ')
            i += 1
            continue
        if ch in _MATRAS or ch == '्':
            i += 1
            continue
        out.append(ch)
        i += 1

    roman = re.sub(r'\s+', ' ', ''.join(out)).strip()
    roman = re.sub(r'n{2,}', 'n', roman)
    return roman


def _take_vowel(text: str, i: int) -> tuple[str, int]:
    if i >= len(text):
        # Word-final schwa is usually dropped in Nepali names (राम → ram).
        return '', 0
    ch = text[i]
    if ch == '्':
        return '', 1
    if ch in _MATRAS:
        return _MATRAS[ch], 1
    if ch.isspace() or ch in ('।', '॥', ',', '.', '/', '-', '–'):
        return '', 0
    if ch in ('ं', 'ँ', 'ः'):
        return '', 0
    if ch in _CONSONANTS or ch in _INDEPENDENT_VOWELS or ('\u0900' <= ch <= '\u097F'):
        return 'a', 0
    return '', 0


def to_english_field(value: str, *, kind: str = 'text') -> str:
    """
    Return English text for a citizenship field.

    If the value is already Latin, keep it. If it is Nepali, map districts
    when kind='place', otherwise romanize and title-case.
    """
    raw = (value or '').strip(' :-')
    if not raw:
        return ''
    if kind == 'place':
        mapped = lookup_district(raw)
        if mapped:
            return mapped
    if not has_devanagari(raw):
        if kind == 'place':
            mapped = lookup_district(raw)
            return mapped or raw
        return raw

    tokens = [tok for tok in re.split(r'\s+', raw) if tok]
    kept: list[str] = []
    for tok in tokens:
        if tok in _SKIP_PLACE_WORDS:
            continue
        if kind == 'place':
            mapped = lookup_district(tok)
            if mapped:
                kept.append(mapped)
                continue
        if has_devanagari(tok):
            kept.append(transliterate_devanagari(tok))
        else:
            kept.append(tok)
    converted = ' '.join(kept).strip()
    if kind == 'place':
        mapped = lookup_district(converted)
        return mapped or _title_words(converted)
    return _title_words(converted)


def prefer_english(*values: str, kind: str = 'text') -> str:
    """Pick the first Latin/English value; otherwise convert Nepali."""
    latin: list[str] = []
    others: list[str] = []
    for value in values:
        text = (value or '').strip()
        if not text:
            continue
        if is_latin_text(text):
            latin.append(text)
        else:
            others.append(text)
    if latin:
        if kind == 'place':
            return lookup_district(latin[0]) or latin[0]
        return latin[0]
    if others:
        return to_english_field(others[0], kind=kind)
    return ''
