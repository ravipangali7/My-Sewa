# Deploy MySewa so login works on https://mysewa.sewabyapar.com

## Why login returns 405

nginx is serving the **static SPA** for `/api/*`.

| Request | What you see | Meaning |
|---------|--------------|---------|
| `GET /api/settings/` | HTML (`index.html`) | No proxy — SPA fallback |
| `POST /api/auth/login/` | **405 Not Allowed** (nginx) | Static files reject POST |

The SPA and Django code are fine. **Gunicorn must listen on `127.0.0.1:8001` and nginx must proxy `/api/` to it.**

## One-shot fix on the VPS (`147.93.153.157`)

SSH in as root (or a sudo user), copy this repo to the server if needed, then:

```bash
# From the repo root on the VPS (or after rsync):
sudo bash deploy/setup-server.sh
# That starts Gunicorn + patches nginx. Or only patch nginx if API is already up:
sudo bash /var/www/mysewa/deploy/patch-nginx-api.sh
```

### Verify

```bash
curl -s http://127.0.0.1:8001/api/settings/          # must be JSON
curl -s https://mysewa.sewabyapar.com/api/settings/  # must be JSON (not HTML)
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

Build SPA (on your PC) and upload `web/dist/` to `/var/www/mysewa/web/dist`:

```bash
cd web
npm ci
npm run build
```

## Files

| Path | Role |
|------|------|
| `deploy/setup-server.sh` | venv, migrate, systemd `mysewa-api`, nginx patch |
| `deploy/patch-nginx-api.sh` | Inject `/api` proxy into existing SSL site config |
| `deploy/nginx-api-locations.conf` | Snippet included by nginx |
| `deploy/nginx-mysewa.conf` | Full example site (HTTP; certbot adds TLS) |
| `deploy/mysewa-api.service` | systemd unit for Gunicorn |
| `deploy/gunicorn.conf.py` | Binds `127.0.0.1:8001` |
