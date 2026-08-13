#!/usr/bin/env bash
# =============================================================================
# Fix production 500s on:
#   GET /api/settings/
#   GET /api/auth/profile/
#   GET /api/wallet/balance/
#   GET /api/wallet/transactions/
#
# Root cause: Django reads db.sqlite3, but the real database was renamed to
# "db .sqlite3" (space in the name). The empty db.sqlite3 has no core_settings
# (OperationalError: no such table: core_settings).
#
# Paste on the VPS as root (or the app user with sudo):
#   bash /home/luna/My-Sewa/deploy/FIX_ALL_500.sh
# Or paste this entire file into the Hostinger VPS terminal.
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:-}"
if [[ -z "$APP_ROOT" ]]; then
  if [[ -d /home/luna/My-Sewa/server ]]; then
    APP_ROOT=/home/luna/My-Sewa
  elif [[ -d /var/www/mysewa/server ]]; then
    APP_ROOT=/var/www/mysewa
  else
    APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  fi
fi

SERVER_DIR="${MYSEWA_SERVER_DIR:-$APP_ROOT/server}"
echo "==> APP_ROOT=$APP_ROOT"
echo "==> SERVER_DIR=$SERVER_DIR"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "ERROR: server dir not found: $SERVER_DIR" >&2
  exit 1
fi

VENV_PY="${VENV_PY:-}"
for candidate in \
  "$SERVER_DIR/env/bin/python" \
  "$APP_ROOT/env/bin/python" \
  "$SERVER_DIR/../env/bin/python"
do
  if [[ -x "$candidate" ]]; then
    VENV_PY="$candidate"
    break
  fi
done
if [[ -z "$VENV_PY" || ! -x "$VENV_PY" ]]; then
  VENV_PY="$(command -v python3 || true)"
fi
echo "==> PYTHON=$VENV_PY"

cd "$SERVER_DIR"
echo "==> SQLite files:"
ls -la db*.sqlite3 "db .sqlite3" 2>/dev/null || ls -la | grep -i sqlite || true

echo "==> Stopping API (so SQLite is not locked)"
systemctl stop mysewa-api 2>/dev/null || true
pkill -f 'gunicorn.*mysewa' 2>/dev/null || true
sleep 1

python3 - <<'PY'
import os, shutil, sqlite3, time
from pathlib import Path

here = Path(".").resolve()
canonical = here / "db.sqlite3"
spaced = here / "db .sqlite3"

def tables(path: Path):
    if not path.is_file() or path.stat().st_size < 100:
        return set()
    try:
        con = sqlite3.connect(str(path))
        try:
            rows = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            return {r[0] for r in rows}
        finally:
            con.close()
    except Exception as exc:
        print("warn: cannot read", path, exc)
        return set()

def score(path: Path):
    t = tables(path)
    return (1 if "core_settings" in t else 0, 1 if "core_customuser" in t else 0, len(t), path.stat().st_size if path.is_file() else 0)

print("canonical", canonical, "exists", canonical.is_file(), "score", score(canonical) if canonical.is_file() else None, "tables", sorted(tables(canonical))[:12])
print("spaced    ", spaced, "exists", spaced.is_file(), "score", score(spaced) if spaced.is_file() else None, "tables", sorted(tables(spaced))[:12])

candidates = [p for p in (canonical, spaced) if p.is_file()]
if not candidates:
    raise SystemExit("ERROR: no sqlite file found in server/")

best = max(candidates, key=score)
best_t = tables(best)
print("best file:", best.name, "n_tables", len(best_t), "has_core_settings", "core_settings" in best_t)

if best != canonical:
    stamp = time.strftime("%Y%m%d%H%M%S")
    if canonical.is_file():
        bak = here / f"db.sqlite3.empty.{stamp}"
        print("Moving empty/wrong db.sqlite3 ->", bak.name)
        shutil.move(str(canonical), str(bak))
    print("Restoring", best.name, "-> db.sqlite3")
    shutil.move(str(best), str(canonical))
elif "core_settings" not in best_t:
    print("WARNING: db.sqlite3 has no core_settings; migrate will create empty tables.")
else:
    print("OK: db.sqlite3 already has core_settings")

final = tables(canonical)
print("final tables:", len(final), "core_settings" in final, "authtoken_token" in final)
if canonical.is_file():
    print("final size:", canonical.stat().st_size)
PY

echo "==> git pull (best-effort, so Django sqlite-path fix is live)"
if [[ -d "$APP_ROOT/.git" ]]; then
  git -C "$APP_ROOT" pull --ff-only || true
fi

echo "==> migrate"
set +e
"$VENV_PY" manage.py migrate --noinput
"$VENV_PY" manage.py migrate authtoken --noinput
MIG_RC=$?
set -e
echo "==> migrate rc=$MIG_RC"

"$VENV_PY" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
django.setup()
from django.db import connection
from django.conf import settings
names = set(connection.introspection.table_names())
print("Django DB NAME:", settings.DATABASES["default"]["NAME"])
print("core_settings", "core_settings" in names)
print("authtoken_token", "authtoken_token" in names)
print("core_customuser", "core_customuser" in names)
print("core_wallet", "core_wallet" in names)
if "core_settings" not in names:
    from core.models import _ensure_settings_table, _ensure_authtoken_table
    print("ensure settings:", _ensure_settings_table())
    print("ensure authtoken:", _ensure_authtoken_table())
    names = set(connection.introspection.table_names())
    print("after ensure core_settings", "core_settings" in names)
PY

echo "==> Starting API"
if systemctl list-unit-files 2>/dev/null | grep -q mysewa-api; then
  systemctl start mysewa-api
  sleep 2
  systemctl --no-pager --full status mysewa-api | head -20 || true
else
  echo "WARNING: mysewa-api unit not found — start gunicorn manually."
fi

echo "==> Health check"
sleep 1
CODE=$(curl -sS -o /tmp/mysewa-settings.json -w "%{http_code}" http://127.0.0.1:8001/api/settings/ || echo 000)
echo "GET http://127.0.0.1:8001/api/settings/ -> HTTP $CODE"
head -c 240 /tmp/mysewa-settings.json 2>/dev/null; echo
if [[ "$CODE" != "200" ]]; then
  echo "ERROR: settings still not 200. Last journal:"
  journalctl -u mysewa-api -n 40 --no-pager || true
  exit 1
fi
echo "========== SUCCESS — /api/settings/ is JSON 200 =========="
echo "Reload the site. Signed-in users may need to log in again if tokens were on the empty DB."
