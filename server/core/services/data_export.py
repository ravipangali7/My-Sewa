"""
Full-database export for Super Admin: Excel workbook, CSV zip, and
phpMyAdmin-compatible MySQL dumps.
"""
from __future__ import annotations

import csv
import json
import math
import re
import zipfile
from datetime import date, datetime, time
from decimal import Decimal
from io import BytesIO, StringIO
from uuid import UUID
from xml.sax.saxutils import escape as xml_escape

from django.db import connection
from django.utils import timezone

EXPORT_FORMATS = ('xlsx', 'csv', 'sql')

_SKIP_PREFIXES = ('sqlite_', 'pg_')
_SKIP_TABLES = frozenset({'sqlite_sequence'})
_VARCHAR_RE = re.compile(
    r'^(?:VAR)?CHAR(?:ACTER)?(?:\s+VARYING)?\s*\(\s*(\d+)\s*\)',
    re.IGNORECASE,
)
_DECIMAL_RE = re.compile(
    r'^(?:DECIMAL|NUMERIC)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)',
    re.IGNORECASE,
)


def build_export(fmt: str) -> tuple[bytes, str, str]:
    """
    Return (payload, filename, content_type) for the requested format.
    fmt: xlsx | csv | sql
    """
    fmt = (fmt or '').strip().lower()
    if fmt in ('excel', 'xls'):
        fmt = 'xlsx'
    if fmt in ('mysql', 'phpmyadmin', 'dump'):
        fmt = 'sql'
    if fmt in ('csvs', 'zip'):
        fmt = 'csv'
    if fmt not in EXPORT_FORMATS:
        raise ValueError('format must be xlsx, csv, or sql')

    stamp = timezone.localtime().strftime('%Y%m%d-%H%M%S')
    tables = collect_tables()

    if fmt == 'xlsx':
        return (
            build_xlsx(tables),
            f'mysewa-all-data-{stamp}.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
    if fmt == 'csv':
        return (
            build_csv_zip(tables, stamp),
            f'mysewa-all-data-{stamp}.zip',
            'application/zip',
        )
    return (
        build_mysql_dump(tables, stamp),
        f'mysewa-all-data-{stamp}.sql',
        'application/sql; charset=utf-8',
    )


def collect_tables() -> list[dict]:
    """Read every application table (name, columns, type info, rows)."""
    tables: list[dict] = []
    with connection.cursor() as cursor:
        names = connection.introspection.table_names(cursor, include_views=False)
        for name in sorted(names):
            if name in _SKIP_TABLES or name.startswith(_SKIP_PREFIXES):
                continue
            description = connection.introspection.get_table_description(cursor, name)
            columns = [field.name for field in description]
            pk = None
            try:
                pk = connection.introspection.get_primary_key_column(cursor, name)
            except Exception:
                pk = None
            quoted = connection.ops.quote_name(name)
            cursor.execute(f'SELECT * FROM {quoted}')
            raw_rows = cursor.fetchall()
            rows = [tuple(_normalize_value(v) for v in row) for row in raw_rows]
            tables.append(
                {
                    'name': name,
                    'columns': columns,
                    'description': description,
                    'pk': pk,
                    'rows': rows,
                }
            )
    return tables


def _normalize_value(value):
    if value is None:
        return None
    if isinstance(value, memoryview):
        return bytes(value)
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            return timezone.localtime(value).replace(tzinfo=None)
        return value
    return value


def _cell_text(value) -> str:
    if value is None:
        return ''
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


# --- CSV zip -----------------------------------------------------------------

def build_csv_zip(tables: list[dict], stamp: str) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        overview = StringIO()
        overview.write('table,columns,rows\n')
        for table in tables:
            overview.write(
                f'{table["name"]},{len(table["columns"])},{len(table["rows"])}\n'
            )
            sheet = StringIO()
            writer = csv.writer(sheet)
            writer.writerow(table['columns'])
            for row in table['rows']:
                writer.writerow([_cell_text(v) for v in row])
            # UTF-8 BOM so Excel opens Nepali / Unicode correctly
            payload = '\ufeff' + sheet.getvalue()
            zf.writestr(f'{table["name"]}.csv', payload.encode('utf-8'))
        readme = (
            'MySewa full data export\n'
            f'Generated: {stamp}\n'
            'Each CSV is one database table. Import individually, or use the\n'
            'MySQL .sql export in phpMyAdmin (Import tab, format SQL).\n'
        )
        zf.writestr('_overview.csv', ('\ufeff' + overview.getvalue()).encode('utf-8'))
        zf.writestr('README.txt', readme.encode('utf-8'))
    return buf.getvalue()


# --- Excel (.xlsx) -----------------------------------------------------------

def _col_letter(n: int) -> str:
    letters = ''
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _excel_sheet_names(tables: list[dict]) -> list[str]:
    used: set[str] = set()
    names = ['_overview']
    used.add('_overview')
    for table in tables:
        base = re.sub(r'[:\\/?*\[\]]', '_', table['name'])[:31] or 'table'
        name = base
        i = 2
        while name.lower() in used:
            suffix = f'_{i}'
            name = f'{base[: 31 - len(suffix)]}{suffix}'
            i += 1
        used.add(name.lower())
        names.append(name)
    return names


def _xml_text(value: str) -> str:
    cleaned = ''.join(ch if ord(ch) >= 32 or ch in '\t\n\r' else ' ' for ch in value)
    return xml_escape(cleaned, {'"': '&quot;', "'": '&apos;'})


def _worksheet_xml(headers: list[str], rows: list[tuple]) -> str:
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<sheetData>',
    ]
    header_cells = []
    for i, header in enumerate(headers, start=1):
        ref = f'{_col_letter(i)}1'
        header_cells.append(
            f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">'
            f'{_xml_text(str(header))}</t></is></c>'
        )
    parts.append(f'<row r="1">{"".join(header_cells)}</row>')

    excel_max = 1_048_575  # header uses row 1
    for r_idx, row in enumerate(rows[:excel_max], start=2):
        cells = []
        for c_idx, value in enumerate(row, start=1):
            ref = f'{_col_letter(c_idx)}{r_idx}'
            text = _cell_text(value)
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">'
                f'{_xml_text(text)}</t></is></c>'
            )
        parts.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    parts.append('</sheetData></worksheet>')
    return ''.join(parts)


