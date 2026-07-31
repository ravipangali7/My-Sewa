# Dynamic: Admin transfers — `routes/admin/transfers.tsx` (`/admin/transfers`)

## Current (static)

Ledger from `bankTransfers` + `userById`.

## Make dynamic

**Target:** `GET /api/admin/transfers/` (staff — **to build**). Not the user `GET /api/bank-transfer/history/`.

| Column | `BankTransferTransaction` field |
|---|---|
| ID | `id` |
| User | phone |
| Amount | `amount` |
| Bank | `destination_bank` / `destination_bank_name` |
| Account | `destination_acc_no`, `destination_acc_name` |
| Remarks | `transaction_remarks` (+ 2/3) |
| Verified | `verified` |
| Charge / cashback / total | `charge`, `cashback`, `total_debited` |
| Status | `status` |
| Merchant / provider / ref | `merchant_txn_id`, `provider_txn_id`, `reference_id` |
| Dates | `created_at`, `updated_at` |

Backed by HimalPay `BANK_TRANSFER` flow.

### Remove

`bankTransfers`, `userById` from dummy-data.
