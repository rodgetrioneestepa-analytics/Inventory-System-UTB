import { mapAsync } from './db.js';
import { Store, id, now, hash, type Row } from './db.js';
import { requireThat, AppError } from './errors.js';
import {
  openingSchema,
  receiptSchema,
  saleSchema,
  wasteSchema,
  countSchema,
  reversalSchema,
  type Sale,
} from './schemas.js';
const EPS = 0.0000001;
export const rounded = (x: number) => Math.round(x * 1e6) / 1e6;
export const manilaDay = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export class Ledger {
  constructor(public s: Store) {}
  async item(itemId: string, requireOpening = true) {
    const item = await this.s.get('SELECT * FROM inventory_items WHERE id=?', itemId);
    requireThat(item && !item.archived, 'Inventory item is missing or archived');
    if (requireOpening)
      requireThat(
        await this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId),
        `${item.name}: opening stock not configured`,
      );
    return item;
  }
  async convert(item: Row, quantity: number, unit: string) {
    const checked = (value: number) => {
      const result = rounded(value);
      requireThat(
        Number.isFinite(result) && result <= 1e12 && (quantity === 0 || result >= 0.000001),
        'Quantity is outside the supported precision (minimum 0.000001 base units)',
      );
      return result;
    };
    if (unit === item.base_unit) return checked(quantity);
    if ((unit === 'kg' && item.base_unit === 'g') || (unit === 'l' && item.base_unit === 'ml'))
      return checked(quantity * 1000);
    if (unit === 'pack') {
      const c = await this.s.get(
        'SELECT factor FROM unit_conversions WHERE item_id=? AND from_unit=?',
        item.id,
        unit,
      );
      requireThat(c, `${item.name}: pack conversion not configured`);
      return checked(quantity * c.factor);
    }
    throw new AppError(
      422,
      `${item.name}: incompatible or missing unit conversion (${unit} to ${item.base_unit})`,
    );
  }
  async batches(itemId: string) {
    return await this.s.all(
      `SELECT b.*, COALESCE(SUM(m.quantity),0) quantity FROM stock_batches b
      LEFT JOIN stock_movements m ON m.batch_id=b.id WHERE b.item_id=? GROUP BY b.id
      ORDER BY COALESCE(b.expiry_date,'9999-12-31'),b.created_at,b.id`,
      itemId,
    );
  }
  async balances(itemId: string) {
    if (!(await this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId)))
      return { balance: null, available: null, expired: null };
    const batches = await this.batches(itemId);
    const expired = batches
      .filter((b) => b.expiry_date && b.expiry_date < manilaDay())
      .reduce((n, b) => n + b.quantity, 0);
    const balance = batches.reduce((n, b) => n + b.quantity, 0);
    return {
      balance: rounded(balance),
      available: rounded(balance - expired),
      expired: rounded(expired),
    };
  }
  async allocate(itemId: string, quantity: number, allowExpired = false, batchId?: string) {
    await this.item(itemId);
    const batches = (await this.batches(itemId)).filter(
      (b) =>
        b.quantity > EPS &&
        (!batchId || b.id === batchId) &&
        (allowExpired || !b.expiry_date || b.expiry_date >= manilaDay()),
    );
    const available = batches.reduce((n, b) => n + b.quantity, 0);
    requireThat(available + EPS >= quantity, 'Insufficient available stock', 409);
    let remaining = quantity;
    const allocations: {
      batch_id: string;
      quantity: number;
    }[] = [];
    for (const b of batches) {
      if (remaining <= EPS) break;
      const take = rounded(Math.min(remaining, b.quantity));
      allocations.push({ batch_id: b.id, quantity: take });
      remaining = rounded(remaining - take);
    }
    return allocations;
  }
  async movement(
    event: string,
    item: string,
    batch: string,
    quantity: number,
    reverses: string | null = null,
  ) {
    await this.s.run(
      'INSERT INTO stock_movements VALUES (?,?,?,?,?,?)',
      id(),
      event,
      item,
      batch,
      rounded(quantity),
      reverses,
    );
  }
  async batch(item: Row, label: string, expiry: string | null) {
    requireThat(!item.expiry_tracking || expiry, `${item.name}: expiry date is required`);
    requireThat(
      item.expiry_tracking || !expiry,
      'Enable expiry tracking before entering an expiry date',
    );
    const batchId = id();
    await this.s.run(
      'INSERT INTO stock_batches VALUES (?,?,?,?,?)',
      batchId,
      item.id,
      label,
      expiry,
      now(),
    );
    return batchId;
  }
  // Call only inside a transaction, or via post(). The same key with changed input is rejected.
  async event(
    kind: string,
    body: Row,
    actor: string,
    source: string,
    work: (eventId: string) => void,
    reverses: string | null = null,
  ) {
    const requestHash = hash(JSON.stringify({ kind, body, reverses }));
    const existing = await this.s.get(
      'SELECT * FROM posted_events WHERE idempotency_key=?',
      body.key,
    );
    if (existing) {
      requireThat(
        existing.request_hash === requestHash,
        'Idempotency key already used with different input',
        409,
      );
      return { id: existing.id, duplicate: true };
    }
    const eventId = id();
    await this.s.run(
      'INSERT INTO posted_events VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      eventId,
      kind,
      body.key,
      requestHash,
      body.reference,
      body.reason,
      source,
      actor,
      body.occurred_at,
      now(),
      reverses,
    );
    await work(eventId);
    await this.s.audit(actor, 'post', kind, eventId, {
      reference: body.reference,
      reason: body.reason,
      source,
    });
    return { id: eventId, duplicate: false };
  }
  async post(
    kind: string,
    body: Row,
    actor: string,
    source: string,
    work: (eventId: string) => void,
    reverses: string | null = null,
  ) {
    return await this.s.tx(async () => await this.event(kind, body, actor, source, work, reverses));
  }
  async opening(itemId: string, raw: unknown, actor: string) {
    const body = openingSchema.parse(raw);
    return await this.post(
      'opening',
      { ...body, item_id: itemId },
      actor,
      'opening-form',
      async (eventId) => {
        const item = await this.item(itemId, false);
        requireThat(
          !(await this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId)),
          'Opening stock already configured',
          409,
        );
        const quantity = await this.convert(item, body.quantity, body.unit);
        const batchId = await this.batch(item, body.batch_label, body.expiry_date);
        await this.s.run('INSERT INTO opening_events VALUES (?,?)', itemId, eventId);
        await this.movement(eventId, itemId, batchId, quantity);
      },
    );
  }
  async poDetail(poId: string): Promise<
    Row & {
      lines: Row[];
    }
  > {
    const po = await this.s.get(
      'SELECT p.*,s.name supplier_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?',
      poId,
    );
    requireThat(po, 'Purchase order not found', 404);
    const lines = await this.s.all(
      `SELECT l.*,i.name,i.sku,i.base_unit,i.expiry_tracking,
      COALESCE((SELECT SUM(rl.quantity) FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id
      WHERE rl.po_line_id=l.id AND NOT EXISTS (SELECT 1 FROM posted_events e WHERE e.reverses_event_id=r.id)),0) received
      FROM purchase_order_lines l JOIN inventory_items i ON i.id=l.item_id WHERE po_id=?`,
      poId,
    );
    return {
      ...po,
      lines: lines.map((l) => ({ ...l, remaining: rounded(Math.max(0, l.quantity - l.received)) })),
    };
  }
  async refreshPO(poId: string) {
    const po = await this.poDetail(poId);
    const complete = po.lines.every((l) => l.received + EPS >= l.quantity);
    const any = po.lines.some((l) => l.received > EPS);
    await this.s.run(
      'UPDATE purchase_orders SET status=? WHERE id=?',
      complete ? 'complete' : any ? 'partial' : 'ordered',
      poId,
    );
  }
  async receive(poId: string, raw: unknown, actor: string, role: string) {
    const body = receiptSchema.parse(raw);
    return await this.post(
      'receipt',
      { ...body, po_id: poId },
      actor,
      'receiving-form',
      async (eventId) => {
        const po = await this.poDetail(poId);
        requireThat(
          ['ordered', 'partial', 'complete'].includes(po.status),
          'Submit the purchase order before receiving',
        );
        requireThat(
          !(await this.s.get(
            'SELECT 1 FROM receipts WHERE delivery_reference=?',
            body.delivery_reference,
          )),
          'Delivery reference already received',
          409,
        );
        requireThat(
          new Set(body.lines.map((l) => l.po_line_id)).size === body.lines.length,
          'Duplicate receipt lines',
        );
        await this.s.run(
          'INSERT INTO receipts VALUES (?,?,?,?)',
          eventId,
          poId,
          body.delivery_reference,
          body.over_receipt_reason ?? null,
        );
        for (const line of body.lines) {
          const pol = po.lines.find((l) => l.id === line.po_line_id);
          requireThat(pol, 'Purchase order line not found');
          const item = await this.item(pol.item_id);
          const quantity = await this.convert(item, line.quantity, line.unit);
          if (quantity > pol.remaining + EPS)
            requireThat(
              role === 'admin' && body.over_receipt_reason,
              'Over-receipt needs an admin exception and reason',
              403,
            );
          const batchId = await this.batch(item, line.batch_label, line.expiry_date);
          await this.s.run(
            'INSERT INTO receipt_lines VALUES (?,?,?,?,?,?)',
            id(),
            eventId,
            pol.id,
            batchId,
            quantity,
            pol.unit_cost,
          );
          await this.movement(eventId, item.id, batchId, quantity);
        }
        await this.refreshPO(poId);
      },
    );
  }
  async previewSale(raw: unknown) {
    const body = saleSchema.parse(raw);
    requireThat(
      new Set(body.lines.map((l) => l.line_number)).size === body.lines.length,
      'Duplicate line numbers',
    );
    requireThat(
      !(await this.s.get(
        'SELECT 1 FROM operational_sales WHERE transaction_reference=?',
        body.reference,
      )),
      'Transaction already posted or overlaps a previous import',
      409,
    );
    const requirements = new Map<string, number>();
    const resolved = await mapAsync(body.lines, async (line) => {
      const product = await this.s.get(
        'SELECT * FROM menu_products WHERE id=? AND archived=0',
        line.product_id,
      );
      requireThat(product, 'Menu product not found or archived');
      requireThat(
        product.selling_price !== null,
        `${product.source_name}: current price not confirmed`,
      );
      requireThat(
        Math.abs(Math.round(line.quantity * line.unit_price * 100) / 100 - line.sales_amount) <=
          0.01000001,
        'Qty × UnitPrice differs from SalesAmount (tolerance ₱0.01)',
      );
      const version = await this.s.get(
        `SELECT v.* FROM recipe_versions v JOIN recipes r ON r.id=v.recipe_id WHERE r.product_id=? ORDER BY version DESC LIMIT 1`,
        product.id,
      );
      requireThat(version, `${product.source_name}: recipe not configured`);
      const ingredients = await this.s.all(
        'SELECT * FROM recipe_ingredients WHERE version_id=?',
        version.id,
      );
      requireThat(ingredients.length, 'Recipe has no ingredients');
      for (const ingredient of ingredients) {
        const item = await this.item(ingredient.item_id);
        requireThat(ingredient.base_unit === item.base_unit, 'Recipe base unit mismatch');
        const required = rounded(ingredient.quantity * line.quantity);
        requireThat(
          required >= 0.000001,
          'Consumption is below supported precision (0.000001 base units)',
        );
        requirements.set(item.id, rounded((requirements.get(item.id) ?? 0) + required));
      }
      const sourceKey = `${body.reference}\u001f${line.line_number}`;
      requireThat(
        !(await this.s.get('SELECT 1 FROM operational_sale_lines WHERE source_key=?', sourceKey)),
        'Source line overlaps an existing sale',
        409,
      );
      return {
        ...line,
        recipe_version_id: version.id,
        source_key: sourceKey,
        product_name: product.source_name,
      };
    });
    const consumption = await mapAsync([...requirements], async ([itemId, quantity]) => {
      const item = await this.item(itemId);
      const balances = await this.balances(itemId);
      const shortage = rounded(Math.max(0, quantity - (balances.available ?? 0)));
      return {
        item_id: itemId,
        name: item.name,
        unit: item.base_unit,
        quantity,
        available: balances.available,
        shortage,
        batches: shortage > EPS ? [] : await this.allocate(itemId, quantity),
      };
    });
    return { body, resolved, consumption, can_post: consumption.every((c) => c.shortage <= EPS) };
  }
  async saleInside(body: Sale, actor: string, source: string) {
    return await this.event('sale', body, actor, source, async (eventId) => {
      const preview = await this.previewSale(body);
      requireThat(preview.can_post, 'Insufficient available stock', 409);
      await this.s.run(
        'INSERT INTO operational_sales VALUES (?,?,?)',
        eventId,
        body.reference,
        body.occurred_at,
      );
      for (const line of preview.resolved)
        await this.s.run(
          'INSERT INTO operational_sale_lines VALUES (?,?,?,?,?,?,?,?,?)',
          id(),
          eventId,
          line.line_number,
          line.product_id,
          line.quantity,
          line.unit_price,
          line.sales_amount,
          line.recipe_version_id,
          line.source_key,
        );
      for (const c of preview.consumption)
        for (const b of c.batches) await this.movement(eventId, c.item_id, b.batch_id, -b.quantity);
    });
  }
  async sale(raw: unknown, actor: string, source = 'sale-form') {
    const body = saleSchema.parse(raw);
    return await this.s.tx(async () => await this.saleInside(body, actor, source));
  }
  async waste(raw: unknown, actor: string) {
    const body = wasteSchema.parse(raw);
    return await this.post('wastage', body, actor, 'wastage-form', async (eventId) => {
      await this.s.run('INSERT INTO wastage VALUES (?,?)', eventId, body.category);
      for (const line of body.lines) {
        const item = await this.item(line.item_id);
        const quantity = await this.convert(item, line.quantity, line.unit);
        const allocations = await this.allocate(item.id, quantity, true, line.batch_id);
        await this.s.run(
          'INSERT INTO wastage_lines VALUES (?,?,?,?)',
          id(),
          eventId,
          item.id,
          quantity,
        );
        for (const b of allocations) await this.movement(eventId, item.id, b.batch_id, -b.quantity);
      }
    });
  }
  async previewCount(raw: unknown) {
    const body = countSchema.parse(raw);
    requireThat(
      new Set(body.lines.map((l) => l.batch_id)).size === body.lines.length,
      'Duplicate counted batches',
    );
    const lines = await mapAsync(body.lines, async (line) => {
      const item = await this.item(line.item_id);
      const batch = (await this.batches(item.id)).find((b) => b.id === line.batch_id);
      requireThat(batch, 'Batch not found for item');
      const counted = await this.convert(item, line.counted, line.unit);
      requireThat(
        Math.abs(batch.quantity - line.expected_book) < EPS,
        'Stock changed since count preview; refresh the book balance',
        409,
      );
      return {
        ...line,
        book: batch.quantity,
        counted,
        delta: rounded(counted - batch.quantity),
        unit: item.base_unit,
      };
    });
    return { lines };
  }
  async count(raw: unknown, actor: string) {
    const body = countSchema.parse(raw);
    return await this.post('count', body, actor, 'count-form', async (eventId) => {
      const preview = await this.previewCount(body);
      await this.s.run('INSERT INTO stock_counts VALUES (?)', eventId);
      for (const line of preview.lines) {
        await this.s.run(
          'INSERT INTO stock_count_lines VALUES (?,?,?,?,?,?)',
          id(),
          eventId,
          line.item_id,
          line.batch_id,
          line.book,
          line.counted,
        );
        await this.movement(eventId, line.item_id, line.batch_id, line.delta);
      }
    });
  }
  async reverse(eventId: string, raw: unknown, actor: string) {
    const body = reversalSchema.parse(raw);
    return await this.post(
      'reversal',
      body,
      actor,
      'reversal-form',
      async (newEvent) => {
        const original = await this.s.get('SELECT * FROM posted_events WHERE id=?', eventId);
        requireThat(original, 'Event not found', 404);
        requireThat(
          ['receipt', 'sale', 'wastage', 'count'].includes(original.kind),
          'This event cannot be reversed',
        );
        // The new event already links the original. Exclude it when checking for prior reversals.
        requireThat(
          !(await this.s.get(
            'SELECT 1 FROM posted_events WHERE reverses_event_id=? AND id!=?',
            eventId,
            newEvent,
          )),
          'Event already reversed',
          409,
        );
        for (const m of await this.s.all(
          'SELECT * FROM stock_movements WHERE event_id=?',
          eventId,
        )) {
          if (m.quantity > 0) {
            const b = (await this.batches(m.item_id)).find((b) => b.id === m.batch_id)!;
            requireThat(
              b.quantity + EPS >= m.quantity,
              'Cannot reverse stock already consumed; reverse dependent events first',
              409,
            );
          }
          await this.movement(newEvent, m.item_id, m.batch_id, -m.quantity, m.id);
        }
        if (original.kind === 'receipt')
          await this.refreshPO(
            (await this.s.get('SELECT po_id FROM receipts WHERE id=?', eventId))!.po_id,
          );
      },
      eventId,
    );
  }
}
