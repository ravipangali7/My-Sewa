#!/usr/bin/env bash
# Paste into Hostinger VPS Browser Terminal as root to fix:
# "HimalPay API key is not configured"
set -euo pipefail

APP_ROOT="${MYSEWA_ROOT:-/var/www/mysewa}"
ENV_FILE="$APP_ROOT/server/.env"
KEY="e479cc2b-af36-459e-8585-c42f6dcc1f2a"
BASE="https://uatapi.himalpay.com.np/api/v1"

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
  echo "==> Updated $ENV_FILE"
fi

systemctl restart mysewa-api
sleep 1
systemctl is-active mysewa-api
echo "==> Done. HimalPay API key is live."
