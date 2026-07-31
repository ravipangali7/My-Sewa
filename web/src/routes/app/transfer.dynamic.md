# Dynamic: Bank transfer — `routes/app/transfer.tsx` (`/app/transfer`)

## Current (static)

- Bank select: hardcoded `BANKS` (6 banks)
- Verify: sets `accName = "Hari Bahadur Karki"` locally
- Charge: `amt > 0 ? 15 : 0`
- List: `bankTransfers.filter(user === currentUser.id)`
- Submit → toast if `verified`

## Make dynamic

### HimalPay 3-step (via MySewa)

1. **List banks** — `GET /api/bank-transfer/banks/`  
   Bind Select to `banks[]`: `bank_code`, `bank_name` (not dummy `BANKS`).
2. **Verify** — `POST /api/bank-transfer/verify/`  
   Body: `bank_code`, `account_name`, `account_number`, optional `is_mobile`, `merchant_txn_id`  
   On success: `verified: true`; show provider-confirmed name if returned in `data`/`raw`.
3. **Charge preview** — `POST /api/bank-transfer/calculate/`  
   Body: `{ amount }` → `data.charge`, `data.cashback`, `data.total_debited`  
   **Delete** hardcoded `15` fee.
4. **Create** — `POST /api/bank-transfer/create/`  
   Body maps to `BankTransferTransaction` fields:

| Form | API |
|---|---|
| Bank code | `destination_bank` |
| Bank name | `destination_bank_name` |
| Account no | `destination_acc_no` |
| Account name | `destination_acc_name` |
| Amount | `amount` |
| Remarks | `transaction_remarks` (+ `_2`, `_3` if UI adds) |
| Mobile wallet? | `is_destination_mobile` |
| Reuse verify txn id | `merchant_txn_id` |

HimalPay payment service: `BANK_TRANSFER` with destination fields (see `himalpay-api.md`).

### Charge card

All values from calculate endpoint; show loading while fetching.

### Recent transfers

`GET /api/bank-transfer/history/` → table/cards with destination, amount, charge, status, dates.

### Status poll (pending)

`POST /api/bank-transfer/status/` + `merchant_transaction_id`.

### Remove

`BANKS`, `bankTransfers`, `currentUser` from dummy-data; fake verify name; fixed Rs. 15 charge.
