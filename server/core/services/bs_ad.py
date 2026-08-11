"""
Bikram Sambat (BS) ↔ Anno Domini (AD) date conversion helpers.

Used by citizenship OCR / remittance verification so BS and AD dates
can be compared after normalization.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

# Days in each BS month for years 1970–2100 (1-indexed months Baisakh–Chaitra).
# Sourced from the common Nepali calendar tables used by nepali-date libraries.

# Compact encoding: for each year, 12 month lengths.
_BS_CALENDAR_RAW = {
    1970: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1971: (31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30),
    1972: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    1973: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    1974: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1975: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    1976: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    1977: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    1978: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1979: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    1980: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    1981: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    1982: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1983: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    1984: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    1985: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    1986: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1987: (31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    1988: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    1989: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    1990: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1991: (31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    1992: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    1993: (31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30),
    1994: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1995: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    1996: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    1997: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1998: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    1999: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2000: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2001: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2002: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2003: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2004: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2005: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2006: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2007: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2008: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31),
    2009: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2010: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2011: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2012: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    2013: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2014: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2015: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2016: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    2017: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2018: (31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2019: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2020: (31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30),
    2021: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2022: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2023: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2024: (31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30),
    2025: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2026: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2027: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2028: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2029: (31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30),
    2030: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2031: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2032: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2033: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2034: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2035: (30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31),
    2036: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2037: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2038: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2039: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    2040: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2041: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2042: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2043: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    2044: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2045: (31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2046: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2047: (31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30),
    2048: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2049: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2050: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2051: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2052: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2053: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2054: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2055: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2056: (31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30),
    2057: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2058: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2059: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2060: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2061: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2062: (30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2063: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2064: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2065: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2066: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31),
    2067: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2068: (31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2069: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2070: (31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30),
    2071: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2072: (31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30),
    2073: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31),
    2074: (31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30),
    2075: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2076: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2077: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31),
    2078: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2079: (31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30),
    2080: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2081: (31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30),
    2082: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2083: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30),
    2084: (31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30),
    2085: (31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30),
    2086: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
    2087: (31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30),
    2088: (31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30),
    2089: (31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30),
    2090: (31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30),
}

_NEPALI_DIGITS = str.maketrans('०१२३४५६७८९', '0123456789')

# Reference: BS 2000-01-01 == AD 1943-04-14
_BS_EPOCH = date(1943, 4, 14)
_BS_EPOCH_YEAR = 2000


def _days_in_bs_year(year: int) -> int:
    months = _BS_CALENDAR_RAW.get(year)
    if not months:
        # Fallback approximation outside table range.
        return 365
    return sum(months)


def _bs_to_absolute_day(year: int, month: int, day: int) -> Optional[int]:
    """Days since BS 2000-01-01 (0-based)."""
    if month < 1 or month > 12 or day < 1:
        return None
    months = _BS_CALENDAR_RAW.get(year)
    if months and day > months[month - 1]:
        return None

    total = 0
    if year >= _BS_EPOCH_YEAR:
        for y in range(_BS_EPOCH_YEAR, year):
            total += _days_in_bs_year(y)
        months = _BS_CALENDAR_RAW.get(year) or (31,) * 12
        for m in range(1, month):
            total += months[m - 1]
        total += day - 1
        return total

    # Years before epoch: walk backwards.
    total = 0
    for y in range(year + 1, _BS_EPOCH_YEAR):
        total += _days_in_bs_year(y)
    months = _BS_CALENDAR_RAW.get(year) or (31,) * 12
    remaining_in_year = sum(months[month - 1 :]) - day + 1
    total += remaining_in_year
    return -total


def bs_to_ad(year: int, month: int, day: int) -> Optional[date]:
    """Convert BS Y/M/D to AD date, or None if out of supported range."""
    if year not in _BS_CALENDAR_RAW and not (1970 <= year <= 2090):
        return None
    abs_day = _bs_to_absolute_day(year, month, day)
    if abs_day is None:
        return None
    return _BS_EPOCH + timedelta(days=abs_day)


def ad_to_bs(ad: date) -> Optional[tuple[int, int, int]]:
    """Convert AD date to (BS year, month, day)."""
    delta = (ad - _BS_EPOCH).days
    if delta >= 0:
        year = _BS_EPOCH_YEAR
        remaining = delta
        while year <= 2090:
            year_days = _days_in_bs_year(year)
            if remaining < year_days:
                break
            remaining -= year_days
            year += 1
        else:
            return None
        months = _BS_CALENDAR_RAW.get(year) or (31,) * 12
        for month_idx, length in enumerate(months, start=1):
            if remaining < length:
                return year, month_idx, remaining + 1
            remaining -= length
        return None

    # Before epoch
    remaining = -delta
    year = _BS_EPOCH_YEAR - 1
    while year >= 1970:
        year_days = _days_in_bs_year(year)
        if remaining <= year_days:
            months = _BS_CALENDAR_RAW.get(year) or (31,) * 12
            # remaining days counting back from end of year
            pos_from_start = year_days - remaining
            for month_idx, length in enumerate(months, start=1):
                if pos_from_start < length:
                    return year, month_idx, pos_from_start + 1
                pos_from_start -= length
            return None
        remaining -= year_days
        year -= 1
    return None


def normalize_nepali_digits(text: str) -> str:
    return (text or '').translate(_NEPALI_DIGITS)


def _parse_ymd_parts(text: str) -> Optional[tuple[int, int, int]]:
    text = normalize_nepali_digits((text or '').strip())
    if not text:
        return None

    # ISO / dashed / slashed: YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY
    m = re.search(
        r'(?P<a>\d{4})[./\-\s]+(?P<b>\d{1,2})[./\-\s]+(?P<c>\d{1,2})',
        text,
    )
    if m:
        a, b, c = int(m.group('a')), int(m.group('b')), int(m.group('c'))
        return a, b, c

    m = re.search(
        r'(?P<a>\d{1,2})[./\-\s]+(?P<b>\d{1,2})[./\-\s]+(?P<c>\d{4})',
        text,
    )
    if m:
        a, b, c = int(m.group('a')), int(m.group('b')), int(m.group('c'))
        return c, b, a  # treat as DD-MM-YYYY → Y, M, D later via heuristics

    # Compact 8 digits YYYYMMDD or DDMMYYYY
    m = re.search(r'(?<!\d)(\d{8})(?!\d)', text)
    if m:
        raw = m.group(1)
        y, mo, d = int(raw[0:4]), int(raw[4:6]), int(raw[6:8])
        if 1900 <= y <= 2100 and 1 <= mo <= 12:
            return y, mo, d
        d, mo, y = int(raw[0:2]), int(raw[2:4]), int(raw[4:8])
        if 1900 <= y <= 2100 and 1 <= mo <= 12:
            return y, mo, d
    return None


def _try_ad(year: int, month: int, day: int) -> Optional[date]:
    try:
        if 1 <= month <= 12 and 1 <= day <= monthrange(year, month)[1]:
            return date(year, month, day)
    except ValueError:
        return None
    return None


def normalize_date_to_ad_iso(value: str, *, prefer_bs: bool = False) -> Optional[str]:
    """
    Normalize a free-form date string (AD or BS, English/Nepali digits) to AD ISO YYYY-MM-DD.
    """
    parts = _parse_ymd_parts(value)
    if not parts:
        return None
    year, month, day = parts

    bs_ad = bs_to_ad(year, month, day) if 1970 <= year <= 2090 else None
    ad = _try_ad(year, month, day)

    if prefer_bs and bs_ad is not None:
        return bs_ad.isoformat()

    # Clear BS issue/DOB years on Nepali cards are typically 2050+.
    if year >= 2050 and bs_ad is not None:
        return bs_ad.isoformat()

    if ad is not None and not prefer_bs:
        return ad.isoformat()

    if bs_ad is not None:
        return bs_ad.isoformat()

    return ad.isoformat() if ad else None


def dates_equal(a: str, b: str) -> bool:
    """True if both parse and normalize to the same AD ISO date (BS↔AD aware)."""
    candidates_a = {
        normalize_date_to_ad_iso(a, prefer_bs=False),
        normalize_date_to_ad_iso(a, prefer_bs=True),
    }
    candidates_b = {
        normalize_date_to_ad_iso(b, prefer_bs=False),
        normalize_date_to_ad_iso(b, prefer_bs=True),
    }
    candidates_a.discard(None)
    candidates_b.discard(None)
    return bool(candidates_a & candidates_b)
