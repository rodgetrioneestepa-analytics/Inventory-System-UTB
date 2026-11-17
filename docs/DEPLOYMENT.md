# Vercel frontend and API with Neon PostgreSQL

Cloud hosting uses two Vercel projects and one Neon Free database. The React website proxies same-origin /api requests to Express in Vercel Functions; the API persists users, sessions, catalog and inventory in PostgreSQL. The computer and temporary tunnel are no longer needed after verified cutover.

| Component | Project                                                                                | Configuration              |
| --------- | -------------------------------------------------------------------------------------- | -------------------------- |
| Frontend  | [under-the-balete-inventory.vercel.app](https://under-the-balete-inventory.vercel.app) | Root vercel.json           |
| Backend   | under-the-balete-inventory-api                                                         | config/vercel.backend.json |
| Database  | neon-bronze-house, Neon Free                                                           | Server-only DATABASE_URL   |

Free service quotas and eligibility apply. No paid upgrades, additional paid resources or overages are authorized. A dormant database can take longer to answer its first request. Independent backups and uptime monitoring remain the owner's responsibility.

## Backend deployment

Use the repository root, Node.js 24 and Framework Preset Other. Link the backend project and use its configuration:

```sh
vercel deploy --prod --local-config config/vercel.backend.json
```

With the authenticated deployment connector, submit reviewed source files with config/vercel.backend.json as that deployment's root vercel.json. Keep the repository's actual root configuration for the frontend. Never deploy frontend configuration to the API project.

Connect Neon through Vercel Marketplace. Configure these production variables on the backend project:

- DATABASE_URL: pooled PostgreSQL connection string, TLS enabled, sensitive and server-only.
- APP_ORIGIN: https://under-the-balete-inventory.vercel.app exactly.
- NODE_ENV: production.

Keep the production database unavailable to untrusted preview code. Use an isolated database for previews. The API refuses to initialize without PostgreSQL and never falls back to ephemeral SQLite on Vercel. Migrations and account creation are explicit maintenance commands, never startup seeds.

## Copy an existing SQLite installation

1. Preserve .env and the original database. Save the full Neon connection string as DATABASE_URL=... in ignored .local/cloud-postgres.env. Never put it in chat, GitHub, frontend variables or build artifacts.
2. Run tests and build. Deploy the API while leaving the frontend on its current service until copying succeeds.
3. Pause operational writes for cutover. Run from the repository root:

```powershell
node --env-file=.local/cloud-postgres.env --import tsx scripts/migrate-sqlite-to-postgres.ts --hold
# Windows runtime helper:
.\scripts\run.ps1 migrate:cloud --hold
```

The command applies PostgreSQL migrations, makes a consistent SQLite backup, holds a source write lock and copies all 26 business tables in one PostgreSQL transaction. It retains IDs, password hashes, recipe versions, posted movements, import traceability and audit entries. Each table is compared by count and SHA-256 of canonical row contents. A nonempty target is refused; no reset occurs. Backups and verification reports remain private in .local/backups/.

4. Check backend /api/health and login. Set frontend UTB_API_ORIGIN to the stable backend HTTPS origin without /api and deploy the frontend. Verify login, pages, refresh, export and logout.
5. Stop the previous local production server and tunnel only after cloud checks pass. Record the absolute source_path and hosted website in ignored .local/cloud-cutover.json. The app then refuses to reopen that retired SQLite file, preventing divergent records. Use another DATABASE_PATH for independent development.
6. Release the source lock by writing .local/postgres-cutover-control.json with the session from .local/postgres-cutover-state.json and release: true. The lock also expires after 15 minutes. Keep the original database and backup.

If verification fails before switching the frontend, retain the original service and release the lock. Once cloud users start writing, the old SQLite file is a backup rather than an interchangeable production database. Returning to SQLite requires an explicit verified migration of newer cloud records.

## Frontend deployment

Link the frontend project and use root vercel.json. Set build-only UTB_API_ORIGIN to the stable backend HTTPS origin. Then deploy the reviewed source:

```sh
vercel deploy --prod
```

The build:vercel script writes Build Output API v3 to .vercel/output. Static output contains only frontend assets. API requests proxy to the backend before the SPA fallback without caching sessions. Database credentials are unnecessary on the frontend. These projects currently use authenticated API deployments; GitHub automatic deployments require a separately connected Git integration. A GitHub push alone does not deploy them.

## Authentication, uploads and operations

Sessions and shared login rate counters persist in PostgreSQL across function instances. Cookies remain Secure, httpOnly and SameSite=Strict through the frontend proxy. Authenticated writes require CSRF tokens and the exact permitted origin. Inventory postings use one checked-out connection and a database advisory transaction lock to serialize changes.

CSV limits remain 20 MiB and 150,000 records. Larger browser uploads use authenticated chunks below individual function request limits. Staging belongs to its administrator and expires after 30 minutes; successful preview removes it. Catalog import persists approved catalog metadata only, never synthetic quantities or prices as operational data.

Use provider-supported backups or private pg_dump exports. Keep dumps and restore credentials outside Git. Check the database dashboard for the actual recovery window instead of assuming a free-tier guarantee. For future PostgreSQL migrations, load the private production environment and run backend/src/migrate.ts explicitly after backup and review.

## Local development and the former tunnel

SQLite remains supported with DATABASE_PATH and no DATABASE_URL; see the root README. After cutover, use an isolated development database. The tunnel helper remains available for explicitly chosen local demonstrations but is unnecessary for hosted production. Quick Tunnel hostnames expire and change; an expired address causes gateway errors even while the website loads. The frontend now explains service unavailability if a gateway returns text instead of JSON.
