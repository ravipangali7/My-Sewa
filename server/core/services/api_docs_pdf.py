"""Professional MySewa API documentation PDF (no extra dependencies)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field


PAGE_W = 595.28
PAGE_H = 841.89
MARGIN_L = 48
MARGIN_R = 48
MARGIN_T = 62
MARGIN_B = 48
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

BRAND = (0.039, 0.478, 0.294)
BRAND_DARK = (0.024, 0.373, 0.227)
INK = (0.059, 0.090, 0.165)
MUTED = (0.357, 0.396, 0.451)
LINE = (0.886, 0.910, 0.941)
SOFT = (0.910, 0.969, 0.937)
CODE_BG = (0.059, 0.090, 0.165)
WHITE = (1, 1, 1)
DANGER = (0.863, 0.149, 0.149)


def _pdf_escape(text: str) -> str:
    cleaned = (
        (text or '')
        .replace('\u2022', '-')
        .replace('\u00b7', '|')
        .replace('\u2013', '-')
        .replace('\u2014', '-')
        .replace('\u2018', "'")
        .replace('\u2019', "'")
        .replace('\u201c', '"')
        .replace('\u201d', '"')
    )
    return (
        cleaned.replace('\\', '\\\\')
        .replace('(', '\\(')
        .replace(')', '\\)')
        .encode('latin-1', 'replace')
        .decode('latin-1')
    )


def _rgb(color) -> str:
    return f'{color[0]:.3f} {color[1]:.3f} {color[2]:.3f}'


def _width(text: str, font: str, size: float) -> float:
    if 'Courier' in font:
        return len(text) * size * 0.60
    factor = 0.58 if 'Bold' in font else 0.50
    return len(text) * size * factor


def _wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    text = (text or '').replace('\t', '    ')
    if not text:
        return ['']
    words = text.split(' ')
    lines: list[str] = []
    current = ''
    for word in words:
        candidate = word if not current else f'{current} {word}'
        if _width(candidate, font, size) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        if _width(word, font, size) <= max_width:
            current = word
            continue
        chunk = word
        while _width(chunk, font, size) > max_width and chunk:
            take = max(1, int(max_width / (_width('M', font, size) or 1)))
            lines.append(chunk[:take])
            chunk = chunk[take:]
        current = chunk
    if current:
        lines.append(current)
    return lines or ['']


@dataclass
class PdfBuilder:
    title: str
    pages: list[list[str]] = field(default_factory=list)
    ops: list[str] = field(default_factory=list)
    y: float = PAGE_H
    page_no: int = 0
    is_cover: bool = False

    def new_page(self, cover: bool = False):
        if self.ops:
            self.pages.append(self.ops)
        self.ops = []
        self.page_no += 1
        self.is_cover = cover
        self.y = PAGE_H - (36 if cover else MARGIN_T)
        if not cover:
            self._header()
            self._footer()

    def _header(self):
        self.rect(0, PAGE_H - 36, PAGE_W, 36, BRAND, fill=True)
        self.text(MARGIN_L, PAGE_H - 23, 'MySewa Developer API', 'Helvetica-Bold', 10, WHITE)
        self.text(PAGE_W - MARGIN_R - 90, PAGE_H - 23, 'Developer API', 'Helvetica', 9, WHITE)

    def _footer(self):
        self.rect(0, 0, PAGE_W, 32, BRAND_DARK, fill=True)
        self.text(MARGIN_L, 13, 'MySewa  |  Confidential developer documentation', 'Helvetica', 8, WHITE)
        label = f'{self.page_no}'
        self.text(PAGE_W - MARGIN_R - _width(label, 'Helvetica-Bold', 9), 13, label, 'Helvetica-Bold', 9, WHITE)

    def rect(self, x, y, w, h, color, fill=False, stroke=False, width=0.6):
        cmd = 'f' if fill and not stroke else 'S' if stroke and not fill else 'B'
        self.ops.append(f'{_rgb(color)} rg' if fill else '')
        if stroke:
            self.ops.append(f'{_rgb(color)} RG')
            self.ops.append(f'{width:.2f} w')
        if fill and not stroke:
            self.ops.append(f'{_rgb(color)} rg')
        self.ops.append(f'{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {cmd}')

    def filled_rect(self, x, y, w, h, color):
        self.ops.append(f'{_rgb(color)} rg')
        self.ops.append(f'{x:.2f} {y:.2f} {w:.2f} {h:.2f} re f')

    def text(self, x, y, content, font, size, color=INK):
        safe = _pdf_escape(content)
        self.ops.append('BT')
        self.ops.append(f'/{font} {size:.1f} Tf')
        self.ops.append(f'{_rgb(color)} rg')
        self.ops.append(f'1 0 0 1 {x:.2f} {y:.2f} Tm')
        self.ops.append(f'({safe}) Tj')
        self.ops.append('ET')

    def ensure(self, height: float):
        if self.y - height < MARGIN_B + 8:
            self.new_page()

    def spacer(self, amount=10):
        self.y -= amount

    def heading(self, text: str, size=16):
        height = size + 18
        self.ensure(height)
        self.filled_rect(MARGIN_L, self.y - size + 2, 4, size + 4, BRAND)
        self.text(MARGIN_L + 12, self.y - size + 4, text, 'Helvetica-Bold', size, INK)
        self.y -= height

    def paragraph(self, text: str, font='Helvetica', size=10, color=INK, width=None):
        width = width or CONTENT_W
        lines = _wrap(text, font, size, width)
        for line in lines:
            self.ensure(size + 4)
            self.text(MARGIN_L, self.y - size, line, font, size, color)
            self.y -= size + 3
        self.y -= 4

    def bullets(self, items: list[str]):
        for item in items:
            lines = _wrap(f'-  {item}', 'Helvetica', 10, CONTENT_W)
            for i, line in enumerate(lines):
                self.ensure(14)
                self.text(MARGIN_L, self.y - 10, line, 'Helvetica', 10, INK)
                self.y -= 13
            self.y -= 2

    def numbered(self, items: list[str]):
        for i, item in enumerate(items, start=1):
            prefix = f'{i}. '
            lines = _wrap(item, 'Helvetica', 10, CONTENT_W - 18)
            self.ensure(16)
            self.filled_rect(MARGIN_L, self.y - 12, 14, 14, BRAND)
            self.text(MARGIN_L + 4, self.y - 9, str(i), 'Helvetica-Bold', 8, WHITE)
            self.text(MARGIN_L + 20, self.y - 10, lines[0], 'Helvetica', 10, INK)
            self.y -= 14
            for line in lines[1:]:
                self.ensure(14)
                self.text(MARGIN_L + 20, self.y - 10, line, 'Helvetica', 10, INK)
                self.y -= 13
            self.y -= 4

    def callout(self, text: str):
        lines = _wrap(text, 'Helvetica', 10, CONTENT_W - 24)
        height = 16 + len(lines) * 13
        self.ensure(height)
        self.filled_rect(MARGIN_L, self.y - height, CONTENT_W, height, SOFT)
        self.filled_rect(MARGIN_L, self.y - height, 4, height, BRAND)
        y = self.y - 14
        for line in lines:
            self.text(MARGIN_L + 14, y, line, 'Helvetica', 10, BRAND_DARK)
            y -= 13
        self.y -= height + 8

    def endpoint(self, method: str, path: str):
        self.ensure(32)
        self.filled_rect(MARGIN_L, self.y - 24, CONTENT_W, 28, SOFT)
        badge_w = 42
        self.filled_rect(MARGIN_L + 8, self.y - 18, badge_w, 16, BRAND)
        self.text(MARGIN_L + 14, self.y - 14, method, 'Helvetica-Bold', 8, WHITE)
        self.text(MARGIN_L + 58, self.y - 14, path, 'Courier', 9, INK)
        self.y -= 36

    def code_block(self, text: str):
        raw_lines = (text or '').replace('\t', '    ').splitlines() or ['']
        wrapped: list[str] = []
        for line in raw_lines:
            if _width(line, 'Courier', 8) <= CONTENT_W - 24:
                wrapped.append(line)
            else:
                wrapped.extend(_wrap(line, 'Courier', 8, CONTENT_W - 24))
        # Keep a code block from overflowing a page: split if needed.
        max_lines = 28
        for start in range(0, len(wrapped), max_lines):
            chunk = wrapped[start:start + max_lines]
            height = 18 + len(chunk) * 11
            self.ensure(height)
            self.filled_rect(MARGIN_L, self.y - height, CONTENT_W, height, CODE_BG)
            y = self.y - 16
            for line in chunk:
                self.text(MARGIN_L + 12, y, line, 'Courier', 8, WHITE)
                y -= 11
            self.y -= height + 10

    def table(self, headers: list[str], rows: list[list[str]], col_fracs: list[float] | None = None):
        n = len(headers)
        fracs = col_fracs or [1 / n] * n
        widths = [CONTENT_W * f for f in fracs]
        header_lines = [_wrap(h, 'Helvetica-Bold', 8, w - 10) for h, w in zip(headers, widths)]
        header_h = 10 + max(len(x) for x in header_lines) * 10
        self.ensure(header_h + 20)
        self._table_header(headers, widths, header_h, header_lines)
        for row in rows:
            cell_lines = [_wrap(str(cell), 'Helvetica', 8, w - 10) for cell, w in zip(row, widths)]
            row_h = 8 + max(len(x) for x in cell_lines) * 10
            if self.y - row_h < MARGIN_B + 8:
                self.new_page()
                self._table_header(headers, widths, header_h, header_lines)
            self.filled_rect(MARGIN_L, self.y - row_h, CONTENT_W, row_h, WHITE)
            self.ops.append(f'{_rgb(LINE)} RG')
            self.ops.append('0.4 w')
            self.ops.append(f'{MARGIN_L:.2f} {self.y - row_h:.2f} {CONTENT_W:.2f} {row_h:.2f} re S')
            x = MARGIN_L
            for lines, w in zip(cell_lines, widths):
                cy = self.y - 12
                for line in lines:
                    self.text(x + 5, cy, line, 'Helvetica', 8, INK)
                    cy -= 10
                x += w
            self.y -= row_h
        self.y -= 12

    def _table_header(self, headers, widths, header_h, header_lines):
        self.filled_rect(MARGIN_L, self.y - header_h, CONTENT_W, header_h, BRAND)
        x = MARGIN_L
        for lines, w in zip(header_lines, widths):
            cy = self.y - 12
            for line in lines:
                self.text(x + 5, cy, line, 'Helvetica-Bold', 8, WHITE)
                cy -= 10
            x += w
        self.y -= header_h

    def cover(self, doc: dict):
        self.new_page(cover=True)
        self.filled_rect(0, 0, PAGE_W, PAGE_H, WHITE)
        self.filled_rect(0, PAGE_H - 210, PAGE_W, 210, BRAND)
        self.filled_rect(0, PAGE_H - 214, PAGE_W, 4, (0.125, 0.765, 0.416))
        self.text(MARGIN_L, PAGE_H - 70, 'MySewa', 'Helvetica-Bold', 28, WHITE)
        self.text(MARGIN_L, PAGE_H - 100, 'Developer API Documentation', 'Helvetica-Bold', 22, WHITE)
        self.text(MARGIN_L, PAGE_H - 126, 'Fund Transfer and HimalPay Bank APIs', 'Helvetica', 14, WHITE)
        self.text(MARGIN_L, PAGE_H - 160, f"API {doc['version']}   |   Docs {doc['docs_version']}   |   {doc['published_at']}", 'Helvetica', 11, WHITE)
        self.y = PAGE_H - 250
        self.paragraph('Official integration guide for wallet-to-wallet fund transfer and HimalPay bank payouts.')
        self.callout('API transactions are created automatically when your application calls the APIs. They are not created manually from the dashboard.')
        self.paragraph(f"Base URL: {doc['base_url']}", font='Helvetica-Bold')
        self.paragraph('Bank APIs: GET /api/v1/banklist/  |  POST /api/v1/verifiedbank/  |  POST /api/v1/banktransfer/')
        self.paragraph(f"Fund Transfer: {doc['method']} {doc['path']}")
        self.text(MARGIN_L, 56, 'mysewa.sewabyapar.com', 'Helvetica', 10, MUTED)
        self.text(MARGIN_L, 40, 'Confidential  |  For authorized API users', 'Helvetica', 9, MUTED)

    def toc(self, doc: dict):
        self.new_page()
        self.heading('Contents', 18)
        for i, item in enumerate(doc['toc'], start=1):
            self.ensure(18)
            self.text(MARGIN_L, self.y - 10, f"{i:02d}", 'Helvetica-Bold', 10, BRAND)
            self.text(MARGIN_L + 28, self.y - 10, item['title'], 'Helvetica', 11, INK)
            self.y -= 18

    def finish(self) -> bytes:
        if self.ops:
            self.pages.append(self.ops)
        content_streams = []
        for ops in self.pages:
            stream = '\n'.join(op for op in ops if op).encode('latin-1', 'replace')
            content_streams.append(stream)

        font_map = [
            ('F1', 'Helvetica'),
            ('F2', 'Helvetica-Bold'),
            ('F3', 'Courier'),
            ('F4', 'Courier-Bold'),
        ]
        # Rewrite font names used in ops: Helvetica -> F1 etc.
        renamed = []
        for stream in content_streams:
            text = stream.decode('latin-1')
            text = text.replace('/Helvetica-Bold', '/F2')
            text = text.replace('/Courier-Bold', '/F4')
            text = text.replace('/Helvetica', '/F1')
            text = text.replace('/Courier', '/F3')
            renamed.append(text.encode('latin-1'))

        n_pages = len(renamed)
        # object ids: 1 catalog, 2 pages, 3.. pages, then contents, then fonts
        page_ids = list(range(3, 3 + n_pages))
        content_ids = list(range(3 + n_pages, 3 + 2 * n_pages))
        font_ids = list(range(3 + 2 * n_pages, 3 + 2 * n_pages + 4))

        objects: list[bytes] = [
            b'<< /Type /Catalog /Pages 2 0 R >>',
            (
                f'<< /Type /Pages /Count {n_pages} /Kids [{" ".join(f"{pid} 0 R" for pid in page_ids)}] >>'
            ).encode('latin-1'),
        ]
        font_res = ' '.join(f'/F{i + 1} {fid} 0 R' for i, fid in enumerate(font_ids))
        for page_id, content_id in zip(page_ids, content_ids):
            objects.append(
                (
                    f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}] '
                    f'/Resources << /Font << {font_res} >> >> '
                    f'/Contents {content_id} 0 R >>'
                ).encode('latin-1')
            )
        for stream in renamed:
            objects.append(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
        for _res, name in font_map:
            objects.append(f'<< /Type /Font /Subtype /Type1 /BaseFont /{name} >>'.encode('latin-1'))

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


def render_pdf_documentation(doc: dict) -> bytes:
    pdf = PdfBuilder(title=doc['title'])
    pdf.cover(doc)
    pdf.toc(doc)

    pdf.new_page()
    pdf.heading('1. Introduction')
    pdf.paragraph(
        'The MySewa Developer API lets an approved API user move NPR from their wallet '
        'to another MySewa wallet, or to a bank account through HimalPay.'
    )
    pdf.callout(
        'You do not create API transactions from the Developer dashboard. Your application '
        'calls the API; MySewa creates the transaction automatically. Bank verification is not a wallet transaction.'
    )
    pdf.heading('How API Fund Transfer Works')
    pdf.numbered(doc['how_it_works'])

    pdf.heading('2. API Base URL')
    pdf.code_block(doc['base_url'])

    pdf.heading('3. Authentication')
    pdf.paragraph('All Developer API endpoints accept Bearer API keys only. Dashboard login tokens are rejected.')
    pdf.code_block(doc['authentication']['header'])
    pdf.bullets(doc['authentication']['notes'])

    pdf.heading('4. API Key')
    pdf.numbered(
        [
            'An administrator enables Fund Transfer API access for the account.',
            'Open Developer / API to view, copy, or regenerate the key.',
            'Regenerating a key invalidates the previous key immediately.',
        ]
    )

    pdf.heading('Bank API integration flow')
    pdf.paragraph('Recommended order. The three bank endpoints are independent, but payouts require a recent successful verification of the same bank details.')
    pdf.code_block('1. GET /api/v1/banklist/\n2. POST /api/v1/verifiedbank/\n3. POST /api/v1/banktransfer/')
    pdf.numbered(doc.get('bank_flow') or [])

    for section in doc.get('api_sections') or []:
        pdf.heading(section['title'])
        pdf.endpoint(section.get('method') or 'POST', section.get('path') or '')
        pdf.paragraph(section.get('purpose') or '')
        pdf.paragraph(f"Full URL: {section.get('url') or ''}")
        if section.get('query'):
            pdf.paragraph('Query parameters')
            pdf.table(
                ['Field', 'Required', 'Type', 'Description'],
                [
                    [item['name'], 'Yes' if item.get('required') else 'No', str(item.get('type') or ''), str(item.get('description') or '')]
                    for item in section['query']
                ],
                [0.18, 0.14, 0.12, 0.56],
            )
        body = section.get('request_body') or {}
        if body:
            pdf.paragraph('Request parameters')
            pdf.table(
                ['Field', 'Required', 'Type', 'Description'],
                [
                    [name, 'Yes' if field.get('required') else 'No', str(field.get('type')), str(field.get('description'))]
                    for name, field in body.items()
                ],
                [0.22, 0.12, 0.12, 0.54],
            )
        if section.get('request_example'):
            pdf.code_block(json.dumps(section['request_example'], indent=2))
        pdf.paragraph(section.get('success_http') or '200 OK')
        pdf.code_block(json.dumps(section.get('success_response') or {}, indent=2))
        if section.get('failed_response'):
            pdf.paragraph('Failed verification')
            pdf.code_block(json.dumps(section['failed_response'], indent=2))
        examples = section.get('examples') or {}
        if examples.get('curl'):
            pdf.heading('cURL', 12)
            pdf.code_block(examples['curl'])
        if examples.get('python'):
            pdf.heading('Python', 12)
            pdf.code_block(examples['python'])
        if examples.get('javascript'):
            pdf.heading('JavaScript', 12)
            pdf.code_block(examples['javascript'])
        if section.get('errors'):
            pdf.table(
                ['HTTP', 'Code', 'Error', 'When'],
                [
                    [str(item['http']), item['code'], item['error'], item.get('message') or '']
                    for item in section['errors']
                ],
                [0.12, 0.26, 0.24, 0.38],
            )
        if section.get('notes'):
            pdf.bullets(section['notes'])

    pdf.heading('5. Fund Transfer API')
    pdf.endpoint(doc['method'], doc['path'])
    pdf.paragraph(f"Full URL: {doc['endpoint']}")

    pdf.heading('6. Request Parameters')
    pdf.table(
        ['Field', 'Required', 'Type', 'Description'],
        [
            [name, 'Yes' if field.get('required') else 'No', str(field.get('type')), str(field.get('description'))]
            for name, field in doc['request_body'].items()
        ],
        [0.18, 0.14, 0.12, 0.56],
    )
    pdf.code_block(json.dumps(doc['request_example'], indent=2))
    pdf.paragraph('Validation rules')
    pdf.bullets(doc['validation'])

    pdf.heading('7. Headers')
    pdf.table(
        ['Header', 'Required', 'Example', 'Notes'],
        [
            [h['name'], 'Yes' if h.get('required') else 'No', h['example'], h.get('notes') or '']
            for h in doc['headers']
        ],
        [0.22, 0.12, 0.28, 0.38],
    )

    pdf.heading('8. Request Examples')
    pdf.heading('9. cURL Example', 13)
    pdf.code_block(doc['examples']['curl'])
    pdf.heading('10. Python Example', 13)
    pdf.code_block(doc['examples']['python'])
    pdf.heading('11. JavaScript Example', 13)
    pdf.code_block(doc['examples']['javascript'])

    pdf.heading('12. Successful Response')
    pdf.paragraph(doc['success_http'])
    pdf.paragraph('transaction_id is the MySewa wallet-transfer reference, for example MYSEWA_WT_...')
    pdf.code_block(json.dumps(doc['success_response'], indent=2))

    pdf.heading('13. Error Responses')
    pdf.table(
        ['HTTP', 'Code', 'Error', 'When'],
        [
            [str(item['http']), item['code'], item['error'], item.get('message') or '']
            for item in doc['error_responses']
        ],
        [0.12, 0.28, 0.22, 0.38],
    )
    pdf.code_block(json.dumps(doc['error_body'], indent=2))

    pdf.heading('14. HTTP Status Codes')
    pdf.table(
        ['Status', 'Meaning'],
        [[str(item['http']), item['meaning']] for item in doc['http_status_codes']],
        [0.16, 0.84],
    )

    pdf.heading('15. Duplicate / Idempotency Rules')
    pdf.paragraph(doc['idempotency'])

    pdf.heading('16. API Transaction History')
    pdf.paragraph(doc['transaction_history']['summary'])
    pdf.bullets(doc['transaction_history']['fields'])
    pdf.paragraph(doc['transaction_history']['note'])
    pdf.callout(doc['transaction_history']['empty'])

    pdf.heading('17. Security Guidelines')
    pdf.bullets(doc['security'])

    pdf.heading('18. Integration Flow')
    pdf.numbered(doc['how_it_works'])

    return pdf.finish()
