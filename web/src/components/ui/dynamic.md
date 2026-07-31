# Dynamic: UI kit — `components/ui/*`

## Scope

shadcn/Radix primitives (`button`, `input`, `table`, `card`, `dialog`, `select`, …) are **presentational**. They take props/children only.

## Rule for 100% dynamic pages

Parents must pass **API-backed** values into:

| Primitive | Dynamic usage |
|---|---|
| `Table` / rows | Map API arrays — never hardcode row literals |
| `Card` / balance / KPI | Bind numeric/text from queries |
| `Form` + `Input` / `Select` / `Textarea` | Controlled state submitted to mutations |
| `Dialog` / `Sheet` | Open with live record (deposit proof, user detail) |
| `Badge` | Prefer `StatusChip` for txn/deposit status |
| `Skeleton` | Show while `isLoading` from React Query |
| `Avatar` | `avatar_url` from profile |
| `Chart` (via recharts in admin) | Feed `volume_series` / `operator_split` from API |

Do not add per-file `button.dynamic.md` etc. Data ownership stays in route files listed in `src/dynamic.md`.
