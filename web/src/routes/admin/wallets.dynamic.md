# Dynamic: Admin wallets — `routes/admin/wallets.tsx` (`/admin/wallets`)

## Current (static)

- Description shows `walletFloat`
- Table from `wallets` + `userById`
- Local phone search filter (keep as client filter)

## Make dynamic

**Target:** `GET /api/admin/wallets/` (staff-only — **to build**).

| UI | Field |
|---|---|
| Float summary | `sum(balance)` from API or dedicated `wallet_float` |
| User phone / name | joined `CustomUser` |
| Balance | `Wallet.balance` |
| Updated | `updated_at` |

Search: filter client-side on phone/name from loaded list (or `?q=` if API supports).

### Remove

`wallets`, `userById`, `walletFloat` from dummy-data.
