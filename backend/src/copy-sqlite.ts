import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store, type Row } from './db.js';

// Parents precede children; all existing identifiers and hashed passwords are
// retained. Operational records are copied as records, never posted as new events.
export const copyTables = [
  'users',
  'sessions',
  'inventory_items',
  'unit_conversions',
  'menu_products',
  'recipes',
  'recipe_versions',
  'recipe_ingredients',
  'suppliers',
  'purchase_orders',
  'purchase_order_lines',
  'posted_events',
  'stock_batches',
  'stock_movements',
  'opening_events',
  'receipts',
  'receipt_lines',
  'operational_sales',
  'operational_sale_lines',
  'wastage',
  'wastage_lines',
  'stock_counts',
  'stock_count_lines',
  'imports',
  'import_rows',
  'audit_log',
] as const;
const sorted = (rows: Row[]) =>
  rows.sort((a, b) =>
    String(a.id ?? a.token_hash ?? a.item_id).localeCompare(
      String(b.id ?? b.token_hash ?? b.item_id),
    ),
  );
const digest = (rows: Row[], columns: string[]) =>
  createHash('sha256')
    .update(JSON.stringify(sorted(rows).map((row) => columns.map((column) => row[column]))))
    .digest('hex');

export async function copySQLite(source: DatabaseSync, target: Store) {
  if (target.dialect !== 'postgres') throw new Error('Migration target must be PostgreSQL.');
  const report: Record<string, { rows: number; sha256: string }> = {};
  await target.tx(async () => {
    for (const table of copyTables) {
      const rows = source.prepare('SELECT * FROM "' + table + '"').all() as Row[];
      const columns = source
        .prepare('PRAGMA table_info("' + table + '")')
        .all()
        .map((row) => String(row.name));
      const count = Number((await target.get('SELECT COUNT(*) total FROM "' + table + '"'))!.total);
      if (count !== 0)
        throw new Error('Migration target is not empty: ' + table + '. No records were changed.');
      for (let start = 0; start < rows.length; start += 500) {
        const batch = rows.slice(start, start + 500);
        const values = batch.flatMap((row) => columns.map((column) => row[column]));
        const markers = batch.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',');
        await target.run(
          'INSERT INTO "' +
            table +
            '" (' +
            columns.map((column) => '"' + column + '"').join(',') +
            ') VALUES ' +
            markers,
          ...values,
        );
      }
      const copied = await target.all('SELECT * FROM "' + table + '"');
      const sha256 = digest(rows, columns);
      if (copied.length !== rows.length || digest(copied, columns) !== sha256)
        throw new Error('Migration verification failed: ' + table);
      report[table] = { rows: rows.length, sha256 };
    }
  });
  return report;
}
