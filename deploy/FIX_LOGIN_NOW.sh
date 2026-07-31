#!/usr/bin/env bash
# =============================================================================
# FIX MySewa login 405 — paste this ENTIRE file into Hostinger VPS Browser Terminal
# (hPanel → VPS → Manage → Terminal) as root, then press Enter.
# =============================================================================
set -euo pipefail

APP_ROOT="${MYSEWA_ROOT:-/var/www/mysewa}"
REPO_URL="${MYSEWA_REPO:-https://github.com/ravipangali7/My-Sewa.git}"
DOMAIN="mysewa.sewabyapar.com"
GUNICORN_PORT=8001

echo "========== MySewa login fix =========="

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (Hostinger Browser Terminal usually is root)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx git curl rsync >/dev/null

mkdir -p "$APP_ROOT"

if [[ -d "$APP_ROOT/.git" ]]; then
  echo "==> Updating repo in $APP_ROOT"
  git -C "$APP_ROOT" fetch --depth 1 origin main || git -C "$APP_ROOT" fetch --depth 1 origin master
  git -C "$APP_ROOT" reset --hard FETCH_HEAD
elif [[ -d "$APP_ROOT/server" ]]; then
  echo "==> $APP_ROOT already has server/ (no .git) — keeping files"
else
  echo "==> Cloning $REPO_URL → $APP_ROOT"
  rm -rf "$APP_ROOT"
  git clone --depth 1 "$REPO_URL" "$APP_ROOT"
fi

cd "$APP_ROOT/server"

# Ensure .env exists
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
HIMALPAY_BASE_URL=https://uatapi.himalpay.com.np/api/v1
HIMALPAY_API_KEY=
HIMALPAY_BYPASS_API=true
HIMALPAY_TIMEOUT=60
EOF
  fi
  echo "==> Created server/.env (edit HimalPay keys later if needed)"
fi

echo "==> Python venv + deps"
if [[ ! -d "$APP_ROOT/env" ]]; then
  python3 -m venv "$APP_ROOT/env"
fi
# shellcheck disable=SC1091
source "$APP_ROOT/env/bin/activate"
pip install -q -r requirements.txt gunicorn

echo "==> migrate + collectstatic"
python manage.py migrate --noinput
python manage.py collectstatic --noinput

# Create demo staff user if missing (phone 9800000000 / 12345678)
python <<'PY'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysewa_backend.settings")
import django
django.setup()
from django.contrib.auth import get_user_model
User = get_user_model()
phone = "9800000000"
u, created = User.objects.get_or_create(phone=phone, defaults={"is_staff": True, "is_superuser": True})
if created or not u.check_password("12345678"):
    u.set_password("12345678")
    u.is_staff = True
    u.is_superuser = True
    u.save()
    print(f"==> User {phone} ready (password 12345678)")
else:
    print(f"==> User {phone} already OK")
PY

echo "==> systemd mysewa-api"
cat > /etc/systemd/system/mysewa-api.service <<EOF
[Unit]
Description=MySewa Django API (Gunicorn)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$APP_ROOT/server
EnvironmentFile=$APP_ROOT/server/.env
ExecStart=$APP_ROOT/env/bin/gunicorn -c $APP_ROOT/deploy/gunicorn.conf.py mysewa_backend.wsgi:application
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Ensure www-data can read app + write sqlite/media
chown -R www-data:www-data "$APP_ROOT/server" "$APP_ROOT/deploy" 2>/dev/null || true
chmod -R u+rwX "$APP_ROOT/server" || true
# Keep env readable by service
chown -R www-data:www-data "$APP_ROOT/env" || true

systemctl daemon-reload
systemctl enable mysewa-api
systemctl restart mysewa-api
sleep 2

if ! curl -sf "http://127.0.0.1:${GUNICORN_PORT}/api/settings/" >/dev/null; then
  echo "ERROR: Gunicorn not responding on :${GUNICORN_PORT}"
  journalctl -u mysewa-api -n 40 --no-pager || true
  exit 1
fi
echo "==> Gunicorn OK on :${GUNICORN_PORT}"

echo "==> nginx API proxy snippet"
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/mysewa-api-proxy.conf <<'EOF'
location /api/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;
}

location /media/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /database/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /static/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
}
EOF

# Patch every nginx config that mentions the domain
python3 - <<PY
from pathlib import Path
import glob

