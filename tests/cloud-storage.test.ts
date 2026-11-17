import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Store, id, now, type SQLBackend } from '../backend/src/db.js';
import { Ledger } from '../backend/src/ledger.js';
import { Imports } from '../backend/src/imports.js';
import { CSVUploads } from '../backend/src/csv-uploads.js';
import { copySQLite, copyTables } from '../backend/src/copy-sqlite.js';
import { DatabaseRateLimitStore } from '../backend/src/rate-limit.js';

test('SQLite copy preserves records, credentials, ledger and identifiers and refuses nonempty targets', async () => {
  const source = new Store(':memory:');
  const target = new Store({ postgres: new PGlite() as SQLBackend, initialize: true });
  try {
    const user = id(),
      item = id(),
      product = id(),
      recipe = id(),
      version = id();
    await source.run(
      'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
      user,
      'test-migration@invalid.local',
      'TEST ONLY',
      'test-hash-preserved',
      'admin',
      1,
      now(),
    );
    await source.run(
      'INSERT INTO inventory_items VALUES (?,?,?,?,?,?,?,?,?,?)',
      item,
      'TEST-MIGRATION',
      'TEST ONLY',
      'Test',
      'piece',
      'Shelf',
      0,
      20,
      0,
      0,
    );
    const ledger = new Ledger(source);
    await ledger.opening(
      item,
      {
        key: id(),
        reference: 'TEST opening',
        reason: 'Isolated test',
        occurred_at: now(),
        quantity: 10,
        unit: 'piece',
        batch_label: 'TEST',
      },
      user,
    );
    await source.run(
      'INSERT INTO menu_products VALUES (?,?,?,?,?,?,?)',
      product,
      'TEST-MENU',
      'TEST menu',
      'test menu',
      'Test',
      0,
      0,
    );
    await source.run('INSERT INTO recipes VALUES (?,?)', recipe, product);
    await source.run(
      'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
      version,
      recipe,
      1,
      user,
      now(),
      'TEST',
    );
    await source.run(
      'INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)',
      id(),
      version,
      item,
      2,
      'piece',
    );
    const sale = await ledger.sale(
      {
        key: id(),
        reference: 'TEST sale',
        reason: 'Isolated test',
        occurred_at: now(),
        lines: [
          { line_number: 1, product_id: product, quantity: 1, unit_price: 0, sales_amount: 0 },
        ],
      },
      user,
    );
    const report = await copySQLite(source.db!, target);
    assert.equal(Object.keys(report).length, copyTables.length);
    assert.equal(
      (await target.get('SELECT password_hash FROM users WHERE id=?', user))!.password_hash,
      'test-hash-preserved',
    );
    assert.equal((await new Ledger(target).balances(item)).available, 8);
    assert.equal(
      (await target.get(
        'SELECT recipe_version_id FROM operational_sale_lines WHERE sale_id=?',
        sale.id,
      ))!.recipe_version_id,
      version,
    );
    await assert.rejects(copySQLite(source.db!, target), /not empty/);
    assert.equal((await new Ledger(source).balances(item)).available, 8);
  } finally {
    await source.close();
    await target.close();
  }
});

for (const dialect of ['sqlite', 'postgres'])
  test(
    'staged CSV upload is owned, complete, retry-safe and catalog-only on ' + dialect,
    async () => {
      const store =
        dialect === 'sqlite'
          ? new Store(':memory:')
          : new Store({ postgres: new PGlite() as SQLBackend, initialize: true });
      try {
        const actor = id(),
          other = id();
        for (const user of [actor, other])
          await store.run(
            'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
            user,
            user + '@invalid.local',
            'TEST',
            'test-hash',
            'admin',
            1,
            now(),
          );
        const uploads = new CSVUploads(store, new Imports(store, new Ledger(store)));
        const upload = await uploads.begin(
          { kind: 'catalog', filename: 'test.csv', chunks: 2 },
          actor,
        );
        const first = 'ProductName,Category,Qty,UnitPrice,SalesAmount\n';
        await uploads.chunk(upload.id, 0, { content: first }, actor);
        await uploads.chunk(upload.id, 0, { content: first }, actor);
        await assert.rejects(uploads.chunk(upload.id, 0, { content: 'changed' }, actor), /changed/);
        await assert.rejects(
          uploads.chunk(upload.id, 1, { content: 'TEST,Test,5,10,50\n' }, other),
          /missing or expired/,
        );
        await assert.rejects(uploads.preview(upload.id, actor), /incomplete/);
        await uploads.chunk(upload.id, 1, { content: 'TEST,Test,5,10,50\n' }, actor);
        const preview = await uploads.preview(upload.id, actor);
        assert.equal(preview.summary.unique_products, 1);
        assert.equal(await store.get('SELECT 1 FROM csv_uploads WHERE id=?', upload.id), undefined);
        const row = await store.get(
          'SELECT row_data FROM import_rows WHERE import_id=?',
          preview.id,
        );
        assert.deepEqual(JSON.parse(row!.row_data), { ProductName: 'TEST', Category: 'Test' });
        assert.equal(Number((await store.get('SELECT COUNT(*) n FROM posted_events'))!.n), 0);
      } finally {
        await store.close();
      }
    },
  );

test('hosted login counters are shared across limiter instances and store hashed keys', async () => {
  const store = new Store({ postgres: new PGlite() as SQLBackend, initialize: true });
  try {
    const a = new DatabaseRateLimitStore(store),
      b = new DatabaseRateLimitStore(store);
    const hits = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).increment('TEST-CLIENT')),
    );
    assert.deepEqual(
      hits.map((x) => x.totalHits).sort((a, b) => a - b),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    assert.notEqual((await store.get('SELECT key FROM auth_rate_limits'))!.key, 'TEST-CLIENT');
  } finally {
    await store.close();
  }
});
