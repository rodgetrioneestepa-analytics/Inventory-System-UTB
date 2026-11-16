# Under the Balete Inventory

Restaurant inventory management with a React frontend, Express backend and an auditable SQLite stock ledger.

**Website:** [under-the-balete-inventory.vercel.app](https://under-the-balete-inventory.vercel.app)

The backend and database run on the owner's computer through a secure tunnel. Keep the computer and tunnel running for the online website to work.

## Repository folders

| Folder                                 | Contents                                                               |
| -------------------------------------- | ---------------------------------------------------------------------- |
| [inventory-webapp/](inventory-webapp/) | Application code: frontend, backend and shared API types               |
| [database/](database/)                 | Versioned database migrations; the actual database stays private       |
| [readme/](readme/)                     | Setup guide, API reference, business rules and deployment instructions |
| [tests/](tests/)                       | Backend, browser and deployment tests                                  |
| [scripts/](scripts/)                   | Windows runner, Vercel build and local tunnel helpers                  |
| [config/](config/)                     | TypeScript, Vite and Playwright configuration                          |
| [samples/](samples/)                   | Blank CSV import templates                                             |

The root keeps package/dependency files, the environment template and `vercel.json` so installation and hosting tools work normally. Passwords, local data, generated builds and tunnel settings are excluded from Git.

## Run from the repository root

Use Node.js 24 or newer. Install dependencies, copy `.env.example` to `.env` only if it does not exist, then create an administrator and start the application:

```sh
npm install
npm run admin:create
npm run dev
```

Open [localhost:5173](http://localhost:5173). On this Windows workspace, the runner is `scripts/run.ps1`, for example `.\scripts\run.ps1 build`.

See the [full setup guide](readme/SETUP.md), [API reference](readme/API.md), [operating rules](readme/DATA_AND_OPERATIONS.md) and [Vercel/local database deployment guide](readme/DEPLOYMENT.md).
