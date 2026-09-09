"""Fund Transfer API documentation generated from the live implementation."""
from __future__ import annotations

from datetime import date
import json

from django.conf import settings

from .api_docs_html import render_html_documentation
from .api_docs_pdf import render_pdf_documentation

DOCS_VERSION = '1.2'


def _json_block(payload) -> str:
    return json.dumps(payload or {}, indent=2)


def api_base_url(request=None) -> str:
    origin = (getattr(settings, 'BACKEND_ORIGIN', '') or '').rstrip('/')
    if request is not None:
        try:
            origin = request.build_absolute_uri('/').rstrip('/')
        except Exception:
            pass
    if not origin:
        origin = 'https://mysewaserver.sewabyapar.com'
    return origin


def fund_transfer_path() -> str:
    return '/api/v1/fund-transfer/'


def fund_transfer_url(request=None) -> str:
    return f'{api_base_url(request)}{fund_transfer_path()}'


def banklist_path() -> str:
    return '/api/v1/banklist/'


def verifiedbank_path() -> str:
    return '/api/v1/verifiedbank/'


def banktransfer_path() -> str:
    return '/api/v1/banktransfer/'


def _auth_headers(include_json: bool = True) -> list[dict]:
    headers = [
        {'name': 'Authorization', 'required': True, 'example': 'Bearer YOUR_API_KEY'},
    ]
    if include_json:
        headers.append({'name': 'Content-Type', 'required': True, 'example': 'application/json'})
    return headers


def _shared_auth_errors() -> list[dict]:
    return [
        {
            'http': 401,
            'code': 'invalid_api_key',
            'error': 'Invalid API key',
            'message': 'The API key is missing, invalid, or has been revoked.',
        },
        {
            'http': 403,
            'code': 'api_access_disabled',
            'error': 'API access disabled',
            'message': 'API access is disabled for this account.',
        },
        {
            'http': 403,
            'code': 'user_inactive',
            'error': 'User inactive',
            'message': 'This account is inactive and cannot use the API.',
        },
        {
            'http': 429,
            'code': 'throttled',
            'error': 'Too many requests',
            'message': 'Too many requests. Please slow down and try again.',
        },
        {
            'http': 500,
            'code': 'server_error',
            'error': 'Server/internal error',
            'message': 'The request could not be completed. Please try again.',
        },
    ]


def _provider_errors() -> list[dict]:
    return [
        {
            'http': 502,
            'code': 'provider_unavailable',
            'error': 'HimalPay unavailable',
            'message': 'The payment provider is temporarily unavailable. Please try again later.',
        },
        {
            'http': 504,
            'code': 'provider_timeout',
            'error': 'HimalPay timeout',
            'message': 'The payment provider took too long to respond. Please try again.',
        },
        {
            'http': 400,
            'code': 'provider_error',
            'error': 'HimalPay API error',
            'message': 'The payment provider rejected this request.',
        },
    ]


def _curl_get(url: str) -> str:
    return (
        f'curl -X GET "{url}" \\\n'
        '  -H "Authorization: Bearer YOUR_API_KEY"'
    )


def _curl_post(url: str, body: str) -> str:
    return (
        f'curl -X POST "{url}" \\\n'
        '  -H "Authorization: Bearer YOUR_API_KEY" \\\n'
        '  -H "Content-Type: application/json" \\\n'
        f"  -d '{body}'"
    )


def _python_get(url: str) -> str:
    return (
        'import requests\n\n'
        f'url = "{url}"\n'
        'headers = {"Authorization": "Bearer YOUR_API_KEY"}\n'
        'response = requests.get(url, headers=headers, timeout=30)\n'
        'print(response.status_code, response.json())\n'
    )


def _python_post(url: str, payload: str) -> str:
    return (
        'import requests\n\n'
        f'url = "{url}"\n'
        'headers = {\n'
        '    "Authorization": "Bearer YOUR_API_KEY",\n'
        '    "Content-Type": "application/json",\n'
        '}\n'
        f'payload = {payload}\n'
        'response = requests.post(url, json=payload, headers=headers, timeout=60)\n'
        'print(response.status_code, response.json())\n'
    )


def _javascript_get(url: str) -> str:
    return (
        f'const url = "{url}";\n'
        'const response = await fetch(url, {\n'
        '  method: "GET",\n'
        '  headers: { Authorization: "Bearer YOUR_API_KEY" },\n'
        '});\n'
        'const data = await response.json();\n'
        'console.log(response.status, data);\n'
    )


