"""
Catalog of KUKL water, NEA Electricity, and Community Electricity platforms (HimalPay).

Each entry maps a user-facing provider to HimalPay GET/PAY (and optional
counter/slug) wallet_service_name values from himalpay-api.md.
"""
from typing import Any, Dict, List, Optional

from .himalpay_parse import extract_session_id

# ---------------------------------------------------------------------------
# KUKL Water (3-step: counter → detail → pay)
# ---------------------------------------------------------------------------

KUKL_WATER: Dict[str, Any] = {
    'id': 'kukl',
    'name': 'KUKL Water',
    'counter_service': 'KUKL_GET_COUNTER',
    'get_service': 'KUKL_GET_DETAIL',
    'pay_service': 'KUKL_PAY',
    'steps': 3,
    'fields': ('connection_no', 'customer_code', 'counter'),
    'default_payment_type': 'Bill Payment',
}


def get_kukl() -> Dict[str, Any]:
    return dict(KUKL_WATER)


# ---------------------------------------------------------------------------
# NEA Electricity (3-step: office counter → detail → pay)
# ---------------------------------------------------------------------------

NEA_ELECTRICITY: Dict[str, Any] = {
    'id': 'nea',
    'name': 'NEA Electricity',
    'counter_service': 'NEA_GET_COUNTER',
    'get_service': 'NEA_GET_DETAIL',
    'pay_service': 'NEA_PAY',
    'steps': 3,
    'fields': ('sc_no', 'office_code', 'consumer_id'),
}


def get_nea() -> Dict[str, Any]:
    return dict(NEA_ELECTRICITY)


def build_nea_inquiry_payload(
    sc_no: Any,
    office_code: str,
    consumer_id: Any,
) -> Dict[str, Any]:
    """Build NEA_GET_DETAIL data payload."""
    return {
        'sc_no': str(sc_no or '').strip(),
        'office_code': str(office_code or '').strip(),
        'consumer_id': _as_int_or_str(consumer_id),
    }


def build_nea_pay_payload(session_id: Any, consumer_id: Any) -> Dict[str, Any]:
    return {
        'session_id': _as_int_or_str(session_id),
        'consumer_id': _as_int_or_str(consumer_id),
    }


def build_kukl_inquiry_payload(
    connection_no: Any,
    customer_code: Any,
    counter: str,
) -> Dict[str, Any]:
    """Build KUKL_GET_DETAIL data payload (connection_no / customer_code as ints when possible)."""
    return {
        'connection_no': _as_int_or_str(connection_no),
        'customer_code': _as_int_or_str(customer_code),
        'counter': str(counter or '').strip(),
    }


def build_kukl_pay_payload(
    session_id: Any,
    payment_type: Optional[str] = None,
) -> Dict[str, Any]:
    pt = (payment_type or KUKL_WATER['default_payment_type']).strip() or 'Bill Payment'
    return {
        'payment_type': pt,
        'session_id': _as_int_or_str(session_id),
    }


# ---------------------------------------------------------------------------
# Community Electricity platforms
# ---------------------------------------------------------------------------

COMMUNITY_ELECTRICITY_CATALOG: List[Dict[str, Any]] = [
    {
        'id': 'himchuli',
        'name': 'Himchuli',
        'get_service': 'HIMCHULI_GET',
        'pay_service': 'HIMCHULI_PAY',
        'steps': 2,
        'customer_field': 'customer_number',
        'inquiry_fields': ('customer_number', 'service_slug'),
        'default_service_slug': 'himchuli',
        'customer_label': 'Customer number',
        'placeholder': 'Enter customer number',
        'color': '#0D9488',
    },
    {
        'id': 'watermark',
        'name': 'Watermark',
        'slug_service': 'WATERMARK_SLUGS',
        'get_service': 'WATERMARK_GET',
        'pay_service': 'WATERMARK_PAY',
        'steps': 3,
        'customer_field': 'customer_code',
        'inquiry_fields': ('customer_code', 'service_slug'),
        'customer_label': 'Customer code',
        'placeholder': 'Enter customer code',
        'color': '#2563EB',
    },
    {
        'id': 'dreamer',
        'name': 'Dreamer',
        'get_service': 'DREAMER_GET',
        'pay_service': 'DREAMER_PAY',
        'steps': 2,
        'customer_field': 'customer_no',
        'inquiry_fields': ('customer_no', 'service_slug'),
        'customer_label': 'Customer number',
        'placeholder': 'Enter customer number',
        'color': '#EA580C',
    },
    {
        'id': 'softlab',
        'name': 'Softlab',
        'get_service': 'SOFTLAB_GET',
        'pay_service': 'SOFTLAB_PAY',
        'steps': 2,
        'customer_field': 'customer_code',
        'inquiry_fields': ('customer_code', 'month', 'service_slug'),
        'customer_label': 'Customer code',
        'placeholder': 'Enter customer code',
        'color': '#7C3AED',
    },
    {
        'id': 'bpc',
        'name': 'BPC',
        'counter_service': 'BPC_GET_COUNTER',
        'get_service': 'BPC_GET_DETAILS',
        'pay_service': 'BPC_PAY',
        'steps': 3,
        'customer_field': 'consumer_no',
        'inquiry_fields': ('consumer_id', 'consumer_no', 'counter_code'),
        'customer_label': 'Consumer number',
        'placeholder': 'Enter consumer number',
        'color': '#DB2777',
    },
]

