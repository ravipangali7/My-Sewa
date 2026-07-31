#!/usr/bin/env bash
# Deploy MySewa API + static SPA on the VPS that already hosts mysewa.sewabyapar.com.
# Run as root (or with sudo) from the repo root on the server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${MYSEWA_ROOT:-/var/www/mysewa}"

echo "==> Syncing app to $APP_ROOT"
mkdir -p "$APP_ROOT"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'web/node_modules' \
  --exclude '**/__pycache__' \
  --exclude 'server/env' \
  --exclude 'server/.venv' \
  "$ROOT/" "$APP_ROOT/"

cd "$APP_ROOT/server"

echo "==> Python venv + deps"
if [[ ! -d "$APP_ROOT/env" ]]; then
  python3 -m venv "$APP_ROOT/env"
fi
# shellcheck disable=SC1091
source "$APP_ROOT/env/bin/activate"
pip install -q -r requirements.txt gunicorn

echo "==> Migrate + collectstatic"
python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "==> Install systemd unit"
sed "s|/var/www/mysewa|$APP_ROOT|g" "$APP_ROOT/deploy/mysewa-api.service" \
  > /etc/systemd/system/mysewa-api.service
# Fix ExecStart to use the venv under APP_ROOT/env
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$APP_ROOT/server|" /etc/systemd/system/mysewa-api.service
sed -i "s|EnvironmentFile=.*|EnvironmentFile=$APP_ROOT/server/.env|" /etc/systemd/system/mysewa-api.service
sed -i "s|ExecStart=.*|ExecStart=$APP_ROOT/env/bin/gunicorn -c $APP_ROOT/deploy/gunicorn.conf.py mysewa_backend.wsgi:application|" /etc/systemd/system/mysewa-api.service

systemctl daemon-reload
systemctl enable --now mysewa-api
systemctl restart mysewa-api

echo "==> Health check (local Gunicorn)"
sleep 1
curl -sf "http://127.0.0.1:8001/api/settings/" >/dev/null \
  && echo "API OK on :8001" \
  || echo "WARNING: /api/settings/ did not return 200 — check journalctl -u mysewa-api"

echo "==> Done. Ensure nginx includes deploy/nginx-mysewa.conf location /api/ proxy,"
echo "    then: nginx -t && systemctl reload nginx"
echo "    Upload web/dist (built with .env.production) to $APP_ROOT/web/dist"
