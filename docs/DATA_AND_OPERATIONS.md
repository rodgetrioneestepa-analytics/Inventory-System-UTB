# Data boundaries and operating rules

The user explicitly confirmed that the undated supplied CSV is synthetic and must be used for menu catalog names and categories only. This takes precedence over the pasted request's older historical-sales instructions and over the chapter document's analytics scope. This application manages inventory. It does not contain a historical snapshot, historical sales endpoint, revenue dashboard, forecast or synthetic sales seed.

The original GitHub repository contained only a README. No deployed database, existing operational records, or snapshot implementation was present in the checked-out repository. No data was reset, deleted or replaced.

## Supplied source inspection

`SIGMA_Updated_Chapter1-3 (1).docx` describes METRICAST, a POS analytics and forecasting project for Under the Balete, a restaurant, café and bar in Quezon City. It discusses KwikPOS exports and management reporting. Inventory and suppliers are deliberately added by the user's current request. The document is context, not authority to infer dates or real recipes from the synthetic file. No manuscript content or private raw CSV is committed.

The supplied `UTB-Datasheet-2023-ProductSales.csv` was read and rechecked programmatically:

| File diagnostic | Observed |
|---|---:|
| Source line items | 78,310 |
| Distinct source transaction IDs | 18,403 |
| Distinct source product spellings | 153 |
| Distinct normalized catalog names | 151 |
| Categories | 25 |
| Rows with zero price and amount | 2,020 |
| Qty × UnitPrice discrepancies above ₱0.01 | 0 |

SHA-256 of the decoded UTF-8 source content: `dca17a2f7f8ff7c24c6dc03a0e6e2384048202a045cd0b6eac9e0703ee5963de`.

Case normalization merges `SOP` / `Sop` and `Bone-in PorkChop` / `Bone-In Porkchop`. The first source spelling is retained on the menu product; every spelling remains in projected import row traceability, and preview includes source variants. Category conflicts block confirmation for manual review. The import has 151 normalized products, not 153 separately selectable duplicates.

Transaction IDs, quantities, synthetic prices and amounts are discarded before catalog payloads and import rows are persisted. The hash and source row counts are diagnostics. They never populate stock, sales or business KPIs. Source numeric reconciliation was performed in memory only. Import history retains filename, hash, source row number, catalog fields, actor, status and confirmation time. Reimports preserve current confirmed prices and immutable recipes.

## Stock and unit rules

Stock is the sum of signed posted movements. There is no editable current quantity. An item with no opening event has an unknown balance, including in reports. Explicit opening zero is valid. One opening event is allowed per item; its initial counted lot is one batch. Additional actual deliveries create their own batches. Count batches separately for expiry-tracked items.

Base units are `g`, `ml`, `piece`, `bottle`. `kg` converts only to `g`; `l` converts only to `ml`; other dimensions cannot mix. A pack requires an item-specific confirmed factor. A pack factor means the number of that item's base units in one pack. No implicit bottle-to-piece or mass-to-volume conversion exists. Quantities are rounded to six decimal places in base units; consumption below 0.000001 base units is rejected. Recipes store converted base quantities, so changing a pack conversion does not rewrite existing recipe versions.

Expiry dates are calendar dates in Manila and remain usable through the stated date. Expired means strictly before the current Manila date. Sales use the earliest-expiring unexpired batch first. Wastage can dispose of expired batches. The dashboard warning window is seven days and includes already expired batches. The book balance includes expired stock; available balance excludes it.

## Posting and corrections

- PO quantities and costs are entered in the selected ordering unit and stored per base unit. An order is saved as draft, submitted, then partially or completely received. Receiving requires a physical opening count first, including an explicit zero count where appropriate.
- A stable delivery reference prevents accidental repeat receipts even with a different request key. Receiving more than ordered requires an admin and an explicit exception reason.
- Sales require an active product, a confirmed current menu price (zero is valid), a published recipe, openings for all ingredients, and enough unexpired stock. Each line retains its immutable recipe version. The actual dated sale price is entered separately and its amount must reconcile within ₱0.01 after cent rounding.
- Counts are per batch and carry the book quantity used in preview. Confirmation fails if the batch changed. The signed difference is a ledger event, including a zero-difference count for traceability.
- Voids are linked compensating events. Original sales, lines, movements, actors and references remain. A second void cannot post. A receipt or positive count cannot be reversed after its added quantity is consumed; reverse dependent events first. Opening events and reversals cannot themselves be reversed. Correct a mistaken opening with a reasoned physical count. To correct immutable batch metadata, reverse dependent consumption and the receipt, then enter a corrected delivery with a new reference; a reversal restoring expired goods leaves them unavailable for sales.
- SQLite serializes writers using `BEGIN IMMEDIATE`, a busy timeout and WAL. Posting keys, source line keys, delivery references and reversal links have uniqueness constraints. Database triggers protect the ledger, posted documents and recipe versions against updates/deletes.

Genuine operational CSV dates must be ISO 8601 with an explicit offset, for example `2026-11-16T14:30:00+08:00` (Manila) or its UTC equivalent. Future operational timestamps beyond five minutes are rejected. Transaction IDs identify whole transactions; positive integer line numbers identify distinct lines. All lines of one transaction must have the same timestamp. Overlapping transaction references are held for review rather than merged. A voided transaction keeps its source identity; correcting it requires a new explicit reference. Upload never deducts stock. Confirmation posts the entire valid file atomically or nothing. Correct any rejected source rows and upload the corrected file. The blank sample contains no invented transactions.

The ledger records both occurrence time supplied by the operator and actual creation time. Backdated genuine sales are allowed and consume currently available batches. This is a current-balance system, not a reconstruction of historical batch availability. Operators must confirm that their backdated transaction is an appropriate unposted operational event; historical reconciliation requires a separately designed workflow.

## Reports and limitations

Stock, low/out-of-stock, expiry, receipt and recipe-consumption reports are available, with CSV and full-report printing. Receipt and usage reports show original event movements and a reversed flag; linked corrections are in the stock ledger. They are not net revenue or net usage charts. Print exports load all pages before printing.

No inventory valuation is claimed: purchase costs are stored on real PO/receipt lines, but no weighted-average or FIFO financial costing method is implemented. There is no forecasting, automatic procurement, POS connector, email delivery, password recovery email, multi-restaurant tenancy or cloud deployment. PO drafts can be submitted or cancelled; to revise an incorrect unreceived draft, cancel it and create a new reference. Settings describe the fixed operating policy; security origins and database location are environment configuration.

This is a local application using a single Node.js service and local SQLite database. Do not place the live database on a network share or run multiple computers against a OneDrive-synced SQLite file. Before multi-machine production use, move the database to a non-synced local server disk, configure HTTPS and an exact origin, restrict host access and establish backups. Stop the app and copy the entire data directory for an offline backup; restore only while stopped. Never delete the database to apply a migration. Migrations apply forward on startup and do not seed operational data.
