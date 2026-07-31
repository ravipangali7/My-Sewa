# Dynamic: Admin users — `routes/admin/users.tsx` (`/admin/users`)

## Current (static)

Full table from `users` + `wallets` (Rita, Bikash, Sunita, Prakash, Anjali).

## Make dynamic

**Target:** `GET /api/admin/users/` (staff-only — **to build**).

| Table column | Model / field |
|---|---|
| ID | `CustomUser.id` |
| Phone | `phone` |
| Name | `first_name` + `last_name` |
| Email | `email` |
| Active | `is_active` |
| Staff / Super | `is_staff`, `is_superuser` |
| Joined | `date_joined` |
| Last login | `last_login` |
| Wallet balance | related `Wallet.balance` |

Use `formatNPR` / `formatDateTime`. Empty → empty table body.

### Remove

`users`, `wallets` dummy arrays.
