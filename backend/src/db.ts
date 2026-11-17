import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

export type Row = Record<string, any>;
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
pg.types.setTypeParser(20, Number);
export interface SQLBackend {
  query(
    sql: string,
    args?: any[],
  ): Promise<{ rows: Row[]; rowCount?: number | null; affectedRows?: number }>;
  exec?(sql: string): Promise<unknown>;
  close?(): Promise<void>;
}
type TransactionContext = { client?: pg.PoolClient; local?: boolean };

// Convert parameter placeholders only outside quoted SQL values and identifiers.
export function postgresSQL(sql: string) {
  let index = 0,
    quote = '',
    result = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      result += c;
      if (c === quote) {
        if (sql[i + 1] === quote) result += sql[++i];
        else quote = '';
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      result += c;
    } else if (/[A-Za-z_]/.test(c)) {
      let end = i + 1;
      while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end])) end++;
      const word = sql.slice(i, end);
      result += word.toUpperCase() === 'LIKE' ? 'ILIKE' : word;
      i = end - 1;
    } else result += c === '?' ? '$' + ++index : c;
  }
  result = result.replace(/(\w+)\s*=\s*(\$\d+)\s+COLLATE NOCASE/gi, 'lower($1)=lower($2)');
  if (/^SELECT COUNT\(\*\) total FROM \(/i.test(result.trim())) result += ' AS page_rows';
  return result;
}

