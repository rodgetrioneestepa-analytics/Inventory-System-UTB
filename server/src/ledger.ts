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
  item(itemId: string, requireOpening = true) {
    const item = this.s.get('SELECT * FROM inventory_items WHERE id=?', itemId);
    requireThat(item && !item.archived, 'Inventory item is missing or archived');
    if (requireOpening)
      requireThat(
        this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId),
        `${item.name}: opening stock not configured`,
      );
    return item;
  }
  convert(item: Row, quantity: number, unit: string) {
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
      const c = this.s.get(
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
  batches(itemId: string) {
    return this.s.all(
      `SELECT b.*, COALESCE(SUM(m.quantity),0) quantity FROM stock_batches b
      LEFT JOIN stock_movements m ON m.batch_id=b.id WHERE b.item_id=? GROUP BY b.id
      ORDER BY COALESCE(b.expiry_date,'9999-12-31'),b.created_at,b.id`,
      itemId,
    );
  }
  balances(itemId: string) {
    if (!this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId))
      return { balance: null, available: null, expired: null };
    const batches = this.batches(itemId);
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
  allocate(itemId: string, quantity: number, allowExpired = false, batchId?: string) {
    this.item(itemId);
    const batches = this.batches(itemId).filter(
      (b) =>
        b.quantity > EPS &&
        (!batchId || b.id === batchId) &&
        (allowExpired || !b.expiry_date || b.expiry_date >= manilaDay()),
    );
    const available = batches.reduce((n, b) => n + b.quantity, 0);
    requireThat(available + EPS >= quantity, 'Insufficient available stock', 409);
    let remaining = quantity;
    const allocations: { batch_id: string; quantity: number }[] = [];
    for (const b of batches) {
      if (remaining <= EPS) break;
      const take = rounded(Math.min(remaining, b.quantity));
      allocations.push({ batch_id: b.id, quantity: take });
      remaining = rounded(remaining - take);
    }
    return allocations;
  }
  movement(
    event: string,
    item: string,
    batch: string,
    quantity: number,
    reverses: string | null = null,
  ) {
    this.s.run(
      'INSERT INTO stock_movements VALUES (?,?,?,?,?,?)',
      id(),
      event,
      item,
      batch,
      rounded(quantity),
      reverses,
    );
  }
  batch(item: Row, label: string, expiry: string | null) {
    requireThat(!item.expiry_tracking || expiry, `${item.name}: expiry date is required`);
    requireThat(
      item.expiry_tracking || !expiry,
      'Enable expiry tracking before entering an expiry date',
    );
    const batchId = id();
    this.s.run(
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
  event(
    kind: string,
    body: Row,
    actor: string,
    source: string,
    work: (eventId: string) => void,
    reverses: string | null = null,
  ) {
    const requestHash = hash(JSON.stringify({ kind, body, reverses }));
    const existing = this.s.get('SELECT * FROM posted_events WHERE idempotency_key=?', body.key);
    if (existing) {
      requireThat(
        existing.request_hash === requestHash,
        'Idempotency key already used with different input',
        409,
      );
      return { id: existing.id, duplicate: true };
    }
    const eventId = id();
    this.s.run(
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
    work(eventId);
    this.s.audit(actor, 'post', kind, eventId, {
      reference: body.reference,
      reason: body.reason,
      source,
    });
    return { id: eventId, duplicate: false };
  }
  post(
    kind: string,
    body: Row,
    actor: string,
    source: string,
    work: (eventId: string) => void,
    reverses: string | null = null,
  ) {
    return this.s.tx(() => this.event(kind, body, actor, source, work, reverses));
  }
  opening(itemId: string, raw: unknown, actor: string) {
    const body = openingSchema.parse(raw);
    return this.post('opening', { ...body, item_id: itemId }, actor, 'opening-form', (eventId) => {
      const item = this.item(itemId, false);
      requireThat(
        !this.s.get('SELECT 1 FROM opening_events WHERE item_id=?', itemId),
        'Opening stock already configured',
        409,
      );
      const quantity = this.convert(item, body.quantity, body.unit);
      const batchId = this.batch(item, body.batch_label, body.expiry_date);
      this.s.run('INSERT INTO opening_events VALUES (?,?)', itemId, eventId);
      this.movement(eventId, itemId, batchId, quantity);
    });
  }
  poDetail(poId: string): Row & { lines: Row[] } {
    const po = this.s.get(
      'SELECT p.*,s.name supplier_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?',
      poId,
    );
    requireThat(po, 'Purchase order not found', 404);
    const lines = this.s.all(
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
  refreshPO(poId: string) {
    const po = this.poDetail(poId);
    const complete = po.lines.every((l) => l.received + EPS >= l.quantity);
    const any = po.lines.some((l) => l.received > EPS);
    this.s.run(
      'UPDATE purchase_orders SET status=? WHERE id=?',
      complete ? 'complete' : any ? 'partial' : 'ordered',
      poId,
    );
  }
  receive(poId: string, raw: unknown, actor: string, role: string) {
    const body = receiptSchema.parse(raw);
    return this.post('receipt', { ...body, po_id: poId }, actor, 'receiving-form', (eventId) => {
      const po = this.poDetail(poId);
      requireThat(
        ['ordered', 'partial', 'complete'].includes(po.status),
        'Submit the purchase order before receiving',
      );
      requireThat(
        !this.s.get('SELECT 1 FROM receipts WHERE delivery_reference=?', body.delivery_reference),
        'Delivery reference already received',
        409,
      );
      requireThat(
        new Set(body.lines.map((l) => l.po_line_id)).size === body.lines.length,
        'Duplicate receipt lines',
      );
      this.s.run(
        'INSERT INTO receipts VALUES (?,?,?,?)',
        eventId,
        poId,
        body.delivery_reference,
        body.over_receipt_reason ?? null,
      );
      for (const line of body.lines) {
        const pol = po.lines.find((l) => l.id === line.po_line_id);
        requireThat(pol, 'Purchase order line not found');
        const item = this.item(pol.item_id);
        const quantity = this.convert(item, line.quantity, line.unit);
        if (quantity > pol.remaining + EPS)
          requireThat(
            role === 'admin' && body.over_receipt_reason,
            'Over-receipt needs an admin exception and reason',
            403,
          );
        const batchId = this.batch(item, line.batch_label, line.expiry_date);
        this.s.run(
          'INSERT INTO receipt_lines VALUES (?,?,?,?,?,?)',
          id(),
          eventId,
          pol.id,
          batchId,
          quantity,
          pol.unit_cost,
        );
        this.movement(eventId, item.id, batchId, quantity);
      }
      this.refreshPO(poId);
    });
  }
  previewSale(raw: unknown) {
    const body = saleSchema.parse(raw);
    requireThat(
      new Set(body.lines.map((l) => l.line_number)).size === body.lines.length,
      'Duplicate line numbers',
    );
    requireThat(
      !this.s.get('SELECT 1 FROM operational_sales WHERE transaction_reference=?', body.reference),
      'Transaction already posted or overlaps a previous import',
      409,
    );
    const requirements = new Map<string, number>();
    const resolved = body.lines.map((line) => {
      const product = this.s.get(
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
      const version = this.s.get(
        `SELECT v.* FROM recipe_versions v JOIN recipes r ON r.id=v.recipe_id WHERE r.product_id=? ORDER BY version DESC LIMIT 1`,
        product.id,
      );
      requireThat(version, `${product.source_name}: recipe not configured`);
      const ingredients = this.s.all(
        'SELECT * FROM recipe_ingredients WHERE version_id=?',
        version.id,
      );
      requireThat(ingredients.length, 'Recipe has no ingredients');
      for (const ingredient of ingredients) {
        const item = this.item(ingredient.item_id);
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
        !this.s.get('SELECT 1 FROM operational_sale_lines WHERE source_key=?', sourceKey),
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
    const consumption = [...requirements].map(([itemId, quantity]) => {
      const item = this.item(itemId);
      const balances = this.balances(itemId);
      const shortage = rounded(Math.max(0, quantity - (balances.available ?? 0)));
      return {
        item_id: itemId,
        name: item.name,
        unit: item.base_unit,
        quantity,
        available: balances.available,
        shortage,
        batches: shortage > EPS ? [] : this.allocate(itemId, quantity),
      };
    });
    return { body, resolved, consumption, can_post: consumption.every((c) => c.shortage <= EPS) };
  }
  saleInside(body: Sale, actor: string, source: string) {
    return this.event('sale', body, actor, source, (eventId) => {
      const preview = this.previewSale(body);
      requireThat(preview.can_post, 'Insufficient available stock', 409);
      this.s.run(
        'INSERT INTO operational_sales VALUES (?,?,?)',
        eventId,
        body.reference,
        body.occurred_at,
      );
      for (const line of preview.resolved)
        this.s.run(
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
        for (const b of c.batches) this.movement(eventId, c.item_id, b.batch_id, -b.quantity);
    });
  }
  sale(raw: unknown, actor: string, source = 'sale-form') {
    const body = saleSchema.parse(raw);
    return this.s.tx(() => this.saleInside(body, actor, source));
  }
  waste(raw: unknown, actor: string) {
    const body = wasteSchema.parse(raw);
    return this.post('wastage', body, actor, 'wastage-form', (eventId) => {
      this.s.run('INSERT INTO wastage VALUES (?,?)', eventId, body.category);
      for (const line of body.lines) {
        const item = this.item(line.item_id);
        const quantity = this.convert(item, line.quantity, line.unit);
        const allocations = this.allocate(item.id, quantity, true, line.batch_id);
        this.s.run('INSERT INTO wastage_lines VALUES (?,?,?,?)', id(), eventId, item.id, quantity);
        for (const b of allocations) this.movement(eventId, item.id, b.batch_id, -b.quantity);
      }
    });
  }
  previewCount(raw: unknown) {
    const body = countSchema.parse(raw);
    requireThat(
      new Set(body.lines.map((l) => l.batch_id)).size === body.lines.length,
      'Duplicate counted batches',
    );
    const lines = body.lines.map((line) => {
      const item = this.item(line.item_id);
      const batch = this.batches(item.id).find((b) => b.id === line.batch_id);
      requireThat(batch, 'Batch not found for item');
      const counted = this.convert(item, line.counted, line.unit);
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
  count(raw: unknown, actor: string) {
    const body = countSchema.parse(raw);
    return this.post('count', body, actor, 'count-form', (eventId) => {
      const preview = this.previewCount(body);
      this.s.run('INSERT INTO stock_counts VALUES (?)', eventId);
      for (const line of preview.lines) {
        this.s.run(
          'INSERT INTO stock_count_lines VALUES (?,?,?,?,?,?)',
          id(),
          eventId,
          line.item_id,
          line.batch_id,
          line.book,
          line.counted,
        );
        this.movement(eventId, line.item_id, line.batch_id, line.delta);
      }
    });
  }
  reverse(eventId: string, raw: unknown, actor: string) {
    const body = reversalSchema.parse(raw);
    return this.post(
      'reversal',
      body,
      actor,
      'reversal-form',
      (newEvent) => {
        const original = this.s.get('SELECT * FROM posted_events WHERE id=?', eventId);
        requireThat(original, 'Event not found', 404);
        requireThat(
          ['receipt', 'sale', 'wastage', 'count'].includes(original.kind),
          'This event cannot be reversed',
        );
        // The new event already links the original. Exclude it when checking for prior reversals.
        requireThat(
          !this.s.get(
            'SELECT 1 FROM posted_events WHERE reverses_event_id=? AND id!=?',
            eventId,
            newEvent,
          ),
          'Event already reversed',
          409,
        );
        for (const m of this.s.all('SELECT * FROM stock_movements WHERE event_id=?', eventId)) {
          if (m.quantity > 0) {
            const b = this.batches(m.item_id).find((b) => b.id === m.batch_id)!;
            requireThat(
              b.quantity + EPS >= m.quantity,
              'Cannot reverse stock already consumed; reverse dependent events first',
              409,
            );
          }
          this.movement(newEvent, m.item_id, m.batch_id, -m.quantity, m.id);
        }
        if (original.kind === 'receipt')
          this.refreshPO(this.s.get('SELECT po_id FROM receipts WHERE id=?', eventId)!.po_id);
      },
      eventId,
    );
  }
}
