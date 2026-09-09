"""Cached HimalPay BANK_TRANSFER_LIST used by the Bank APIs and bank-code resolve."""
from __future__ import annotations

import logging

from django.core.cache import cache

from .himalpay import HimalPayAPI, HimalPayError

logger = logging.getLogger(__name__)

BANK_LIST_CACHE_KEY = 'himalpay:bank_list:v1'
BANK_LIST_TTL = 30 * 60


def public_bank_rows(rows) -> list[dict]:
    return [
        {'bank_code': row['bank_code'], 'bank_name': row['bank_name']}
        for row in rows
        if row.get('bank_code')
    ]


def fetch_normalized_banks(*, force_refresh: bool = False, himalpay: HimalPayAPI | None = None):
    """
    Return (banks, source) where source is himalpay or cache.

    Does not use the local fallback catalog — API callers must see HimalPay banks.
    """
    if not force_refresh:
        cached = cache.get(BANK_LIST_CACHE_KEY)
        if cached:
            return cached, 'cache'

    client = himalpay or HimalPayAPI()
    try:
        from ..views.bank_transfer_views import _normalize_banks

        raw = client.list_banks()
        banks = public_bank_rows(_normalize_banks(raw))
    except HimalPayError:
        cached = cache.get(BANK_LIST_CACHE_KEY)
        if cached:
            logger.warning('HimalPay BANK_TRANSFER_LIST failed; serving cached bank list')
            return cached, 'cache'
        raise
    except Exception:
        cached = cache.get(BANK_LIST_CACHE_KEY)
        if cached:
            logger.warning('HimalPay BANK_TRANSFER_LIST failed unexpectedly; serving cached bank list')
            return cached, 'cache'
        raise

    if not banks:
        cached = cache.get(BANK_LIST_CACHE_KEY)
        if cached:
            return cached, 'cache'
        raise HimalPayError(
            'HimalPay returned an empty bank list. Please try again later.',
            status_code=502,
        )

    cache.set(BANK_LIST_CACHE_KEY, banks, BANK_LIST_TTL)
    return banks, 'himalpay'
