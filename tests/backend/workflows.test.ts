import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import { id, now } from '../../backend/src/db.js';
import { Store } from './test-store.js';
import { Ledger } from '../../backend/src/ledger.js';
import { Imports } from '../../backend/src/imports.js';
import { createApp } from '../../backend/src/app.js';
let s: Store, ledger: Ledger, imports: Imports, adminId: string, staffId: string;
let app: ReturnType<typeof createApp>,
  adminAgent: ReturnType<typeof supertest.agent>,
  staffAgent: ReturnType<typeof supertest.agent>;
let adminCSRF = '',
  staffCSRF = '';
const password = 'test-only-unique-password';
const origin = 'http://localhost:5173';
const event = (reference = id()) => ({
  key: id(),
  reference,
  reason: 'Isolated automated test',
  occurred_at: now(),
});
async function item(opts: Record<string, any> = {}) {
  const itemId = id();
  await s.run(
    'INSERT INTO inventory_items VALUES (?,?,?,?,?,?,?,?,?,?)',
    itemId,
    'TEST-' + itemId,
    'TEST ONLY ' + itemId,
    'Test',
    'piece',
    'Test shelf',
    2,
    20,
    0,
    0,
  );
  if (opts.base_unit)
    await s.run('UPDATE inventory_items SET base_unit=? WHERE id=?', opts.base_unit, itemId);
  if (opts.expiry) await s.run('UPDATE inventory_items SET expiry_tracking=1 WHERE id=?', itemId);
  return itemId;
}
async function opening(itemId: string, quantity = 10, expiry: string | null = null) {
  const i = (await s.get('SELECT * FROM inventory_items WHERE id=?', itemId))!;
  return await ledger.opening(
    itemId,
    { ...event(), quantity, unit: i.base_unit, batch_label: 'TEST opening', expiry_date: expiry },
    adminId,
  );
}
async function product(itemId?: string, quantity = 2, price = 0) {
  const productId = id();
  await s.run(
    'INSERT INTO menu_products VALUES (?,?,?,?,?,?,?)',
    productId,
    'MENU-' + productId,
    'TEST ' + productId,
    'test ' + productId,
    'Test',
    price,
    0,
  );
  if (itemId) {
    const recipeId = id(),
      versionId = id();
    await s.run('INSERT INTO recipes VALUES (?,?)', recipeId, productId);
    await s.run(
      'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
      versionId,
      recipeId,
      1,
      adminId,
      now(),
      'TEST',
    );
    const base = (await s.get('SELECT base_unit FROM inventory_items WHERE id=?', itemId))!
      .base_unit;
    await s.run(
      'INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)',
      id(),
      versionId,
      itemId,
      quantity,
      base,
    );
  }
  return productId;
}
function sale(productId: string, qty = 1, price = 0, reference = id()) {
  return {
    ...event(reference),
    lines: [
      {
        line_number: 1,
        product_id: productId,
        quantity: qty,
        unit_price: price,
        sales_amount: qty * price,
      },
    ],
  };
}
async function po(itemId: string, qty = 10) {
  const supplierId = id(),
    poId = id(),
    lineId = id();
  await s.run(
    'INSERT INTO suppliers VALUES (?,?,?,?,?,?)',
    supplierId,
    'TEST supplier',
    '',
    '',
    '',
    0,
  );
  await s.run(
    'INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)',
    poId,
    id(),
    supplierId,
    '2026-11-16',
    'ordered',
    adminId,
    now(),
  );
  await s.run('INSERT INTO purchase_order_lines VALUES (?,?,?,?,?)', lineId, poId, itemId, qty, 15);
  return { poId, lineId };
}
before(async () => {
  s = new Store(':memory:');
  ledger = new Ledger(s);
  imports = new Imports(s, ledger);
  adminId = id();
  staffId = id();
  const passwordHash = bcrypt.hashSync(password, 4);
  for (const [userId, role] of [
    [adminId, 'admin'],
    [staffId, 'staff'],
  ])
    await s.run(
      'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
      userId,
      role + '@test.local',
      role,
      passwordHash,
      role,
      1,
      now(),
    );
  app = createApp(s, { log: false, origin });
  adminAgent = supertest.agent(app);
  staffAgent = supertest.agent(app);
  const a = await adminAgent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email: 'admin@test.local', password });
  assert.equal(a.status, 200);
  adminCSRF = a.body.csrf;
  const b = await staffAgent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email: 'staff@test.local', password });
  assert.equal(b.status, 200);
  staffCSRF = b.body.csrf;
});
after(async () => await s.close());
test('proxy trust is limited to loopback and login limits remain per client', async () => {
  const trust = app.get('trust proxy fn');
  assert.equal(trust('127.0.0.1', 0), true);
  assert.equal(trust('::1', 0), true);
  assert.equal(trust('203.0.113.20', 0), false);
  for (let i = 1; i <= 12; i++) {
    const response = await supertest(app)
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-Forwarded-For', `198.51.100.${i}`)
      .send({ email: 'admin@test.local', password });
    assert.equal(
      response.status,
      200,
      'Independent forwarded clients must not share the loopback login limit',
    );
  }
  for (let i = 0; i < 11; i++) {
    const response = await supertest(app)
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-Forwarded-For', '203.0.113.71')
      .send({ email: 'admin@test.local', password: 'incorrect-password' });
    assert.equal(response.status, i < 10 ? 401 : 429);
  }
});
test('opening is unknown, required for posting, can be zero and cannot be duplicated', async () => {
  const i = await item();
  assert.equal((await ledger.balances(i)).balance, null);
  const p = await product(i);
  await assert.rejects(
    async () => await ledger.sale(sale(p), adminId),
    /opening stock not configured/,
  );
  const body = { ...event(), quantity: 0, unit: 'piece', batch_label: 'TEST' };
  await ledger.opening(i, body, adminId);
  assert.equal((await ledger.balances(i)).balance, 0);
  assert.equal((await ledger.opening(i, body, adminId)).duplicate, true);
  await assert.rejects(async () => await opening(i, 1), /already configured/);
});
test('ledger update/delete and immutable recipe edits are rejected by the database', async () => {
  const i = await item();
  await opening(i);
  const p = await product(i);
  const movement = (await s.get('SELECT id FROM stock_movements WHERE item_id=?', i))!;
  await assert.rejects(
    async () => await s.run('UPDATE stock_movements SET quantity=999 WHERE id=?', movement.id),
    /immutable/,
  );
  await assert.rejects(
    async () => await s.run('DELETE FROM stock_movements WHERE id=?', movement.id),
    /immutable/,
  );
  await assert.rejects(
    async () =>
      await s.run(
        'UPDATE recipe_versions SET reason=? WHERE id=(SELECT v.id FROM recipe_versions v JOIN recipes r ON r.id=v.recipe_id WHERE r.product_id=?)',
        'tamper',
        p,
      ),
    /immutable/,
  );
});
test('dimensional and explicit pack conversions; missing/incompatible conversions reject', async () => {
  const i = await item({ base_unit: 'g' });
  const row = await ledger.item(i, false);
  assert.equal(await ledger.convert(row, 1, 'kg'), 1000);
  await assert.rejects(async () => await ledger.convert(row, 1, 'ml'), /incompatible/);
  await assert.rejects(async () => await ledger.convert(row, 1, 'pack'), /not configured/);
  await s.run('INSERT INTO unit_conversions VALUES (?,?,?,?)', id(), i, 'pack', 500);
  assert.equal(await ledger.convert(row, 2, 'pack'), 1000);
});
test('receiving supports partial quantities, duplicate prevention and completion exactly once', async () => {
  const i = await item();
  await opening(i, 0);
  const { poId, lineId } = await po(i);
  assert.equal((await ledger.balances(i)).balance, 0);
  const receive = {
    ...event(),
    delivery_reference: id(),
    lines: [{ po_line_id: lineId, quantity: 4, unit: 'piece', batch_label: 'TEST delivery' }],
  };
  const result = await ledger.receive(poId, receive, staffId, 'staff');
  assert.equal((await ledger.balances(i)).balance, 4);
  assert.equal((await ledger.receive(poId, receive, staffId, 'staff')).duplicate, true);
  assert.equal((await ledger.balances(i)).balance, 4);
  assert.equal((await ledger.poDetail(poId)).status, 'partial');
  assert.equal((await ledger.poDetail(poId)).lines[0].remaining, 6);
  await assert.rejects(
    async () => await ledger.receive(poId, { ...receive, key: id() }, staffId, 'staff'),
    /already received/,
  );
  await ledger.receive(
    poId,
    {
      ...event(),
      delivery_reference: id(),
      lines: [
        { po_line_id: lineId, quantity: 6, unit: 'piece', batch_label: 'TEST second delivery' },
      ],
    },
    staffId,
    'staff',
  );
  assert.equal((await ledger.poDetail(poId)).status, 'complete');
  assert.equal((await ledger.balances(i)).balance, 10);
  await ledger.reverse(result.id, event(), adminId);
  assert.equal((await ledger.balances(i)).balance, 6);
  assert.equal((await ledger.poDetail(poId)).status, 'partial');
});
test('over-receipt needs an explicit admin reason and multi-line failure rolls back', async () => {
  const i = await item();
  await opening(i, 0);
  const { poId, lineId } = await po(i, 1);
  const b = {
    ...event(),
    delivery_reference: id(),
    over_receipt_reason: 'Approved extra',
    lines: [{ po_line_id: lineId, quantity: 2, unit: 'piece', batch_label: 'TEST' }],
  };
  await assert.rejects(
    async () => await ledger.receive(poId, b, staffId, 'staff'),
    /admin exception/,
  );
  assert.equal((await ledger.balances(i)).balance, 0);
  assert.equal(
    await s.get('SELECT 1 FROM receipts WHERE delivery_reference=?', b.delivery_reference),
    undefined,
  );
  await ledger.receive(poId, b, adminId, 'admin');
  assert.equal((await ledger.balances(i)).balance, 2);
});
test('zero-price sales consume the exact recipe, preserve version and are idempotent', async () => {
  const i = await item();
  await opening(i, 20);
  const p = await product(i, 2, 0);
  const b = sale(p, 3);
  const preview = await ledger.previewSale(b);
  assert.equal(preview.consumption[0].quantity, 6);
  assert.equal((await ledger.balances(i)).balance, 20);
  const result = await ledger.sale(b, adminId);
  assert.equal((await ledger.balances(i)).balance, 14);
  assert.equal((await ledger.sale(b, adminId)).duplicate, true);
  assert.equal((await ledger.balances(i)).balance, 14);
  assert.equal(
    (await s.get(
      'SELECT recipe_version_id FROM operational_sale_lines WHERE sale_id=?',
      result.id,
    ))!.recipe_version_id,
    preview.resolved[0].recipe_version_id,
  );
  await assert.rejects(
    async () => await ledger.sale({ ...b, reason: 'changed' }, adminId),
    /different input/,
  );
});
test('unmapped products and amount mismatches fail without writing partial sale records', async () => {
  const p = await product();
  const body = sale(p);
  await assert.rejects(async () => await ledger.sale(body, adminId), /recipe not configured/);
  assert.equal(
    await s.get('SELECT 1 FROM operational_sales WHERE transaction_reference=?', body.reference),
    undefined,
  );
  const i = await item();
  await opening(i);
  const mapped = await product(i);
  const b = sale(mapped, 1, 10);
  b.lines[0].sales_amount = 99;
  await assert.rejects(async () => await ledger.sale(b, adminId), /SalesAmount/);
  assert.equal((await ledger.balances(i)).balance, 10);
});
test('insufficient and expired stock fail atomically; FEFO excludes expired batches', async () => {
  const i = await item({ expiry: true });
  await opening(i, 50, '2000-01-01');
  const p = await product(i, 2);
  const b = sale(p);
  assert.equal((await ledger.previewSale(b)).can_post, false);
  await assert.rejects(async () => await ledger.sale(b, adminId), /Insufficient/);
  assert.equal((await ledger.balances(i)).balance, 50);
  assert.equal((await ledger.balances(i)).available, 0);
  const { poId, lineId } = await po(i, 20);
  for (const [qty, expiry] of [
    [6, '2099-02-01'],
    [8, '2099-01-01'],
  ] as const)
    await ledger.receive(
      poId,
      {
        ...event(),
        delivery_reference: id(),
        lines: [
          {
            po_line_id: lineId,
            quantity: qty,
            unit: 'piece',
            batch_label: expiry,
            expiry_date: expiry,
          },
        ],
      },
      adminId,
      'admin',
    );
  const result = await ledger.sale(sale(p, 5), adminId);
  const moves = await s.all(
    'SELECT m.quantity,b.expiry_date FROM stock_movements m JOIN stock_batches b ON b.id=m.batch_id WHERE event_id=? ORDER BY b.expiry_date',
    result.id,
  );
  assert.deepEqual(
    moves.map((r) => [r.quantity, r.expiry_date]),
    [
      [-8, '2099-01-01'],
      [-2, '2099-02-01'],
    ],
  );
  assert.equal((await ledger.balances(i)).expired, 50);
});
test('wastage consumes stock; physical counts preview signed differences and reject stale counts', async () => {
  const i = await item();
  await opening(i, 10);
  await ledger.waste(
    { ...event(), category: 'Damage', lines: [{ item_id: i, quantity: 3, unit: 'piece' }] },
    staffId,
  );
  assert.equal((await ledger.balances(i)).balance, 7);
  const batch = (await ledger.batches(i))[0];
  const body = {
    ...event(),
    lines: [{ item_id: i, batch_id: batch.id, counted: 5, expected_book: 7, unit: 'piece' }],
  };
  assert.equal((await ledger.previewCount(body)).lines[0].delta, -2);
  await ledger.count(body, staffId);
  assert.equal((await ledger.balances(i)).balance, 5);
  assert.equal((await ledger.count(body, staffId)).duplicate, true);
  await assert.rejects(
    async () => await ledger.count({ ...body, key: id() }, staffId),
    /Stock changed/,
  );
  await ledger.count(
    {
      ...event(),
      lines: [{ item_id: i, batch_id: batch.id, counted: 8, expected_book: 5, unit: 'piece' }],
    },
    staffId,
  );
  assert.equal((await ledger.balances(i)).balance, 8);
});
test('void restores stock through linked reversals; double void and consumed receipt reversal are blocked', async () => {
  const i = await item();
  await opening(i, 0);
  const p = await product(i, 2);
  const { poId, lineId } = await po(i);
  const receipt = await ledger.receive(
    poId,
    {
      ...event(),
      delivery_reference: id(),
      lines: [{ po_line_id: lineId, quantity: 10, unit: 'piece', batch_label: 'TEST' }],
    },
    adminId,
    'admin',
  );
  const posted = await ledger.sale(sale(p, 2), adminId);
  assert.equal((await ledger.balances(i)).balance, 6);
  await assert.rejects(
    async () => await ledger.reverse(receipt.id, event(), adminId),
    /already consumed/,
  );
  const reversed = await ledger.reverse(posted.id, event(), adminId);
  assert.equal((await ledger.balances(i)).balance, 10);
  assert.ok(
    await s.get(
      'SELECT 1 FROM stock_movements WHERE event_id=? AND reverses_movement_id IS NOT NULL',
      reversed.id,
    ),
  );
  await assert.rejects(async () => await ledger.reverse(posted.id, event(), adminId));
  assert.equal((await ledger.balances(i)).balance, 10);
  assert.ok(await s.get('SELECT 1 FROM operational_sales WHERE id=?', posted.id));
});
test('catalog imports keep only distinct names/categories and preserve price and recipe on reimport', async () => {
  const content =
    'TransactionID,ProductName,Category,Qty,UnitPrice,SalesAmount\n1,TEST Catalog Freebie,Promo,2,999,1998\n1,TEST Catalog Freebie,Promo,3,888,2664\n';
  const beforeMovements = (await s.get('SELECT COUNT(*) n FROM stock_movements'))!.n;
  const beforeSales = (await s.get('SELECT COUNT(*) n FROM operational_sales'))!.n;
  const uploaded = await imports.upload('catalog', 'test.csv', content, adminId);
  assert.equal(uploaded.summary.unique_products, 1);
  await imports.confirm(uploaded.id, adminId);
  const p = (await s.get(
    'SELECT * FROM menu_products WHERE source_name=?',
    'TEST Catalog Freebie',
  ))!;
  assert.equal(p.selling_price, null);
  await s.run('UPDATE menu_products SET selling_price=0 WHERE id=?', p.id);
  const recipeId = id(),
    versionId = id();
  await s.run('INSERT INTO recipes VALUES (?,?)', recipeId, p.id);
  await s.run(
    'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
    versionId,
    recipeId,
    1,
    adminId,
    now(),
    'Confirmed manually',
  );
  const existingItem = (await s.get('SELECT id,base_unit FROM inventory_items LIMIT 1'))!;
  await s.run(
    'INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)',
    id(),
    versionId,
    existingItem.id,
    1,
    existingItem.base_unit,
  );
  const same = await imports.upload('catalog', 'renamed.csv', content, adminId);
  assert.equal(same.id, uploaded.id);
  assert.equal((await imports.confirm(same.id, adminId)).duplicate, true);
  const different = await imports.upload(
    'catalog',
    'reexport.csv',
    content + '2,TEST Catalog Freebie,Promo,1,123,123\n',
    adminId,
  );
  await imports.confirm(different.id, adminId);
  assert.equal(
    (await s.get('SELECT selling_price FROM menu_products WHERE id=?', p.id))!.selling_price,
    0,
  );
  assert.equal(
    (await s.get('SELECT id FROM recipe_versions WHERE recipe_id=?', recipeId))!.id,
    versionId,
  );
  const raw = (await s.get('SELECT payload FROM imports WHERE id=?', uploaded.id))!.payload;
  assert.ok(!raw.includes('UnitPrice') && !raw.includes('TransactionID') && !raw.includes('999'));
  assert.equal((await s.get('SELECT COUNT(*) n FROM stock_movements'))!.n, beforeMovements);
  assert.equal((await s.get('SELECT COUNT(*) n FROM operational_sales'))!.n, beforeSales);
});
test('catalog category conflicts require review and rejected-row report is downloadable', async () => {
  const uploaded = await imports.upload(
    'catalog',
    'conflict.csv',
    'ProductName,Category\nTEST conflicting,A\nTEST conflicting,B\n',
    adminId,
  );
  assert.equal(uploaded.error_count, 1);
  await assert.rejects(async () => await imports.confirm(uploaded.id, adminId), /Resolve all/);
  assert.match(await imports.rejected(uploaded.id), /Category conflict/);
});
test('operational CSV retains distinct same-transaction lines and file/row idempotency', async () => {
  const i = await item();
  await opening(i, 100);
  const p = await product(i, 2);
  const ref = id();
  const content = `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\n${ref},${now()},1,${p},2,0,0\n${ref},${now()},2,${p},3,0,0\n`;
  // All lines of a transaction use an identical timestamp.
  const timestamp = now();
  const fixed = content.replace(/\d{4}-\d\d-\d\dT[^,]+/g, timestamp);
  const up = await imports.upload('sales', 'real.csv', fixed, adminId);
  assert.equal(up.error_count, 0);
  assert.equal((await ledger.balances(i)).balance, 100);
  await imports.confirm(up.id, adminId);
  assert.equal((await ledger.balances(i)).balance, 90);
  assert.equal(
    (await s.get(
      'SELECT COUNT(*) n FROM operational_sale_lines WHERE sale_id=(SELECT id FROM operational_sales WHERE transaction_reference=?)',
      ref,
    ))!.n,
    2,
  );
  assert.equal((await imports.confirm(up.id, adminId)).duplicate, true);
  const duplicate = await imports.upload('sales', 'again.csv', fixed, adminId);
  assert.equal(duplicate.id, up.id);
  const overlap = await imports.upload('sales', 'overlap.csv', fixed + '\n', adminId);
  assert.ok(overlap.error_count > 0);
  await assert.rejects(async () => await imports.confirm(overlap.id, adminId), /Resolve all/);
  assert.equal((await ledger.balances(i)).balance, 90);
});
test('whole-file stock shortages and synthetic undated input reject operational import', async () => {
  const i = await item();
  await opening(i, 5);
  const p = await product(i, 2);
  const content = `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\n${id()},${now()},1,${p},2,0,0\n${id()},${now()},1,${p},2,0,0\n`;
  const up = await imports.upload('sales', 'short.csv', content, adminId);
  assert.ok(up.error_count > 0);
  await assert.rejects(async () => await imports.confirm(up.id, adminId), /Resolve all/);
  assert.equal((await ledger.balances(i)).balance, 5);
  await assert.rejects(
    imports.upload(
      'sales',
      'synthetic.csv',
      'TransactionID,ProductName,Category,Qty,UnitPrice,SalesAmount\n1,X,Y,1,0,0',
      adminId,
    ),
    /Required columns/,
  );
});
test('authorization denies staff administration and enforces CSRF and exact Origin', async () => {
  for (const path of [
    '/users',
    '/products',
    '/suppliers',
    '/sales',
    '/imports',
    '/settings',
    '/audit',
  ])
    assert.equal((await staffAgent.get('/api' + path)).status, 403, path);
  for (const path of ['/inventory', '/products', '/purchase-orders', '/sales', '/imports/preview'])
    assert.equal(
      (
        await staffAgent
          .post('/api' + path)
          .set('X-CSRF-Token', staffCSRF)
          .send({})
      ).status,
      403,
      path,
    );
  assert.equal((await adminAgent.post('/api/inventory').send({})).status, 403);
  assert.equal(
    (
      await adminAgent
        .post('/api/inventory')
        .set('X-CSRF-Token', adminCSRF)
        .set('Origin', 'https://evil.example')
        .send({})
    ).status,
    403,
  );
  assert.equal((await supertest(app).get('/api/inventory')).status, 401);
});
test('API creates items, validates input and keeps all main resources reachable', async () => {
  const malformed = await adminAgent
    .post('/api/imports/preview')
    .set('X-CSRF-Token', adminCSRF)
    .send({
      kind: 'catalog',
      filename: 'malformed.csv',
      content: 'ProductName,Category\n"Unclosed,Category',
    });
  assert.equal(malformed.status, 422);
  const r = await adminAgent
    .post('/api/inventory')
    .set('X-CSRF-Token', adminCSRF)
    .send({
      sku: 'API-' + id(),
      name: 'TEST API item',
      category: 'Test',
      base_unit: 'g',
      location: 'Test',
      reorder_point: 1,
      target: 10,
      expiry_tracking: false,
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await adminAgent.get('/api/inventory?q=TEST%20API%20item');
  assert.equal(list.body.rows[0].balance, null);
  assert.equal(
    (
      await adminAgent
        .post('/api/inventory')
        .set('X-CSRF-Token', adminCSRF)
        .send({ sku: 'Invalid', reorder_point: -1 })
    ).status,
    422,
  );
  for (const path of [
    '/dashboard',
    '/lookups',
    '/inventory',
    '/products',
    '/suppliers',
    '/purchase-orders',
    '/movements',
    '/events',
    '/sales',
    '/imports',
    '/users',
    '/settings',
    '/audit',
    '/reports/stock',
    '/reports/low-stock',
    '/reports/receipts',
    '/reports/usage',
    '/reports/expiry',
  ])
    assert.equal((await adminAgent.get('/api' + path)).status, 200, path);
  assert.equal((await adminAgent.get('/api/reports/stock?format=csv')).type, 'text/csv');
});
test('simultaneous conflicting HTTP sales cannot drive stock negative; simultaneous retries post once', async () => {
  const i = await item();
  await opening(i, 3);
  const p = await product(i, 2);
  const a = sale(p),
    b = sale(p);
  const results = await Promise.all(
    [a, b].map((body) => adminAgent.post('/api/sales').set('X-CSRF-Token', adminCSRF).send(body)),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await ledger.balances(i)).balance, 1);
  const j = await item();
  await opening(j, 10);
  const q = await product(j, 2);
  const body = sale(q);
  const retries = await Promise.all(
    Array.from({ length: 4 }, () =>
      adminAgent.post('/api/sales').set('X-CSRF-Token', adminCSRF).send(body),
    ),
  );
  assert.ok(retries.every((r) => r.status === 200));
  assert.equal((await ledger.balances(j)).balance, 8);
  assert.equal(retries.filter((r) => r.body.duplicate).length, 3);
});
test('last administrator and expired sessions are protected', async () => {
  const update = await adminAgent
    .put('/api/users/' + adminId)
    .set('X-CSRF-Token', adminCSRF)
    .send({ name: 'admin', role: 'staff', active: true });
  assert.equal(update.status, 422);
  await s.run(
    'UPDATE sessions SET expires_at=? WHERE user_id=?',
    '2000-01-01T00:00:00.000Z',
    staffId,
  );
  assert.equal((await staffAgent.get('/api/inventory')).status, 401);
});
test('user creation, self password change, session revocation and disabled account checks', async () => {
  const email = `staff-${id()}@test.local`;
  const created = await adminAgent
    .post('/api/users')
    .set('X-CSRF-Token', adminCSRF)
    .send({ email, name: 'TEST account', role: 'staff', password });
  assert.equal(created.status, 201);
  assert.equal(
    bcrypt.getRounds(
      (await s.get('SELECT password_hash FROM users WHERE id=?', created.body.id))!.password_hash,
    ),
    12,
  );
  const agent = supertest.agent(app);
  const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email, password });
  assert.equal(login.status, 200);
  const changed = await agent
    .post('/api/auth/password')
    .set('X-CSRF-Token', login.body.csrf)
    .send({ current_password: password, password: password + '-new' });
  assert.equal(changed.status, 200);
  assert.equal((await agent.get('/api/inventory')).status, 401);
  const relogin = await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email, password: password + '-new' });
  assert.equal(relogin.status, 200);
  const disabled = await adminAgent
    .put('/api/users/' + created.body.id)
    .set('X-CSRF-Token', adminCSRF)
    .send({ name: 'TEST account', role: 'staff', active: false });
  assert.equal(disabled.status, 200);
  assert.equal((await agent.get('/api/inventory')).status, 401);
  assert.equal((await adminAgent.get('/api/' + ['historical', 'sales'].join('-'))).status, 404);
});
test('versioned migrations and ledger data persist across closing and reopening a real SQLite file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'utb-test-'));
  const path = join(dir, 'test.sqlite');
  try {
    let disk = new Store(path);
    const u = id();
    await disk.run(
      'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
      u,
      'disk@test.local',
      'Test',
      'disabled',
      'admin',
      0,
      now(),
    );
    const inv = id();
    await disk.run(
      'INSERT INTO inventory_items VALUES (?,?,?,?,?,?,?,?,?,?)',
      inv,
      'PERSIST',
      'TEST Persistence',
      'Test',
      'piece',
      'Shelf',
      1,
      10,
      0,
      0,
    );
    await new Ledger(disk).opening(
      inv,
      { ...event(), quantity: 7, unit: 'piece', batch_label: 'TEST' },
      u,
    );
    await disk.close();
    disk = new Store(path);
    assert.equal((await new Ledger(disk).balances(inv)).balance, 7);
    assert.equal(
      Number((await disk.get('SELECT COUNT(*) n FROM schema_migrations'))!.n),
      disk.dialect === 'sqlite' ? 3 : 1,
    );
    if (disk.dialect === 'sqlite') {
      assert.equal((await disk.get('PRAGMA foreign_keys'))!.foreign_keys, 1);
      assert.equal((await disk.get('PRAGMA journal_mode'))!.journal_mode, 'wal');
    }
    await disk.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('supplied 78k-row file is processed as catalog metadata only when source is supplied', async (t) => {
  const path = process.env.UTB_CATALOG_SOURCE;
  if (!path) {
    t.skip('Set UTB_CATALOG_SOURCE to validate the supplied private source file.');
    return;
  }
  const isolated = new Store(':memory:');
  try {
    const u = id();
    await isolated.run(
      'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
      u,
      'source@test.local',
      'TEST',
      'disabled',
      'admin',
      0,
      now(),
    );
    const imp = new Imports(isolated, new Ledger(isolated));
    const preview = await imp.upload(
      'catalog',
      'UTB-Datasheet-2023-ProductSales.csv',
      readFileSync(path, 'utf8'),
      u,
    );
    assert.deepEqual(preview.summary, {
      rows: 78310,
      unique_products: 151,
      source_distinct_names: 153,
      categories: 25,
      errors: 0,
    });
    await imp.confirm(preview.id, u);
    assert.equal((await isolated.get('SELECT COUNT(*) n FROM menu_products'))!.n, 151);
    for (const table of ['operational_sales', 'inventory_items', 'stock_movements'])
      assert.equal((await isolated.get(`SELECT COUNT(*) n FROM ${table}`))!.n, 0);
    assert.equal(
      (await isolated.get('SELECT COUNT(*) n FROM menu_products WHERE selling_price IS NOT NULL'))!
        .n,
      0,
    );
    assert.ok(await isolated.get("SELECT 1 FROM menu_products WHERE source_name='Free Pudding'"));
  } finally {
    await isolated.close();
  }
});
