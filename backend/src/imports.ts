import { forEachAsync } from './db.js';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { Store, id, now, hash, type Row } from './db.js';
import { Ledger, rounded } from './ledger.js';
import { AppError, requireThat } from './errors.js';
import { saleSchema, type Sale } from './schemas.js';
export const normalizeName = (name: string) =>
  name.normalize('NFKC').trim().toLocaleLowerCase('en-PH').replace(/\s+/g, ' ');
export const csvCell = (value: unknown) => {
  let s = value == null ? '' : String(value);
  // Spreadsheet formula injection guard, also used for imported names/references.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export const csv = (rows: Row[]) => {
  if (!rows.length) return 'No records\r\n';
  const keys = Object.keys(rows[0]);
  return [
    keys.map(csvCell).join(','),
    ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(',')),
  ].join('\r\n');
};
async function parseCSV(content: string, required: string[]) {
  requireThat(!content.includes('\0'), 'CSV contains binary content');
  let headers: string[] = [];
  const parser = parse({
    bom: true,
    columns: (columns: string[]) => {
      headers = columns.map((c) => c.trim());
      requireThat(new Set(headers).size === headers.length, 'Duplicate CSV headers');
      requireThat(
        required.every((c) => headers.includes(c)),
        `Required columns: ${required.join(', ')}`,
      );
      return headers;
    },
    skip_empty_lines: true,
    trim: true,
    max_record_size: 20000,
  });
  const rows: Row[] = [];
  // Feed in chunks; the parser's async iterator applies backpressure to the producer.
  const producer = Readable.from(
    (function* () {
      for (let start = 0; start < content.length; start += 65536)
        yield content.slice(start, start + 65536);
    })(),
  );
  producer.pipe(parser);
  try {
    for await (const record of parser) {
      requireThat(rows.length < 150000, 'CSV exceeds 150,000 rows');
      rows.push(record);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      422,
      'Invalid CSV structure',
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    producer.destroy();
    parser.destroy();
  }
  requireThat(rows.length > 0, 'CSV has no data rows');
  return rows;
}
export class Imports {
  constructor(
    public s: Store,
    public ledger: Ledger,
  ) {}
  async catalogPreview(rows: Row[]) {
    const unique = new Map<string, Row>();
    const errors: Row[] = [];
    const categories = new Set<string>();
    const existingProducts = new Map(
      (await this.s.all('SELECT normalized_name,category FROM menu_products')).map((p) => [
        p.normalized_name,
        p,
      ]),
    );
    const sourceNames = new Set<string>();
    rows.forEach((row, i) => {
      // Deliberately project only name/category. Synthetic numeric columns are never persisted.
      const name = String(row.ProductName ?? '').trim();
      const category = String(row.Category ?? '').trim();
      const key = normalizeName(name);
      if (!name || !category || name.length > 200 || category.length > 200) {
        errors.push({
          row: i + 2,
          reason: 'ProductName and Category are required (maximum 200 characters)',
          ProductName: name,
          Category: category,
        });
        return;
      }
      const prior = unique.get(key);
      const existing = existingProducts.get(key);
      if ((prior && prior.category !== category) || (existing && existing.category !== category))
        errors.push({
          row: i + 2,
          reason: 'Category conflict; review and correct the CSV or product manually',
          ProductName: name,
          Category: category,
        });
      if (!prior)
        unique.set(key, {
          source_name: name,
          source_variants: [name],
          normalized_name: key,
          category,
          row: i + 2,
        });
      else if (!prior.source_variants.includes(name)) prior.source_variants.push(name);
      sourceNames.add(name);
      categories.add(category);
    });
    return {
      products: [...unique.values()],
      summary: {
        rows: rows.length,
        unique_products: unique.size,
        source_distinct_names: sourceNames.size,
        categories: categories.size,
        errors: errors.length,
      },
      errors,
    };
  }
  async salesPreview(rows: Row[], importHash: string) {
    const groups = new Map<string, Sale>();
    const errors: Row[] = [];
    const seen = new Set<string>();
    await forEachAsync(rows, async (row, i) => {
      try {
        requireThat(String(row.TransactionID ?? '').trim(), 'TransactionID is required');
        const sourceKey = `${row.TransactionID}\u001f${row.LineNumber}`;
        requireThat(!seen.has(sourceKey), 'Duplicate transaction/line key in file');
        seen.add(sourceKey);
        requireThat(
          !(await this.s.get('SELECT 1 FROM operational_sale_lines WHERE source_key=?', sourceKey)),
          'Overlapping transaction/line already posted',
        );
        const product = await this.s.get(
          'SELECT id FROM menu_products WHERE id=? OR sku=?',
          row.ProductSKUorID,
          row.ProductSKUorID,
        );
        requireThat(product, 'Unknown product SKU or ID');
        requireThat(
          ['Qty', 'UnitPrice', 'SalesAmount', 'LineNumber'].every(
            (k) => String(row[k] ?? '').trim() !== '',
          ),
          'Numeric fields cannot be blank',
        );
        const body = saleSchema.parse({
          key: `import:${importHash}:${row.TransactionID}`,
          reference: row.TransactionID,
          reason: 'Confirmed operational CSV',
          occurred_at: row.TransactionDate,
          lines: [
            {
              line_number: Number(row.LineNumber),
              product_id: product.id,
              quantity: Number(row.Qty),
              unit_price: Number(row.UnitPrice),
              sales_amount: Number(row.SalesAmount),
            },
          ],
        });
        const group = groups.get(body.reference);
        if (group) {
          requireThat(
            group.occurred_at === body.occurred_at,
            'Transaction lines have different dates',
          );
          group.lines.push(body.lines[0]);
        } else groups.set(body.reference, body);
      } catch (e) {
        errors.push({ row: i + 2, reason: e instanceof Error ? e.message : 'Invalid row', ...row });
      }
    });
    // Aggregate the entire file, so independent sales cannot all preview against the same stock.
    const consumption = new Map<string, Row>();
    for (const body of groups.values()) {
      try {
        const preview = await this.ledger.previewSale(body);
        for (const c of preview.consumption) {
          const prior = consumption.get(c.item_id);
          consumption.set(c.item_id, {
            ...c,
            quantity: rounded((prior?.quantity ?? 0) + c.quantity),
          });
        }
      } catch (e) {
        rows.forEach((row, i) => {
          if (row.TransactionID === body.reference)
            errors.push({
              row: i + 2,
              reason: e instanceof Error ? e.message : 'Invalid sale',
              ...row,
            });
        });
      }
    }
    for (const c of consumption.values())
      if (c.quantity > c.available + 0.000001)
        errors.push({
          row: 0,
          reason: `${c.name}: file requests ${c.quantity} ${c.unit}; available ${c.available}`,
        });
    return {
      sales: [...groups.values()],
      consumption: [...consumption.values()],
      errors,
      summary: { rows: rows.length, transactions: groups.size, errors: errors.length },
    };
  }
  async upload(kind: 'catalog' | 'sales', filename: string, content: string, actor: string) {
    requireThat(
      /\.csv$/i.test(filename) && filename.length <= 200,
      'Upload a .csv file (filename max 200 characters)',
    );
    requireThat(Buffer.byteLength(content) <= 20 * 1024 * 1024, 'CSV exceeds 20 MiB limit', 413);
    const digest = hash(content);
    const existing = await this.s.get(
      'SELECT id FROM imports WHERE kind=? AND hash=?',
      kind,
      digest,
    );
    if (existing) return await this.detail(existing.id);
    const required =
      kind === 'catalog'
        ? ['ProductName', 'Category']
        : [
            'TransactionID',
            'TransactionDate',
            'LineNumber',
            'ProductSKUorID',
            'Qty',
            'UnitPrice',
            'SalesAmount',
          ];
    const rows = await parseCSV(content, required);
    // Only whitelisted catalog fields are retained, even in rejected rows and import payload.
    const safeRows: Row[] =
      kind === 'catalog'
        ? rows.map((row) => ({ ProductName: row.ProductName, Category: row.Category }))
        : rows;
    const preview =
      kind === 'catalog'
        ? await this.catalogPreview(safeRows)
        : await this.salesPreview(safeRows, digest);
    const importId = await this.s.tx(async () => {
      const raced = await this.s.get(
        'SELECT id FROM imports WHERE kind=? AND hash=?',
        kind,
        digest,
      );
      if (raced) return raced.id as string;
      const newId = id();
      await this.s.run(
        'INSERT INTO imports VALUES (?,?,?,?,?,?,?,?,?,?)',
        newId,
        kind,
        filename,
        digest,
        actor,
        now(),
        'preview',
        JSON.stringify(safeRows),
        JSON.stringify(preview.summary),
        null,
      );
      const rowErrors = new Map<number, string[]>();
      for (const e of preview.errors)
        rowErrors.set(e.row, [...(rowErrors.get(e.row) ?? []), e.reason]);
      const importRows = safeRows.map((row, i) => {
        const error = (rowErrors.get(i + 2) ?? []).join('; ');
        return [
          id(),
          newId,
          i + 2,
          kind === 'catalog' ? row.ProductName : `${row.TransactionID}:${row.LineNumber}`,
          error || null,
          JSON.stringify(row),
        ];
      });
      await this.s.insertRows(
        'import_rows',
        ['id', 'import_id', 'row_number', 'source_reference', 'error', 'row_data'],
        importRows,
      );
      await this.s.audit(actor, 'upload', 'import', newId, {
        kind,
        filename,
        hash: digest,
        summary: preview.summary,
      });
      return newId;
    });
    return await this.detail(importId);
  }
  async detail(importId: string): Promise<
    Row & {
      summary: Row;
      preview: Row;
      error_count: number;
    }
  > {
    const row = await this.s.get('SELECT * FROM imports WHERE id=?', importId);
    requireThat(row, 'Import not found', 404);
    const rows = JSON.parse(row.payload) as Row[];
    const preview =
      row.status === 'confirmed'
        ? { summary: JSON.parse(row.summary), errors: [], confirmed: true }
        : row.kind === 'catalog'
          ? await this.catalogPreview(rows)
          : await this.salesPreview(rows, row.hash);
    const { payload, ...metadata } = row;
    return {
      ...metadata,
      summary: preview.summary,
      preview: { ...preview, errors: preview.errors.slice(0, 200) },
      error_count: preview.errors.length,
    };
  }
  async confirm(importId: string, actor: string) {
    return await this.s.tx(async () => {
      const imported = await this.s.get('SELECT * FROM imports WHERE id=?', importId);
      requireThat(imported, 'Import not found', 404);
      if (imported.status === 'confirmed') return { id: importId, duplicate: true };
      const rows = JSON.parse(imported.payload) as Row[];
      const preview =
        imported.kind === 'catalog'
          ? await this.catalogPreview(rows)
          : await this.salesPreview(rows, imported.hash);
      requireThat(!preview.errors.length, 'Resolve all import errors before confirmation', 422);
      if (imported.kind === 'catalog') {
        const catalog = await this.catalogPreview(rows);
        for (const product of catalog.products) {
          if (
            !(await this.s.get(
              'SELECT 1 FROM menu_products WHERE normalized_name=?',
              product.normalized_name,
            ))
          ) {
            const productId = id();
            await this.s.run(
              'INSERT INTO menu_products VALUES (?,?,?,?,?,?,?)',
              productId,
              `MENU-${productId.slice(0, 8).toUpperCase()}`,
              product.source_name,
              product.normalized_name,
              product.category,
              null,
              0,
            );
          }
        }
      } else
        for (const sale of (await this.salesPreview(rows, imported.hash)).sales)
          await this.ledger.saleInside(sale, actor, `import:${importId}`);
      await this.s.run(
        'UPDATE imports SET status=?,confirmed_at=?,summary=? WHERE id=?',
        'confirmed',
        now(),
        JSON.stringify(preview.summary),
        importId,
      );
      await this.s.audit(actor, 'confirm', 'import', importId, preview.summary);
      return { id: importId, duplicate: false };
    });
  }
  async rejected(importId: string) {
    const row = await this.s.get('SELECT * FROM imports WHERE id=?', importId);
    requireThat(row, 'Import not found', 404);
    if (row.status === 'confirmed') return csv([]);
    const rows = JSON.parse(row.payload);
    const preview =
      row.kind === 'catalog'
        ? await this.catalogPreview(rows)
        : await this.salesPreview(rows, row.hash);
    return csv(preview.errors);
  }
}
