# CODEX MASTER BUILD PROMPT — UNDER THE BALETE INVENTORY

You are the lead full-stack engineer responsible for IMPLEMENTING, RUNNING, TESTING, and DOCUMENTING a complete inventory management web application named **Under the Balete Inventory** for the restaurant, café, and bar Under the Balete in Quezon City, Philippines.

**Repository:** https://github.com/rodgetrioneestepa-analytics/Inventory-System-UTB
**Workspace/project name:** Inventory ni Miss Ann

## Execution rules — please do not stop at a plan

1. Inspect the current repository and directory structure, existing code, dependencies, Git status, README, and any attachments before changes. Preserve working features and user data. The public GitHub repository may contain only a README; if so, scaffold the complete project. Do not pretend that files or credentials exist.
2. If provided, read `SIGMA_Updated_Chapter1-3 (1).docx` to understand restaurant/POS context and `UTB-Datasheet-2023-ProductSales.csv` to extract **menu catalog names and categories only**. If missing, build the entire application with empty states and the documented import feature; do not fabricate or insert the CSV or ingredients.
3. Implement real working frontend, backend, database, migrations, authentication, validation, permissions, and tests. Actually create files and run the available checks. Do not respond with just an outline, figma-like UI, pseudocode, or isolated component.
4. Work in coherent milestones, fix errors before proceeding, and summarize verified functionality and any remaining limitations at the end. Do not delete existing records, reset or replace a deployed database, or overwrite `.env` without permission. Use idempotent migrations.
5. Use TypeScript everywhere practicable. No paid service is required to run locally. Keep commands simple and documented. Do not hardcode production secrets or real restaurant credentials.

## IMPORTANT: Historical Sales Snapshot must NOT exist

The former historical-sales snapshot feature was based on synthetic data. Completely remove its sidebar link, cards, charts, tables, backend-only endpoints/queries, exports, and seeds (if present), without removing genuine operational sales or unrelated functionality. Do not substitute another historical sales chart. Do not erase production records or post artificial reversal stock movements for snapshots that never affected stock.

## Stack

- Frontend: **React + TypeScript + Vite + Tailwind CSS**, responsive, accessible forms and tables, React Router and TanStack Query or straightforward equivalent; charts only for legitimate posted inventory data.
- Backend: **Node.js + Express + TypeScript**, with input validation (Zod or equivalent), central error handling, parameterized SQL and explicit authorization.
- Database: **SQLite with versioned migrations** (better-sqlite3 or equivalent). Enable foreign keys and WAL; transactions must protect multi-step stock postings. Organize code so another SQL database can be adopted later.
- Authentication: password hashing with bcrypt/Argon2, secure httpOnly session cookies and sameSite/CSRF protections; rate-limit login; session expiration; do not put credentials in frontend source.
- Tooling: typed APIs, `npm run dev`, `npm run build`, `npm test`, `.env.example`, README, sample **operational** CSV format, `.gitignore` for secrets/DB/node_modules.
- Application name: **Under the Balete Inventory**. Palette: deep green, warm cream and restrained earthy accents. Use PHP `₱` formatting and `Asia/Manila` timezone where dates are displayed.

## Verified source-data boundaries

The supplied synthetic `UTB-Datasheet-2023-ProductSales.csv` (when available) has columns:
`TransactionID, ProductName, Category, Qty, UnitPrice, SalesAmount`.

Previous inspection identified 78,310 line items, 18,403 distinct transaction IDs, 153 distinct products, 25 categories and 2,020 zero-price rows. Treat these counts **only as source-file diagnostics**, recheck them against the actual file, and never present them as business KPIs. Source examples: Truffle Pasta, Grilled Tuna, Chicken Parm, Sisig Rice Bowl, San Mig Pilsen, Container and Free Pudding; categories include Entree, Beer, Appetizer, Coffee, Cocktail, Packaging and Promos & Freebies.

**ABSOLUTE RULES:**
- Import **ONLY distinct (`ProductName`, `Category`) menu catalog metadata** from that undated file. Never import its `TransactionID`, `Qty`, `UnitPrice`, or `SalesAmount` into sales tables, inventory, revenue metrics, dashboards or projections.
- `UnitPrice` is a selling price, NOT an ingredient purchasing cost. The filename `2023` is NOT a transaction timestamp. Sold quantity alone cannot determine stock.
- Do not create fake opening balances, costs, deliveries, recipes, suppliers, expiry dates, operating dates or forecasts.
- Preserve free products in the catalog because they can still consume stock.
- Unconfigured data must visibly say “Not configured” / “Opening stock not configured”, not zero.
- Do not silently delete or overwrite existing manual configuration during re-imports.

## Core roles and authorization

**Owner/Admin** may manage user roles/accounts, menu catalog, ingredient definitions, recipes, imports, suppliers, purchasing, stock opening, adjustments, reversals, operational sales, reports and settings.