export class Store {
  readonly dialect: 'sqlite' | 'postgres';
  readonly db?: DatabaseSync;
  readonly pool?: pg.Pool;
  readonly backend?: SQLBackend;
  private readonly context = new AsyncLocalStorage<TransactionContext>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<unknown> = Promise.resolve();
  constructor(source: string | { postgres: SQLBackend; initialize?: boolean }) {
    this.dialect =
      typeof source === 'object' || /^postgres(?:ql)?:\/\//.test(source) ? 'postgres' : 'sqlite';
    if (typeof source === 'object') {
      this.backend = source.postgres;
      if (source.initialize) this.ready = this.migratePostgres();
    } else if (this.dialect === 'postgres') {
      const connectionURL = new URL(source);
      if (process.env.VERCEL || connectionURL.searchParams.get('sslmode') === 'require')
        connectionURL.searchParams.set('sslmode', 'verify-full');
      this.pool = new pg.Pool({
        connectionString: connectionURL.href,
        max: 5,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 10000,
        allowExitOnIdle: true,
      });
      this.pool.on('error', () => console.error('A PostgreSQL connection was interrupted.'));
    } else {
      if (process.env.VERCEL)
        throw new Error(
          'Hosted backend requires DATABASE_URL. Local SQLite is disabled on Vercel.',
        );
      const cutoverPath = resolve('.local/cloud-cutover.json');
      if (source !== ':memory:' && existsSync(cutoverPath)) {
        const cutover = JSON.parse(readFileSync(cutoverPath, 'utf8'));
        if (resolve(source).toLowerCase() === String(cutover.source_path).toLowerCase())
          throw new Error(
            'This SQLite database was migrated to the hosted system. Use DATABASE_URL or a separate local development database to avoid divergent records.',
          );
      }
      if (source !== ':memory:') mkdirSync(dirname(resolve(source)), { recursive: true });
      const { DatabaseSync: SQLiteDatabase } = createRequire(import.meta.url)(
        'node:sqlite',
      ) as typeof import('node:sqlite');
      this.db = new SQLiteDatabase(source);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      for (const file of readdirSync(resolve('database/migrations'))
        .filter((x) => x.endsWith('.sql'))
        .sort()) {
        if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(file)) {
          this.db.exec('BEGIN IMMEDIATE');
          try {
            this.db.exec(readFileSync(resolve('database/migrations', file), 'utf8'));
            this.db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(file, now());
            this.db.exec('COMMIT');
          } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
          }
        }
      }
    }
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      release();
    }
  }
  private async query(sql: string, args: SQLInputValue[]) {
    await this.ready;
    const execute = async () => {
      if (this.db) {
        const statement = this.db.prepare(sql);
        if (statement.columns().length)
          return { rows: statement.all(...args) as Row[], rowCount: 0 };
        const result = statement.run(...args);
        return { rows: [] as Row[], rowCount: Number(result.changes) };
      }
      const target = (this.context.getStore()?.client ?? this.pool ?? this.backend!) as SQLBackend;
      const result = await target.query(postgresSQL(sql), args);
      return { rows: result.rows, rowCount: result.rowCount ?? result.affectedRows ?? 0 };
    };
    return this.db || this.backend
      ? this.context.getStore()?.local
        ? execute()
        : this.locked(execute)
      : execute();
  }
  async get(sql: string, ...args: SQLInputValue[]): Promise<Row | undefined> {
    return (await this.query(sql, args)).rows[0];
  }
  async all(sql: string, ...args: SQLInputValue[]): Promise<Row[]> {
    return (await this.query(sql, args)).rows;
  }
  async run(sql: string, ...args: SQLInputValue[]) {
    return { changes: (await this.query(sql, args)).rowCount };
  }
  async insertRows(table: string, columns: string[], rows: SQLInputValue[][]) {
    if (![table, ...columns].every((name) => /^[a-z_][a-z0-9_]*$/.test(name)))
      throw new Error('Invalid insert identifier');
    for (let start = 0; start < rows.length; start += 500) {
      const batch = rows.slice(start, start + 500);
      const markers = batch.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',');
      await this.run(
        'INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES ' + markers,
        ...batch.flat(),
      );
    }
  }
  async tx<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.ready;
    if (this.context.getStore()) return await fn();
    const execute = async () => {
      const client = this.pool ? await this.pool.connect() : undefined;
      const target = (client ?? this.backend) as SQLBackend | undefined;
      const raw = async (sql: string) =>
        this.db ? this.db.exec(sql) : target!.exec ? target!.exec(sql) : target!.query(sql);
      try {
        await raw(this.db ? 'BEGIN IMMEDIATE' : 'BEGIN');
        // Preserve single-writer inventory posting across serverless instances.
        if (!this.db) await target!.query('SELECT pg_advisory_xact_lock(726210031)');
        const result = await this.context.run(
          { client, local: Boolean(this.db || this.backend) },
          async () => await fn(),
        );
        await raw('COMMIT');
        return result;
      } catch (error) {
        await raw('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client?.release();
      }
    };
    return this.db || this.backend ? this.locked(execute) : execute();
  }
  async audit(user: string, action: string, entity: string, entityId: string, details: unknown) {
    await this.run(
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
  async migratePostgres() {
    if (this.dialect !== 'postgres') return;
    const client = this.pool ? await this.pool.connect() : undefined;
    const target = (client ?? this.backend!) as SQLBackend;
    try {
      await target.query('BEGIN');
      await target.query('SELECT pg_advisory_xact_lock(726210031)');
      await target.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      for (const file of readdirSync(resolve('database/postgres'))
        .filter((x) => x.endsWith('.sql'))
        .sort()) {
        if (
          !(await target.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file])).rows
            .length
        ) {
          const sql = readFileSync(resolve('database/postgres', file), 'utf8');
          if (target.exec) await target.exec(sql);
          else await target.query(sql);
          await target.query('INSERT INTO schema_migrations VALUES ($1,$2)', [file, now()]);
        }
      }
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client?.release();
    }
  }
  async close() {
    await this.ready;
    await this.queue;
    this.db?.close();
    await this.pool?.end();
    await this.backend?.close?.();
  }
}

export async function mapAsync<T, R>(
  rows: readonly T[],
  work: (row: T, index: number) => R | Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  for (let i = 0; i < rows.length; i++) output.push(await work(rows[i], i));
  return output;
}
export async function forEachAsync<T>(
  rows: readonly T[],
  work: (row: T, index: number) => unknown | Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i++) await work(rows[i], i);
}
