#!/usr/bin/env bash
# Fix OperationalError: no such table: core_electricitybilltransaction
# Code for ElectricityBillTransaction (migration 0031) was deployed without migrate.
#
# On the VPS:
#   bash /home/luna/My-Sewa/deploy/FIX_ELECTRICITY_BILL_TABLE.sh
#
# If the migration file is missing on the server, pull first:
#   cd /home/luna/My-Sewa && git pull
#   bash deploy/FIX_ELECTRICITY_BILL_TABLE.sh
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

MIG_FILE="$SERVER_DIR/core/migrations/0031_electricity_bill.py"
if [[ ! -f "$MIG_FILE" ]]; then
  echo "Migration file missing: $MIG_FILE" >&2
  echo "Pull latest code first: cd $APP_ROOT && git pull" >&2
  exit 1
fi

echo "==> Applying migrations (creates core_electricitybilltransaction)"
cd "$SERVER_DIR"
"$VENV_PY" manage.py migrate --noinput
"$VENV_PY" manage.py showmigrations core | tail -15

echo "==> Reloading gunicorn"
if systemctl list-units --type=service --all 2>/dev/null | grep -qE 'mysewa-api|gunicorn'; then
  systemctl restart mysewa-api 2>/dev/null || systemctl restart gunicorn 2>/dev/null || true
  systemctl --no-pager --full status mysewa-api 2>/dev/null | head -20 || true
else
  pkill -HUP -f 'gunicorn.*mysewa' 2>/dev/null \
    || pkill -HUP -f 'gunicorn.*wsgi' 2>/dev/null \
    || echo "HUP sent skipped — restart gunicorn manually if needed."
fi

echo "Done. Re-check GET /api/wallet/transactions/ (should not 500)."
