"""Normalize deposit payment accounts (bank, Khalti, eSewa) in Settings.bank_details."""
from __future__ import annotations

import uuid
from typing import Any

PAYMENT_METHODS = ('bank', 'khalti', 'esewa')
LEGACY_KEYS = ('bank_name', 'account_name', 'account_number', 'branch')


def _new_id() -> str:
    return f"acc_{uuid.uuid4().hex[:12]}"


def _str(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def _clean_account(raw: Any, fallback_id: str | None = None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    method = _str(raw.get('method') or raw.get('type') or 'bank').lower()
    if method not in PAYMENT_METHODS:
        method = 'bank'
    account_number = _str(raw.get('account_number') or raw.get('number') or raw.get('id_number'))
    account_name = _str(raw.get('account_name') or raw.get('name'))
    bank_name = _str(raw.get('bank_name'))
    branch = _str(raw.get('branch'))
    label = _str(raw.get('label'))
    if not label:
        if method == 'khalti':
            label = 'Khalti'
        elif method == 'esewa':
            label = 'eSewa'
        else:
            label = bank_name or 'Bank account'
    enabled = raw.get('enabled')
    if enabled is None:
        enabled = True
    else:
        enabled = str(enabled).lower() not in ('0', 'false', 'no', 'off')
    # Skip empty disabled drafts
    if not account_number and not account_name and not bank_name and not label:
        return None
    acc_id = _str(raw.get('id')) or fallback_id or _new_id()
    return {
        'id': acc_id,
        'method': method,
        'label': label,
        'bank_name': bank_name if method == 'bank' else '',
        'account_name': account_name,
        'account_number': account_number,
        'branch': branch if method == 'bank' else '',
        'enabled': bool(enabled),
    }


def _legacy_from_flat(data: dict) -> dict | None:
    bank_name = _str(data.get('bank_name'))
    account_name = _str(data.get('account_name'))
    account_number = _str(data.get('account_number'))
    branch = _str(data.get('branch'))
    if not (bank_name or account_name or account_number):
        return None
    return {
        'id': _new_id(),
        'method': 'bank',
        'label': bank_name or 'Bank account',
        'bank_name': bank_name,
        'account_name': account_name,
        'account_number': account_number,
        'branch': branch,
        'enabled': True,
    }


def _sync_legacy(accounts: list[dict]) -> dict:
    """Keep flat bank_* keys for older clients / remittance agent defaults."""
    primary = next(
        (a for a in accounts if a.get('enabled') and a.get('method') == 'bank'),
        None,
    )
    if primary is None:
        primary = next((a for a in accounts if a.get('enabled')), None)
    if primary is None and accounts:
        primary = accounts[0]
    if not primary:
        return {k: '' for k in LEGACY_KEYS}
    if primary.get('method') == 'bank':
        return {
            'bank_name': primary.get('bank_name') or '',
            'account_name': primary.get('account_name') or '',
            'account_number': primary.get('account_number') or '',
            'branch': primary.get('branch') or '',
        }
    return {
        'bank_name': primary.get('label') or primary.get('method') or '',
        'account_name': primary.get('account_name') or '',
        'account_number': primary.get('account_number') or '',
        'branch': '',
    }


def normalize_bank_details(raw: Any) -> dict:
    """
    Normalize Settings.bank_details to:
    {
      bank_name, account_name, account_number, branch,  # legacy
      accounts: [ { id, method, label, bank_name, account_name, account_number, branch, enabled } ]
    }
    """
    data = raw if isinstance(raw, dict) else {}
    accounts: list[dict] = []
    seen_ids: set[str] = set()

    raw_accounts = data.get('accounts')
    if isinstance(raw_accounts, list):
        for item in raw_accounts:
            cleaned = _clean_account(item)
            if not cleaned:
                continue
            if cleaned['id'] in seen_ids:
                cleaned['id'] = _new_id()
            seen_ids.add(cleaned['id'])
            accounts.append(cleaned)

    if not accounts:
        legacy = _legacy_from_flat(data)
        if legacy:
            accounts.append(legacy)

    legacy_flat = _sync_legacy(accounts)
    return {**legacy_flat, 'accounts': accounts}


def enabled_accounts(bank_details: Any) -> list[dict]:
    normalized = normalize_bank_details(bank_details)
    return [a for a in normalized.get('accounts') or [] if a.get('enabled')]
