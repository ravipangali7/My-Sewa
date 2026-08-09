#!/usr/bin/env bash
# Emergency one-liner-friendly fix for wallet transactions 500.
# Does NOT require git pull if migration 0031 file already exists on the server.
#
# Paste on VPS:
#   bash /home/luna/My-Sewa/deploy/FIX_ELECTRICITY_BILL_TABLE.sh
# Or without the script file:
#   cd /home/luna/My-Sewa/server && ./env/bin/python manage.py migrate --noinput && sudo systemctl restart mysewa-api
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/luna/My-Sewa}"
SERVER_DIR="${MYSEWA_SERVER_DIR:-$APP_ROOT/server}"
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

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server dir not found: $SERVER_DIR" >&2
  exit 1
fi
if [[ -z "$VENV_PY" || ! -x "$VENV_PY" ]]; then
  echo "Python venv not found under $APP_ROOT" >&2
  exit 1
fi

if [[ -d "$APP_ROOT/.git" ]]; then
  echo "==> git pull (best-effort)"
  git -C "$APP_ROOT" pull --ff-only || true
fi

echo "==> Applying migrations (creates core_electricitybilltransaction)"
cd "$SERVER_DIR"
set +e
"$VENV_PY" manage.py migrate --noinput
MIG_RC=$?
set -e

TABLE_OK="$("$VENV_PY" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
django.setup()
from django.db import connection
print("yes" if "core_electricitybilltransaction" in connection.introspection.table_names() else "no")
PY
)"

if [[ "$TABLE_OK" != "yes" ]]; then
  echo "==> migrate did not create table (rc=$MIG_RC); applying schema_editor / SQL fallback"
  "$VENV_PY" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
django.setup()
from django.db import connection
from core.models import _ensure_electricity_bill_table

try:
    created = _ensure_electricity_bill_table()
    print("ensure helper created=", created)
except Exception as exc:
    print("ensure helper failed:", exc)
    sql = """
CREATE TABLE IF NOT EXISTS "core_electricitybilltransaction" (
    "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sc_no" varchar(50) NOT NULL,
    "consumer_id" varchar(50) NOT NULL,
    "office_code" varchar(100) NOT NULL,
    "office_name" varchar(200) NOT NULL,
    "customer_name" varchar(200) NOT NULL,
    "session_id" varchar(100) NOT NULL,
    "amount" decimal NOT NULL,
    "pay_service" varchar(80) NOT NULL,
    "status" varchar(20) NOT NULL,
    "merchant_txn_id" varchar(100) NOT NULL UNIQUE,
    "service_hub_txn_id" varchar(100) NULL,
    "reference_id" varchar(100) NULL,
    "charge" decimal NOT NULL,
    "cashback" decimal NOT NULL,
    "total_debited" decimal NOT NULL,
    "balance_before" decimal NULL,
    "balance_after" decimal NULL,
    "inquiry_response" text NOT NULL DEFAULT '{}',
    "pay_payload" text NOT NULL DEFAULT '{}',
    "provider_response" text NOT NULL DEFAULT '{}',
    "created_at" datetime NOT NULL,
    "updated_at" datetime NOT NULL,
    "user_id" bigint NOT NULL REFERENCES "core_customuser" ("id") DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS "core_electricitybilltransaction_user_id_idx"
  ON "core_electricitybilltransaction" ("user_id");
"""
    with connection.cursor() as c:
        c.executescript(sql)
    from django.db.migrations.recorder import MigrationRecorder
    recorder = MigrationRecorder(connection)
    if (
        recorder.migration_qs.filter(app="core", name="0030_home_popup").exists()
        and not recorder.migration_qs.filter(app="core", name="0031_electricity_bill").exists()
    ):
        recorder.record_applied("core", "0031_electricity_bill")
        print("Recorded migration core.0031_electricity_bill as applied")
    print("Raw SQL table create done")

print("table ok:", "core_electricitybilltransaction" in connection.introspection.table_names())
PY
fi

"$VENV_PY" manage.py showmigrations core | tail -20

echo "==> Reloading gunicorn"
if systemctl list-units --type=service --all 2>/dev/null | grep -qE 'mysewa-api|gunicorn'; then
  systemctl restart mysewa-api 2>/dev/null || systemctl restart gunicorn 2>/dev/null || true
  systemctl --no-pager --full status mysewa-api 2>/dev/null | head -20 || true
else
  pkill -HUP -f 'gunicorn.*mysewa' 2>/dev/null \
    || pkill -HUP -f 'gunicorn.*wsgi' 2>/dev/null \
    || echo "HUP skipped — restart gunicorn manually if needed."
fi

echo "Done. Re-check GET /api/wallet/transactions/ (should not 500)."
