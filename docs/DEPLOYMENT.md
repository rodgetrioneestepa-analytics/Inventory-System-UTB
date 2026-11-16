# Vercel website with a local backend and database

The selected setup uses Vercel for the public frontend and this computer for the existing Node.js backend and SQLite database. No paid backend or hosted database is required. The paid Render blueprint was removed. The database file, administrator and operational records stay on the computer.

## Start the local connection

Install Cloudflare's official `cloudflared` executable. On Windows this project also checks `.local/bin/cloudflared.exe`; on other systems it uses `cloudflared` on PATH. `CLOUDFLARED_PATH` can specify another executable. Verify downloaded binaries against the official release checksums.

```sh
npm run build
npm run tunnel
```

Keep the terminal and computer running. The helper creates a free Cloudflare Quick Tunnel and starts a separate production-mode backend on loopback port 3002. It uses the existing `DATABASE_PATH` and requires no database copy. The original local server on port 3001 is unaffected. The temporary HTTPS address also serves the complete built system, with secure httpOnly session cookies and an exact origin allowlist.

The tunnel's HTTPS address is recorded in ignored `.local/tunnel-state.json`. Quick Tunnels are temporary, intended for development/testing and have no uptime guarantee. Restarting the tunnel changes its URL. A stable deployment needs a named tunnel and a suitable hostname or a separate hosting arrangement. Sleeping, restarting or disconnecting the computer makes the online system unavailable.

## Connect Vercel

1. Connect a Vercel account and import this repository, using the repository root and Framework Preset **Other**. `vercel.json` supplies the installation/build commands.
2. Set the build-only `UTB_API_ORIGIN` to the actual HTTPS tunnel origin, with no `/api` path. Do not use `localhost` because Vercel cannot reach the computer's private loopback address directly.
3. Build and deploy. `npm run build:vercel` emits Build Output API v3 at `.vercel/output`. Only generated frontend assets are copied. API requests are proxied to the tunnel without caching session responses; application paths use the React Router fallback.
4. Once Vercel returns the actual production origin, authorize it on the local backend:

```sh
npm run tunnel -- --set-frontend-origin https://YOUR-ACTUAL-PROJECT.vercel.app
```

The helper restarts only its public backend to apply the new origin while retaining the same tunnel URL. Never authorize `*` or every preview domain. Vercel preview deployments must be explicitly authorized or use a separate isolated test backend.

5. Verify login/logout and the main workflows through the Vercel URL. The same existing local administrator and records are used. Test actual CSV uploads through the hosted route before enabling large operational imports.

To stop the public connection while leaving the original local app available:

```sh
npm run tunnel -- --stop
```

When the tunnel URL changes, update Vercel's `UTB_API_ORIGIN` and redeploy the frontend. Keep SQLite backups separately and never commit the database, passwords or tunnel state. Free service eligibility and quotas still apply; this setup does not approve plan upgrades or paid overages.

References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Vercel SQLite limitations](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [Vercel Build Output API](https://vercel.com/docs/build-output-api).