def build_xlsx(tables: list[dict]) -> bytes:
    sheet_names = _excel_sheet_names(tables)
    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        overrides = [
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '<Override PartName="/xl/styles.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        ]
        wb_rels = []
        sheets_xml = []
        for i, name in enumerate(sheet_names, start=1):
            overrides.append(
                f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            )
            wb_rels.append(
                f'<Relationship Id="rId{i}" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                f'Target="worksheets/sheet{i}.xml"/>'
            )
            sheets_xml.append(
                f'<sheet name="{_xml_text(name)}" sheetId="{i}" r:id="rId{i}"/>'
            )

        styles_id = len(sheet_names) + 1
        wb_rels.append(
            f'<Relationship Id="rId{styles_id}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
            'Target="styles.xml"/>'
        )

        zf.writestr(
            '[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            + ''.join(overrides)
            + '</Types>',
        )
        zf.writestr(
            '_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/>'
            '</Relationships>',
        )
        zf.writestr(
            'xl/_rels/workbook.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(wb_rels)
            + '</Relationships>',
        )
        zf.writestr(
            'xl/workbook.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets>{"".join(sheets_xml)}</sheets></workbook>',
        )
        zf.writestr(
            'xl/styles.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
            '<borders count="1"><border/></borders>'
            '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
            '<cellXfs count="1"><xf/></cellXfs>'
            '</styleSheet>',
        )

        overview_headers = ['table', 'columns', 'rows']
        overview_rows = [
            (t['name'], len(t['columns']), len(t['rows'])) for t in tables
        ]
        zf.writestr('xl/worksheets/sheet1.xml', _worksheet_xml(overview_headers, overview_rows))
        for i, table in enumerate(tables, start=2):
            zf.writestr(
                f'xl/worksheets/sheet{i}.xml',
                _worksheet_xml(table['columns'], table['rows']),
            )
    return buf.getvalue()


# --- phpMyAdmin MySQL dump ---------------------------------------------------

def _mysql_ident(name: str) -> str:
    return '`' + str(name).replace('`', '``') + '`'


def _mysql_column_type(info, is_pk: bool) -> str:
    raw = str(getattr(info, 'type_code', '') or 'TEXT').strip()
    upper = raw.upper()

    match = _VARCHAR_RE.match(raw)
    if match:
        size = min(max(int(match.group(1)), 1), 16383)
        return f'VARCHAR({size})'

    dec = _DECIMAL_RE.match(raw)
    if dec:
        return f'DECIMAL({int(dec.group(1))},{int(dec.group(2))})'

    if 'BOOL' in upper:
        return 'TINYINT(1)'
    if 'BIGINT' in upper or upper in ('BIGSERIAL',):
        return 'BIGINT'
    if 'SMALLINT' in upper or 'TINYINT' in upper:
        return 'SMALLINT'
    if 'INT' in upper or upper in ('INTEGER', 'SERIAL'):
        return 'BIGINT' if is_pk else 'INT'
    if 'DECIMAL' in upper or 'NUMERIC' in upper:
        precision = getattr(info, 'precision', None) or 12
        scale = getattr(info, 'scale', None)
        if scale is None:
            scale = 2
        return f'DECIMAL({int(precision)},{int(scale)})'
    if any(token in upper for token in ('DOUBLE', 'FLOAT', 'REAL')):
        return 'DOUBLE'
    if 'DATETIME' in upper or 'TIMESTAMP' in upper:
        return 'DATETIME(6)'
    if upper == 'DATE':
        return 'DATE'
    if upper == 'TIME' or upper.startswith('TIME('):
        return 'TIME'
    if any(token in upper for token in ('BLOB', 'BINARY', 'BYTEA')):
        return 'LONGBLOB'
    if 'JSON' in upper:
        return 'LONGTEXT'
    if any(token in upper for token in ('TEXT', 'CLOB', 'CHAR')):
        size = getattr(info, 'internal_size', None) or getattr(info, 'display_size', None)
        if size and 0 < int(size) <= 1024 and 'TEXT' not in upper:
            return f'VARCHAR({int(size)})'
        return 'LONGTEXT'

    size = getattr(info, 'internal_size', None) or getattr(info, 'display_size', None)
    if size and 0 < int(size) <= 1024:
        return f'VARCHAR({int(size)})'
    return 'LONGTEXT'


def _mysql_literal(value) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return 'NULL'
        return repr(value)
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, datetime):
        return "'" + value.strftime('%Y-%m-%d %H:%M:%S.%f') + "'"
    if isinstance(value, date):
        return "'" + value.isoformat() + "'"
    if isinstance(value, time):
        return "'" + value.isoformat() + "'"
    if isinstance(value, UUID):
        value = str(value)
    if isinstance(value, (bytes, bytearray)):
        if not value:
            return "''"
        return '0x' + bytes(value).hex()
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, default=str)
    text = str(value)
    escaped = (
        text.replace('\\', '\\\\')
        .replace('\x00', '\\0')
        .replace('\n', '\\n')
        .replace('\r', '\\r')
        .replace("'", "\\'")
    )
    return f"'{escaped}'"


