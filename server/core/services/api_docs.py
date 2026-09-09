"""Fund Transfer API documentation content used by the dashboard and downloads."""
from __future__ import annotations

from django.conf import settings


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
    return {
        'title': 'MySewa Fund Transfer API',
        'version': 'v1',
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
        'validation': [
            'Receiver must exist, be active, and must not be the sender.',
            'Amount must be a positive number (zero and negative values are rejected).',
            'Amount must satisfy the configured min/max transfer limits.',
            'Sender wallet must have sufficient balance including any applicable charges.',
            'Sender must be an API user with an active, approved account and wallet transfer permission.',
            'Frozen or blocked wallets cannot send or receive.',
            'Reference is required, 1–64 characters: letters, digits, hyphen, underscore, and period.',
        ],
        'success_response': {
            'success': True,
            'message': 'Fund transfer successful',
            'transaction_id': 'TXN123456789',
            'reference': 'ORDER-10001',
            'amount': 1000,
            'status': 'SUCCESS',
        },
        'error_responses': [
            {'http': 401, 'code': 'invalid_api_key', 'error': 'Invalid API key'},
            {'http': 403, 'code': 'api_access_disabled', 'error': 'API access disabled'},
            {'http': 403, 'code': 'user_inactive', 'error': 'User inactive'},
            {'http': 400, 'code': 'invalid_receiver', 'error': 'Invalid receiver'},
            {'http': 404, 'code': 'receiver_not_found', 'error': 'Receiver not found'},
            {'http': 400, 'code': 'insufficient_balance', 'error': 'Insufficient balance'},
            {'http': 400, 'code': 'invalid_amount', 'error': 'Invalid amount'},
            {'http': 409, 'code': 'duplicate_reference', 'error': 'Duplicate reference'},
            {'http': 403, 'code': 'unauthorized_transaction', 'error': 'Unauthorized transaction'},
            {'http': 404, 'code': 'wallet_unavailable', 'error': 'Wallet unavailable'},
            {'http': 429, 'code': 'throttled', 'error': 'Too many requests'},
            {'http': 500, 'code': 'server_error', 'error': 'Server/internal error'},
        ],
        'idempotency': (
            'Each API user may use a given `reference` (or Idempotency-Key) only once for a successful transfer. '
            'A repeated request with the same reference returns the original transaction_id and does not debit again. '
            'A failed attempt does not consume the reference, so the client may retry.'
        ),
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
        ],
        'examples': {
            'curl': _curl_example(endpoint),
            'python': _python_example(endpoint),
            'javascript': _javascript_example(endpoint),
        },
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
        f"- `{item['http']}` `{item['code']}` — {item['error']}"
        for item in doc['error_responses']
    )
    headers = '\n'.join(
        f"- `{h['name']}`{' (required)' if h.get('required') else ''} — `{h['example']}`"
        for h in doc['headers']
    )
    rules = '\n'.join(f'- {rule}' for rule in doc['validation'])
    security = '\n'.join(f'- {item}' for item in doc['security'])
    return f"""# {doc['title']}

Version: {doc['version']}

## Base URL

`{doc['base_url']}`

## Endpoint

`{doc['method']} {doc['path']}`

Full URL: `{doc['endpoint']}`

## Authentication

Send the API key as a Bearer token:

```
{doc['authentication']['header']}
```

{chr(10).join('- ' + n for n in doc['authentication']['notes'])}

## Headers

{headers}

## Request body

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| receiver | yes | string | Phone (preferred), email, or numeric user id of the MySewa recipient |
| amount | yes | number | NPR amount greater than zero |
| reference | yes | string | Unique client reference used for idempotency |

Example:

```json
{{
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "ORDER-10001"
}}
```

## Validation rules

{rules}

## Successful response

HTTP `201 Created` (or `200 OK` when replaying a duplicate reference):

```json
{ _json_block(doc['success_response']) }
```

`transaction_id` is the MySewa wallet-transfer reference (for example `MYSEWA_WT_...`).

## Error responses

{errors}

Error body shape:

```json
{{
  "success": false,
  "error": "Insufficient balance",
  "message": "Human-readable explanation",
  "code": "insufficient_balance"
}}
```

Internal exception messages and stack traces are never returned.

## Duplicate / idempotency behavior

{doc['idempotency']}

## Security recommendations

{security}

## Documentation download

Dashboard users with API access can download this document:

`GET /api/developer/docs/download/?doc_format=markdown`

Supported `doc_format` values: `markdown`, `html`, `pdf`.

## cURL

```bash
{doc['examples']['curl']}
```

## Python

```python
{doc['examples']['python']}
```

## JavaScript (fetch)

```javascript
{doc['examples']['javascript']}
```
"""


