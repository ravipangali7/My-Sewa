# Deploy MySewa so login works on https://mysewa.sewabyapar.com

## Why login fails today

1. The live SPA was built **without** `VITE_API_BASE_URL`, so it calls `http://127.0.0.1:8000` in the visitor’s browser (unreachable + mixed content on HTTPS).
2. nginx on `mysewa.sewabyapar.com` only serves the static SPA. `POST /api/auth/login/` returns **405**; `GET /api/*` returns HTML — **Django is not proxied**.

Login is already dynamic in code (`POST /api/auth/login/` → DRF Token). The backend just is not reachable from production.

## Fix (same VPS as www.sewabyapar.com — `147.93.153.157`)

### 1. Build the frontend (on your PC)

```bash
cd web
npm ci
npm run build   # uses .env.production → same-origin /api
```

Upload `web/dist/` to the server document root (e.g. `/var/www/mysewa/web/dist`).

### 2. Deploy Django + Gunicorn on the VPS

```bash
# copy repo to server, then:
sudo bash deploy/setup-server.sh
```

Gunicorn listens on `127.0.0.1:8001` (avoids clashing with the ecommerce app on `:8000`).

### 3. Point nginx at the API

Merge the `location /api/`, `/media/`, `/database/`, and `/static/` blocks from `deploy/nginx-mysewa.conf` into the existing `mysewa.sewabyapar.com` server block (keep your current SSL certs), then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Verify

```bash
curl -s https://mysewa.sewabyapar.com/api/settings/
curl -s -X POST https://mysewa.sewabyapar.com/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"phone":"98XXXXXXXX","password":"yourpassword"}'
```

Expect JSON (not HTML / 405). Then log in from the site.

### Create a user (on the server)

```bash
cd /var/www/mysewa/server
source ../env/bin/activate
python manage.py createsuperuser   # phone-based USERNAME_FIELD
```

## Frontend env

| File | Purpose |
|------|---------|
| `web/.env` | Local: `VITE_API_BASE_URL=http://127.0.0.1:8000` |
| `web/.env.production` | Prod: empty → same-origin `/api/...` |
