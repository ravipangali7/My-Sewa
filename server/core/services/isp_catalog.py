"""
Catalog of supported Internet Service Providers for bill payment.

Each entry maps a user-facing ISP to HimalPay GET/PAY service names and the
customer identifier field expected by the inquiry API.
"""
from typing import Any, Dict, List, Optional

from .himalpay_parse import parse_isp_inquiry

# id, display name, inquiry/pay services, customer field key, placeholder
ISP_CATALOG: List[Dict[str, Any]] = [
    {
        'id': 'worldlink',
        'name': 'Worldlink',
        'get_service': 'WLINK_GET',
        'pay_service': 'WLINK_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Worldlink username',
        'color': '#E11D48',
    },
    {
        'id': 'vianet',
        'name': 'Vianet',
        'get_service': 'VIANET_GET',
        'pay_service': 'VIANET_PAY',
        'customer_field': 'customer_id',
        'customer_label': 'Customer ID',
        'placeholder': 'Enter Vianet customer ID',
        'color': '#2563EB',
    },
    {
        'id': 'subisu',
        'name': 'Subisu',
        'get_service': 'SUBISU_GET',
        'pay_service': 'SUBISU_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Subisu username',
        'color': '#7C3AED',
    },
    {
        'id': 'dishhome',
        'name': 'Dish Home',
        'get_service': 'DISHHOME_GET',
        'pay_service': 'DISHHOME_PAY',
        'customer_field': 'customer_id',
        'customer_label': 'Customer ID',
        'placeholder': 'Enter Dish Home customer ID',
        'color': '#EA580C',
    },
    {
        'id': 'broadlink',
        'name': 'Broadlink',
        'get_service': 'BROADLINK_GET',
        'pay_service': 'BROADLINK_PAY',
        'customer_field': 'customer_id',
        'customer_label': 'Customer ID',
        'placeholder': 'Enter Broadlink customer ID',
        'color': '#0891B2',
    },
    {
        'id': 'arrownet',
        'name': 'Arrownet',
        'get_service': 'ARROWNET_GET',
        'pay_service': 'ARROWNET_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Arrownet username',
        'color': '#059669',
    },
    {
        'id': 'chitrawan',
        'name': 'Chitrawan',
        'get_service': 'CHITRAWAN_GET',
        'pay_service': 'CHITRAWAN_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Chitrawan username',
        'color': '#DB2777',
    },
    {
        'id': 'rapidunique',
        'name': 'Rapid Unique',
        'get_service': 'RAPIDUNIQUE_GET',
        'pay_service': 'RAPIDUNIQUE_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Rapid Unique username',
        'color': '#4F46E5',
    },
    {
        'id': 'grs',
        'name': 'GRS Internet',
        'get_service': 'GRS_GET',
        'pay_service': 'GRS_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter GRS username',
        'color': '#0D9488',
    },
    {
        'id': '3gvision',
        'name': '3G Vision',
        'get_service': '3G_VISION_GET',
        'pay_service': '3G_VISION_PAY',
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter 3G Vision username',
        'color': '#CA8A04',
    },
]

_ISP_BY_ID = {item['id']: item for item in ISP_CATALOG}
_GET_TO_ISP = {item['get_service']: item for item in ISP_CATALOG}
_PAY_TO_ISP = {item['pay_service']: item for item in ISP_CATALOG}


def get_isp(isp_id: str) -> Optional[Dict[str, Any]]:
    return _ISP_BY_ID.get((isp_id or '').strip().lower())


def build_inquiry_payload(isp: Dict[str, Any], customer_id: str) -> Dict[str, Any]:
    field = isp['customer_field']
    cleaned = customer_id.strip()
    payload = {field: cleaned}
    if isp['id'] == 'chitrawan':
        payload['request_id'] = cleaned
    return payload


def list_isps_public(reseller_services: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """
    User-facing ISP list filtered to services enabled on the HimalPay reseller account.
    """
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
    for item in ISP_CATALOG:
        get_svc = item['get_service']
        pay_svc = item['pay_service']
        if available is not None and get_svc not in available and pay_svc not in available:
            continue
        logo = logos.get(get_svc) or logos.get(pay_svc)
        result.append({
            'id': item['id'],
            'name': item['name'],
            'customer_label': item['customer_label'],
            'placeholder': item['placeholder'],
            'color': item.get('color'),
            'pay_service': item['pay_service'],
            'logo_image_url': logo,
        })

    # If reseller list is empty/unavailable, expose full catalog (same as top-up fallback)
    if available is not None and not result:
        return list_isps_public(None)

    return result


def normalize_inquiry(
    isp: Dict[str, Any],
    customer_id: str,
    raw: Any,
) -> Dict[str, Any]:
    parsed = parse_isp_inquiry(raw, isp, customer_id)
    parsed['raw'] = raw
    return parsed
