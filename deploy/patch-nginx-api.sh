#!/usr/bin/env bash
# Inject /api|/media|/database|/static proxy into nginx server blocks for
# mysewa.sewabyapar.com. Idempotent — safe to re-run.
#
# Usage (on the VPS as root):
#   sudo bash /var/www/mysewa/deploy/patch-nginx-api.sh
set -euo pipefail

DOMAIN="${MYSEWA_DOMAIN:-mysewa.sewabyapar.com}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SNIPPET_SRC="$ROOT/nginx-api-locations.conf"
SNIPPET_DST="/etc/nginx/snippets/mysewa-api-proxy.conf"
MARKER_BEGIN="# BEGIN mysewa-api-proxy"
MARKER_END="# END mysewa-api-proxy"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "$SNIPPET_SRC" ]]; then
  echo "ERROR: missing $SNIPPET_SRC" >&2
  exit 1
fi

echo "==> Installing snippet $SNIPPET_DST"
mkdir -p /etc/nginx/snippets
cp "$SNIPPET_SRC" "$SNIPPET_DST"

mapfile -t CANDIDATES < <(
  {
    ls /etc/nginx/sites-enabled/* 2>/dev/null || true
    ls /etc/nginx/sites-available/* 2>/dev/null || true
    ls /etc/nginx/conf.d/*.conf 2>/dev/null || true
  } | sort -u
)

TARGETS=()
for f in "${CANDIDATES[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -qF "$DOMAIN" "$f"; then
    TARGETS+=("$f")
  fi
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "ERROR: no nginx config mentions $DOMAIN" >&2
  echo "Install deploy/nginx-mysewa.conf first, or set MYSEWA_DOMAIN." >&2
  exit 1
fi

patched=0
for conf in "${TARGETS[@]}"; do
  echo "==> Checking $conf"

  if grep -qF "$SNIPPET_DST" "$conf" || grep -qF "$MARKER_BEGIN" "$conf"; then
    echo "    already patched"
    continue
  fi

  if grep -qE 'location[[:space:]]+/api/' "$conf" \
    && grep -qE 'proxy_pass[[:space:]]+http://127\.0\.0\.1:8001' "$conf"; then
    echo "    already has /api/ → :8001"
    continue
  fi

  if grep -qE 'location[[:space:]]+/api/' "$conf"; then
    echo "WARNING: $conf has location /api/ but not proxy to :8001 — edit manually." >&2
    continue
  fi

  backup="${conf}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$conf" "$backup"
  echo "    backup → $backup"

  python3 - "$conf" "$DOMAIN" "$SNIPPET_DST" "$MARKER_BEGIN" "$MARKER_END" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
domain, snippet, begin, end = sys.argv[2:6]
text = path.read_text()
lines = text.splitlines(keepends=True)

# Split into top-level server { ... } blocks (brace-aware).
chunks = []
i = 0
n = len(lines)
while i < n:
    line = lines[i]
    if line.lstrip().startswith("server") and "{" in line:
        start = i
        depth = 0
        j = i
        while j < n:
            depth += lines[j].count("{") - lines[j].count("}")
            j += 1
            if depth == 0:
                break
        chunks.append(("server", lines[start:j]))
        i = j
        continue
    chunks.append(("other", [line]))
    i += 1

out = []
changed = False
for kind, block in chunks:
    if kind != "server":
        out.extend(block)
        continue
    body = "".join(block)
    if domain not in body:
        out.extend(block)
        continue
    if snippet in body or begin in body:
        out.extend(block)
        continue
    # Insert include after the opening `server {` line.
    inject = [
        f"    {begin}\n",
        f"    include {snippet};\n",
        f"    {end}\n",
    ]
    out.append(block[0])
    out.extend(inject)
    out.extend(block[1:])
    changed = True

if not changed:
    sys.stderr.write(f"WARNING: no injectable server block for {domain} in {path}\n")
    sys.exit(2)

path.write_text("".join(out))
print(f"    injected include {snippet}")
PY

  patched=$((patched + 1))
done

echo "==> nginx -t"
nginx -t

echo "==> reload nginx"
systemctl reload nginx

echo "==> Local Gunicorn"
if curl -sf "http://127.0.0.1:8001/api/settings/" >/dev/null; then
  echo "    :8001 OK"
else
  echo "    WARNING: nothing on :8001 — start API first:"
  echo "      systemctl status mysewa-api || sudo bash $ROOT/setup-server.sh"
fi

echo "==> Public API"
code=$(curl -s -o /tmp/mysewa-settings.body -w "%{http_code}" "https://${DOMAIN}/api/settings/" || true)
ctype=$(file -b --mime-type /tmp/mysewa-settings.body 2>/dev/null || echo unknown)
echo "    GET https://${DOMAIN}/api/settings/ → HTTP ${code:-000} (${ctype})"
head -c 120 /tmp/mysewa-settings.body 2>/dev/null; echo

echo "Done. Patched $patched file(s)."
