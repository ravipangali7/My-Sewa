# MySewa Web — 100% Dynamic Frontend Spec

> **Scope:** Replace every hardcoded / `dummy-data` binding in `web/src` with live Django API data.  
> **Models:** `server/core/models.py` + `models.md`  
> **HimalPay:** `himalpay-api.md` (UAT) — reseller payments for NTC, NCELL, bank transfer  
> **Constraint of this doc set:** documentation only — no code changes yet.

## Index of dynamic.md files

| File | Covers |
|---|---|
| [routes/index.dynamic.md](./routes/index.dynamic.md) | Login `/` |
| [routes/app/index.dynamic.md](./routes/app/index.dynamic.md) | Wallet home |
| [routes/app/history.dynamic.md](./routes/app/history.dynamic.md) | Activity history |
| [routes/app/profile.dynamic.md](./routes/app/profile.dynamic.md) | Profile |
| [routes/app/load.dynamic.md](./routes/app/load.dynamic.md) | Deposit / load |
| [routes/app/topup.dynamic.md](./routes/app/topup.dynamic.md) | NTC / NCELL top-up |
| [routes/app/transfer.dynamic.md](./routes/app/transfer.dynamic.md) | Bank transfer |
| [routes/app/services.dynamic.md](./routes/app/services.dynamic.md) | Services hub |
| [routes/admin/index.dynamic.md](./routes/admin/index.dynamic.md) | Admin dashboard |
| [routes/admin/users.dynamic.md](./routes/admin/users.dynamic.md) | Users table |
| [routes/admin/wallets.dynamic.md](./routes/admin/wallets.dynamic.md) | Wallets table |
| [routes/admin/deposits.dynamic.md](./routes/admin/deposits.dynamic.md) | Deposit approvals |
| [routes/admin/topups.dynamic.md](./routes/admin/topups.dynamic.md) | Top-up ledger |
| [routes/admin/transfers.dynamic.md](./routes/admin/transfers.dynamic.md) | Transfer ledger |
| [routes/admin/settings.dynamic.md](./routes/admin/settings.dynamic.md) | App settings |
| [components/layout/UserShell.dynamic.md](./components/layout/UserShell.dynamic.md) | User chrome |
| [components/layout/AdminShell.dynamic.md](./components/layout/AdminShell.dynamic.md) | Admin chrome |
| [components/StatusChip.dynamic.md](./components/StatusChip.dynamic.md) | Status badge |
| [lib/dummy-data.dynamic.md](./lib/dummy-data.dynamic.md) | Kill list for mocks |
| [lib/api.dynamic.md](./lib/api.dynamic.md) | Shared API client (to create) |

**Presentational only (no per-file dynamic.md):** `components/ui/*`, `hooks/use-mobile.tsx`, `lib/format.ts`, `lib/utils.ts`, `constants/colors.ts`, `__root.tsx`, `router.tsx`, `routeTree.gen.ts`, error libs. Keep them; they do not own domain data.

---

## Money & HimalPay rules

| Layer | Unit |
|---|---|
| Django models / MySewa API responses | NPR `Decimal` / string with 2 dp (e.g. `"100.50"`) |
| HimalPay request/response | **paisa** integers (`10050` = Rs. 100.50) |
| Conversion | Server-side in `HimalPayAPI.to_paisa` / `to_rupees` — frontend never sends paisa |

**HimalPay UAT (server `.env` only — never expose to browser):**

```
HIMALPAY_BASE_URL=https://uatapi.himalpay.com.np/api/v1
HIMALPAY_API_KEY=e479cc2b-af36-459e-8585-c42f6dcc1f2a
```

Header used by backend: `X-API-Key`. Frontend talks **only** to MySewa `/api/*`.

Relevant HimalPay flows already wrapped by MySewa:

