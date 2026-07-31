# Dynamic: Admin dashboard — `routes/admin/index.tsx` (`/admin/`)

## Current (static)

KPI cards and charts from dummy aggregates:

| KPI / chart | Mock source |
|---|---|
| Total users | `users.length` |
| Wallet float | `walletFloat` |
| Pending deposits | `deposits.filter(pending)` |
| Top-ups today | `topups.length` (mislabeled — not filtered by today) |
| Transfers today | `bankTransfers.length` |
| Weekly volume bars | `volumeSeries` |
| Operator pie | `operatorSplit` |
| Pending table | pending deposits + `userById` |

## Make dynamic

**Target:** `GET /api/admin/dashboard/` (staff-only — **to build**).

Suggested response:

```json
{
  "kpis": {
    "total_users": 0,
    "wallet_float": "0.00",
    "pending_deposits": 0,
    "topups_today": 0,
    "transfers_today": 0
  },
  "volume_series": [{ "day": "Mon", "deposits": 0, "topups": 0, "transfers": 0 }],
  "operator_split": [{ "name": "NTC", "value": 0 }, { "name": "NCELL", "value": 0 }],
  "pending_deposits": [ /* DepositSerializer + user phone/name */ ]
}
```

### Bindings

| UI | Data |
|---|---|
| 5 KPI cards | `kpis.*` + `formatNPR(wallet_float)` |
| Bar chart | `volume_series` |
| Pie chart | `operator_split` (`product_id` 1/2 → NTC/NCELL) |
| Pending table rows | deposit `id`, user phone, `amount`, `created_at`, link to `/admin/deposits` |
| Approve CTA | navigate or call approve API (see deposits.dynamic.md) |

### Auth

Require `is_staff` / `is_superuser`; else redirect `/app/`.

### Remove

All dummy-data imports listed in file header.
