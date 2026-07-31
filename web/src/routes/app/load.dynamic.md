# Dynamic: Load / Deposit — `routes/app/load.tsx` (`/app/load`)

## Current (static)

- Bank details from `appSettings.bank_details` (Laxmi / `0123456789`)
- QR is icon placeholder — **not** `appSettings.qr_code` image
- Deposit list: `deposits.filter(user === currentUser.id)`
- Submit → toast only

## Make dynamic

### Pay-to-MySewa card

| UI | Endpoint | Model field |
|---|---|---|
| Bank name | `GET /api/settings/` | `bank_details.bank_name` |
| Account name | same | `bank_details.account_name` |
| Account number | same | `bank_details.account_number` |
| Branch | same | `bank_details.branch` |
| QR image | same | `qr_code_url` (render `<img>`, not icon) |

`Settings` is singleton `pk=1`.

### Create deposit form

| Form field | API field | Endpoint |
|---|---|---|
| Amount | `amount` (≥ 100 NPR) | `POST /api/deposit/create/` multipart |
| Note | `note` | optional |
| Screenshot | `screenshot_proof` | required image file |

Response `data`: `id`, `amount`, `status` (`pending`), `screenshot_proof`, `note`, `created_at`, …

On success: toast + invalidate deposit list query.

### My deposits list

| UI | Endpoint | Fields |
|---|---|---|
| List / cards | `GET /api/deposit/list/` | `amount`, `status`, `note`, `created_at`, proof URL |
| Status | — | `<StatusChip status={status} />` |

Optional detail: `GET /api/deposit/<id>/`.

### Remove

`appSettings`, `deposits`, `currentUser` from dummy-data; fake submit toast-only path.
