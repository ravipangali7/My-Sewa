#!/usr/bin/env bash
# Fix admin dashboard / statement 500s caused by missing migration 0024.
#
# On the VPS:
#   sudo bash /var/www/mysewa/deploy/FIX_STATEMENT_500.sh
#
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/mysewa}"
SERVER_DIR="${MYSEWA_SERVER_DIR:-$APP_ROOT/server}"
VENV_PY="${VENV_PY:-$APP_ROOT/env/bin/python}"

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server dir not found: $SERVER_DIR" >&2
  exit 1
fi
if [[ ! -x "$VENV_PY" ]]; then
  echo "Python venv not found: $VENV_PY" >&2
  exit 1
fi

echo "==> Applying migrations (incl. statement reconcile + himalpay logs)"
cd "$SERVER_DIR"
"$VENV_PY" manage.py migrate --noinput
"$VENV_PY" manage.py showmigrations core | tail -8

echo "==> Restarting API"
systemctl restart mysewa-api
systemctl --no-pager --full status mysewa-api | head -20 || true

echo "==> Optional: install daily statement reconcile timer"
if [[ -f "$APP_ROOT/deploy/mysewa-statement-reconcile.service" ]]; then
  cp "$APP_ROOT/deploy/mysewa-statement-reconcile.service" /etc/systemd/system/
  cp "$APP_ROOT/deploy/mysewa-statement-reconcile.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now mysewa-statement-reconcile.timer || true
fi

echo "Done. Re-check:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -H 'Authorization: Bearer <token>' https://mysewaserver.sewabyapar.com/api/admin/dashboard/"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -H 'Authorization: Bearer <token>' 'https://mysewaserver.sewabyapar.com/api/admin/statement/?status=open'"
