# Dynamic: StatusChip — `components/StatusChip.tsx`

## Current

Presentational only. Maps status → `STATUS_TONE` colors.

Accepted statuses: `pending` | `approved` | `success` | `rejected` | `failed`.

## Make dynamic

No fetch required. Callers pass API `status` strings from:

| Model | Statuses |
|---|---|
| Deposit | `pending`, `approved`, `rejected` |
| TopupTransaction | `pending`, `success`, `failed` |
| BankTransferTransaction | `pending`, `success`, `failed` |

Ensure every table/card/list uses `<StatusChip status={row.status} />` with live values — never hardcode `"success"` in parents.

### Optional

Map `status_display` for title attribute if API returns it; chip key stays raw `status`.
