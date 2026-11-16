import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import { Store, id, now } from '../src/db.js';
import { Ledger } from '../src/ledger.js';
import { Imports } from '../src/imports.js';
import { createApp } from '../src/app.js';

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
function item(opts: Record<string, any> = {}) {
  const itemId = id();
  s.run(
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
    s.run('UPDATE inventory_items SET base_unit=? WHERE id=?', opts.base_unit, itemId);
  if (opts.expiry) s.run('UPDATE inventory_items SET expiry_tracking=1 WHERE id=?', itemId);
  return itemId;
}
function opening(itemId: string, quantity = 10, expiry: string | null = null) {
  const i = s.get('SELECT * FROM inventory_items WHERE id=?', itemId)!;
  return ledger.opening(
    itemId,
    { ...event(), quantity, unit: i.base_unit, batch_label: 'TEST opening', expiry_date: expiry },
    adminId,
  );
}
function product(itemId?: string, quantity = 2, price = 0) {
  const productId = id();
  s.run(
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
    s.run('INSERT INTO recipes VALUES (?,?)', recipeId, productId);
    s.run(
      'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
      versionId,
      recipeId,
      1,
      adminId,
      now(),
      'TEST',
    );
    const base = s.get('SELECT base_unit FROM inventory_items WHERE id=?', itemId)!.base_unit;
    s.run(
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
function po(itemId: string, qty = 10) {
  const supplierId = id(),
    poId = id(),
    lineId = id();
  s.run('INSERT INTO suppliers VALUES (?,?,?,?,?,?)', supplierId, 'TEST supplier', '', '', '', 0);
  s.run(
    'INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)',
    poId,
    id(),
    supplierId,
    '2026-11-16',
    'ordered',
    adminId,
    now(),
  );
  s.run('INSERT INTO purchase_order_lines VALUES (?,?,?,?,?)', lineId, poId, itemId, qty, 15);
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
    s.run(
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
after(() => s.close());

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

test('opening is unknown, required for posting, can be zero and cannot be duplicated', () => {
  const i = item();
  assert.equal(ledger.balances(i).balance, null);
  const p = product(i);
  assert.throws(() => ledger.sale(sale(p), adminId), /opening stock not configured/);
  const body = { ...event(), quantity: 0, unit: 'piece', batch_label: 'TEST' };
  ledger.opening(i, body, adminId);
  assert.equal(ledger.balances(i).balance, 0);
  assert.equal(ledger.opening(i, body, adminId).duplicate, true);
  assert.throws(() => opening(i, 1), /already configured/);
});
test('ledger update/delete and immutable recipe edits are rejected by the database', () => {
  const i = item();
  opening(i);
  const p = product(i);
  const movement = s.get('SELECT id FROM stock_movements WHERE item_id=?', i)!;
  assert.throws(
    () => s.run('UPDATE stock_movements SET quantity=999 WHERE id=?', movement.id),
    /immutable/,
  );
  assert.throws(() => s.run('DELETE FROM stock_movements WHERE id=?', movement.id), /immutable/);
  assert.throws(
    () =>
      s.run(
        'UPDATE recipe_versions SET reason=? WHERE id=(SELECT v.id FROM recipe_versions v JOIN recipes r ON r.id=v.recipe_id WHERE r.product_id=?)',
        'tamper',
        p,
      ),
    /immutable/,
  );
});
test('dimensional and explicit pack conversions; missing/incompatible conversions reject', () => {
  const i = item({ base_unit: 'g' });
  const row = ledger.item(i, false);
  assert.equal(ledger.convert(row, 1, 'kg'), 1000);
  assert.throws(() => ledger.convert(row, 1, 'ml'), /incompatible/);
  assert.throws(() => ledger.convert(row, 1, 'pack'), /not configured/);
  s.run('INSERT INTO unit_conversions VALUES (?,?,?,?)', id(), i, 'pack', 500);
  assert.equal(ledger.convert(row, 2, 'pack'), 1000);
});
test('receiving supports partial quantities, duplicate prevention and completion exactly once', () => {
  const i = item();
  opening(i, 0);
  const { poId, lineId } = po(i);
  assert.equal(ledger.balances(i).balance, 0);
  const receive = {
    ...event(),
    delivery_reference: id(),
    lines: [{ po_line_id: lineId, quantity: 4, unit: 'piece', batch_label: 'TEST delivery' }],
  };
  const result = ledger.receive(poId, receive, staffId, 'staff');
  assert.equal(ledger.balances(i).balance, 4);
  assert.equal(ledger.receive(poId, receive, staffId, 'staff').duplicate, true);
  assert.equal(ledger.balances(i).balance, 4);
  assert.equal(ledger.poDetail(poId).status, 'partial');
  assert.equal(ledger.poDetail(poId).lines[0].remaining, 6);
  assert.throws(
    () => ledger.receive(poId, { ...receive, key: id() }, staffId, 'staff'),
    /already received/,
  );
  ledger.receive(
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
  assert.equal(ledger.poDetail(poId).status, 'complete');
  assert.equal(ledger.balances(i).balance, 10);
  ledger.reverse(result.id, event(), adminId);
  assert.equal(ledger.balances(i).balance, 6);
  assert.equal(ledger.poDetail(poId).status, 'partial');
});
test('over-receipt needs an explicit admin reason and multi-line failure rolls back', () => {
  const i = item();
  opening(i, 0);
  const { poId, lineId } = po(i, 1);
  const b = {
    ...event(),
    delivery_reference: id(),
    over_receipt_reason: 'Approved extra',
    lines: [{ po_line_id: lineId, quantity: 2, unit: 'piece', batch_label: 'TEST' }],
  };
  assert.throws(() => ledger.receive(poId, b, staffId, 'staff'), /admin exception/);
  assert.equal(ledger.balances(i).balance, 0);
  assert.equal(
    s.get('SELECT 1 FROM receipts WHERE delivery_reference=?', b.delivery_reference),
    undefined,
  );
  ledger.receive(poId, b, adminId, 'admin');
  assert.equal(ledger.balances(i).balance, 2);
});
test('zero-price sales consume the exact recipe, preserve version and are idempotent', () => {
  const i = item();
  opening(i, 20);
  const p = product(i, 2, 0);
  const b = sale(p, 3);
  const preview = ledger.previewSale(b);
  assert.equal(preview.consumption[0].quantity, 6);
  assert.equal(ledger.balances(i).balance, 20);
  const result = ledger.sale(b, adminId);
  assert.equal(ledger.balances(i).balance, 14);
  assert.equal(ledger.sale(b, adminId).duplicate, true);
  assert.equal(ledger.balances(i).balance, 14);
  assert.equal(
    s.get('SELECT recipe_version_id FROM operational_sale_lines WHERE sale_id=?', result.id)!
      .recipe_version_id,
    preview.resolved[0].recipe_version_id,
  );
  assert.throws(() => ledger.sale({ ...b, reason: 'changed' }, adminId), /different input/);
});
test('unmapped products and amount mismatches fail without writing partial sale records', () => {
  const p = product();
  const body = sale(p);
  assert.throws(() => ledger.sale(body, adminId), /recipe not configured/);
  assert.equal(
    s.get('SELECT 1 FROM operational_sales WHERE transaction_reference=?', body.reference),
    undefined,
  );
  const i = item();
  opening(i);
  const mapped = product(i);
  const b = sale(mapped, 1, 10);
  b.lines[0].sales_amount = 99;
  assert.throws(() => ledger.sale(b, adminId), /SalesAmount/);
  assert.equal(ledger.balances(i).balance, 10);
});
test('insufficient and expired stock fail atomically; FEFO excludes expired batches', () => {
  const i = item({ expiry: true });
  opening(i, 50, '2000-01-01');
  const p = product(i, 2);
  const b = sale(p);
  assert.equal(ledger.previewSale(b).can_post, false);
  assert.throws(() => ledger.sale(b, adminId), /Insufficient/);
  assert.equal(ledger.balances(i).balance, 50);
  assert.equal(ledger.balances(i).available, 0);
  const { poId, lineId } = po(i, 20);
  for (const [qty, expiry] of [
    [6, '2099-02-01'],
    [8, '2099-01-01'],
  ] as const)
    ledger.receive(
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
  const result = ledger.sale(sale(p, 5), adminId);
  const moves = s.all(
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
  assert.equal(ledger.balances(i).expired, 50);
});
test('wastage consumes stock; physical counts preview signed differences and reject stale counts', () => {
  const i = item();
  opening(i, 10);
  ledger.waste(
    { ...event(), category: 'Damage', lines: [{ item_id: i, quantity: 3, unit: 'piece' }] },
    staffId,
  );
  assert.equal(ledger.balances(i).balance, 7);
  const batch = ledger.batches(i)[0];
  const body = {
    ...event(),
    lines: [{ item_id: i, batch_id: batch.id, counted: 5, expected_book: 7, unit: 'piece' }],
  };
  assert.equal(ledger.previewCount(body).lines[0].delta, -2);
  ledger.count(body, staffId);
  assert.equal(ledger.balances(i).balance, 5);
  assert.equal(ledger.count(body, staffId).duplicate, true);
  assert.throws(() => ledger.count({ ...body, key: id() }, staffId), /Stock changed/);
  ledger.count(
    {
      ...event(),
      lines: [{ item_id: i, batch_id: batch.id, counted: 8, expected_book: 5, unit: 'piece' }],
    },
    staffId,
  );
  assert.equal(ledger.balances(i).balance, 8);
});
test('void restores stock through linked reversals; double void and consumed receipt reversal are blocked', () => {
  const i = item();
  opening(i, 0);
  const p = product(i, 2);
  const { poId, lineId } = po(i);
  const receipt = ledger.receive(
    poId,
    {
      ...event(),
      delivery_reference: id(),
      lines: [{ po_line_id: lineId, quantity: 10, unit: 'piece', batch_label: 'TEST' }],
    },
    adminId,
    'admin',
  );
  const posted = ledger.sale(sale(p, 2), adminId);
  assert.equal(ledger.balances(i).balance, 6);
  assert.throws(() => ledger.reverse(receipt.id, event(), adminId), /already consumed/);
  const reversed = ledger.reverse(posted.id, event(), adminId);
  assert.equal(ledger.balances(i).balance, 10);
  assert.ok(
    s.get(
      'SELECT 1 FROM stock_movements WHERE event_id=? AND reverses_movement_id IS NOT NULL',
      reversed.id,
    ),
  );
  assert.throws(() => ledger.reverse(posted.id, event(), adminId));
  assert.equal(ledger.balances(i).balance, 10);
  assert.ok(s.get('SELECT 1 FROM operational_sales WHERE id=?', posted.id));
});
test('catalog imports keep only distinct names/categories and preserve price and recipe on reimport', async () => {
  const content =
    'TransactionID,ProductName,Category,Qty,UnitPrice,SalesAmount\n1,TEST Catalog Freebie,Promo,2,999,1998\n1,TEST Catalog Freebie,Promo,3,888,2664\n';
  const beforeMovements = s.get('SELECT COUNT(*) n FROM stock_movements')!.n;
  const beforeSales = s.get('SELECT COUNT(*) n FROM operational_sales')!.n;
  const uploaded = await imports.upload('catalog', 'test.csv', content, adminId);
  assert.equal(uploaded.summary.unique_products, 1);
  imports.confirm(uploaded.id, adminId);
  const p = s.get('SELECT * FROM menu_products WHERE source_name=?', 'TEST Catalog Freebie')!;
  assert.equal(p.selling_price, null);
  s.run('UPDATE menu_products SET selling_price=0 WHERE id=?', p.id);
  const recipeId = id(),
    versionId = id();
  s.run('INSERT INTO recipes VALUES (?,?)', recipeId, p.id);
  s.run(
    'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
    versionId,
    recipeId,
    1,
    adminId,
    now(),
    'Confirmed manually',
  );
  const existingItem = s.get('SELECT id,base_unit FROM inventory_items LIMIT 1')!;
  s.run(
    'INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)',
    id(),
    versionId,
    existingItem.id,
    1,
    existingItem.base_unit,
  );
  const same = await imports.upload('catalog', 'renamed.csv', content, adminId);
  assert.equal(same.id, uploaded.id);
  assert.equal(imports.confirm(same.id, adminId).duplicate, true);
  const different = await imports.upload(
    'catalog',
    'reexport.csv',
    content + '2,TEST Catalog Freebie,Promo,1,123,123\n',
    adminId,
  );
  imports.confirm(different.id, adminId);
  assert.equal(s.get('SELECT selling_price FROM menu_products WHERE id=?', p.id)!.selling_price, 0);
  assert.equal(s.get('SELECT id FROM recipe_versions WHERE recipe_id=?', recipeId)!.id, versionId);
  const raw = s.get('SELECT payload FROM imports WHERE id=?', uploaded.id)!.payload;
  assert.ok(!raw.includes('UnitPrice') && !raw.includes('TransactionID') && !raw.includes('999'));
  assert.equal(s.get('SELECT COUNT(*) n FROM stock_movements')!.n, beforeMovements);
  assert.equal(s.get('SELECT COUNT(*) n FROM operational_sales')!.n, beforeSales);
});
test('catalog category conflicts require review and rejected-row report is downloadable', async () => {
  const uploaded = await imports.upload(
    'catalog',
    'conflict.csv',
    'ProductName,Category\nTEST conflicting,A\nTEST conflicting,B\n',
    adminId,
  );
  assert.equal(uploaded.error_count, 1);
  assert.throws(() => imports.confirm(uploaded.id, adminId), /Resolve all/);
  assert.match(imports.rejected(uploaded.id), /Category conflict/);
});
test('operational CSV retains distinct same-transaction lines and file/row idempotency', async () => {
  const i = item();
  opening(i, 100);
  const p = product(i, 2);
  const ref = id();
  const content = `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\n${ref},${now()},1,${p},2,0,0\n${ref},${now()},2,${p},3,0,0\n`;
  // All lines of a transaction use an identical timestamp.
  const timestamp = now();
  const fixed = content.replace(/\d{4}-\d\d-\d\dT[^,]+/g, timestamp);
  const up = await imports.upload('sales', 'real.csv', fixed, adminId);
  assert.equal(up.error_count, 0);
  assert.equal(ledger.balances(i).balance, 100);
  imports.confirm(up.id, adminId);
  assert.equal(ledger.balances(i).balance, 90);
  assert.equal(
    s.get(
      'SELECT COUNT(*) n FROM operational_sale_lines WHERE sale_id=(SELECT id FROM operational_sales WHERE transaction_reference=?)',
      ref,
    )!.n,
    2,
  );
  assert.equal(imports.confirm(up.id, adminId).duplicate, true);
  const duplicate = await imports.upload('sales', 'again.csv', fixed, adminId);
  assert.equal(duplicate.id, up.id);
  const overlap = await imports.upload('sales', 'overlap.csv', fixed + '\n', adminId);
  assert.ok(overlap.error_count > 0);
  assert.throws(() => imports.confirm(overlap.id, adminId), /Resolve all/);
  assert.equal(ledger.balances(i).balance, 90);
});
test('whole-file stock shortages and synthetic undated input reject operational import', async () => {
  const i = item();
  opening(i, 5);
  const p = product(i, 2);
  const content = `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\n${id()},${now()},1,${p},2,0,0\n${id()},${now()},1,${p},2,0,0\n`;
  const up = await imports.upload('sales', 'short.csv', content, adminId);
  assert.ok(up.error_count > 0);
  assert.throws(() => imports.confirm(up.id, adminId), /Resolve all/);
  assert.equal(ledger.balances(i).balance, 5);
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
  const i = item();
  opening(i, 3);
  const p = product(i, 2);
  const a = sale(p),
    b = sale(p);
  const results = await Promise.all(
    [a, b].map((body) => adminAgent.post('/api/sales').set('X-CSRF-Token', adminCSRF).send(body)),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(ledger.balances(i).balance, 1);
  const j = item();
  opening(j, 10);
  const q = product(j, 2);
  const body = sale(q);
  const retries = await Promise.all(
    Array.from({ length: 4 }, () =>
      adminAgent.post('/api/sales').set('X-CSRF-Token', adminCSRF).send(body),
    ),
  );
  assert.ok(retries.every((r) => r.status === 200));
  assert.equal(ledger.balances(j).balance, 8);
  assert.equal(retries.filter((r) => r.body.duplicate).length, 3);
});
test('last administrator and expired sessions are protected', async () => {
  const update = await adminAgent
    .put('/api/users/' + adminId)
    .set('X-CSRF-Token', adminCSRF)
    .send({ name: 'admin', role: 'staff', active: true });
  assert.equal(update.status, 422);
  s.run('UPDATE sessions SET expires_at=? WHERE user_id=?', '2000-01-01T00:00:00.000Z', staffId);
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
      s.get('SELECT password_hash FROM users WHERE id=?', created.body.id)!.password_hash,
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
test('versioned migrations and ledger data persist across closing and reopening a real SQLite file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utb-test-'));
  const path = join(dir, 'test.sqlite');
  try {
    let disk = new Store(path);
    const u = id();
    disk.run(
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
    disk.run(
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
    new Ledger(disk).opening(
      inv,
      { ...event(), quantity: 7, unit: 'piece', batch_label: 'TEST' },
      u,
    );
    disk.close();
    disk = new Store(path);
    assert.equal(new Ledger(disk).balances(inv).balance, 7);
    assert.equal(disk.get('SELECT COUNT(*) n FROM schema_migrations')!.n, 2);
    assert.equal(disk.get('PRAGMA foreign_keys')!.foreign_keys, 1);
    assert.equal(disk.get('PRAGMA journal_mode')!.journal_mode, 'wal');
    disk.close();
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
    isolated.run(
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
    imp.confirm(preview.id, u);
    assert.equal(isolated.get('SELECT COUNT(*) n FROM menu_products')!.n, 151);
    for (const table of ['operational_sales', 'inventory_items', 'stock_movements'])
      assert.equal(isolated.get(`SELECT COUNT(*) n FROM ${table}`)!.n, 0);
    assert.equal(
      isolated.get('SELECT COUNT(*) n FROM menu_products WHERE selling_price IS NOT NULL')!.n,
      0,
    );
    assert.ok(isolated.get("SELECT 1 FROM menu_products WHERE source_name='Free Pudding'"));
  } finally {
    isolated.close();
  }
});
