# Agent instructions: Under the Balete Inventory

Read `CODEX_MASTER_PROMPT.md` before creating or modifying the application. Follow it as the project implementation specification.

## Non-negotiable data safeguards

- The supplied 2023 POS-derived CSV is synthetic and undated: it may seed **menu names and categories only**. Do not create operational sales, historical-sales widgets, balances, costs or transaction dates from it.
- No “Historical Sales Snapshot” page, dashboard widget, endpoint, export or seed.
- Never invent ingredient recipes, suppliers, opening stock, expiry dates, costs or performance metrics.
- Enforce owner/admin vs inventory staff permissions on the server.
- Stock amounts must be calculated from an append-only ledger, not manually edited totals.
- Every stock-affecting operation must use DB transactions and prevent duplicate writes; reverse posted events with linked compensating movements.
- Unmapped menu products and inventory items without posted opening stock must block stock-affecting sales postings.
- Respect existing deployed data and migrations; do not reset or overwrite unrelated code.

## How to work

Inspect current repository first. Implement in small coherent steps, writing the actual source files. Run tests/build and fix faults. Summarize verified results and remaining gaps without pretending success. Keep credentials out of git. Use the stack and UX defined in `CODEX_MASTER_PROMPT.md` unless the repository has existing stronger conventions.
