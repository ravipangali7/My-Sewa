#!/usr/bin/env bash
# Fix OperationalError: no such table: authtoken_token
# (DRF TokenAuthentication 500 on /api/wallet/transactions/ and all authed APIs)
#
# Paste on VPS:
#   bash /home/luna/My-Sewa/deploy/FIX_AUTHTOKEN_TABLE.sh
# Or without the script file:
#   cd /home/luna/My-Sewa/server && ./env/bin/python manage.py migrate authtoken --noinput && sudo systemctl restart mysewa-api
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

echo "==> Applying authtoken + remaining migrations"
cd "$SERVER_DIR"
set +e
"$VENV_PY" manage.py migrate authtoken --noinput
"$VENV_PY" manage.py migrate --noinput
MIG_RC=$?
set -e

TABLE_OK="$("$VENV_PY" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
django.setup()
from django.db import connection
print("yes" if "authtoken_token" in connection.introspection.table_names() else "no")
PY
)"

if [[ "$TABLE_OK" != "yes" ]]; then
  echo "==> migrate did not create table (rc=$MIG_RC); applying schema_editor / SQL fallback"
  "$VENV_PY" - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
django.setup()
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from rest_framework.authtoken.models import Token

table = Token._meta.db_table
if table not in connection.introspection.table_names():
    try:
        with connection.schema_editor() as schema_editor:
            schema_editor.create_model(Token)
        print("schema_editor created", table)
    except Exception as exc:
        print("schema_editor failed:", exc)
        sql = """
CREATE TABLE IF NOT EXISTS "authtoken_token" (
    "key" varchar(40) NOT NULL PRIMARY KEY,
    "created" datetime NOT NULL,
    "user_id" bigint NOT NULL UNIQUE REFERENCES "core_customuser" ("id") DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS "authtoken_token_user_id_key"
  ON "authtoken_token" ("user_id");
"""
        with connection.cursor() as c:
            c.executescript(sql)
        print("Raw SQL table create done")

recorder = MigrationRecorder(connection)
from django.db.migrations.loader import MigrationLoader
loader = MigrationLoader(connection, ignore_no_migrations=True)
for app_label, name in loader.disk_migrations:
    if app_label != "authtoken":
        continue
    if not recorder.migration_qs.filter(app=app_label, name=name).exists():
        recorder.record_applied(app_label, name)
        print("Recorded migration authtoken.%s as applied" % name)

print("table ok:", table in connection.introspection.table_names())
PY
fi

"$VENV_PY" manage.py showmigrations authtoken

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
echo "Users may need to sign in again if old tokens were stored in a dropped table."
