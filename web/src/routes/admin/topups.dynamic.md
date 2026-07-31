# Dynamic: Admin top-ups — `routes/admin/topups.tsx` (`/admin/topups`)

## Current (static)

Wide ledger from entire `topups` dummy array + `userById` + `OPERATORS`.

## Make dynamic

**Target:** `GET /api/admin/topups/` (staff — **to build**). User-scoped `GET /api/topup/history/` is insufficient (self only).

| Column | `TopupTransaction` / serializer field |
|---|---|
| ID | `id` |
| User phone | joined / `phone` |
| Mobile | `mobile_number` |
| Operator | `product_id` → NTC/NCELL (`product_name`) |
| Amount | `amount` |
| Charge / cashback / total | `charge`, `cashback`, `total_debited` |
| Status | `status` |
| Merchant / provider IDs | `merchant_txn_id`, `service_hub_txn_id`, `reference_id` |
| Provider JSON | `provider_response` (if exposed to admin) |
| Dates | `created_at`, `updated_at` |

HimalPay context: rows created by NTC/NCELL reseller payments; amounts stored in NPR.

### Remove

`topups`, `userById` dummy imports.