def _javascript_post(url: str, payload: str) -> str:
    return (
        f'const url = "{url}";\n'
        'const response = await fetch(url, {\n'
        '  method: "POST",\n'
        '  headers: {\n'
        '    Authorization: "Bearer YOUR_API_KEY",\n'
        '    "Content-Type": "application/json",\n'
        '  },\n'
        f'  body: JSON.stringify({payload}),\n'
        '});\n'
        'const data = await response.json();\n'
        'console.log(response.status, data);\n'
    )


def documentation_payload(request=None) -> dict:
    base = api_base_url(request)
    endpoint = fund_transfer_url(request)
    banklist_url = f'{base}{banklist_path()}'
    verifiedbank_url = f'{base}{verifiedbank_path()}'
    banktransfer_url = f'{base}{banktransfer_path()}'
    verify_example = {
        'bank_code': 'NABILNPKA',
        'bank_account_number': '1234567890123',
        'account_holder_name': 'John Doe',
    }
    transfer_example = {
        **verify_example,
        'amount': 1000,
        'reference': 'ORDER-10001',
    }
    verify_example_json = _json_block(verify_example)
    transfer_example_json = _json_block(transfer_example)
    bank_list_success = {
        'success': True,
        'source': 'himalpay',
        'data': [
            {'bank_code': 'NABILNPKA', 'bank_name': 'Nabil Bank Limited'},
            {'bank_code': 'NICENPKA', 'bank_name': 'NIC Asia Bank Limited'},
        ],
    }
    verify_success = {
        'success': True,
        'verified': True,
        'message': 'Bank account verified successfully',
        'data': {
            'bank_code': 'NABILNPKA',
            'bank_name': 'Nabil Bank Limited',
            'account_number': '*********0123',
            'account_holder_name': 'John Doe',
        },
    }
    verify_failed = {
        'success': False,
        'verified': False,
        'message': 'Bank account verification failed',
        'error': 'Bank account verification failed',
        'code': 'verification_failed',
    }
    bank_transfer_success = {
        'success': True,
        'message': 'Bank transfer successful',
        'transaction_id': 'MYSEWA_BT_A1B2C3D4E5F678',
        'provider_reference': 'HP123456',
        'reference': 'ORDER-10001',
        'amount': 1000,
        'status': 'SUCCESS',
        'data': {
            'bank_code': 'NABILNPKA',
            'bank_name': 'Nabil Bank Limited',
            'account_number': '*********0123',
            'account_holder_name': 'John Doe',
            'method': 'API Bank Transfer',
        },
    }
    bank_flow = [
        'GET /api/v1/banklist/ to load HimalPay bank codes and names (cached when unchanged).',
        'POST /api/v1/verifiedbank/ with bank_code, bank_account_number, and account_holder_name. MySewa calls HimalPay BANK_TRANSFER_VERIFICATION.',
        'After a successful verify, POST /api/v1/banktransfer/ with the same bank details, amount, and a unique reference. MySewa re-verifies with HimalPay, then calls BANK_TRANSFER and records the wallet transaction.',
    ]
    bank_list_section = {
        'id': 'bank-list',
        'title': 'Bank List API',
        'purpose': (
            'Returns banks currently available through the configured HimalPay BANK_TRANSFER_LIST service. '
            'MySewa does not hardcode this list. Use bank_code from this response in later calls. '
            'Results are cached for about 30 minutes; pass refresh=1 to force a HimalPay refresh.'
        ),
        'method': 'GET',
        'path': banklist_path(),
        'url': banklist_url,
        'headers': _auth_headers(include_json=False),
        'query': [
            {
                'name': 'refresh',
                'required': False,
                'type': 'boolean',
                'description': 'Set to 1 to bypass cache and fetch a fresh HimalPay bank list.',
                'example': '1',
            },
        ],
        'request_body': {},
        'request_example': None,
        'success_http': '200 OK',
        'success_response': bank_list_success,
        'errors': _shared_auth_errors() + _provider_errors() + [
            {
                'http': 403,
                'code': 'unauthorized_transaction',
                'error': 'Unauthorized transaction',
                'message': 'Transfers or bank transfer permission are disabled.',
            },
        ],
        'examples': {
            'curl': _curl_get(banklist_url),
            'python': _python_get(banklist_url),
            'javascript': _javascript_get(banklist_url),
        },
        'notes': [
            'bank_code is the HimalPay instrument/SWIFT-style code (for example NABILNPKA), not a local nickname.',
            'bank_name is the display name returned by HimalPay.',
            'source is himalpay on a live fetch or cache when a recent list is reused.',
        ],
    }
    verified_bank_section = {
        'id': 'verified-bank',
        'title': 'Verified Bank API',
        'purpose': (
            'Verifies a destination bank account against HimalPay BANK_TRANSFER_VERIFICATION. '
            'This call does not debit the wallet. A successful verify is required before /banktransfer/ '
            'for the same API user, bank, account number, and holder name (valid about 15 minutes). '
            'HimalPay does not issue a verification token; MySewa remembers the successful match internally.'
        ),
        'method': 'POST',
        'path': verifiedbank_path(),
        'url': verifiedbank_url,
        'headers': _auth_headers(),
        'query': [],
        'request_body': {
            'bank_code': {
                'required': True,
                'type': 'string',
                'description': 'HimalPay bank code from GET /api/v1/banklist/. bank_name may be sent instead when uniquely resolvable.',
                'example': 'NABILNPKA',
            },
            'bank_account_number': {
                'required': True,
                'type': 'string',
                'description': 'Destination account number. Aliases: account_number, destination_acc_no.',
                'example': '1234567890123',
            },
            'account_holder_name': {
                'required': True,
                'type': 'string',
                'description': 'Registered account holder name. Aliases: account_name, destination_acc_name.',
                'example': 'John Doe',
            },
            'bank_name': {
                'required': False,
                'type': 'string',
                'description': 'Optional bank display name used to resolve a short or missing bank_code.',
                'example': 'Nabil Bank Limited',
            },
        },
        'request_example': verify_example,
        'success_http': '200 OK when HimalPay confirms the account and the holder name matches.',
        'success_response': verify_success,
        'failed_response': verify_failed,
        'errors': _shared_auth_errors() + _provider_errors() + [
            {'http': 400, 'code': 'invalid_bank_code', 'error': 'Invalid bank code', 'message': 'bank_code or bank_name is required.'},
            {'http': 400, 'code': 'bank_not_supported', 'error': 'Bank not supported', 'message': 'This bank is not on the HimalPay bank list.'},
            {'http': 400, 'code': 'invalid_account_number', 'error': 'Invalid account number', 'message': 'bank_account_number is missing or malformed.'},
            {'http': 400, 'code': 'missing_account_holder_name', 'error': 'Missing account holder name', 'message': 'account_holder_name is required.'},
            {'http': 400, 'code': 'verification_failed', 'error': 'Bank account verification failed', 'message': 'The account number and holder name did not match HimalPay records.'},
        ],
        'examples': {
            'curl': _curl_post(verifiedbank_url, verify_example_json),
            'python': _python_post(verifiedbank_url, verify_example_json),
            'javascript': _javascript_post(verifiedbank_url, verify_example_json),
        },
        'notes': [
            'MySewa maps the request to HimalPay fields bank_code, account_number, account_name, merchant_txn_id, and is_mobile=n.',
            'Account numbers are masked in the API response.',
            'Verification failure is returned as verified: false. Results are never faked.',
        ],
    }
    bank_transfer_section = {
        'id': 'bank-transfer',
        'title': 'Bank Transfer API',
        'purpose': (
            'Pays a verified bank account through HimalPay BANK_TRANSFER using the API user MySewa wallet. '
            'The wallet is debited only after HimalPay reports success (or auto-verified pending policy). '
            'Failed HimalPay responses do not consume the client reference, so the same reference can be retried.'
        ),
        'method': 'POST',
        'path': banktransfer_path(),
        'url': banktransfer_url,
        'headers': _auth_headers() + [
            {
                'name': 'Idempotency-Key',
                'required': False,
                'example': 'ORDER-10001',
                'notes': 'Optional. If omitted, body reference is used.',
            },
        ],
        'query': [],
        'request_body': {
            'bank_code': {
                'required': True,
                'type': 'string',
                'description': 'Same HimalPay bank code used in /verifiedbank/.',
                'example': 'NABILNPKA',
            },
            'bank_account_number': {
                'required': True,
                'type': 'string',
                'description': 'Destination account number previously verified.',
                'example': '1234567890123',
            },
            'account_holder_name': {
                'required': True,
                'type': 'string',
                'description': 'Account holder name previously verified.',
                'example': 'John Doe',
            },
            'amount': {
                'required': True,
                'type': 'number',
                'description': 'NPR amount. Must be greater than zero and within transfer limits. HimalPay is paid in paisa.',
                'example': 1000,
            },
            'reference': {
                'required': True,
                'type': 'string',
                'description': 'Unique client reference (1-64 letters, digits, hyphen, underscore, period). Replay of a completed reference returns the original result without a second debit.',
                'example': 'ORDER-10001',
            },
        },
        'request_example': transfer_example,
        'success_http': '201 Created on a new SUCCESS transfer; 202 Accepted when HimalPay/MySewa status is PENDING; 200 OK on idempotent replay.',
        'success_response': bank_transfer_success,
        'errors': _shared_auth_errors() + _provider_errors() + [
            {'http': 400, 'code': 'verification_required', 'error': 'Verification required', 'message': 'Call POST /api/v1/verifiedbank/ first for these bank details.'},
            {'http': 400, 'code': 'verification_failed', 'error': 'Bank account verification failed', 'message': 'HimalPay re-verification failed before payout.'},
            {'http': 400, 'code': 'insufficient_balance', 'error': 'Insufficient balance', 'message': 'Wallet does not cover amount plus charges.'},
            {'http': 400, 'code': 'invalid_amount', 'error': 'Invalid amount', 'message': 'Amount must be a valid number greater than zero and within limits.'},
            {'http': 400, 'code': 'duplicate_reference', 'error': 'Duplicate reference', 'message': 'Reference is missing, malformed, or already being processed.'},
            {'http': 409, 'code': 'duplicate_reference', 'error': 'Duplicate reference', 'message': 'This reference is already being processed.'},
            {'http': 400, 'code': 'transfer_failed', 'error': 'Transfer failed', 'message': 'HimalPay rejected or failed the payout. Wallet was not debited.'},
            {'http': 400, 'code': 'bank_not_supported', 'error': 'Bank not supported', 'message': 'This bank is not on the HimalPay bank list.'},
            {'http': 403, 'code': 'unauthorized_transaction', 'error': 'Unauthorized transaction', 'message': 'Bank transfer is disabled, blocked, or over the daily limit.'},
        ],
        'examples': {
            'curl': _curl_post(banktransfer_url, transfer_example_json),
            'python': _python_post(banktransfer_url, transfer_example_json),
            'javascript': _javascript_post(banktransfer_url, transfer_example_json),
        },
        'notes': [
            'MySewa re-verifies with HimalPay immediately before BANK_TRANSFER. A cached /verifiedbank/ result is required but is not treated as the final match.',
            'transaction_id is the MySewa merchant id (MYSEWA_BT_...). provider_reference is HimalPay when present.',
            'status is SUCCESS, PENDING, or FAILED. Do not treat PENDING as paid.',
            'HimalPay payout fields: destination_bank, destination_acc_no, destination_acc_name, amount in paisa.',
        ],
    }
    success_body = {
        'success': True,
        'message': 'Fund transfer successful',
        'transaction_id': 'MYSEWA_WT_A1B2C3D4E5F678',
        'reference': 'ORDER-10001',
        'amount': 1000,
        'status': 'SUCCESS',
    }
    error_body = {
        'success': False,
        'error': 'Insufficient balance',
        'message': 'Human-readable explanation',
        'code': 'insufficient_balance',
    }
    return {
        'title': 'MySewa Developer API',
        'product': 'MySewa',
        'version': 'v1',
        'docs_version': DOCS_VERSION,
        'published_at': date.today().isoformat(),
        'base_url': base,
        'endpoint': endpoint,
        'path': fund_transfer_path(),
        'method': 'POST',
        'authentication': {
            'type': 'Bearer API key',
            'header': 'Authorization: Bearer <API_KEY>',
            'notes': [
                'Use the API key issued when API access is enabled for your account.',
                'Do not send your dashboard login token on this endpoint.',
                'API access is denied when is_api_user is false, the account is inactive, or the key was regenerated.',
            ],
        },
        'headers': [
            {'name': 'Authorization', 'required': True, 'example': 'Bearer YOUR_API_KEY'},
            {'name': 'Content-Type', 'required': True, 'example': 'application/json'},
            {
                'name': 'Idempotency-Key',
                'required': False,
                'example': 'ORDER-10001',
                'notes': 'Optional. If omitted, the request body `reference` is used for duplicate protection.',
            },
        ],
        'request_body': {
            'receiver': {
                'required': True,
                'type': 'string',
                'description': (
                    'MySewa user identifier: registered phone number (preferred), email, or numeric user id.'
                ),
                'example': '98XXXXXXXX',
            },
            'amount': {
                'required': True,
                'type': 'number',
                'description': 'Amount in NPR. Must be greater than zero and within configured transfer limits.',
                'example': 1000,
            },
            'reference': {
                'required': True,
                'type': 'string',
                'description': (
                    'Client order/reference id. Unique per API user. Repeating the same reference '
                    'does not transfer money twice; the original success response is returned.'
                ),
                'example': 'ORDER-10001',
            },
        },
        'request_example': {
            'receiver': '98XXXXXXXX',
            'amount': 1000,
            'reference': 'ORDER-10001',
        },
        'validation': [
            'Receiver must exist, be active, and must not be the sender.',
            'Amount must be a positive number (zero and negative values are rejected).',
            'Amount must satisfy the configured min/max transfer limits.',
            'Sender wallet must have sufficient balance including any applicable charges.',
            'Sender must be an API user with an active, approved account and wallet transfer permission.',
            'Frozen or blocked wallets cannot send or receive.',
            'Reference is required, 1-64 characters: letters, digits, hyphen, underscore, and period.',
        ],
        'success_http': '201 Created for a new transfer; 200 OK when replaying a completed reference.',
        'success_response': success_body,
        'error_body': error_body,
        'error_responses': [
            {
                'http': 401,
                'code': 'invalid_api_key',
                'error': 'Invalid API key',
                'message': 'The API key is missing, invalid, or has been revoked.',
            },
            {
                'http': 403,
                'code': 'api_access_disabled',
                'error': 'API access disabled',
                'message': 'API fund-transfer access is disabled for this account.',
            },
            {
                'http': 403,
                'code': 'user_inactive',
                'error': 'User inactive',
                'message': 'This account is inactive and cannot perform transfers.',
            },
            {
                'http': 400,
                'code': 'invalid_receiver',
                'error': 'Invalid receiver',
                'message': 'Receiver is required, is the sender, or cannot receive transfers.',
            },
            {
                'http': 404,
                'code': 'receiver_not_found',
                'error': 'Receiver not found',
                'message': 'No MySewa user was found for that receiver.',
            },
            {
                'http': 400,
                'code': 'insufficient_balance',
                'error': 'Insufficient balance',
                'message': 'Sender wallet does not cover amount plus applicable charges.',
            },
            {
                'http': 400,
                'code': 'invalid_amount',
                'error': 'Invalid amount',
                'message': 'Amount must be a valid number greater than zero and within limits.',
            },
            {
                'http': 400,
                'code': 'duplicate_reference',
                'error': 'Duplicate reference',
                'message': 'Reference is missing, malformed, or already being processed.',
            },
            {
                'http': 409,
                'code': 'duplicate_reference',
                'error': 'Duplicate reference',
                'message': 'This reference is already being processed.',
            },
            {
                'http': 403,
                'code': 'unauthorized_transaction',
                'error': 'Unauthorized transaction',
                'message': 'Wallet transfer is disabled, blocked, frozen, or over the daily limit.',
            },
            {
                'http': 404,
                'code': 'wallet_unavailable',
                'error': 'Wallet unavailable',
                'message': 'Wallet is unavailable for this transfer.',
            },
            {
                'http': 429,
                'code': 'throttled',
                'error': 'Too many requests',
                'message': 'Too many requests. Please slow down and try again.',
            },
            {
                'http': 500,
                'code': 'server_error',
                'error': 'Server/internal error',
                'message': 'The transfer could not be completed. Please try again.',
            },
        ],
        'http_status_codes': [
            {'http': 200, 'meaning': 'Idempotent replay of a completed transfer. No second debit.'},
            {'http': 201, 'meaning': 'New fund transfer created and wallets updated.'},
            {'http': 400, 'meaning': 'Validation failed (receiver, amount, balance, or reference).'},
            {'http': 401, 'meaning': 'Missing, invalid, or revoked API key.'},
            {'http': 403, 'meaning': 'API access disabled, inactive user, or unauthorized wallet.'},
            {'http': 404, 'meaning': 'Receiver or wallet was not found.'},
            {'http': 409, 'meaning': 'The same reference is already being processed.'},
            {'http': 429, 'meaning': 'Rate limit exceeded (60 requests per minute).'},
            {'http': 500, 'meaning': 'Unexpected server error. Reference is not consumed; retry is allowed.'},
        ],
        'idempotency': (
            'Each API user may use a given `reference` (or Idempotency-Key) only once for a successful transfer. '
            'A repeated request with the same reference returns HTTP 200 and the original transaction_id and does not debit again. '
            'A failed attempt does not consume the reference, so the client may retry the same reference.'
        ),
        'how_it_works': [
            'An administrator enables Fund Transfer API access for your MySewa account. An API key is generated automatically.',
            'You copy the API key from Developer / API and store it securely in your own website or application.',
            'Your application sends POST /api/v1/fund-transfer/ with receiver, amount, and a unique reference.',
            'MySewa authenticates the Bearer API key. Dashboard login tokens are rejected.',
            'MySewa validates the sender, receiver, amount, limits, and wallet state.',
            'If the sender wallet has sufficient balance (including charges), the sender is debited.',
            'The receiver wallet is credited in the same atomic wallet transfer.',
            'A wallet transaction is created automatically. You do not create API transactions from the dashboard.',
            'The API returns transaction_id, reference, amount, and status.',
            'Successful and failed API calls appear in API Transaction History for the authenticated API user.',
        ],
        'transaction_history': {
            'title': 'API Transaction History',
            'summary': (
                'API transactions are created automatically when your application calls Fund Transfer or Bank Transfer APIs. '
                'Bank verification is not a wallet transaction and does not appear here.'
                'There is no manual "create API transaction" action in the dashboard.'
            ),
            'fields': [
                'Transaction ID (MySewa wallet-transfer reference, present on success)',
                'Sender (authenticated API user)',
                'Receiver (phone, email, or user id submitted in the request)',
                'Amount',
                'Client reference',
                'Status (SUCCESS or FAILED)',
                'Method (API for wallet-to-wallet, API Bank Transfer for HimalPay payouts)',
                'Created date/time',
                'Masked bank account and provider reference for bank transfers',
                'Failure reason when the request did not succeed',
            ],
            'empty': (
                'No API transactions yet. Transactions will appear here after your application '
                'makes a fund-transfer request through the API.'
            ),
            'note': (
                'Successful API transfers also appear in standard wallet history because they reuse '
                'the existing MySewa wallet-transfer ledger. Failed API attempts are audit records only.'
            ),
        },
        'downloads': {
            'path': '/api/developer/docs/download/',
            'query': 'doc_format=markdown|html|pdf',
            'note': (
                'Dashboard users with API access can download this documentation as Markdown, HTML, or PDF.'
            ),
        },
        'security': [
            'Use HTTPS in production. Do not send API keys over plain HTTP.',
            'Store the API key like a password. Rotate it if it is exposed.',
            'Never log API keys, put them in URLs, or share them in support tickets.',
            'Regenerating a key invalidates the previous key immediately.',
            'The Developer API is throttled to 60 requests per minute per API user.',
        ],
        'examples': {
            'curl': _curl_example(endpoint),
            'python': _python_example(endpoint),
            'javascript': _javascript_example(endpoint),
        },
        'bank_flow': bank_flow,
        'api_sections': [bank_list_section, verified_bank_section, bank_transfer_section],
        'toc': [
            {'id': 'introduction', 'title': 'Introduction'},
            {'id': 'base-url', 'title': 'API Base URL'},
            {'id': 'authentication', 'title': 'Authentication'},
            {'id': 'api-key', 'title': 'API Key'},
            {'id': 'bank-flow', 'title': 'Bank API integration flow'},
            {'id': 'bank-list', 'title': 'Bank List API'},
            {'id': 'verified-bank', 'title': 'Verified Bank API'},
            {'id': 'bank-transfer', 'title': 'Bank Transfer API'},
            {'id': 'fund-transfer', 'title': 'Fund Transfer API'},
            {'id': 'request', 'title': 'Fund Transfer request'},
            {'id': 'headers', 'title': 'Headers'},
            {'id': 'examples', 'title': 'Fund Transfer examples'},
            {'id': 'curl', 'title': 'cURL Example'},
            {'id': 'python', 'title': 'Python Example'},
            {'id': 'javascript', 'title': 'JavaScript Example'},
            {'id': 'success', 'title': 'Successful Response'},
            {'id': 'errors', 'title': 'Error Responses'},
            {'id': 'status-codes', 'title': 'HTTP Status Codes'},
            {'id': 'idempotency', 'title': 'Duplicate / Idempotency Rules'},
            {'id': 'history', 'title': 'API Transaction History'},
            {'id': 'security', 'title': 'Security Guidelines'},
            {'id': 'flow', 'title': 'Integration Flow'},
        ],
    }