| UI action | MySewa API | HimalPay |
|---|---|---|
| NTC top-up | `POST /api/topup/ntc/` | `NTC` payment |
| NCELL top-up | `POST /api/topup/ncell/` | `NCELL` payment |
| Charge preview | `POST /api/topup/calculate-charge/` | `reseller-calculate-cashback-and-charge` |
| List banks | `GET /api/bank-transfer/banks/` | `BANK_TRANSFER_LIST` |
| Verify account | `POST /api/bank-transfer/verify/` | `BANK_TRANSFER_VERIFICATION` |
| Transfer | `POST /api/bank-transfer/create/` | `BANK_TRANSFER` payment |
| Txn status | `POST /api/topup/status/` or `/api/bank-transfer/status/` | `wallet-service-reseller-status` |

---

## Auth session (all protected pages)

1. Store DRF token from login/register (`Authorization: Token <key>`).
2. On app boot: if token → `GET /api/auth/profile/` + `GET /api/wallet/balance/`.
3. Route guard: unauthenticated → `/`; staff/superuser → `/admin/` allowed; normal users → `/app/`.
4. Logout → `POST /api/auth/logout/` → clear token → `/`.

Do **not** use the fake login role toggle as source of truth. Role = `is_staff` / `is_superuser` from profile (extend profile serializer or add fields if missing).

---

## Models ↔ UI map

| Model | User screens | Admin screens |
|---|---|---|
| `CustomUser` | Login, Profile, shells | Users, join columns |
| `Wallet` | Home balance, Profile | Wallets, float KPI |
| `Settings` | Load QR/bank, Services | Settings form |
| `Deposit` | Load form + list, History | Deposits, Dashboard pending |
| `TopupTransaction` | Top-up form + list, History | Top-ups, Dashboard |
| `BankTransferTransaction` | Transfer form + list, History | Transfers, Dashboard |

---

## Existing MySewa endpoints (user app — ready)

```
POST /api/auth/register|login|logout|change-password|change-phone
GET|PUT|PATCH /api/auth/profile/
GET /api/wallet/balance/
GET /api/wallet/transactions/
POST /api/deposit/create/   GET /api/deposit/list/   GET /api/deposit/<id>/
GET /api/settings/
POST /api/topup/ntc|ncell|calculate-charge|status   GET /api/topup/history/
GET /api/bank-transfer/banks|history
POST /api/bank-transfer/verify|calculate|create|status
```

## Admin APIs still needed (backend gaps)

Admin UI currently has **no** staff-scoped list/approve endpoints. Spec them while making admin pages dynamic:

| Needed | Purpose |
|---|---|
| `GET /api/admin/users/` | Users table + wallet join |
| `GET /api/admin/wallets/` | Wallets + float |
| `GET /api/admin/deposits/` | All deposits |
| `POST /api/admin/deposits/<id>/approve/` | Approve → credit wallet |
| `POST /api/admin/deposits/<id>/reject/` | Reject |
| `GET /api/admin/topups/` | Full top-up ledger |
| `GET /api/admin/transfers/` | Full transfer ledger |
| `GET|PUT|PATCH /api/admin/settings/` | Write singleton + QR upload |
| `GET /api/admin/dashboard/` | KPIs + `volumeSeries` + `operatorSplit` |

Until those exist, admin pages document the target contract; user app can go fully live first.

---

## Implementation order

1. `lib/api.ts` + auth store (see `lib/api.dynamic.md`)
2. Login → Profile → Wallet home → History
3. Load → Top-up → Transfer → Services
4. UserShell session
5. Admin APIs + admin pages
6. Delete `dummy-data.ts` usage (see kill list)

## Shared UI conventions after dynamism

- Loading: skeleton / spinner on every fetch
- Empty: keep empty-state copy when arrays length 0
- Errors: `toast.error` with API `message` / `error`
- Amounts: always `formatNPR(...)`
- Dates: always `formatDateTime(...)` / `formatDate(...)`
- Status: always `<StatusChip status={...} />`
- Remove all imports from `@/lib/dummy-data`
