# Dynamic: History — `routes/app/history.tsx` (`/app/history`)

## Current (static)

- Full list from `activityFor(currentUser.id)`
- Client filter chips: All / Load / Top-up / Transfer (`ActivityKind`)

## Make dynamic

| UI | Endpoint | Notes |
|---|---|---|
| Activity list | `GET /api/wallet/transactions/` | Build `ActivityItem[]` client-side (same map as home) |
| Filter chips | Client-only | Filter by `kind` after merge |

### Row fields (all dynamic)

- `title`, `subtitle`, `amount`, `credit`, `status`, `created_at`
- Status chip from Deposit (`pending|approved|rejected`) or txn (`pending|success|failed`)

### Empty state

When filtered array is empty — keep current empty UI; do not invent rows.

### Remove

`activityFor`, `currentUser` from dummy-data.
