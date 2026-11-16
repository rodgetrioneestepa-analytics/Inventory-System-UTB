# Vercel frontend and persistent backend

The inventory application uses a local SQLite ledger. Vercel Functions do not provide a shared persistent filesystem for that database. Use Vercel for the public React frontend and a separate Node.js backend with a persistent disk. The local application and its database keep working independently.

The supplied `render.yaml` configures one Render Node.js 24 backend instance in Singapore with a 1 GB persistent disk mounted at `/var/data`. SQLite remains at `/var/data/utb.sqlite`; migrations apply at runtime after the disk is mounted. Never create the database inside a build artifact or commit it to Git. This is a paid service and must only be provisioned after costs are approved. At preparation time, the smallest server was US$7/month and storage US$0.25/GB/month, excluding extras and taxes. Review the provider's current quote before provisioning.

## Backend

1. Connect the repository to a Render account and review the Blueprint. Approve the paid service and disk before creating resources.
2. Set `APP_ORIGIN` to the exact production Vercel origin, including `https://`. An explicit comma-separated list can authorize separate domains. Never use `*` or automatically authorize every preview deployment.
3. Keep `NODE_ENV=production`, `HOST=0.0.0.0` and `DATABASE_PATH=/var/data/utb.sqlite`. Render supplies the listening port. The disk requires a single service instance.
4. Deploy and check `https://<actual-backend-domain>/api/health`.
5. In the service's secure shell, run `node dist/server/admin.js`, choosing an administrator email and hidden password. Never put passwords in Git, frontend variables or build logs.

Fresh cloud services start empty. Local users, catalog and operational records are not uploaded automatically or reset. To move existing records, make a consistent SQLite backup and transfer it privately to the approved service while its application is stopped. Do not copy a live `.sqlite` file without its WAL state or overwrite an existing cloud database. Transfer requires separately confirmed service access.

## Frontend

1. Connect the repository to Vercel. Use the repository root and Framework Preset **Other**. `vercel.json` supplies the build command; `packageManager` pins pnpm.
2. Set the server-side build variable `UTB_API_ORIGIN` to the backend's actual HTTPS origin, without `/api` or another path. It contains no credentials.
3. Build using `pnpm run build:vercel`. The build emits Vercel Build Output API v3 at `.vercel/output`. Only `dist/web` is copied into public static assets.
4. `/api/*` is proxied to the backend and application pages use the React SPA fallback. Browser calls stay on the Vercel origin so httpOnly session cookies and CSRF protection work. API responses are not cached. Missing, local, non-HTTPS or credential-bearing backend URLs fail the build.
5. Set the final production domain in backend `APP_ORIGIN`, redeploy if needed, and verify login through the Vercel URL.

Preview URLs must not silently connect to production data. Give previews separate staging backends and databases, or leave preview backend configuration unset so those builds fail safely.

## Verification

Run `pnpm test`, `pnpm run test:deployment`, `pnpm run build`, and browser tests before release. Once both services are live, verify login/logout, stock setup, receipt, recipe sale, count, reversal and CSV import through the Vercel proxy with isolated test records. Test actual catalog upload size through the hosted route. Verify persistence after backend restart and redeploy. Local tests do not establish that a cloud deployment is live or verified.

Never delete or recreate the persistent disk during redeployment. Make consistent SQLite backups to separate durable storage. A single SQLite backend has brief downtime during redeploys and cannot scale horizontally.

References: [Vercel SQLite limitations](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [Build Output API](https://vercel.com/docs/build-output-api), [Render disks](https://render.com/docs/disks), [Render pricing](https://render.com/pricing).