def _curl_example(endpoint: str) -> str:
    return (
        f'curl -X POST "{endpoint}" \\\n'
        '  -H "Authorization: Bearer YOUR_API_KEY" \\\n'
        '  -H "Content-Type: application/json" \\\n'
        "  -d '{\n"
        '    "receiver": "98XXXXXXXX",\n'
        '    "amount": 1000,\n'
        '    "reference": "ORDER-10001"\n'
        "  }'"
    )


def _python_example(endpoint: str) -> str:
    return (
        'import requests\n\n'
        f'url = "{endpoint}"\n'
        'headers = {\n'
        '    "Authorization": "Bearer YOUR_API_KEY",\n'
        '    "Content-Type": "application/json",\n'
        '}\n'
        'payload = {\n'
        '    "receiver": "98XXXXXXXX",\n'
        '    "amount": 1000,\n'
        '    "reference": "ORDER-10001",\n'
        '}\n'
        'response = requests.post(url, json=payload, headers=headers, timeout=30)\n'
        'print(response.status_code, response.json())\n'
    )


def _javascript_example(endpoint: str) -> str:
    return (
        f'const url = "{endpoint}";\n'
        'const response = await fetch(url, {\n'
        '  method: "POST",\n'
        '  headers: {\n'
        '    Authorization: "Bearer YOUR_API_KEY",\n'
        '    "Content-Type": "application/json",\n'
        '  },\n'
        '  body: JSON.stringify({\n'
        '    receiver: "98XXXXXXXX",\n'
        '    amount: 1000,\n'
        '    reference: "ORDER-10001",\n'
        '  }),\n'
        '});\n'
        'const data = await response.json();\n'
        'console.log(response.status, data);\n'
    )


