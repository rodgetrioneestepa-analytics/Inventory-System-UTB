import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from '../backend/src/db.js';
import { copySQLite } from '../backend/src/copy-sqlite.js';

if (!process.env.DATABASE_URL?.startsWith('postgres'))
  throw new Error('Set the target PostgreSQL DATABASE_URL in a private environment file.');
const target = new Store(process.env.DATABASE_URL);
const sourcePath = resolve(process.env.DATABASE_PATH || 'data/utb.sqlite');
const source = new DatabaseSync(sourcePath);
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
mkdirSync('.local/backups', { recursive: true });
try {
  await target.migratePostgres();
  // Reserved write lock prevents changes while the final consistent copy is made.
  // Readers can continue; this process never updates the source database.
  source.exec('PRAGMA busy_timeout=15000; BEGIN IMMEDIATE');
  const reader = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(reader, resolve('.local/backups/cutover-' + stamp + '.sqlite'));
  } finally {
    reader.close();
  }
  const report = await copySQLite(source, target);
  writeFileSync('.local/backups/postgres-copy-' + stamp + '.json', JSON.stringify(report, null, 2));
  console.info(
    JSON.stringify({
      migration: 'verified',
      tables: Object.keys(report).length,
      counts: Object.fromEntries(
        Object.entries(report).map(([table, value]) => [table, value.rows]),
      ),
    }),
  );
  if (process.argv.includes('--hold')) {
    const session = randomUUID();
    const control = resolve('.local/postgres-cutover-control.json');
    writeFileSync(
      '.local/postgres-cutover-state.json',
      JSON.stringify({ session, locked: true, verified_at: new Date().toISOString() }),
    );
    console.info(
      'Verified copy complete. Local writes remain paused until the hosted cutover is checked.',
    );
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () => {
          unwatchFile(control);
          fail(new Error('Cutover window expired; local writes were resumed.'));
        },
        15 * 60 * 1000,
      );
      watchFile(control, { interval: 1000 }, () => {
        try {
          const command = JSON.parse(readFileSync(control, 'utf8'));
          if (command.session === session && command.release) {
            clearTimeout(timer);
            unwatchFile(control);
            done();
          }
        } catch {}
      });
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database migration failed.');
  process.exitCode = 1;
} finally {
  try {
    source.exec('ROLLBACK');
  } catch {}
  source.close();
  await target.close();
}
