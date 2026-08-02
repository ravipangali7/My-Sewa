# Dynamic: Top-up — `routes/app/topup.tsx` (`/app/topup`)

## HimalPay mapping (via MySewa)

| Operator | `product_id` | MySewa | HimalPay `wallet_service_name` |
|---|---|---|---|
| NTC | `1` | `POST /api/topup/ntc/` | `NTC` — `data.number` |
| NCELL | `2` | `POST /api/topup/ncell/` | `NCELL` — `data.number` |

Amounts to MySewa in **NPR**; server converts to **paisa** for HimalPay (`10000` = Rs. 100).

## Live endpoints

| UI | Endpoint | Notes |
|---|---|---|
| Operator list | `GET /api/topup/services/` | Filters HimalPay `my-reseller-services` to NTC/NCELL |
| Charge / cashback / total | `POST /api/topup/calculate-charge/` | `provider_charge`, `platform_charge`, `charge`, `cashback`, `total_debited` |
| Submit NTC | `POST /api/topup/ntc/` | Body: `mobile_number`, `amount`, `product_id: 1` |
| Submit NCELL | `POST /api/topup/ncell/` | Body: `mobile_number`, `amount`, `product_id: 2` |
| History | `GET /api/topup/history/` | Recent rows with fees + status |
| Status poll | `POST /api/topup/status/` | Body: `merchant_transaction_id` → syncs pending |

## Form fields (HimalPay payment shape)

| Field | Maps to |
|---|---|
| Operator toggle | `wallet_service_name` NTC / NCELL |
| Mobile number | `data.number` |
| Amount (NPR) | `amount` (server → paisa) |
| Merchant txn | Auto `MYSEWA_…` on server |

## UX behaviour

- Debounced fee preview before confirm
- Wallet balance + insufficient-funds guard
- Amount presets + “Use my number”
- 200 success / 202 pending toasts
- Auto-poll + manual “Check status” for pending rows