def _json_block(payload: dict) -> str:
    import json

    return json.dumps(payload, indent=2)


def html_documentation(request=None) -> str:
    import html as html_lib

    md = markdown_documentation(request)
    escaped = html_lib.escape(md)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MySewa Fund Transfer API</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; color: #111; }}
    pre {{ background: #0f172a; color: #e2e8f0; padding: 1rem; overflow: auto; border-radius: 8px; white-space: pre-wrap; }}
    h1, h2 {{ color: #0f766e; }}
  </style>
</head>
<body>
  <pre>{escaped}</pre>
</body>
</html>
"""


def pdf_documentation(request=None) -> bytes:
    """Minimal multi-page PDF from the markdown documentation (no extra dependency)."""
    text = markdown_documentation(request)
    return _text_to_pdf('MySewa Fund Transfer API', text)


def _escape_pdf(text: str) -> str:
    return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def _text_to_pdf(_title: str, text: str) -> bytes:
    lines: list[str] = []
    for raw in text.replace('\t', '    ').splitlines():
        if not raw:
            lines.append('')
            continue
        chunk = raw
        while len(chunk) > 92:
            lines.append(chunk[:92])
            chunk = chunk[92:]
        lines.append(chunk)

    page_height = 792
    page_width = 612
    margin = 48
    leading = 12
    lines_per_page = max(1, (page_height - 2 * margin) // leading)
    pages = [lines[i:i + lines_per_page] for i in range(0, len(lines), lines_per_page)] or [['']]

    content_streams = []
    for page_lines in pages:
        y = page_height - margin
        parts = ['BT', '/F1 10 Tf', f'{margin} {y} Td', f'{leading} TL']
        for line in page_lines:
            parts.append(f'({_escape_pdf(line)}) Tj T*')
        parts.append('ET')
        content_streams.append('\n'.join(parts).encode('latin-1', 'replace'))

    font_id = 3 + 2 * len(pages)
    objects: list[bytes] = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        f'<< /Type /Pages /Count {len(pages)} /Kids [{" ".join(f"{3 + i} 0 R" for i in range(len(pages)))}] >>'.encode(
            'latin-1'
        ),
    ]
    for page_index in range(len(pages)):
        content_id = 3 + len(pages) + page_index
        objects.append(
            (
                f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] '
                f'/Resources << /Font << /F1 {font_id} 0 R >> >> '
                f'/Contents {content_id} 0 R >>'
            ).encode('latin-1')
        )
    for stream in content_streams:
        objects.append(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')

    out = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f'{index} 0 obj\n'.encode('ascii'))
        out.extend(obj)
        out.extend(b'\nendobj\n')
    xref_pos = len(out)
    out.extend(f'xref\n0 {len(objects) + 1}\n'.encode('ascii'))
    out.extend(b'0000000000 65535 f \n')
    for offset in offsets[1:]:
        out.extend(f'{offset:010d} 00000 n \n'.encode('ascii'))
    out.extend(
        f'trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n'.encode(
            'ascii'
        )
    )
    return bytes(out)