**Inventory Staff** may view inventory/alerts, create receiving records, perform authorized counts and wastage, and view movements. Staff must be denied admin-only actions by the backend (not only by hidden frontend buttons).

Create a dev-admin seeding CLI that asks for a password or reads environment values locally; do not ship a universal password. Track acting `user_id`, action time, reference, reason and source on every stock-affecting write.

## Required persistent tables / entities

Design suitable normalized schema with migrations, foreign keys, indexes, constraints and archive statuses:
- `users`, sessions/auth tables, roles/permissions or role field
- `menu_products` (source name, category, confirmed selling price optional, active/archived)
- `inventory_items` (SKU unique, name, category, base unit, storage location, reorder point, target, expiry tracking, opening configured state, archived)
- `unit_conversions` (only compatible dimensional conversions; require explicit pack size)
- `recipes`, `recipe_versions`, `recipe_ingredients` (quantities and base units; immutable posted versions)
- `suppliers`
- `purchase_orders`, `purchase_order_lines`, `receipts`, `receipt_lines`
- `stock_batches` and expiry dates where applicable
- `stock_movements` as **append-only, auditable ledger**, including opening, receipt, consumption, wastage, count adjustment, reversal and references
- `stock_counts`, `wastage` and their line records
- `operational_sales`, `operational_sale_lines` with unique source-row references and recipe version used
- `imports` / `import_rows` or equivalent traceability (filename, hash, created_by, timestamp, status, error row references)
- `audit_log` for important configuration/privileged changes.

**NEVER store editable `current_quantity` as the source of truth.** Compute stock by summing signed *posted* ledger movements. Maintain ledger consistency with atomic transactions and uniqueness/idempotency keys for posting. Never physically delete posted movements; reverse with linked compensating movements.

## Inventory item/setup rules

Support ingredients, drinks, packaging and consumables with SKU, name, category, unit, location, low-stock threshold, target stock, active state and optional expiry tracking.

Support grams/kilograms, milliliters/liters, piece/bottle and explicit pack conversions. Never convert mass to volume or packs to pieces without user-defined information.

An opening stock event must be posted before an item can participate in stock-affecting operations. Unknown is **not** the same as zero. Reject invalid numbers, negative inputs, duplicate opening events, mismatched units and unauthorized attempts. Display stock balances, reorder warnings and missing openings clearly.

For expiry-tracked items, record received batches/expiry; show expired and soon-to-expire items; prefer earliest-expiring unexpired batches for consumption and distinguish available vs expired stock. Do not consume expired stock.

## Menu products and versioned recipe mapping

Separate menu products (sellable items) from inventory items (physical stock). Allow administrators to import the catalog, create/archive products, and confirm current selling price manually.

Recipe editor maps each menu product to item(s) and per-serving quantities, including beverages, packaging, extras, zero-price freebies and bundles/promotions. Store immutable recipe versions; associate sales consumption with the version used at posting. Show products missing a recipe in a setup queue and **block posting sales for unmapped products**.

Do not invent actual recipes or serving quantities. Require manual confirmation of every mapping and any needed unit conversions.

## Suppliers, purchasing and receiving

Create supplier CRUD, PO drafts with lines, expected quantities/purchase cost and status. Receive against a PO as partial or complete with delivery reference, received date and optional expiry/batch. Only actual posted receipt increases stock, never PO creation. Prevent receiving more than ordered without explicit authorized exception and prevent duplicate receiving via stable idempotency/delivery reference keys. Show remaining-to-receive counts and preserve an audit trail. Correct mistakes by documented reversal/correction, not by deleting history.

## Operational sales with recipe-based stock deduction

Separate **genuine dated operational sales** from the undated synthetic 2023 product catalog. Provide form and import to enter transactions with reference/transaction ID, actual date/time, menu product, units sold, confirmed selling price and sales amount. One transaction can contain multiple distinct lines, so do not de-duplicate by transaction ID alone.

Preview an operational sale before posting: resolve every product to its current recipe version, multiply ingredients by units, show requested consumption and stock shortages, validate dates/units/opening balances and block if any product unconfigured or stock insufficient. When posting, write sale, lines, immutable recipe-version references and stock consumptions together in **one database transaction**. Prevent double posting from retries and simultaneous requests. Free items may consume stock. Void posted sales with linked reversal entries; preserve originals and prevent double voiding.

## CSV imports

Two completely distinct flows:

**A) Menu catalog CSV**
- Accept the supplied CSV; validate `ProductName` and `Category`; efficiently stream/parse ~78k rows.
- Preview unique products/categories, category conflicts and invalid rows before confirmation.
- On confirm, upsert catalog only by normalized unique name while preserving source name; conflict of category requires manual review rather than silent overwrite.
- Never read sales quantities/prices into business records. Record filename, hash, imported timestamp, source row reference and summary counts.
- Reimport is idempotent and must not overwrite confirmed pricing or recipes.

