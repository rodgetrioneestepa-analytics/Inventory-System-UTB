# Local API

The frontend calls same-origin `/api`. JSON errors have `{ "error": "message", "details": ... }`. Validation failures use 422, conflicts use 409, missing authentication uses 401, and forbidden access uses 403. Collections return `{ rows, total, page, limit }`; `page` starts at 1 and `limit` is capped at 200. Search uses `q`.

Sign in with `POST /auth/login` and `{ email, password }`, with the configured `Origin` header. The response contains a user and CSRF token. Keep the httpOnly session cookie and send the response's `csrf` as `X-CSRF-Token` for every authenticated mutation. `GET /auth/me` recovers the user and CSRF token after refresh. Sessions expire after eight hours. `POST /auth/logout` revokes the session. `POST /auth/password` accepts `{ current_password, password }`, changes the caller's password and revokes all their sessions.

All routes below require authentication. Admin-only routes enforce the restriction on the server. There are no delete endpoints for operational records.

| Area | Routes | Access |
|---|---|---|
| Overview | `GET /dashboard`, `GET /lookups` | Both roles; lookups are restricted by role |
| Inventory | `GET /inventory`, `GET /inventory/:id/batches`, `GET /inventory/:id/conversions` | Both |
| Setup | `POST /inventory`, `PUT /inventory/:id`, `PUT /inventory/:id/conversions`, `POST /inventory/:id/opening` | Admin |
| Products | `GET/POST /products`, `PUT /products/:id`, `GET/POST /products/:id/recipes` | Admin |
| Suppliers | `GET/POST /suppliers`, `PUT /suppliers/:id` | Admin |
| Purchasing | `GET /purchase-orders`, `GET /purchase-orders/:id`, `POST /purchase-orders/:id/receive` | Both |
| Order setup | `POST /purchase-orders`, `POST /purchase-orders/:id/status` | Admin |
| Sales | `GET/POST /sales`, `GET /sales/:id`, `POST /sales/preview` | Admin |
| Adjustments | `POST /wastage`, `POST /counts/preview`, `POST /counts` | Both |
| Corrections | `POST /events/:id/reverse` | Admin |
| Ledger | `GET /movements`, `GET /events` | Both |
| Imports | `GET /imports`, `POST /imports/preview`, `GET /imports/:id`, `POST /imports/:id/confirm`, `GET /imports/:id/rejected.csv` | Admin |
| Template | `GET /templates/operational-sales.csv` | Admin |
| Reports | `GET /reports/{stock,low-stock,receipts,usage,expiry}` | Both |
| Access | `GET/POST /users`, `PUT /users/:id`, `POST /users/:id/password`, `GET /settings`, `GET /audit` | Admin |

Inventory filters: `q`, `category`, `status=unconfigured|low|out|healthy`, `archived=all`. Product filters: `q`, `category`, `status=unmapped`, `archived=all`. PO filters: `q`, `status`. Ledger filters: `q` (reference/item/reason), `type`, `item` (ID), `actor` (user ID), `from`, `to` (ISO timestamps). Reports accept `format=csv`; receipt/usage reports also accept the ledger filters.

Posting requests share these fields:

```json
{
  "key": "client-generated-stable-unique-key",
  "reference": "actual-operational-reference",
  "occurred_at": "2026-11-16T14:30:00+08:00",
  "reason": "Explanation of the actual event"
}
```

Use a new key for each distinct event. Retries of an identical request return `{ id, duplicate: true }`. Reusing a key with different contents is a conflict. Preview has no stock effect. Every confirmation revalidates within a SQLite `BEGIN IMMEDIATE` transaction.

The exact request schemas are in `server/src/schemas.ts`; the sale schema is used by both the form posting and operational importer. The service in `server/src/ledger.ts` provides the transaction and stock invariants. SQL values are bound parameters. Table/column identifiers in queries come from fixed application code.

Import preview takes `{ kind: "catalog" | "sales", filename, content }`. Content must parse as CSV; the filename must end in `.csv`. The application accepts JSON-transported CSV content rather than executing or storing uploaded files on disk. CSV contents are capped at 20 MiB and 150,000 records. All CSV exports escape cells and neutralize spreadsheet formula prefixes.
