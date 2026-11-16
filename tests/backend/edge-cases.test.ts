import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, id, now } from '../../backend/src/db.js';
import { Ledger } from '../../backend/src/ledger.js';
import { Imports } from '../../backend/src/imports.js';
import { openingSchema, saleSchema, passwordSchema } from '../../backend/src/schemas.js';
const event = () => ({ key: id(), reference: id(), reason: 'TEST ONLY', occurred_at: now() });
function fixture() {
  const s = new Store(':memory:');
  const uid = id();
  s.run(
    'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
    uid,
    'test@local.invalid',
    'TEST',
    'disabled',
    'admin',
    0,
    now(),
  );
  function item(qty: number) {
    const iid = id();
    s.run(
      'INSERT INTO inventory_items VALUES (?,?,?,?,?,?,?,?,?,?)',
      iid,
      iid,
      'TEST ONLY',
      'Test',
      'piece',
      'Shelf',
      0,
      100,
      0,
      0,
    );
    new Ledger(s).opening(
      iid,
      { ...event(), quantity: qty, unit: 'piece', batch_label: 'TEST' },
      uid,
    );
    return iid;
  }
  return { s, uid, item, ledger: new Ledger(s) };
}
test('failed multi-line wastage rolls back the first successful deduction and its event', () => {
  const f = fixture();
  try {
    const a = f.item(10),
      b = f.item(1);
    const body = {
      ...event(),
      category: 'Test',
      lines: [
        { item_id: a, quantity: 3, unit: 'piece' },
        { item_id: b, quantity: 5, unit: 'piece' },
      ],
    };
    assert.throws(() => f.ledger.waste(body, f.uid), /Insufficient/);
    assert.equal(f.ledger.balances(a).balance, 10);
    assert.equal(f.ledger.balances(b).balance, 1);
    assert.equal(
      f.s.get('SELECT 1 FROM posted_events WHERE idempotency_key=?', body.key),
      undefined,
    );
  } finally {
    f.s.close();
  }
});
test('malformed CSV, blank numeric fields, duplicate headers and CSV formula cells are handled', async () => {
  const f = fixture();
  try {
    const imports = new Imports(f.s, f.ledger);
    await assert.rejects(
      imports.upload('catalog', 'bad.csv', 'ProductName,Category\n"unterminated,A', f.uid),
    );
    await assert.rejects(
      imports.upload('catalog', 'bad.csv', 'ProductName,Category,Category\nA,B,C', f.uid),
    );
    const up = await imports.upload(
      'catalog',
      'safe.csv',
      'ProductName,Category\n=1+1,Test\n',
      f.uid,
    );
    imports.confirm(up.id, f.uid);
    assert.ok(f.s.get('SELECT 1 FROM menu_products WHERE source_name=?', '=1+1'));
    const mismatch = await imports.upload(
      'sales',
      'bad-numbers.csv',
      `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\nX,${now()},1,missing,,0,0\n`,
      f.uid,
    );
    assert.ok(mismatch.error_count);
  } finally {
    f.s.close();
  }
});
test('invalid calendar dates, future sale dates and overlong UTF-8 passwords reject', () => {
  assert.equal(
    openingSchema.safeParse({
      ...event(),
      quantity: 1,
      unit: 'piece',
      batch_label: 'TEST',
      expiry_date: '2026-02-30',
    }).success,
    false,
  );
  assert.equal(
    saleSchema.safeParse({
      ...event(),
      occurred_at: '2999-01-01T00:00:00+08:00',
      lines: [{ line_number: 1, product_id: id(), quantity: 1, unit_price: 0, sales_amount: 0 }],
    }).success,
    false,
  );
  assert.equal(passwordSchema.safeParse('界'.repeat(30)).success, false);
});
test('a stale import preview is rechecked before confirmation without partial writes', async () => {
  const f = fixture();
  try {
    const iid = f.item(5),
      pid = id(),
      rid = id(),
      vid = id();
    f.s.run(
      'INSERT INTO menu_products VALUES (?,?,?,?,?,?,?)',
      pid,
      pid,
      'TEST free',
      'test free',
      'Test',
      0,
      0,
    );
    f.s.run('INSERT INTO recipes VALUES (?,?)', rid, pid);
    f.s.run('INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)', vid, rid, 1, f.uid, now(), 'Test');
    f.s.run('INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)', id(), vid, iid, 2, 'piece');
    const importer = new Imports(f.s, f.ledger);
    const body = `TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\n${id()},${now()},1,${pid},2,0,0\n`;
    const up = await importer.upload('sales', 'real.csv', body, f.uid);
    assert.equal(up.error_count, 0);
    f.ledger.waste(
      { ...event(), category: 'Damage', lines: [{ item_id: iid, quantity: 3, unit: 'piece' }] },
      f.uid,
    );
    assert.throws(() => importer.confirm(up.id, f.uid), /Resolve all/);
    assert.equal(f.ledger.balances(iid).balance, 2);
    assert.equal(f.s.get('SELECT COUNT(*) n FROM operational_sales')!.n, 0);
    assert.equal(f.s.get('SELECT status FROM imports WHERE id=?', up.id)!.status, 'preview');
  } finally {
    f.s.close();
  }
});
test('tiny overdraw and subprecision conversions are rejected', () => {
  const f = fixture();
  try {
    const iid = f.item(1);
    assert.throws(
      () =>
        f.ledger.waste(
          {
            ...event(),
            category: 'Test',
            lines: [{ item_id: iid, quantity: 1.000001, unit: 'piece' }],
          },
          f.uid,
        ),
      /Insufficient/,
    );
    f.s.run('INSERT INTO unit_conversions VALUES (?,?,?,?)', id(), iid, 'pack', 0.000001);
    assert.throws(() => f.ledger.convert(f.ledger.item(iid), 0.000001, 'pack'), /precision/);
    assert.equal(f.ledger.balances(iid).balance, 1);
  } finally {
    f.s.close();
  }
});