def _markdown_api_section(section: dict) -> str:
    params = section.get('request_body') or {}
    param_rows = '\n'.join(
        f"| `{name}` | {'yes' if field.get('required') else 'no'} | {field.get('type')} | {field.get('description')} |"
        for name, field in params.items()
    ) or '| — | — | — | No request body |'
    query = section.get('query') or []
    query_md = ''
    if query:
        query_rows = '\n'.join(
            f"| `{item['name']}` | {'yes' if item.get('required') else 'no'} | {item.get('type')} | {item.get('description')} |"
            for item in query
        )
        query_md = f"""
### Query parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
{query_rows}
"""
    errors = '\n'.join(
        f"- `{item['http']}` `{item['code']}` — {item['error']}: {item.get('message') or ''}".rstrip()
        for item in section.get('errors') or []
    )
    notes = '\n'.join(f"- {item}" for item in section.get('notes') or [])
    request_block = ''
    if section.get('request_example'):
        request_block = f"""
### Request example

```json
{_json_block(section['request_example'])}
```
"""
    failed_block = ''
    if section.get('failed_response'):
        failed_block = f"""
### Failed verification

```json
{_json_block(section['failed_response'])}
```
"""
    examples = section.get('examples') or {}
    return f"""## {section['title']}

`{section['method']} {section['path']}`

Full URL: `{section['url']}`

{section['purpose']}

### Headers

{chr(10).join(f"- `{h['name']}`{' (required)' if h.get('required') else ''} — `{h['example']}`" for h in section.get('headers') or [])}
{query_md}
### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
{param_rows}
{request_block}
### Successful response

{section.get('success_http') or '200 OK'}

```json
{_json_block(section.get('success_response') or {})}
```
{failed_block}
### Examples

#### cURL

```bash
{examples.get('curl') or ''}
```

#### Python

```python
{examples.get('python') or ''}
```

#### JavaScript

```javascript
{examples.get('javascript') or ''}
```

### Errors

{errors}

{notes}
"""


