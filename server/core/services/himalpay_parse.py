"""
Normalize HimalPay wallet-service-reseller-detail responses into UI-friendly shapes.

HimalPay wraps payloads in varying `data` nesting; these helpers unwrap and extract
packages, customer fields, and amounts consistently for ISP bills and data packs.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple


def _is_mapping(value: Any) -> bool:
    return isinstance(value, dict)


def _looks_like_package(item: Any) -> bool:
    if not _is_mapping(item):
        return False
    keys = {str(k).lower() for k in item.keys()}
    markers = {
        'package_id', 'id', 'payment_id', 'package_sales_id',
        'package', 'package_name', 'name', 'title', 'description',
        'product_code', 'code', 'amount', 'price', 'payable_amount',
        'total_amount', 'cost', 'volume', 'validity', 'duration',
    }
    return bool(keys & markers)


def _collect_dict_nodes(raw: Any, max_depth: int = 6) -> List[Dict[str, Any]]:
    """Breadth-first collection of dict nodes inside a HimalPay response."""
    nodes: List[Dict[str, Any]] = []
    queue: List[Tuple[Any, int]] = [(raw, 0)]
    seen_ids: set[int] = set()

    while queue:
        node, depth = queue.pop(0)
        if not _is_mapping(node):
            continue
        node_id = id(node)
        if node_id in seen_ids:
            continue
        seen_ids.add(node_id)
        nodes.append(node)

        if depth >= max_depth:
            continue

        for value in node.values():
            if _is_mapping(value):
                queue.append((value, depth + 1))
            elif isinstance(value, list):
                for item in value:
                    if _is_mapping(item):
                        queue.append((item, depth + 1))

    return nodes


def _find_package_lists(raw: Any) -> List[List[Dict[str, Any]]]:
    lists: List[List[Dict[str, Any]]] = []
    preferred_keys = (
        'packages', 'package_list', 'packageList', 'products',
        'plans', 'options', 'data_packs', 'data_pack_list',
    )

    for node in _collect_dict_nodes(raw):
        for key in preferred_keys:
            value = node.get(key)
            if isinstance(value, list) and value and all(_is_mapping(x) for x in value):
                lists.append(value)  # type: ignore[arg-type]

    # Fallback: any list of package-like dicts
    for node in _collect_dict_nodes(raw):
        for value in node.values():
            if (
                isinstance(value, list)
                and len(value) >= 1
                and sum(1 for x in value if _looks_like_package(x)) >= max(1, len(value) // 2)
            ):
                lists.append([x for x in value if _is_mapping(x)])  # type: ignore[misc]

    # De-dupe by first item id/name
    unique: List[List[Dict[str, Any]]] = []
    seen: set[str] = set()
    for lst in lists:
        fingerprint = str(
            lst[0].get('package_id')
            or lst[0].get('id')
            or lst[0].get('product_code')
            or lst[0].get('name')
            or lst[0].get('package')
            or len(lst),
        )
        if fingerprint not in seen:
            seen.add(fingerprint)
            unique.append(lst)
    return unique


def parse_amount_rupees(value: Any) -> Optional[str]:
    """Convert HimalPay amount fields (paisa int or rupee decimal) to rupee string."""
    if value is None or value == '':
        return None
    try:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            # HimalPay uses paisa for payment amounts
            if value >= 100 or value == 0:
                return f'{value / 100:.2f}'
            return f'{float(value):.2f}'
        if isinstance(value, float):
            if value >= 100 and value == int(value):
                return f'{value / 100:.2f}'
            return f'{value:.2f}'
        text = str(value).strip().replace(',', '')
        if not text:
            return None
        dec = Decimal(text)
        # Large whole numbers are likely paisa
        if dec >= 100 and dec == dec.to_integral_value():
            return f'{float(dec / 100):.2f}'
        return f'{float(dec.quantize(Decimal("0.01"))):.2f}'
    except (InvalidOperation, ValueError, TypeError):
        return None


def _first_string(*values: Any) -> Optional[str]:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def extract_session_id(raw: Any) -> Any:
    for node in _collect_dict_nodes(raw):
        for key in ('session_id', 'sessionId', 'session'):
            if key in node and node[key] not in (None, ''):
                return node[key]
    return None


def extract_customer_profile(raw: Any) -> Dict[str, Optional[str]]:
    nodes = _collect_dict_nodes(raw)
    name = None
    current_package = None
    billing_period = None
    due_date = None
    address = None
    phone = None
    status = None
    payable = None

    for node in nodes:
        name = name or _first_string(
            node.get('name'),
            node.get('customer_name'),
            node.get('account_name'),
            node.get('full_name'),
            node.get('subscriber_name'),
            node.get('user_name'),
        )
        current_package = current_package or _first_string(
            node.get('current_plan'),
            node.get('current_package'),
            node.get('subscribed_package'),
            node.get('plan'),
            node.get('package'),
            node.get('package_name'),
            node.get('active_plan'),
        )
        billing_period = billing_period or _first_string(
            node.get('billing_period'),
            node.get('duration'),
            node.get('period'),
            node.get('billing_cycle'),
            node.get('renewal_period'),
        )
        due_date = due_date or _first_string(
            node.get('due_date'),
            node.get('expiry_date'),
            node.get('expire_date'),
            node.get('valid_until'),
            node.get('bill_date'),
            node.get('next_due_date'),
        )
        address = address or _first_string(
            node.get('address'),
            node.get('customer_address'),
            node.get('installation_address'),
        )
        phone = phone or _first_string(
            node.get('phone'),
            node.get('mobile'),
            node.get('mobile_number'),
            node.get('contact_number'),
            node.get('contact_no'),
        )
        status = status or _first_string(
            node.get('status'),
            node.get('subscription_status'),
            node.get('account_status'),
            node.get('connection_status'),
        )
        payable = payable or parse_amount_rupees(
            node.get('payable_amount')
            or node.get('outstanding_amount')
            or node.get('due_amount')
            or node.get('bill_amount')
            or node.get('total_amount')
            or node.get('amount')
        )

    return {
        'customer_name': name,
        'current_package': current_package,
        'billing_period': billing_period,
        'due_date': due_date,
        'address': address,
        'phone': phone,
        'subscription_status': status,
        'payable_amount': payable,
    }


def _package_name(pkg: Dict[str, Any]) -> str:
    return _first_string(
        pkg.get('package'),
        pkg.get('package_name'),
        pkg.get('name'),
        pkg.get('title'),
        pkg.get('description'),
        pkg.get('label'),
        pkg.get('plan'),
        f"Package {pkg.get('package_id') or pkg.get('id') or ''}",
    ) or 'Package'


def _package_amount(pkg: Dict[str, Any]) -> str:
    amount = parse_amount_rupees(
        pkg.get('amount')
        or pkg.get('price')
        or pkg.get('payable_amount')
        or pkg.get('total_amount')
        or pkg.get('cost')
        or pkg.get('package_amount')
        or pkg.get('amount_rupees')
    )
    return amount or '0.00'


def build_isp_pay_data(
    isp: Dict[str, Any],
    customer_id: str,
    pkg: Dict[str, Any],
    session_id: Any,
    inquiry_root: Any,
) -> Dict[str, Any]:
    """Build HimalPay PAY payload from inquiry package + ISP rules."""
    pay_data: Dict[str, Any] = {}

    # Copy provider fields that PAY step expects
    passthrough_keys = (
        'package_id', 'payment_id', 'session_id', 'sessionId',
        'renew_type', 'product_code', 'package_sales_id',
        'service_slug', 'type', 'office_code', 'counter',
        'counter_code', 'schemeId', 'plan_id',
    )
    for key in passthrough_keys:
        if key in pkg and pkg[key] not in (None, ''):
            pay_data[key] = pkg[key]

    if session_id is not None and 'session_id' not in pay_data:
        pay_data['session_id'] = session_id

    field = isp.get('customer_field', 'username')
    pay_data[field] = customer_id

    isp_id = isp.get('id', '')
    if isp_id == 'worldlink' or isp.get('pay_service') == 'WLINK_PAY':
        pay_data['username'] = customer_id
    if isp_id == 'subisu':
        pay_data['account'] = customer_id
        pay_data.setdefault('renew_type', pkg.get('renew_type') or 'outstanding_payment')
    if isp_id == 'broadlink':
        pay_data['username'] = customer_id
    if isp_id == 'chitrawan':
        pay_data.pop('username', None)
        pay_data.pop('customer_id', None)

    if 'package_id' not in pay_data:
        pkg_id = pkg.get('package_id') or pkg.get('id')
        if pkg_id is not None:
            pay_data['package_id'] = pkg_id

    # Drop display-only keys
    for drop in ('package', 'package_name', 'name', 'title', 'description', 'amount', 'price'):
        pay_data.pop(drop, None)

    return pay_data


def parse_isp_inquiry(
    raw: Any,
    isp: Dict[str, Any],
    customer_id: str,
) -> Dict[str, Any]:
    profile = extract_customer_profile(raw)
    session_id = extract_session_id(raw)
    packages: List[Dict[str, Any]] = []

    for pkg_list in _find_package_lists(raw):
        for idx, pkg in enumerate(pkg_list):
            if not _looks_like_package(pkg):
                continue
            pkg_id = pkg.get('package_id') or pkg.get('id') or pkg.get('payment_id') or idx
            amount = _package_amount(pkg)
            pay_data = build_isp_pay_data(isp, customer_id, pkg, session_id, raw)
            packages.append({
                'id': str(pkg_id),
                'name': _package_name(pkg),
                'amount': amount,
                'billing_period': _first_string(
                    pkg.get('duration'),
                    pkg.get('billing_period'),
                    pkg.get('period'),
                    pkg.get('validity'),
                ),
                'pay_data': pay_data,
            })

    # Single outstanding bill with no package list
    if not packages:
        amount = profile.get('payable_amount') or '0.00'
        name = profile.get('current_package') or 'Current bill'
        if profile.get('payable_amount') or profile.get('current_package'):
            pay_data = build_isp_pay_data(
                isp,
                customer_id,
                {'package_id': 'default', 'amount': amount},
                session_id,
                raw,
            )
            packages.append({
                'id': 'default',
                'name': name,
                'amount': amount,
                'billing_period': profile.get('billing_period'),
                'pay_data': pay_data,
            })

    return {
        'isp_id': isp['id'],
        'isp_name': isp['name'],
        'customer_id': customer_id,
        'customer_name': profile.get('customer_name'),
        'current_package': profile.get('current_package'),
        'billing_period': profile.get('billing_period'),
        'due_date': profile.get('due_date'),
        'address': profile.get('address'),
        'phone': profile.get('phone'),
        'subscription_status': profile.get('subscription_status'),
        'payable_amount': profile.get('payable_amount'),
        'packages': packages,
    }


def parse_data_pack_inquiry(raw: Any, operator: str) -> List[Dict[str, Any]]:
    packages: List[Dict[str, Any]] = []

    for pkg_list in _find_package_lists(raw):
        for idx, pkg in enumerate(pkg_list):
            if not _looks_like_package(pkg):
                continue
            package_id = pkg.get('package_id') or pkg.get('id')
            product_code = pkg.get('product_code') or pkg.get('code') or package_id
            packages.append({
                'id': str(package_id or product_code or idx),
                'name': _package_name(pkg),
                'amount': _package_amount(pkg),
                'validity': _first_string(
                    pkg.get('validity'),
                    pkg.get('duration'),
                    pkg.get('days'),
                    pkg.get('period'),
                    pkg.get('expiry'),
                ),
                'volume': _first_string(
                    pkg.get('volume'),
                    pkg.get('data'),
                    pkg.get('size'),
                    pkg.get('data_volume'),
                    pkg.get('quota'),
                ),
                'package_id': str(package_id) if package_id is not None else '',
                'product_code': str(product_code) if product_code is not None else '',
                'operator': operator,
            })

    return packages