_PLATFORM_BY_ID = {item['id']: item for item in COMMUNITY_ELECTRICITY_CATALOG}


def get_community_platform(platform_id: str) -> Optional[Dict[str, Any]]:
    return _PLATFORM_BY_ID.get((platform_id or '').strip().lower())


def list_community_platforms_public(
    reseller_services: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """User-facing platform list filtered to services enabled on the reseller account."""
    available: Optional[set[str]] = None
    logos: Dict[str, Optional[str]] = {}

    if reseller_services is not None:
        available = set()
        for item in reseller_services:
            if not isinstance(item, dict):
                continue
            name = str(item.get('name') or '').upper()
            if name:
                available.add(name)
                logos[name] = item.get('logo_image_url')

    result: List[Dict[str, Any]] = []
    for item in COMMUNITY_ELECTRICITY_CATALOG:
        get_svc = item['get_service']
        pay_svc = item['pay_service']
        counter_svc = item.get('counter_service') or item.get('slug_service')
        if available is not None:
            names = {get_svc, pay_svc}
            if counter_svc:
                names.add(counter_svc)
            if not (names & available):
                continue
        logo = logos.get(get_svc) or logos.get(pay_svc)
        if counter_svc:
            logo = logo or logos.get(counter_svc)
        result.append({
            'id': item['id'],
            'name': item['name'],
            'steps': item['steps'],
            'customer_field': item['customer_field'],
            'customer_label': item['customer_label'],
            'placeholder': item['placeholder'],
            'inquiry_fields': list(item['inquiry_fields']),
            'default_service_slug': item.get('default_service_slug'),
            'has_counters': bool(item.get('counter_service')),
            'has_slugs': bool(item.get('slug_service')),
            'color': item.get('color'),
            'pay_service': item['pay_service'],
            'logo_image_url': logo,
        })

    if available is not None and not result:
        return list_community_platforms_public(None)

    return result


def build_community_inquiry_payload(
    platform: Dict[str, Any],
    *,
    customer_ref: str = '',
    service_slug: str = '',
    month: Optional[int] = None,
    counter_code: str = '',
    consumer_id: Any = None,
) -> Dict[str, Any]:
    """Build GET-service data payload for the given community electricity platform."""
    pid = platform['id']
    slug = (service_slug or platform.get('default_service_slug') or '').strip()
    ref = (customer_ref or '').strip()

    if pid == 'himchuli':
        return {
            'customer_number': ref,
            'service_slug': slug or 'himchuli',
        }
    if pid == 'watermark':
        return {
            'customer_code': ref,
            'service_slug': slug,
        }
    if pid == 'dreamer':
        return {
            'customer_no': ref,
            'service_slug': slug,
        }
    if pid == 'softlab':
        return {
            'customer_code': ref,
            'month': int(month if month is not None else 0),
            'service_slug': slug,
        }
    if pid == 'bpc':
        return {
            'consumer_id': _as_int_or_str(consumer_id),
            'consumer_no': ref,
            'counter_code': str(counter_code or '').strip(),
        }
    return {}


def build_community_pay_payload(session_id: Any) -> Dict[str, Any]:
    return {'session_id': _as_int_or_str(session_id)}


def build_watermark_slug_payload(customer_code: str, service_slug: str) -> Dict[str, Any]:
    return {
        'customer_code': (customer_code or '').strip(),
        'service_slug': (service_slug or '').strip(),
    }


def normalize_utility_inquiry(raw: Any, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Lightweight normalized inquiry shape with session_id for utility payments."""
    session_id = extract_session_id(raw)
    data: Dict[str, Any] = {
        'session_id': session_id,
        'raw': raw,
    }
    if extra:
        data.update(extra)
    return data


def _as_int_or_str(value: Any) -> Any:
    """Prefer int when the value is a pure integer string (matches HimalPay samples)."""
    if value is None:
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if text.isdigit() or (text.startswith('-') and text[1:].isdigit()):
        try:
            return int(text)
        except (TypeError, ValueError):
            return text
    return text
