# Dynamic: Admin deposits — `routes/admin/deposits.tsx` (`/admin/deposits`)

## Current (static)

- Seed: `deposits` array in local state
- Approve/Reject only mutate React state
- Proof shown as text path (`deposits/proof-41.jpg`), not image URL

## Make dynamic

### List

**Target:** `GET /api/admin/deposits/` (or until built, Django admin only — UI must call staff API).

| Column | Field |
|---|---|
| User | `phone` / name from user |
| Amount | `amount` |
| Status | `status` + StatusChip |
| Note | `note` |
| Proof | absolute media URL (`screenshot_proof`) — open in new tab / lightbox |
| Created | `created_at` |

Status filter chips: All / pending / approved / rejected — client or `?status=`.

### Actions

| Button | Endpoint | Effect |
|---|---|---|
| Approve | `POST /api/admin/deposits/<id>/approve/` | `Deposit.status=approved` → wallet credit (signal) |
| Reject | `POST /api/admin/deposits/<id>/reject/` | `status=rejected` |

After action: invalidate list + toast. Do not keep optimistic-only local seed.

### Model

`Deposit`: `pending` → `approved` | `rejected`.

### Remove

Dummy `deposits` seed; local-only approve/reject.
