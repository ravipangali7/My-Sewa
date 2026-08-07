#!/usr/bin/env bash
# Restore Django SQLite after accidental rename to "db .sqlite3" (space in name).
# Run on the VPS as the app user or root:
#   bash deploy/FIX_DB_RENAME.sh
# Or:
#   MYSEWA_SERVER_DIR=/home/luna/My-Sewa/server bash deploy/FIX_DB_RENAME.sh
set -euo pipefail

SERVER_DIR="${MYSEWA_SERVER_DIR:-}"
if [[ -z "$SERVER_DIR" ]]; then
  if [[ -d /home/luna/My-Sewa/server ]]; then
    SERVER_DIR=/home/luna/My-Sewa/server
  elif [[ -d /var/www/mysewa/server ]]; then
    SERVER_DIR=/var/www/mysewa/server
  else
    SERVER_DIR="$(cd "$(dirname "$0")/../server" && pwd)"
  fi
fi

cd "$SERVER_DIR"
echo "==> Working in $SERVER_DIR"
ls -la db*.sqlite3 "db .sqlite3" 2>/dev/null || ls -la | grep -i sqlite || true

if [[ ! -f "db .sqlite3" ]]; then
  if [[ -f db.sqlite3 ]]; then
    echo "OK: db.sqlite3 already present; nothing to rename."
    exit 0
  fi
  echo "ERROR: neither 'db .sqlite3' nor db.sqlite3 found."
  exit 1
fi

systemctl stop mysewa-api 2>/dev/null || true
# Empty auto-created DB may exist — keep it aside, do not overwrite real data.
if [[ -f db.sqlite3 ]]; then
  bak="db.sqlite3.empty.$(date +%Y%m%d%H%M%S)"
  echo "==> Moving existing db.sqlite3 aside -> $bak"
  mv db.sqlite3 "$bak"
fi

echo "==> Restoring 'db .sqlite3' -> db.sqlite3"
mv "db .sqlite3" db.sqlite3

systemctl start mysewa-api 2>/dev/null || true
echo "==> Verifying tables..."
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("db.sqlite3")
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("tables:", tables)
assert "core_settings" in tables, "core_settings missing — wrong database file"
print("OK: core_settings present")
PY

echo "==> Done. Test: curl -sS http://127.0.0.1:8001/api/settings/ | head -c 200"