def markdown_documentation(request=None) -> str:
    doc = documentation_payload(request)
    errors = '\n'.join(
        f"- `{item['http']}` `{item['code']}` — {item['error']}: {item.get('message') or ''}".rstrip()
        for item in doc['error_responses']
    )
    headers = '\n'.join(
        f"- `{h['name']}`{' (required)' if h.get('required') else ''} — `{h['example']}`"
        for h in doc['headers']
    )
    rules = '\n'.join(f'- {rule}' for rule in doc['validation'])
    security = '\n'.join(f'- {item}' for item in doc['security'])
    flow = '\n'.join(f'{i}. {step}' for i, step in enumerate(doc['how_it_works'], start=1))
    history_fields = '\n'.join(f'- {item}' for item in doc['transaction_history']['fields'])
    codes = '\n'.join(f"- `{item['http']}` — {item['meaning']}" for item in doc['http_status_codes'])
    bank_flow = '\n'.join(f'{i}. {step}' for i, step in enumerate(doc.get('bank_flow') or [], start=1))
    bank_md = '\n'.join(_markdown_api_section(section) for section in doc.get('api_sections') or [])
    return f"""# {doc['title']}

Version: {doc['version']} · Documentation {doc['docs_version']} · {doc['published_at']}

## Introduction

MySewa Developer API lets an approved API user move NPR from their MySewa wallet: wallet-to-wallet Fund Transfer, or HimalPay bank payouts via Bank List, Verified Bank, and Bank Transfer.

You do **not** create API transactions from the Developer dashboard. Your application calls the API; MySewa creates the transaction automatically.

## How API Fund Transfer Works

{flow}

## API Base URL

`{doc['base_url']}`

## Authentication

Send the API key as a Bearer token:

```
{doc['authentication']['header']}
```

{chr(10).join('- ' + n for n in doc['authentication']['notes'])}

## API Key

1. An admin enables Fund Transfer API access on your account.
2. Open **Developer / API** in the MySewa app to view, copy, or regenerate the key.
3. Regenerating a key invalidates the previous key immediately.

## Bank API integration flow

Recommended order. The three bank endpoints are independent, but payouts require a recent successful verification of the same bank details.

```
1. GET /api/v1/banklist/
2. POST /api/v1/verifiedbank/
3. POST /api/v1/banktransfer/
```

{bank_flow}

{bank_md}

## Fund Transfer API

`{doc['method']} {doc['path']}`

Full URL: `{doc['endpoint']}`

## Headers

{headers}

## Request Parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| receiver | yes | string | Phone (preferred), email, or numeric user id of the MySewa recipient |
| amount | yes | number | NPR amount greater than zero |
| reference | yes | string | Unique client reference used for idempotency |

Example:

```json
{ _json_block(doc['request_example']) }
```

## Validation rules

{rules}

## Request Examples

### cURL

```bash
{doc['examples']['curl']}
```

### Python

```python
{doc['examples']['python']}
```

### JavaScript

```javascript
{doc['examples']['javascript']}
```

## Successful Response

{doc['success_http']}

`transaction_id` is the MySewa wallet-transfer reference (for example `MYSEWA_WT_...`).

```json
{ _json_block(doc['success_response']) }
```

## Error Responses

{errors}

Error body shape:

```json
{ _json_block(doc['error_body']) }
```

Internal exception messages and stack traces are never returned.

## HTTP Status Codes

{codes}

## Duplicate / idempotency behavior

{doc['idempotency']}

## API Transaction History

{doc['transaction_history']['summary']}

{history_fields}

{doc['transaction_history']['note']}

Empty state: {doc['transaction_history']['empty']}

## Security Guidelines

{security}

## Documentation download

Dashboard users with API access can download this document:

`GET /api/developer/docs/download/?doc_format=markdown`

Supported `doc_format` values: `markdown`, `html`, `pdf`.
"""


def html_documentation(request=None) -> str:
    return render_html_documentation(documentation_payload(request))


def pdf_documentation(request=None) -> bytes:
    return render_pdf_documentation(documentation_payload(request))
