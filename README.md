# Inventory-System-UTB
Inventory System for UTB

Under the Balete Inventory is a working React/TypeScript application backed by Express and SQLite. It includes inventory setup, menu and versioned recipes, suppliers, purchasing and partial receiving, an append-only stock ledger, wastage, physical counts, genuine operational sales, separate CSV import previews, reports and account administration.

The supplied synthetic CSV is **catalog-only**, as explicitly confirmed by the user. It supplies 151 normalized menu names from 153 source spellings across 25 categories. It creates no operational sales, prices, stock or costs. No historical sales snapshot is implemented. See [data boundaries and operating rules](docs/DATA_AND_OPERATIONS.md).

## Install and run

Use Node.js **24 or newer**, with npm, and a local writable directory. No paid service is needed.

```powershell
npm install
Copy-Item .env.example .env
npm run migrate
npm run admin:create
npm run dev
```

Skip the copy if `.env` already exists. The admin command asks for an email, display name and hidden password; passwords require 12–72 characters and at most 72 UTF-8 bytes. It refuses to overwrite an existing account. There is no shared default password. For automation, use local `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` environment variables for this command only, then clear them.

Open [the development application](http://localhost:5173). Vite proxies `/api` to port 3001. Use `localhost`, matching `.env.example`'s exact allowed origin. `npm run dev` starts both frontend and backend. Stop with Ctrl+C.

The local database is `data/utb.sqlite`, ignored by Git. Migrations apply on startup and through `npm run migrate`; no reset is needed. Existing `.env` and data files are never overwritten by setup. All test data is isolated from this database.

For the current Codex Windows environment, where Node is bundled but npm is not on PATH, a PowerShell runner locates the installed runtime and uses the already installed dependencies:

```powershell
.\tools\run.ps1 admin:create
.\tools\run.ps1 dev
```

The runner also supports `build`, `start`, `test`, `test:browser`, `migrate` and `catalog:import`. If PowerShell's execution policy blocks a local script, use a process-scoped invocation: `powershell -ExecutionPolicy Bypass -File .\tools\run.ps1 dev`.

## Catalog import

Use the **CSV imports** page: choose menu catalog, select the file, review errors and confirm. Alternatively, the local maintenance CLI uses the exact same validated importer:

```powershell
npm run catalog:import -- "C:\path\UTB-Datasheet-2023-ProductSales.csv" "your-admin-email"
```

Omit the email for a disabled local import principal with no known password. This creates no login account usable by a person and grants no session. The supplied file's catalog was already imported into this workspace's ignored local database. You still need to create your own administrator using the command above. Fresh clones start empty and need their own import.

Names are normalized for uniqueness and original spellings are retained in source-row traceability. Reimporting an identical hash is a no-op. A changed catalog never overwrites confirmed prices or recipes. Category conflicts require review.

## First operational setup

1. Create real inventory items, thresholds, locations and expiry settings. Configure explicit pack sizes when needed.
2. Enter a physical opening count for every item, including an explicit zero where appropriate. Unknown stock remains “Opening stock not configured.”
3. Confirm current menu prices and publish actual per-serving recipes, including drinks, packaging, promotions and zero-price freebies.
4. Enter your real suppliers and purchase costs. Create and submit a PO, then record actual partial or complete deliveries with unique delivery references and expiry dates where required.
5. Enter genuine dated sales and review the consumption preview before posting, or use the separate operational CSV flow. Download the blank template in-app or from [samples/operational-sales.csv](samples/operational-sales.csv).
6. Record wastage and counts; use linked reversals for corrections. Review stock movements and reports.

For operational CSVs, `TransactionDate` must include an ISO timestamp and timezone, such as `2026-11-16T14:30:00+08:00`. This is a format example, not a seeded sale. `ProductSKUorID` must match a configured menu SKU or ID. Reconciliation tolerance is **₱0.01 per line**, after rounding quantity × price to cents. Distinct line numbers preserve multiple products within a transaction. Uploads are limited to 20 MiB and 150,000 rows. A preview never changes stock; all errors must be resolved before an atomic confirmation.

Owner/Admin can configure and post all workflows. Inventory Staff can view stock, alerts, ledger and reports, receive submitted orders, record waste and perform counts. Admin-only API endpoints enforce roles independently of the navigation. Users and sessions can be disabled or revoked, and the last active administrator is protected.

## Production build and local serving

```powershell
npm run build
$env:APP_ORIGIN="http://127.0.0.1:3001"
npm start
```

Open [the built local application](http://127.0.0.1:3001). The Express server serves the built frontend and API together. This local HTTP example uses development cookie settings. For real deployment use HTTPS, set `NODE_ENV=production`, set `APP_ORIGIN` to the exact HTTPS origin, and configure your reverse proxy and host access. Production cookies are Secure, httpOnly and SameSite=Strict. Login is rate-limited; authenticated writes require a session CSRF token. Do not set production mode for plain HTTP localhost login.

Set `DATABASE_PATH` to a non-synced local server disk before ongoing production use. The current workspace is under OneDrive; using the app for verification here does not establish it as a safe shared production database location. See the [backup and correction procedures](docs/DATA_AND_OPERATIONS.md).

## Checks

```powershell
npm test
npm run build
npm run test:browser
```

Browser tests use installed Google Chrome, an automatically generated temporary password and a temporary SQLite database. They never seed the operational database. If Chrome is unavailable, install it or change Playwright's channel to an installed browser.

To include the supplied private source in the catalog integration check:

```powershell
$env:UTB_CATALOG_SOURCE="C:\path\UTB-Datasheet-2023-ProductSales.csv"
npm test
Remove-Item Env:UTB_CATALOG_SOURCE
```

Without that variable, only the private-source test is explicitly skipped. The other tests use isolated labeled fixtures. Actual verified checks are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Project layout

```text
server/migrations/  Versioned forward SQL migrations
server/src/         Auth, validated REST API, ledger service, import service, CLIs
server/tests/       Ledger and backend integration tests
web/src/            Responsive React application and forms
shared/             Shared transport types
tests/browser/      Playwright browser workflows
samples/            Blank CSV templates, no fabricated operational records
tools/run.ps1       Windows runner using Node or the Codex bundled runtime
docs/               API, business rules, limitations and verification
```

See [API reference](docs/API.md) for endpoints, filters and request conventions. Real opening balances, recipes, pack conversions, suppliers, purchase costs and dated operational sales must be entered by UTB before live use. Purchase costs are stored, but financial inventory valuation and forecasting are intentionally unavailable without a defined costing method and appropriate real data.
