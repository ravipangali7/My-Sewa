# Dynamic: Login — `routes/index.tsx` (`/`)

## Current (static)

- Role tabs: local `ROLES = ["user", "super_admin"]` — fake, not from API
- Prefill: `phone: "+977 9812345678"`, `password: "demo1234"`
- Submit: navigates to `/app` or `/admin` with **no** auth call

## Make dynamic

### Form fields → API

| UI field | Request field | Endpoint |
|---|---|---|
| Phone | `phone` | `POST /api/auth/login/` |
| Password | `password` | same |

Optional register path (CTA text exists): `POST /api/auth/register/` with `phone`, `password`, `password2`, optional `email`, `first_name`, `last_name`.

### Response binding

```json
{
  "message": "Login successful",
  "token": "<key>",
  "user": { "id", "phone", "email", "first_name", "last_name" }
}
```

1. Persist `token` (and optionally `user`).
2. Fetch `GET /api/auth/profile/` — need `is_staff` / `is_superuser` (extend serializer if missing).
3. Navigate: staff/superuser → `/admin/`, else → `/app/`.

### Remove

- Role toggle as auth source (may keep as UI hint only until profile returns role — preferred: drop it)
- Demo prefilled credentials
- Client-side-only navigation without token

### UX states

- Loading on submit button
- 401 → show `message` / `detail` from API
- Inactive user → same error path