**B) Real dated operational-sales CSV**
- Publish a blank sample template with columns: `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount` (document accepted date/time format in Asia/Manila).
- Validate required columns, each date, amount, numeric fields, duplicate line keys and that `Qty*UnitPrice` equals `SalesAmount` within an explicitly documented rounding tolerance; show mismatches.
- Preview and reject/hold unconfigured recipes or inadequate stock *before* posting; do not deduct during preview or upload.
- Confirm with transaction-safe, idempotent imports keyed by file hash and by source row identity. Distinct lines in same transaction must remain distinct. Flag overlapping files rather than guessing.
- Return error report with source row, reason and downloadable rejected-row CSV. Track filename/hash, uploader, date, confirmation status and counts.
- NEVER allow the synthetic undated catalog file into this operational import path.

## Wastage, stock counts and reversals

Implement wastage with item, quantity, date, category/reason, actor and optional batch; creates a negative stock ledger entry only after validation.

Physical stock count: show calculated book balance, accept counted balance, preview delta, require reason and create one signed adjustment movement; prevent accidental duplicate posting. Reversals for mistaken eligible posted events should preserve original records and reference the event reversed. Block reversals that would create invalid stock or conflict with consumed expired batches unless performed through an explicitly documented correction workflow.

## Pages and user experience

1. Login / secure logout.
2. Dashboard: cards for configured inventory items, low stock, out of stock, expiring batches, items awaiting opening stock, products awaiting recipe mapping. Only show REAL data.
3. Inventory: list, search, category and status filters, pagination, create/edit/archive, stock opening workflow.
4. Menu Products & Recipes: catalog import, current price confirmation, recipe mapping, unmapped queue.
5. Suppliers.
6. Purchase Orders & Receiving.
7. Stock Movements: searchable audit table and filters for actor, type, item, date and reference.
8. Wastage & Stock Counts.
9. Operational Sales & Imports.
10. Reports: real stock, low-stock, receipts, usage and expiry where meaningful; downloadable CSV and printable views.
11. Users & Settings (owner/admin only).

Responsive left navigation, practical forms, validation feedback, helpful empty/loading/error/success states, confirmation dialogs for irreversible posts and audit-aware labels. Never display synthetic historical sales. Provide an actionable “Set opening stock” and “Map recipe” control. Currency uses `Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'})`.

No bogus trend charts, daily peaks, stock turnover/cover, valuations or forecasts when inputs are missing. Inventory valuation may only use actual documented purchase costs and a defined costing method; do not use menu selling price as cost.

## Endpoint and app quality

Implement clean REST endpoints with response schemas, predictable pagination and filtering, server-side authorization, request logging without secret leakage, validation of all inputs, database indexes, anti-CSRF protections for cookie-authenticated mutations, account/password/session safeguards and safe errors. Uploads must have size limits, content/type validation and no arbitrary file execution.

Write meaningful automated tests for a stock ledger service and backend integration endpoints, including race/idempotency-sensitive cases. Ensure every mutating workflow is atomic. Do not generate fake analytics seed data.

## Acceptance tests — perform and report actual results

1. Catalog CSV creates only distinct menu products/categories, never sales, prices, stock or inventory movement.
2. Catalog re-import does not duplicate or overwrite manually confirmed prices/recipes.
3. No Historical Sales Snapshot anywhere (UI/API/exports/seeds).
4. Proper roles prevent staff from accessing admin-only operations.
5. Opening stock is required; missing opening stays unknown, not zero.
6. Receipt raises stock **exactly once**; partial receipt updates PO remaining quantities.
7. Genuine dated sale consumes exactly configured recipe quantities, including zero-price products.
8. Unmapped products, missing unit conversions and insufficient or expired stock reject posting without partial writes.
9. Duplicate sale/CSV import does not double-consume.
10. Wastage decreases stock and counts post signed differences with audit references.
11. Voiding a sale restores stock through posted reversals without destroying history.
12. Simultaneous conflicting deductions cannot drive inventory below allowed stock.
13. Data persists after refresh/server restart.
14. Main pages render and work in the browser; backend and frontend production builds pass.

## Final output

Create ALL source files in the working repo, migrations, npm scripts, environment template, tests, sample operational import template, README and setup instructions. Run appropriate installs/tests/builds, inspect and repair failures, and finish by reporting what was actually implemented and tested, exact commands to run it and which business data UTB must still provide: opening stock, recipes, unit conversions, suppliers, real purchase costs, and dated operational sales. Clearly distinguish completed from incomplete features; never claim tests passed without actually running them.

**Start by inspecting the repository and supplied files; then IMPLEMENT, not merely describe.**
