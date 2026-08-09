#!/usr/bin/env bash
# Fix OperationalError: no such column: core_settings.app_version
# Deployed Settings.app_version/apk (migration 0029) without running migrate.
#
# On the VPS:
#   bash /home/luna/My-Sewa/deploy/FIX_APP_VERSION_COLUMN.sh
#
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/luna/My-Sewa}"
SERVER_DIR="${MYSEWA_SERVER_DIR:-$APP_ROOT/server}"
VENV_PY="${VENV_PY:-$SERVER_DIR/env/bin/python}"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server dir not found: $SERVER_DIR" >&2
  exit 1
fi
if [[ ! -x "$VENV_PY" ]]; then
  echo "Python venv not found: $VENV_PY" >&2
  exit 1
fi

echo "==> Applying migrations (adds core_settings.app_version + apk)"
cd "$SERVER_DIR"
"$VENV_PY" manage.py migrate --noinput
"$VENV_PY" manage.py showmigrations core | tail -12

echo "==> Reloading gunicorn"
if systemctl list-units --type=service --all 2>/dev/null | grep -qE 'mysewa-api|gunicorn'; then
  systemctl restart mysewa-api 2>/dev/null || systemctl restart gunicorn 2>/dev/null || true
  systemctl --no-pager --full status mysewa-api 2>/dev/null | head -20 || true
else
  pkill -HUP -f 'gunicorn.*mysewa' 2>/dev/null \
    || pkill -HUP -f 'gunicorn.*wsgi' 2>/dev/null \
    || echo "HUP sent skipped — restart gunicorn manually if needed."
fi

echo "Done. Re-check /api/water/counters/ (should not 500)."
