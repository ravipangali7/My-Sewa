"""Normalize deposit payment accounts (bank, Khalti, eSewa) in Settings.bank_details."""
from __future__ import annotations

import re
import uuid
from typing import Any

from django.core.files.storage import default_storage

PAYMENT_METHODS = ('bank', 'khalti', 'esewa')
LEGACY_KEYS = ('bank_name', 'account_name', 'account_number', 'branch')
ACCOUNT_QR_UPLOAD_PREFIX = 'account_qr_'
ACCOUNT_QR_CLEAR_PREFIX = 'clear_account_qr_'
ACCOUNT_QR_DIR = 'settings/account_qr'


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
    qr_code = _str(raw.get('qr_code'))
    cleaned = {
        'id': acc_id,
        'method': method,
        'label': label,
        'bank_name': bank_name if method == 'bank' else '',
        'account_name': account_name,
        'account_number': account_number,
        'branch': branch if method == 'bank' else '',
        'enabled': bool(enabled),
    }
    if qr_code:
        cleaned['qr_code'] = qr_code
    return cleaned


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


def _accounts_by_id(bank_details: Any) -> dict[str, dict]:
    data = bank_details if isinstance(bank_details, dict) else {}
    raw = data.get('accounts') if isinstance(data.get('accounts'), list) else []
    out: dict[str, dict] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        acc_id = _str(item.get('id'))
        if acc_id:
            out[acc_id] = item
    return out


def preserve_account_qr_codes(previous: Any, incoming: dict) -> dict:
    """Keep stored qr_code paths when the client omits them on a bank_details save."""
    prev_by_id = _accounts_by_id(previous)
    accounts = incoming.get('accounts')
    if not isinstance(accounts, list):
        return incoming
    for item in accounts:
        if not isinstance(item, dict):
            continue
        acc_id = _str(item.get('id'))
        if not acc_id:
            continue
        if _str(item.get('qr_code')):
            continue
        prev_qr = _str((prev_by_id.get(acc_id) or {}).get('qr_code'))
        if prev_qr:
            item['qr_code'] = prev_qr
    return incoming


def delete_stored_qr(path: str | None) -> None:
    path = _str(path)
    if not path:
        return
    try:
        if default_storage.exists(path):
            default_storage.delete(path)
    except Exception:
        pass


def prune_removed_account_qrs(previous: Any, current: Any) -> None:
    """Delete QR media for accounts that were removed from bank_details."""
    prev_by_id = _accounts_by_id(previous)
    curr_by_id = _accounts_by_id(current)
    for acc_id, prev in prev_by_id.items():
        if acc_id in curr_by_id:
            continue
        delete_stored_qr(prev.get('qr_code'))


def save_account_qr_file(account_id: str, uploaded_file) -> str:
    """Persist an uploaded QR image; returns storage path relative to MEDIA_ROOT."""
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '', account_id) or 'account'
    ext = ''
    name = getattr(uploaded_file, 'name', '') or ''
    if '.' in name:
        ext = '.' + name.rsplit('.', 1)[-1].lower()[:8]
        if not re.match(r'^\.[a-z0-9]+$', ext):
            ext = ''
    if not ext:
        content_type = (getattr(uploaded_file, 'content_type', '') or '').lower()
        if 'png' in content_type:
            ext = '.png'
        elif 'webp' in content_type:
            ext = '.webp'
        elif 'gif' in content_type:
            ext = '.gif'
        else:
            ext = '.jpg'
    filename = f'{safe_id}_{uuid.uuid4().hex[:10]}{ext}'
    return default_storage.save(f'{ACCOUNT_QR_DIR}/{filename}', uploaded_file)


def apply_account_qr_uploads(bank_details: dict, files, data) -> dict:
    """
    Apply multipart account QR uploads / clears onto bank_details.accounts[].

    Expected keys:
      - account_qr_<id> (file)
      - clear_account_qr_<id> (truthy)
    """
    details = dict(bank_details) if isinstance(bank_details, dict) else {}
    accounts = list(details.get('accounts') or []) if isinstance(details.get('accounts'), list) else []
    by_id = {
        _str(a.get('id')): a
        for a in accounts
        if isinstance(a, dict) and _str(a.get('id'))
    }

    # Clears
    for key in list(getattr(data, 'keys', lambda: data)()):
        key_s = str(key)
        if not key_s.startswith(ACCOUNT_QR_CLEAR_PREFIX):
            continue
        if str(data.get(key)).lower() not in ('1', 'true', 'yes'):
            continue
        acc_id = key_s[len(ACCOUNT_QR_CLEAR_PREFIX):]
        acc = by_id.get(acc_id)
        if not acc:
            continue
        delete_stored_qr(acc.get('qr_code'))
        acc.pop('qr_code', None)

    # Uploads
    for key in list(getattr(files, 'keys', lambda: files)()):
        key_s = str(key)
        if not key_s.startswith(ACCOUNT_QR_UPLOAD_PREFIX):
            continue
        acc_id = key_s[len(ACCOUNT_QR_UPLOAD_PREFIX):]
        uploaded = files.get(key)
        if not uploaded or not acc_id:
            continue
        acc = by_id.get(acc_id)
        if acc is None:
            # Account not in JSON yet — create a minimal stub so the QR can attach
            acc = {
                'id': acc_id,
                'method': 'bank',
                'label': 'Deposit account',
                'bank_name': '',
                'account_name': '',
                'account_number': '',
                'branch': '',
                'enabled': True,
            }
            accounts.append(acc)
            by_id[acc_id] = acc
        delete_stored_qr(acc.get('qr_code'))
        acc['qr_code'] = save_account_qr_file(acc_id, uploaded)

    details['accounts'] = accounts
    return details


def account_qr_media_url(path: str | None, request=None) -> str | None:
    path = _str(path)
    if not path:
        return None
    try:
        url = default_storage.url(path)
    except Exception:
        url = f'/media/{path.lstrip("/")}'
    if request and url and not url.startswith(('http://', 'https://')):
        return request.build_absolute_uri(url)
    return url


def enrich_bank_details_qr_urls(bank_details: Any, request=None) -> dict:
    """Normalize and attach absolute qr_code_url on each account."""
    normalized = normalize_bank_details(bank_details)
    accounts = []
    for acc in normalized.get('accounts') or []:
        item = dict(acc)
        item['qr_code_url'] = account_qr_media_url(item.get('qr_code'), request)
        accounts.append(item)
    normalized['accounts'] = accounts
    return normalized


def normalize_bank_details(raw: Any) -> dict:
    """
    Normalize Settings.bank_details to:
    {
      bank_name, account_name, account_number, branch,  # legacy
      accounts: [ { id, method, label, ..., enabled, qr_code? } ]
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
