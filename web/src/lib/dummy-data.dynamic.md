# Dynamic: Kill list — `lib/dummy-data.ts`

Every export below must stop being imported by routes/layouts. After migration, delete this file or shrink to shared constants only (`OPERATORS`).

## Exports → replacement

| Export | Replacement |
|---|---|
| `CustomUser` type etc. | Move types to `lib/types.ts` (keep shapes) |
| `OPERATORS` | Keep as real constant (`1` NTC, `2` NCELL) |
| `BANKS` | `GET /api/bank-transfer/banks/` |
| `users` | `GET /api/admin/users/` |
| `wallets` | `GET /api/admin/wallets/` + `GET /api/wallet/balance/` |
| `appSettings` | `GET /api/settings/` |
| `deposits` | `GET /api/deposit/list/` / admin deposits |
| `topups` | `GET /api/topup/history/` / admin topups |
| `bankTransfers` | `GET /api/bank-transfer/history/` / admin transfers |
| `currentUser` | Auth profile session |
| `currentWallet` | Wallet balance endpoint |
| `activityFor` | Client merge of `GET /api/wallet/transactions/` |
| `walletFloat` | Admin wallets / dashboard aggregate |
| `volumeSeries` | Admin dashboard API |
| `operatorSplit` | Admin dashboard API |
| `userById` | Join fields from admin list APIs |

## Definition of done

`rg "dummy-data" web/src` returns **zero** route/layout hits.