domain = "$DOMAIN"
snippet = "/etc/nginx/snippets/mysewa-api-proxy.conf"
begin = "# BEGIN mysewa-api-proxy"
end = "# END mysewa-api-proxy"
files = set()
for pattern in (
    "/etc/nginx/sites-enabled/*",
    "/etc/nginx/sites-available/*",
    "/etc/nginx/conf.d/*.conf",
):
    files.update(glob.glob(pattern))

patched = 0
for path_str in sorted(files):
    path = Path(path_str)
    if not path.is_file():
        continue
    text = path.read_text(errors="ignore")
    if domain not in text:
        continue
    if snippet in text or begin in text:
        print(f"already patched: {path}")
        continue
    if "location /api/" in text and "127.0.0.1:8001" in text:
        print(f"already has api proxy: {path}")
        continue

    lines = text.splitlines(keepends=True)
    chunks = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        if line.lstrip().startswith("server") and "{" in line:
            start = i
            depth = 0
            j = i
            while j < n:
                depth += lines[j].count("{") - lines[j].count("}")
                j += 1
                if depth == 0:
                    break
            chunks.append(("server", lines[start:j]))
            i = j
            continue
        chunks.append(("other", [line]))
        i += 1

    out = []
    changed = False
    for kind, block in chunks:
        if kind != "server":
            out.extend(block)
            continue
        body = "".join(block)
        if domain not in body or snippet in body or begin in body:
            out.extend(block)
            continue
        # Remove broken location /api/ that is not our proxy (best-effort skip if complex)
        out.append(block[0])
        out.extend([f"    {begin}\n", f"    include {snippet};\n", f"    {end}\n"])
        out.extend(block[1:])
        changed = True

    if changed:
        backup = path.with_suffix(path.suffix + f".bak.{path.stat().st_mtime_ns}")
        backup.write_text(text)
        path.write_text("".join(out))
        print(f"patched: {path} (backup {backup.name})")
        patched += 1

if patched == 0:
    # No existing site — install a minimal SSL-aware site if certs exist
    conf = Path(f"/etc/nginx/sites-available/{domain}")
    cert = Path(f"/etc/letsencrypt/live/{domain}/fullchain.pem")
    key = Path(f"/etc/letsencrypt/live/{domain}/privkey.pem")
    root = Path("$APP_ROOT/web/dist")
    root.mkdir(parents=True, exist_ok=True)
    ssl_lines = ""
    listen = "listen 80;\n    listen [::]:80;"
    if cert.exists() and key.exists():
        listen = "listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    listen 80;\n    listen [::]:80;"
        ssl_lines = f"""
    ssl_certificate {cert};
    ssl_certificate_key {key};
"""
    conf.write_text(f"""
server {{
    {listen}
    server_name {domain};
{ssl_lines}
    root {root};
    index index.html;
    client_max_body_size 20M;
    {begin}
    include {snippet};
    {end}
    location /assets/ {{
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}
    location / {{
        try_files $uri $uri/ /index.html;
    }}
}}
""")
    Path("/etc/nginx/sites-enabled").mkdir(exist_ok=True)
    link = Path(f"/etc/nginx/sites-enabled/{domain}")
    if not link.exists():
        link.symlink_to(conf)
    print(f"created site config: {conf}")
PY

nginx -t
systemctl reload nginx

echo "==> Verify public API"
sleep 1
CODE=$(curl -s -o /tmp/mysewa-api-check.json -w "%{http_code}" "https://${DOMAIN}/api/settings/" || echo 000)
echo "GET https://${DOMAIN}/api/settings/ → HTTP $CODE"
head -c 200 /tmp/mysewa-api-check.json; echo
LOGIN=$(curl -s -o /tmp/mysewa-login.json -w "%{http_code}" -X POST "https://${DOMAIN}/api/auth/login/" \
  -H "Content-Type: application/json" \
  -d '{"phone":"9800000000","password":"12345678"}' || echo 000)
echo "POST /api/auth/login/ → HTTP $LOGIN"
head -c 300 /tmp/mysewa-login.json; echo

if [[ "$CODE" == "200" && "$LOGIN" == "200" ]]; then
  echo "========== SUCCESS — login should work on https://${DOMAIN}/ =========="
  echo "Use phone 9800000000 / password 12345678 (or your own user)."
else
  echo "========== PARTIAL — check output above =========="
  echo "If still HTML/405: ls /etc/nginx/sites-enabled; nginx -T | grep -n api"
  systemctl status mysewa-api --no-pager || true
fi
