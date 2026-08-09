"""
Fallback HimalPay bank catalog.

Authoritative bank support comes from HimalPay ``BANK_TRANSFER_LIST``
(see himalpay.md Bank Transfer three-step flow). This catalog is used when:

- ``HIMALPAY_BYPASS_API`` is enabled (local/dev)
- LIVE/UAT list call fails or returns an empty payload

Codes are SWIFT/BIC style identifiers HimalPay expects (e.g. NARBNPKA),
not short tickers like NABIL / CTZN.
"""
from __future__ import annotations

from typing import Dict, List

# Class-A commercial banks + common HimalPay fund-transfer destinations.
FALLBACK_BANKS: List[Dict[str, str]] = [
    {'bank_code': 'ADBLNPKA', 'bank_name': 'Agricultural Development Bank'},
    {'bank_code': 'BOKLNPKA', 'bank_name': 'Bank of Kathmandu'},
    {'bank_code': 'CCBNNPKA', 'bank_name': 'Century Commercial Bank'},
    {'bank_code': 'CTZNNPKA', 'bank_name': 'Citizens Bank International'},
    {'bank_code': 'CIVLNPKA', 'bank_name': 'Civil Bank'},
    {'bank_code': 'EVBLNPKA', 'bank_name': 'Everest Bank'},
    {'bank_code': 'GLBBNPKA', 'bank_name': 'Global IME Bank'},
    {'bank_code': 'HIMANPKA', 'bank_name': 'Himalayan Bank'},
    {'bank_code': 'KMBLNPKA', 'bank_name': 'Kumari Bank'},
    {'bank_code': 'LXBLNPKA', 'bank_name': 'Laxmi Sunrise Bank'},
    {'bank_code': 'MBLNNPKA', 'bank_name': 'Machhapuchchhre Bank'},
    {'bank_code': 'NARBNPKA', 'bank_name': 'Nabil Bank'},
    {'bank_code': 'NEBLNPKA', 'bank_name': 'Nepal Bank Limited'},
    {'bank_code': 'NIBLNPKA', 'bank_name': 'Nepal Investment Mega Bank'},
    {'bank_code': 'NSBINPKA', 'bank_name': 'Nepal SBI Bank'},
    {'bank_code': 'NICENPKA', 'bank_name': 'NIC Asia Bank'},
    {'bank_code': 'NMBBNPKA', 'bank_name': 'NMB Bank'},
    {'bank_code': 'PRVUNPKA', 'bank_name': 'Prabhu Bank'},
    {'bank_code': 'PCBLNPKA', 'bank_name': 'Prime Commercial Bank'},
    {'bank_code': 'RBBENPKA', 'bank_name': 'Rastriya Banijya Bank'},
    {'bank_code': 'SNMANPKA', 'bank_name': 'Sanima Bank'},
    {'bank_code': 'SIDDNPKA', 'bank_name': 'Siddhartha Bank'},
    {'bank_code': 'SCBLNPKA', 'bank_name': 'Standard Chartered Bank Nepal'},
]

# Short / alternate codes → HimalPay SWIFT codes.
LEGACY_BANK_CODE_MAP: Dict[str, str] = {
    'NABIL': 'NARBNPKA',
    'NARBNPKA': 'NARBNPKA',
    'NBBL': 'NARBNPKA',
    'NBBLNPKA': 'NARBNPKA',
    'NIBL': 'NIBLNPKA',
    'NIBLNPKA': 'NIBLNPKA',
    'NIBLNPKT': 'NIBLNPKA',
    'NIMB': 'NIBLNPKA',
    'SCB': 'SCBLNPKA',
    'SCBLNPKA': 'SCBLNPKA',
    'HBL': 'HIMANPKA',
    'HIMANPKA': 'HIMANPKA',
    'EBL': 'EVBLNPKA',
    'EVBLNPKA': 'EVBLNPKA',
    'NMB': 'NMBBNPKA',
    'NMBBNPKA': 'NMBBNPKA',
    'PCBL': 'PCBLNPKA',
    'PCBLNPKA': 'PCBLNPKA',
    'SANIMA': 'SNMANPKA',
    'SNMANPKA': 'SNMANPKA',
    'SANINPKA': 'SNMANPKA',
    'SBI': 'NSBINPKA',
    'NSBINPKA': 'NSBINPKA',
    'SBINPKA': 'NSBINPKA',
    'MBL': 'MBLNNPKA',
    'MBLNNPKA': 'MBLNNPKA',
    'KBL': 'KMBLNPKA',
    'KMBLNPKA': 'KMBLNPKA',
    'LBL': 'LXBLNPKA',
    'LXBLNPKA': 'LXBLNPKA',
    'CBL': 'CIVLNPKA',
    'CIVLNPKA': 'CIVLNPKA',
    'CTZN': 'CTZNNPKA',
    'CTZNNPKA': 'CTZNNPKA',
    'NICA': 'NICENPKA',
    'NICENPKA': 'NICENPKA',
    'GBIME': 'GLBBNPKA',
    'GLBBNPKA': 'GLBBNPKA',
    'PRVU': 'PRVUNPKA',
    'PRVUNPKA': 'PRVUNPKA',
    'PRBL': 'PRVUNPKA',
    'PRBLNPKA': 'PRVUNPKA',
    'ADBL': 'ADBLNPKA',
    'ADBLNPKA': 'ADBLNPKA',
    'RBB': 'RBBENPKA',
    'RBBENPKA': 'RBBENPKA',
    'NBL': 'NEBLNPKA',
    'NEBLNPKA': 'NEBLNPKA',
    'SBL': 'SIDDNPKA',
    'SIDDNPKA': 'SIDDNPKA',
    'BOK': 'BOKLNPKA',
    'BOKLNPKA': 'BOKLNPKA',
    'CCBL': 'CCBNNPKA',
    'CCBNNPKA': 'CCBNNPKA',
}


def fallback_banks() -> List[Dict[str, str]]:
    """Return a copy of the fallback catalog sorted by bank name."""
    return sorted(
        ({'bank_code': b['bank_code'], 'bank_name': b['bank_name']} for b in FALLBACK_BANKS),
        key=lambda row: row['bank_name'].casefold(),
    )
