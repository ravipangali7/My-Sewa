# Dynamic: API client — `lib/api.ts` (to create)

> No API client exists today. React Query is already in `__root.tsx` — use it.

## Env

```
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Never put `HIMALPAY_API_KEY` in Vite env. HimalPay stays server-side:

```
HIMALPAY_BASE_URL=https://uatapi.himalpay.com.np/api/v1
HIMALPAY_API_KEY=e479cc2b-af36-459e-8585-c42f6dcc1f2a
```

## Client responsibilities

1. `fetch(`${base}${path}`, { headers, body })`
2. Attach `Authorization: Token ${token}` when present
3. Parse JSON; throw with `message` / `error` / `detail`
4. Multipart helpers for deposit proof, avatar, settings QR
5. Token get/set/clear (localStorage or cookie)

## Query keys (suggested)

| Key | Endpoint |
|---|---|
| `['auth','profile']` | `GET /api/auth/profile/` |
| `['wallet','balance']` | `GET /api/wallet/balance/` |
| `['wallet','transactions']` | `GET /api/wallet/transactions/` |
| `['settings']` | `GET /api/settings/` |
| `['deposits']` | `GET /api/deposit/list/` |
| `['topups']` | `GET /api/topup/history/` |
| `['banks']` | `GET /api/bank-transfer/banks/` |
| `['transfers']` | `GET /api/bank-transfer/history/` |
| `['admin', ...]` | staff endpoints |

## Mutations

Login, register, logout, profile update, change password/phone, create deposit, topup NTC/NCELL, calculate charge, verify bank, calculate transfer, create transfer, admin approve/reject/settings.

Invalidate related queries on success.

## Types

Align TypeScript interfaces with `models.md` and serializer fields (prefer API response shapes including `phone`, `product_name`, `status_display`, `qr_code_url`, `avatar_url`).
