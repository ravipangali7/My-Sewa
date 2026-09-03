"""Normalize and compare Android app version strings for auto-update."""

from __future__ import annotations

import re


_VERSION_PREFIX = re.compile(r'^[vV]')


def normalize_app_version(value: str | None, *, width: int = 3) -> str:
    """
    Normalize a version string to dotted numeric form.

    Examples:
      '3'      -> '3.0.0'
      'v3.1'   -> '3.1.0'
      '3.0.0+2'-> '3.0.0'
      ' 3.2.1 '-> '3.2.1'
    """
    raw = str(value or '').strip()
    if not raw:
        return ''

    raw = _VERSION_PREFIX.sub('', raw, count=1).strip()
    if not raw:
        return ''

    # Drop pre-release / build metadata: 1.2.3-beta+4 -> 1.2.3
    core = raw.split('+', 1)[0].split('-', 1)[0].strip()
    parts: list[str] = []
    for piece in core.split('.')[:width]:
        piece = piece.strip()
        if not piece:
            parts.append('0')
            continue
        # Allow leading digits only (e.g. '3b' -> 3)
        digits = re.match(r'^(\d+)', piece)
        parts.append(str(int(digits.group(1))) if digits else '0')

    while len(parts) < width:
        parts.append('0')
    return '.'.join(parts)


def version_tuple(value: str | None, *, width: int = 3) -> tuple[int, ...]:
    normalized = normalize_app_version(value, width=width)
    if not normalized:
        return tuple(0 for _ in range(width))
    return tuple(int(part) for part in normalized.split('.'))


def is_newer_version(remote: str | None, local: str | None) -> bool:
    """True when remote is a strictly newer semver than local."""
    return version_tuple(remote) > version_tuple(local)
