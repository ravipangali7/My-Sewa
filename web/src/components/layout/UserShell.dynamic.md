# Dynamic: UserShell — `components/layout/UserShell.tsx`

## Current (static)

- Footer user: `currentUser.first_name/last_name/phone` from dummy-data
- Notification badge hardcoded `"3"`
- Log out: `Link to="/"` (no API)
- Nav labels (Home / Services / History / Profile) — static OK

## Make dynamic

| UI | Source |
|---|---|
| Display name / phone | Auth session from `GET /api/auth/profile/` |
| Avatar | `avatar_url` |
| Log out | `POST /api/auth/logout/` + clear token |
| Notification badge | **No Notification model** in `models.py` / `models.md` — hide badge until model+API exist, or hardcode `0` / omit |

### Auth gate

If no token → redirect `/`. Wrap children only when session loaded.

### Remove

`currentUser` dummy import; fake badge `3`.
