import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export type Row = Record<string, any>;
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    for (const file of readdirSync(resolve('server/migrations'))
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      if (!this.get('SELECT version FROM schema_migrations WHERE version=?', file))
        this.tx(() => {
          this.db.exec(readFileSync(resolve('server/migrations', file), 'utf8'));
          this.run('INSERT INTO schema_migrations VALUES (?,?)', file, now());
        });
    }
  }
  get(sql: string, ...args: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...args);
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  audit(user: string, action: string, entity: string, entityId: string, details: unknown) {
    this.run(
      'INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)',
      id(),
      user,
      action,
      entity,
      entityId,
      JSON.stringify(details),
      now(),
    );
  }
  close() {
    this.db.close();
  }
}
