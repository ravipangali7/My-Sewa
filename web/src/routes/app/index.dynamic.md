# Dynamic: Wallet home — `routes/app/index.tsx` (`/app/`)

## Current (static)

Imports `currentWallet`, `currentUser`, `activityFor` from dummy-data.

| UI piece | Hardcoded source |
|---|---|
| Balance hero | `currentWallet.balance` (`"85450.00"`) |
| Greeting / name | `currentUser.first_name` |
| Recent activity (5) | `activityFor(1).slice(0, 5)` |
| Quick actions | Static nav links (OK to keep) |

## Make dynamic

| UI | Endpoint | Model / fields |
|---|---|---|
| Balance card | `GET /api/wallet/balance/` | `Wallet.balance`, `updated_at` |
| User name | `GET /api/auth/profile/` | `first_name`, `last_name`, `avatar_url` |
| Recent activity | `GET /api/wallet/transactions/` | Merge `deposits` + `topups` + `bank_transfers` |

### Activity mapping (same as dummy `activityFor`)

| Source array item | `kind` | title | subtitle | amount | credit |
|---|---|---|---|---|---|
| Deposit | `deposit` | Remittance Received | `note` \|\| "Wallet load" | `amount` | true |
| Topup | `topup` | `{NTC\|NCELL} Top-Up` via `product_id` | `mobile_number` | `total_debited` or `amount` | false |
| Bank transfer | `transfer` | Fund Transfer | `destination_acc_name · destination_bank_name` | `total_debited` or `amount` | false |

Sort by `created_at` desc; show first 5; link “See all” → `/app/history`.

### Cards / chips

- Each activity row: amount via `formatNPR`, status via `<StatusChip status={status} />`
- Balance: `formatNPR(wallet.balance)`

### Remove

All `dummy-data` imports; no fallback mock balance.
