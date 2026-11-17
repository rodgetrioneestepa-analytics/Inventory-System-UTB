# Hosted cutover verification — 17 November 2026

The production website runs at [under-the-balete-inventory.vercel.app](https://under-the-balete-inventory.vercel.app), with its Express API on [under-the-balete-inventory-api.vercel.app](https://under-the-balete-inventory-api.vercel.app/api/health) and persistence in Neon Free PostgreSQL. The previous local production server and Cloudflare Quick Tunnel were stopped before the final browser check at 06:19 UTC. The website continued to work.

Deployed application source: `2f5ae5f62c4c2e8f3281563fae5d27c5857bc7f4`. Backend deployment: `dpl_AzMzDYDjCNo7BMnQB644gwfkaRvB`. Frontend deployment: `dpl_8gjNiSydy6WCVmo3dxkBkbXvKSpf`. Both production builds completed successfully. A production API runtime error/fatal scan covering the verification window returned no logs.

## Data preservation

All 26 business tables were copied in a single PostgreSQL transaction and checked against SQLite by row count and SHA-256 of canonical row contents. Existing IDs and password hashes were retained. A fresh consistent SQLite backup and detailed comparison report remain private under `.local/backups/`; no database or connection secret was published.

The copied data includes two user records, 151 menu catalog products, one catalog import, 78,310 projected catalog traceability rows and 14 existing audit entries. Those traceability rows retain catalog metadata, not synthetic operational sales. Inventory items, recipes, suppliers, posted stock movements and operational sales were empty in the source and remained empty after cutover. Authentication checks create normal session/audit activity in the cloud database.

The original SQLite database and `.env` were preserved. An ignored local cutover marker prevents the application from accidentally reopening the retired database for new writes. The migration write lock was released after verification. New local development should use a separate database path; the hosted database is the current production source of truth.

## Verified behavior

With the local server and tunnel stopped, the live browser check passed administrator login, secure session cookies, all ten main application pages, catalog consistency, refresh persistence, CSV report export, mobile navigation and logout/session revocation. Uploading the supplied full CSV through the chunked catalog flow returned its existing confirmed import. Products and traceability rows were not duplicated, and no sales or stock records were created. No JavaScript errors, failed network requests or API server errors were found. One intentionally cancelled import-list refresh request was excluded from network failures.

Database credentials are connected only to the backend production environment. The frontend uses a stable API origin and needs no database secret. Sessions and login counters persist across function instances. An additional isolated Neon schema check verified that two independent API database connections cannot overdraw the same stock, concurrent retries post once, and login counters are shared. The isolated test schema was removed afterwards; test fixtures never entered the production schema.

| Automated suite                                                     | Passed |
| ------------------------------------------------------------------- | -----: |
| SQLite backend workflows, including the full private catalog source |     28 |
| PostgreSQL engine workflows using isolated PGlite databases         |     27 |
| Migration, staged CSV uploads and shared rate counters              |      4 |
| Deployment configuration and output checks                          |      5 |
| Chrome application workflows with isolated test data                |      5 |

These tests cover permissions/CSRF, required opening stock, units, partial receiving, recipe consumption, idempotency, expiry, rollback, counts, wastage, reversals, account safeguards and persistence. Local frontend/backend builds, the hosted backend build and formatting checks also passed. This verification does not seed actual restaurant recipes, balances, costs or dated sales. Those remain operator-provided configuration.

See [deployment procedures](DEPLOYMENT.md) for maintenance, backups, environment configuration and rollback constraints. GitHub source updates and production deployments are currently separate actions; automatic Git deployments are not connected.
