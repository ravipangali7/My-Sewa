# Dynamic: Admin settings — `routes/admin/settings.tsx` (`/admin/settings`)

## Current (static)

- Form seeded from `appSettings`
- Save / QR upload → toast only
- Read-only public API exists: `GET /api/settings/` — **no write API**

## Make dynamic

### Load form

`GET /api/settings/` (or staff `GET /api/admin/settings/`):

| Form field | `Settings` / JSON |
|---|---|
| Bank name | `bank_details.bank_name` |
| Account name | `bank_details.account_name` |
| Account number | `bank_details.account_number` |
| Branch | `bank_details.branch` |
| QR preview | `qr_code_url` |

### Save

**Target:** `PUT/PATCH /api/admin/settings/` multipart:

- `bank_details` as JSON object (or flat fields server merges into JSON)
- `qr_code` image file optional

Singleton behavior: always `pk=1` (`Settings.load()`).

### Cards

Bank details card + QR upload card both bind to live singleton; success toast after real save; refetch.

### Remove

`appSettings` dummy seed; toast-only save.