def _create_table_sql(table: dict) -> str:
    name = table['name']
    pk = table.get('pk')
    lines = []
    integer_pk = False
    for info in table['description']:
        col = info.name
        is_pk = bool(pk and col == pk)
        col_type = _mysql_column_type(info, is_pk=is_pk)
        null_ok = bool(getattr(info, 'null_ok', True))
        parts = [_mysql_ident(col), col_type]
        if is_pk and col_type in ('INT', 'BIGINT', 'SMALLINT'):
            parts.append('NOT NULL AUTO_INCREMENT')
            integer_pk = True
        elif not null_ok or is_pk:
            parts.append('NOT NULL')
        else:
            parts.append('NULL')
        lines.append('  ' + ' '.join(parts))
    if pk:
        lines.append(f'  PRIMARY KEY ({_mysql_ident(pk)})')
    body = ',\n'.join(lines)
    auto = ''
    if integer_pk:
        auto_val = 1
        try:
            pk_idx = table['columns'].index(pk)
            max_id = 0
            for row in table['rows']:
                val = row[pk_idx]
                if isinstance(val, int) and val > max_id:
                    max_id = val
            auto_val = max_id + 1 if max_id else 1
        except (ValueError, TypeError):
            auto_val = 1
        auto = f' AUTO_INCREMENT={auto_val}'
    return (
        f'DROP TABLE IF EXISTS {_mysql_ident(name)};\n'
        f'CREATE TABLE {_mysql_ident(name)} (\n{body}\n) '
        f'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci{auto};\n'
    )


def _insert_sql(table: dict) -> str:
    if not table['rows'] or not table['columns']:
        return ''
    cols = ', '.join(_mysql_ident(c) for c in table['columns'])
    chunks = []
    batch: list[str] = []
    batch_size = 80

    def flush():
        if not batch:
            return
        chunks.append(
            f'INSERT INTO {_mysql_ident(table["name"])} ({cols}) VALUES\n'
            + ',\n'.join(batch)
            + ';\n'
        )
        batch.clear()

    for row in table['rows']:
        values = ', '.join(_mysql_literal(v) for v in row)
        batch.append(f'({values})')
        if len(batch) >= batch_size:
            flush()
    flush()
    return ''.join(chunks)


def build_mysql_dump(tables: list[dict], stamp: str) -> bytes:
    generated = timezone.localtime().strftime('%Y-%m-%d %H:%M:%S')
    parts = [
        '-- phpMyAdmin SQL Dump\n',
        '-- MySewa full database export (phpMyAdmin Import, format SQL)\n',
        f'-- Generated: {generated} ({stamp})\n',
        f'-- Tables: {len(tables)}\n',
        '--\n',
        'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n',
        'START TRANSACTION;\n',
        'SET time_zone = "+00:00";\n',
        'SET NAMES utf8mb4;\n',
        'SET FOREIGN_KEY_CHECKS = 0;\n\n',
    ]
    for table in tables:
        parts.append(f'-- --------------------------------------------------------\n')
        parts.append(f'-- Table structure and data for {table["name"]} ({len(table["rows"])} rows)\n')
        parts.append(f'-- --------------------------------------------------------\n\n')
        parts.append(_create_table_sql(table))
        parts.append('\n')
        insert = _insert_sql(table)
        if insert:
            parts.append(insert)
            parts.append('\n')
    parts.append('SET FOREIGN_KEY_CHECKS = 1;\n')
    parts.append('COMMIT;\n')
    return ''.join(parts).encode('utf-8')
