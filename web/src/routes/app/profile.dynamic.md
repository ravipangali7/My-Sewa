# Dynamic: Profile — `routes/app/profile.tsx` (`/app/profile`)

## Current (static)

- Avatar initials, name, phone, email from `currentUser`
- Wallet balance / dates from `currentWallet`
- Edit / Change phone / Change password rows are **dead buttons**
- Log out → `Link to="/"` only

## Make dynamic

### Display

| UI | Endpoint | Fields |
|---|---|---|
| Avatar / initials | `GET /api/auth/profile/` | `avatar_url`, `first_name`, `last_name` |
| Phone / email | same | `phone`, `email` |
| Wallet balance | `GET /api/wallet/balance/` | `balance` |
| Joined / updated | wallet + profile | `created_at` / `date_joined` if exposed |

### Actions (wire dead buttons)

| Action | Endpoint | Body |
|---|---|---|
| Edit profile | `PUT/PATCH /api/auth/profile/` | `email`, `first_name`, `last_name`, `avatar` (multipart) |
| Change password | `POST /api/auth/change-password/` | `current_password`, `new_password`, `confirm_password` → store new `token` |
| Change phone | `POST /api/auth/change-phone/` | `new_phone`, `current_password` |
| Log out | `POST /api/auth/logout/` | clear token → navigate `/` |

### Forms / cards

Every field in profile card and dialogs must bind to serializer responses — no Rita Gurung mock.

### Remove

`currentUser`, `currentWallet` dummy imports.
