#!/usr/bin/env bash
# Paste into Hostinger VPS Browser Terminal as root to switch HimalPay to LIVE.
# Fixes remittance / top-up / bank transfer when still on UAT credentials.
set -euo pipefail

APP_ROOT="${MYSEWA_ROOT:-/var/www/mysewa}"
ENV_FILE="$APP_ROOT/server/.env"
KEY="1611f8b0-c4a8-4fc0-840f-e8b28325d7ba"
BASE="https://api.himalpay.com.np/api/v1"

if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<EOF
HIMALPAY_BASE_URL=$BASE
HIMALPAY_API_KEY=$KEY
HIMALPAY_BYPASS_API=false
HIMALPAY_TIMEOUT=60
EOF
  echo "==> Created $ENV_FILE"
else
  touch "$ENV_FILE"
  if grep -q '^HIMALPAY_API_KEY=' "$ENV_FILE"; then
    sed -i "s|^HIMALPAY_API_KEY=.*|HIMALPAY_API_KEY=$KEY|" "$ENV_FILE"
  else
    echo "HIMALPAY_API_KEY=$KEY" >> "$ENV_FILE"
  fi
  if grep -q '^HIMALPAY_BASE_URL=' "$ENV_FILE"; then
    sed -i "s|^HIMALPAY_BASE_URL=.*|HIMALPAY_BASE_URL=$BASE|" "$ENV_FILE"
  else
    echo "HIMALPAY_BASE_URL=$BASE" >> "$ENV_FILE"
  fi
  if grep -q '^HIMALPAY_BYPASS_API=' "$ENV_FILE"; then
    sed -i "s|^HIMALPAY_BYPASS_API=.*|HIMALPAY_BYPASS_API=false|" "$ENV_FILE"
  else
    echo "HIMALPAY_BYPASS_API=false" >> "$ENV_FILE"
  fi
  echo "==> Updated $ENV_FILE"
fi

# DB integrations override env — keep them in sync with LIVE credentials.
PYTHON_BIN="$APP_ROOT/env/bin/python"
MANAGE="$APP_ROOT/server/manage.py"
if [[ -x "$PYTHON_BIN" && -f "$MANAGE" ]]; then
  echo "==> Syncing Settings.config.integrations to LIVE HimalPay"
  cd "$APP_ROOT/server"
  "$PYTHON_BIN" manage.py shell <<PY
from core.models import Settings, merge_app_config

s = Settings.load()
cfg = merge_app_config(s.config if isinstance(s.config, dict) else {})
integ = dict(cfg.get("integrations") or {})
integ["himalpay_api_key"] = "$KEY"
integ["himalpay_base_url"] = "$BASE"
cfg["integrations"] = integ
payment = dict(cfg.get("payment") or {})
payment["remittances_enabled"] = True
cfg["payment"] = payment
s.config = cfg
try:
    s.save(update_fields=["config", "updated_at"])
except Exception:
    s.save()
print("DB integrations updated:", integ["himalpay_base_url"], "key=…"+integ["himalpay_api_key"][-8:])
print("remittances_enabled:", payment.get("remittances_enabled"))
PY
else
  echo "==> WARNING: Django venv/manage.py not found; only .env was updated"
fi

systemctl restart mysewa-api
sleep 1
systemctl is-active mysewa-api

echo "==> Done. HimalPay is on LIVE:"
echo "    BASE=$BASE"
echo "    KEY=…${KEY: -8}"
echo "==> Ensure VPS public IP 147.93.153.157 is on the HimalPay LIVE IP Allowlist."
echo "==> Also set Remittance agent PAN + teller contact in Admin → Settings."
