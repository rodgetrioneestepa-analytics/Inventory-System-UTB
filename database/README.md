# Database migrations

`migrations/` contains forward SQL migrations. Applied migration filenames are recorded in `schema_migrations`, so moving the source folder does not reset or reapply an existing database's migrations.

The actual SQLite database remains at the configured `DATABASE_PATH` (default `data/utb.sqlite` in the repository root). Database files and passwords are never stored in GitHub.

From the repository root, run `npm run migrate`. See [operating rules and backups](../readme/DATA_AND_OPERATIONS.md).
