# Dynamic: Services — `routes/app/services.tsx` (`/app/services`)

## Current (static)

- Service link list (`SERVICES`) — navigation copy, OK as static
- Company deposit account `<dl>` from `appSettings.bank_details`

## Make dynamic

| UI | Endpoint | Fields |
|---|---|---|
| Bank details block | `GET /api/settings/` | `bank_details.*`, optional `qr_code_url` |

Links to `/app/load`, `/app/topup`, `/app/transfer` stay static routes.

### Remove

`appSettings` dummy import.
