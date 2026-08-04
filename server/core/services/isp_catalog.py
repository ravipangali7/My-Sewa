"""
Catalog of supported Internet Service Providers for bill payment.

Each entry maps a user-facing ISP to HimalPay GET/PAY service names and the
customer identifier field expected by the inquiry API.
"""
from typing import Any, Dict, List, Optional

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
        'customer_field': 'username',
        'customer_label': 'Username',
        'placeholder': 'Enter Broadlink username',
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


def get_isp(isp_id: str) -> Optional[Dict[str, Any]]:
    return _ISP_BY_ID.get((isp_id or '').strip().lower())


def list_isps_public() -> List[Dict[str, Any]]:
    """User-facing ISP list (no internal HimalPay service names)."""
    return [
        {
            'id': item['id'],
            'name': item['name'],
            'customer_label': item['customer_label'],
            'placeholder': item['placeholder'],
            'color': item.get('color'),
            'pay_service': item['pay_service'],
        }
        for item in ISP_CATALOG
    ]


def build_inquiry_payload(isp: Dict[str, Any], customer_id: str) -> Dict[str, Any]:
    field = isp['customer_field']
    return {field: customer_id.strip()}


def _amount_from_paisa(value) -> Optional[str]:
    if value is None:
        return None
    try:
        paisa = int(value)
        rupees = paisa / 100
        return f'{rupees:.2f}'
    except (TypeError, ValueError):
        try:
            return f'{float(value):.2f}'
        except (TypeError, ValueError):
            return None


def _extract_packages(raw: Any, isp: Dict[str, Any], customer_id: str) -> List[Dict[str, Any]]:
    """Best-effort normalization of HimalPay inquiry responses into selectable packages."""
    packages: List[Dict[str, Any]] = []
    if not isinstance(raw, dict):
        return packages

    data = raw.get('data') if isinstance(raw.get('data'), dict) else raw
    nested = data.get('data') if isinstance(data.get('data'), dict) else data

    session_id = (
        nested.get('session_id')
        or data.get('session_id')
        or raw.get('session_id')
    )

    # List of packages under common keys
    candidates = (
        nested.get('packages')
        or nested.get('package_list')
        or data.get('packages')
        or raw.get('packages')
    )
    if isinstance(candidates, list) and candidates:
        for idx, pkg in enumerate(candidates):
            if not isinstance(pkg, dict):
                continue
            pkg_id = pkg.get('package_id') or pkg.get('id') or pkg.get('payment_id') or idx
            name = (
                pkg.get('package')
                or pkg.get('package_name')
                or pkg.get('name')
                or pkg.get('title')
                or f'Package {pkg_id}'
            )
            amount_paisa = (
                pkg.get('amount')
                or pkg.get('price')
                or pkg.get('payable_amount')
                or pkg.get('total_amount')
            )
            amount = _amount_from_paisa(amount_paisa) or str(pkg.get('amount_rupees') or '')
            pay_data = dict(pkg.get('pay_data') or {})
            if not pay_data:
                pay_data = {
                    k: v
                    for k, v in pkg.items()
                    if k not in ('package', 'package_name', 'name', 'title', 'amount', 'price')
                }
            if session_id is not None and 'session_id' not in pay_data:
                pay_data['session_id'] = session_id
            if 'package_id' not in pay_data and pkg_id is not None:
                pay_data['package_id'] = pkg_id
            field = isp['customer_field']
            if field not in pay_data:
                pay_data[field] = customer_id
            if isp['id'] == 'worldlink' and 'username' not in pay_data:
                pay_data['username'] = customer_id
            packages.append({
                'id': str(pkg_id),
                'name': str(name),
                'amount': amount or '0.00',
                'billing_period': pkg.get('duration') or pkg.get('billing_period') or pkg.get('period'),
                'pay_data': pay_data,
            })
        return packages

    # Single-package / outstanding bill shape
    amount_paisa = (
        nested.get('amount')
        or nested.get('payable_amount')
        or nested.get('outstanding_amount')
        or data.get('amount')
    )
    amount = _amount_from_paisa(amount_paisa)
    name = (
        nested.get('package')
        or nested.get('plan')
        or nested.get('package_name')
        or nested.get('current_plan')
        or 'Current bill'
    )
    customer_name = (
        nested.get('name')
        or nested.get('customer_name')
        or nested.get('account_name')
        or data.get('name')
    )
    pay_data: Dict[str, Any] = {}
    if session_id is not None:
        pay_data['session_id'] = session_id
    payment_id = nested.get('payment_id') or data.get('payment_id')
    if payment_id:
        pay_data['payment_id'] = payment_id
    pkg_id = nested.get('package_id') or data.get('package_id')
    if pkg_id is not None:
        pay_data['package_id'] = pkg_id
    field = isp['customer_field']
    pay_data[field] = customer_id
    if isp['id'] == 'worldlink':
        pay_data['username'] = customer_id
    if isp['id'] == 'subisu':
        pay_data['account'] = customer_id
        pay_data.setdefault('renew_type', nested.get('renew_type') or 'outstanding_payment')

    if amount or name:
        packages.append({
            'id': str(pkg_id or 'default'),
            'name': str(name),
            'amount': amount or '0.00',
            'billing_period': nested.get('duration') or nested.get('billing_period'),
            'customer_name': customer_name,
            'pay_data': pay_data,
        })

    return packages


def normalize_inquiry(
    isp: Dict[str, Any],
    customer_id: str,
    raw: Any,
) -> Dict[str, Any]:
    data = raw.get('data') if isinstance(raw, dict) and isinstance(raw.get('data'), dict) else raw
    nested = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
    customer_name = None
    if isinstance(nested, dict):
        customer_name = (
            nested.get('name')
            or nested.get('customer_name')
            or nested.get('account_name')
            or nested.get('full_name')
        )
    packages = _extract_packages(raw, isp, customer_id)
    return {
        'isp_id': isp['id'],
        'isp_name': isp['name'],
        'customer_id': customer_id,
        'customer_name': customer_name,
        'packages': packages,
        'raw': raw,
    }
