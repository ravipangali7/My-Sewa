# Dynamic: Top-up — `routes/app/topup.tsx` (`/app/topup`)

## Current (static)

- Operator toggle uses `OPERATORS` (OK as constant `1→NTC`, `2→NCELL` — matches `TopupTransaction.PRODUCT_CHOICES`)
- **Fake fees:** `charge = amt * 0.01`, `cashback = amt * 0.02`
- Recent list: `topups.filter(user === currentUser.id)`
- Submit → toast only

## Make dynamic

### HimalPay mapping (via MySewa)

| Operator | `product_id` | MySewa | HimalPay `wallet_service_name` |
|---|---|---|---|
| NTC | `1` | `POST /api/topup/ntc/` | `NTC` — `data.number` |
| NCELL | `2` | `POST /api/topup/ncell/` | `NCELL` — `data.number` |

Amounts to MySewa in **NPR**; server converts to paisa for HimalPay.

### Charge breakdown card (must be API-driven)

| UI | Endpoint | Response fields (NPR strings) |
|---|---|---|
| Charge / cashback / total | `POST /api/topup/calculate-charge/` | `charge`, `cashback`, `total_debited`, `amount` |

Body: `{ "wallet_service_name": "NTC"|"NCELL", "amount": <npr> }`  
Debounce on amount change; **delete** client `* 0.01` / `* 0.02` math.

### Submit form

| Field | Body |
|---|---|
| Mobile | `mobile_number` |
| Amount | `amount` (≥ 10) |
| Operator | `product_id` 1 or 2 |

Handle: 200 success, 202 pending, insufficient balance (`required`, `available`, `charge`, `cashback`), failed with `error` / `error_code`.

Optional poll: `POST /api/topup/status/` with `merchant_transaction_id` from `data.merchant_txn_id`.

### Recent top-ups list

`GET /api/topup/history/` → rows: `product_name` / `product_id`, `mobile_number`, `amount`, `charge`, `cashback`, `total_debited`, `status`, `created_at`.

### Remove

Hardcoded fee formulas; `topups` / `currentUser` dummy imports. Keep `OPERATORS` as local constant or import from a non-mock constants module.
