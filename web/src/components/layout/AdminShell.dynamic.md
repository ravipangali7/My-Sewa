# Dynamic: AdminShell — `components/layout/AdminShell.tsx`

## Current (static)

- Static `NAV` links (OK)
- Label “Super Admin” hardcoded
- Log out → `/` without API
- No live admin user display

## Make dynamic

| UI | Source |
|---|---|
| Admin name / phone | `GET /api/auth/profile/` |
| Role label | `is_superuser` → “Super Admin”, else `is_staff` → “Admin” |
| Log out | `POST /api/auth/logout/` |
| Access gate | If not staff/superuser → `/app/` or `/` |

Nav items remain static routes; highlight active from router.

### Remove

Hardcoded “Super Admin” string as sole identity; wire logout to API.
