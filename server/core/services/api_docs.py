"""Fund Transfer API documentation generated from the live implementation."""
from __future__ import annotations

from datetime import date

from django.conf import settings

from .api_docs_html import render_html_documentation
from .api_docs_pdf import render_pdf_documentation

DOCS_VERSION = '1.1'


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


def documentation_payload(request=None) -> dict:
    base = api_base_url(request)
    endpoint = fund_transfer_url(request)
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
        'title': 'MySewa Fund Transfer API',
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
                'API transactions are created automatically when your application calls the Fund Transfer API. '
                'There is no manual "create API transaction" action in the dashboard.'
            ),
            'fields': [
                'Transaction ID (MySewa wallet-transfer reference, present on success)',
                'Sender (authenticated API user)',
                'Receiver (phone, email, or user id submitted in the request)',
                'Amount',
                'Client reference',
                'Status (SUCCESS or FAILED)',
                'Method (always API)',
                'Created date/time',
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
            'The Fund Transfer API is throttled to 60 requests per minute per API user.',
        ],
        'examples': {
            'curl': _curl_example(endpoint),
            'python': _python_example(endpoint),
            'javascript': _javascript_example(endpoint),
        },
        'toc': [
            {'id': 'introduction', 'title': 'Introduction'},
            {'id': 'base-url', 'title': 'API Base URL'},
            {'id': 'authentication', 'title': 'Authentication'},
            {'id': 'api-key', 'title': 'API Key'},
            {'id': 'fund-transfer', 'title': 'Fund Transfer API'},
            {'id': 'request', 'title': 'Request Parameters'},
            {'id': 'headers', 'title': 'Headers'},
            {'id': 'examples', 'title': 'Request Examples'},
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
    return f"""# {doc['title']}

Version: {doc['version']} · Documentation {doc['docs_version']} · {doc['published_at']}

## Introduction

MySewa Fund Transfer API lets an approved API user move NPR from their MySewa wallet to another MySewa wallet from their own website or application.

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


def _json_block(payload: dict) -> str:
    import json

    return json.dumps(payload, indent=2)


def html_documentation(request=None) -> str:
    return render_html_documentation(documentation_payload(request))


def pdf_documentation(request=None) -> bytes:
    return render_pdf_documentation(documentation_payload(request))
