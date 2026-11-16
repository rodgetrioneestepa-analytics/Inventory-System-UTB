# Verification record

Verified locally on 16 November 2026, using Node.js 24.22.1, SQLite through Node's `node:sqlite`, and installed Google Chrome. Dependencies were installed with pnpm; `pnpm-lock.yaml` records the resolved versions. The environment does not have npm on PATH, so the Windows runner executed the same tools used by the npm scripts.

## Executed checks

| Check | Observed result |
|---|---|
| `tools/run.ps1 build` | Passed backend TypeScript compilation, frontend TypeScript check and Vite production build |
| `tools/run.ps1 test`, with `UTB_CATALOG_SOURCE` set to the supplied CSV | **27 passed, 0 failed, 0 skipped** |
| `tools/run.ps1 test:browser` | **4 passed, 0 failed**, Google Chrome |
| Prettier check over source and tests | All matched files formatted |
| Built app HTTP health | 200, application name correct |
| Unauthenticated inventory request | 401 |
| Built app login page | Rendered in Chrome |
| Local app stop/start, followed by health and database checks | Passed; catalog persisted |
| `PRAGMA integrity_check` on local application database | `ok` |
| Applied migrations | `001_initial.sql`, `002_document_integrity.sql` |

The browser suites ran after the main application changes. The final subsequent backend change made malformed CSV errors return validation status 422; the full 27-test backend suite and build passed again after that change. The frontend bundle was unchanged. Screenshots of desktop inventory, mobile overview and the running login screen were opened and visually inspected. The mobile navigation completes its close transition without leaving an overlay or causing horizontal page overflow.

## Acceptance coverage

| Required behavior | Actual verification |
|---|---|
| Catalog-only source boundaries | Imported all 78,310 source rows into a temporary database; 151 normalized menu products, 153 source names, 25 categories; no sales, inventory items, stock movements or prices created |
| Safe catalog reimport | Identical file and changed reexport do not duplicate products; manually confirmed price and recipe version remain |
| No historical snapshot | Application source scan found no historical/snapshot feature; authenticated historical-sales route returns 404; navigation contains no such page |
| Staff authorization | Admin-only endpoints return 403 to staff; unauthorized navigation absent; unauthenticated stock request returns 401 |
| Unknown opening stock | Unconfigured balance is null, displayed as unconfigured; sales blocked; explicit zero opening accepted; duplicate openings rejected |
| Receiving | Partial receipt raises stock once; retry is a no-op; duplicate delivery reference rejected; remaining quantities and PO status update; staff over-receipt denied; reasoned admin exception accepted |
| Recipe consumption | A genuine dated zero-price sale deducts exact configured quantities and records immutable version ID |
| Invalid posting | Unmapped products, missing pack conversions, incompatible dimensions, invalid dates, amount mismatches, expired stock, insufficient stock and tiny overdraws reject safely |
| No duplicate consumption | Duplicate sale keys and identical operational CSV confirmation do not consume twice; overlapping files held for review; distinct same-transaction lines retained |
| Wastage and counts | Wastage reduces stock; counts preview and post signed differences; stale count fails; multi-line failure rolls back earlier deductions |
| Linked voids | Sale void restores stock with linked reversal entries; original sale remains; duplicate void and consumed-receipt reversal blocked |
| Concurrent deductions | Simultaneous HTTP sales cannot overdraw; four simultaneous identical retries consume once |
| Persistence | Browser refresh retains stock; real SQLite connection close/reopen retains ledger; built app restart retains catalog |
| Browser pages | Login, overview and all ten navigation destinations rendered; catalog import, item/opening setup, price confirmation, recipe mapping, sale preview/post, waste, count, void, supplier, PO and partial receiving exercised through forms |
| Reports | CSV download tested, full printable report opens and renders in Chrome; stock/low-stock/receipts/usage/expiry APIs return successfully |
| Account safeguards | Admin CLI creates bcrypt hash with 12 rounds, refuses overwrite and seeds no operations; user creation, password change, session revocation, disabled accounts, session expiry and last-admin protection tested |
| CSRF and request validation | Missing CSRF and foreign Origin rejected; malformed CSV returns 422; invalid numeric/date/password inputs rejected |

## Local database after verification

The actual application database contains **151 catalog products** and the confirmed catalog import's traceability. It contains **0 inventory items, 0 stock movements, 0 operational sales, 0 suppliers and 0 recipe versions**. Menu prices remain unconfigured. Its import actor is a disabled local maintenance principal with a randomly generated unknown password; it cannot sign in. There is no universal administrator password.

All test users, recipes, suppliers, balances and sales were labeled test fixtures and isolated in memory or temporary test databases. The application's database was never used for those workflows. Private source files remain outside Git; the application database, local settings, logs, screenshots and generated test output are ignored.

The built app was left running locally on `http://127.0.0.1:3001`. Create your administrator from the repository directory using `tools/run.ps1 admin:create`, then sign in. The background process ID is in the ignored `.local/app.pid`, and its logs are in `.local/app.stdout.log` and `.local/app.stderr.log`. Stop that process before starting another server on port 3001.

## Information still needed for live operation

UTB must provide physical inventory items and opening counts, confirmed recipes and current menu prices, explicit pack conversions, suppliers, real purchase costs and deliveries, expiry information where applicable, and genuine dated operational sales.

Financial valuation, forecasting, automatic POS integration and deployment were not implemented or claimed. Fixed operating-policy settings are documented; environment configuration controls origin, port and database location. Draft PO corrections use cancellation and recreation. Backdated posting uses currently available stock, not reconstructed historical batch availability. See [operating rules and limitations](DATA_AND_OPERATIONS.md).
