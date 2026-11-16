import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { Store, id, now, hash, type Row } from './db.js';
import { Ledger, manilaDay } from './ledger.js';
import { Imports, csv, normalizeName } from './imports.js';
import { AppError, requireThat } from './errors.js';
import {
  itemSchema,
  productSchema,
  supplierSchema,
  recipeSchema,
  poSchema,
  userSchema,
  passwordSchema,
} from './schemas.js';

declare global {
  namespace Express {
    interface Request {
      user?: Row;
      sessionHash?: string;
      csrf?: string;
    }
  }
}
const auth = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError(401, 'Sign in to continue'));
  next();
};
const admin = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') return next(new AppError(403, 'Administrator access required'));
  next();
};
const param = (req: Request, key = 'id') => String(req.params[key]);
const pageOf = (req: Request) => ({
  page: Math.floor(Math.max(1, Math.min(1e6, Number(req.query.page) || 1))),
  limit: Math.floor(Math.max(1, Math.min(200, Number(req.query.limit) || 25))),
});
const sendPage = (req: Request, res: Response, rows: Row[]) => {
  const { page, limit } = pageOf(req);
  res.json({ rows: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit });
};
export function createApp(
  s: Store,
  options: { origin?: string; production?: boolean; log?: boolean } = {},
) {
  const app = express();
  const ledger = new Ledger(s);
  const imports = new Imports(s, ledger);
  const origins = (options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((x) => x.trim());
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const sqlPage = (
    req: Request,
    res: Response,
    sql: string,
    args: string[] = [],
    map?: (row: Row) => Row,
  ) => {
    const { page, limit } = pageOf(req);
    const total = s.get(`SELECT COUNT(*) total FROM (${sql})`, ...args)!.total;
    const rows = s.all(`${sql} LIMIT ? OFFSET ?`, ...args, limit, (page - 1) * limit);
    res.json({ rows: map ? rows.map(map) : rows, total, page, limit });
  };
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '22mb' }));
  app.use(cookieParser());
  if (options.log !== false)
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () =>
        console.info(
          JSON.stringify({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Date.now() - start,
          }),
        ),
      );
      next();
    });
  app.use('/api', (req, _res, next) => {
    const token = req.cookies.utb_session;
    if (typeof token === 'string') {
      const tokenHash = hash(token);
      const session = s.get(
        `SELECT s.*,u.id,u.email,u.name,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?`,
        tokenHash,
      );
      if (session && session.active && session.expires_at > now()) {
        req.user = {
          id: session.user_id,
          email: session.email,
          name: session.name,
          role: session.role,
        };
        req.sessionHash = tokenHash;
        req.csrf = session.csrf;
      } else if (session) s.run('DELETE FROM sessions WHERE token_hash=?', tokenHash);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && !origins.includes(origin))
        return next(new AppError(403, 'Origin is not allowed'));
      if (req.path === '/auth/login') {
        if (!origin) return next(new AppError(403, 'Login requires an allowed Origin header'));
      } else if (req.user && req.get('x-csrf-token') !== req.csrf)
        return next(new AppError(403, 'Invalid CSRF token; refresh and try again'));
    }
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', application: 'Under the Balete Inventory' }),
  );
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });
  const dummy = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const body = z
      .object({ email: z.email(), password: z.string().min(1).max(72) })
      .parse(req.body);
    const user = s.get('SELECT * FROM users WHERE email=? COLLATE NOCASE', body.email);
    const valid = await bcrypt.compare(body.password, user?.password_hash ?? dummy);
    requireThat(user && user.active && valid, 'Email or password is incorrect', 401);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    s.tx(() => {
      if (req.sessionHash) s.run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
      s.run('DELETE FROM sessions WHERE expires_at<=?', now());
      s.run(
        'INSERT INTO sessions VALUES (?,?,?,?,?)',
        hash(token),
        user.id,
        csrf,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        now(),
      );
      s.audit(user.id, 'login', 'user', user.id, {});
    });
    res.cookie('utb_session', token, {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, csrf });
  });
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user, csrf: req.csrf }));
  app.post('/api/auth/logout', auth, (req, res) => {
    s.run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash!);
    res.clearCookie('utb_session', {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/',
    });
    res.json({ ok: true });
  });
  app.post('/api/auth/password', auth, async (req, res) => {
    const body = z
      .object({ current_password: z.string().max(72), password: passwordSchema })
      .parse(req.body);
    const user = s.get('SELECT password_hash FROM users WHERE id=?', req.user!.id)!;
    requireThat(
      await bcrypt.compare(body.current_password, user.password_hash),
      'Current password is incorrect',
      403,
    );
    const passwordHash = await bcrypt.hash(body.password, 12);
    s.tx(() => {
      s.run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, req.user!.id);
      s.run('DELETE FROM sessions WHERE user_id=?', req.user!.id);
      s.audit(req.user!.id, 'password-change', 'user', req.user!.id, {});
    });
    res.clearCookie('utb_session');
    res.json({ ok: true });
  });
  app.use('/api', auth);
  const inventory = (): Row[] =>
    s
      .all(
        `SELECT i.*, EXISTS(SELECT 1 FROM opening_events o WHERE o.item_id=i.id) opening_configured FROM inventory_items i ORDER BY i.name`,
      )
      .map((item) => {
        const balance = ledger.balances(item.id);
        return {
          ...item,
          ...balance,
          status: !item.opening_configured
            ? 'unconfigured'
            : (balance.available ?? 0) <= 0
              ? 'out'
              : (balance.available ?? 0) <= item.reorder_point
                ? 'low'
                : 'healthy',
        };
      });
  const products = () =>
    s.all(
      `SELECT p.*, (SELECT v.id FROM recipes r JOIN recipe_versions v ON v.recipe_id=r.id WHERE r.product_id=p.id ORDER BY v.version DESC LIMIT 1) recipe_version_id FROM menu_products p ORDER BY p.source_name`,
    );
  app.get('/api/dashboard', (_req, res) => {
    const items = inventory().filter((i) => !i.archived);
    const menu = products().filter((p) => !p.archived);
    const soon = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Manila',
    });
    const batches = s.all(
      `SELECT b.*,i.name,i.base_unit,SUM(m.quantity) quantity FROM stock_batches b JOIN inventory_items i ON i.id=b.item_id JOIN stock_movements m ON m.batch_id=b.id WHERE i.archived=0 AND b.expiry_date IS NOT NULL GROUP BY b.id HAVING quantity>0 AND b.expiry_date<=? ORDER BY b.expiry_date`,
      soon,
    );
    res.json({
      configured: items.filter((i) => i.opening_configured).length,
      low: items.filter((i) => i.status === 'low').length,
      out: items.filter((i) => i.status === 'out').length,
      awaiting_opening: items.filter((i) => !i.opening_configured).length,
      awaiting_recipe: menu.filter((p) => !p.recipe_version_id).length,
      expiring: batches.length,
      batches,
      setup_items: items.filter((i) => !i.opening_configured).slice(0, 8),
      setup_products: menu.filter((p) => !p.recipe_version_id).slice(0, 8),
    });
  });
  app.get('/api/lookups', (req, res) =>
    res.json({
      items: inventory().filter((i) => !i.archived),
      ...(req.user!.role === 'admin'
        ? {
            products: products().filter((p) => !p.archived),
            suppliers: s.all('SELECT * FROM suppliers WHERE archived=0 ORDER BY name'),
            users: s.all('SELECT id,name FROM users ORDER BY name'),
          }
        : {}),
    }),
  );
  app.get('/api/inventory', (req, res) => {
    let rows = inventory();
    const q = String(req.query.q ?? '').toLowerCase();
    if (q) rows = rows.filter((i) => `${i.name} ${i.sku} ${i.location}`.toLowerCase().includes(q));
    if (req.query.category) rows = rows.filter((i) => i.category === req.query.category);
    if (req.query.status) rows = rows.filter((i) => i.status === req.query.status);
    if (req.query.archived !== 'all') rows = rows.filter((i) => !i.archived);
    sendPage(req, res, rows);
  });
  app.get('/api/inventory/:id/batches', (req, res) => res.json(ledger.batches(param(req))));
  app.get('/api/inventory/:id/conversions', (req, res) =>
    res.json(s.all('SELECT * FROM unit_conversions WHERE item_id=?', param(req))),
  );
  app.post('/api/inventory', admin, (req, res) => {
    const b = itemSchema.parse(req.body);
    const itemId = id();
    s.tx(() => {
      s.run(
        'INSERT INTO inventory_items VALUES (?,?,?,?,?,?,?,?,?,?)',
        itemId,
        b.sku,
        b.name,
        b.category,
        b.base_unit,
        b.location,
        b.reorder_point,
        b.target,
        Number(b.expiry_tracking),
        Number(b.archived),
      );
      s.audit(req.user!.id, 'create', 'inventory', itemId, b);
    });
    res.status(201).json({ id: itemId });
  });
  app.put('/api/inventory/:id', admin, (req, res) => {
    const b = itemSchema.parse(req.body);
    const old = s.get('SELECT * FROM inventory_items WHERE id=?', param(req));
    requireThat(old, 'Item not found', 404);
    s.tx(() => {
      requireThat(
        (old.base_unit === b.base_unit && Boolean(old.expiry_tracking) === b.expiry_tracking) ||
          (!s.get('SELECT 1 FROM opening_events WHERE item_id=?', old.id) &&
            !s.get('SELECT 1 FROM recipe_ingredients WHERE item_id=?', old.id) &&
            !s.get('SELECT 1 FROM purchase_order_lines WHERE item_id=?', old.id)),
        'Unit and expiry mode are locked after configuration or posting',
      );
      if (b.archived)
        requireThat(
          !s.get(
            `SELECT 1 FROM recipe_ingredients ri JOIN recipe_versions v ON v.id=ri.version_id JOIN recipes r ON r.id=v.recipe_id JOIN menu_products p ON p.id=r.product_id WHERE ri.item_id=? AND p.archived=0 AND v.version=(SELECT MAX(v2.version) FROM recipe_versions v2 WHERE v2.recipe_id=r.id)`,
            old.id,
          ),
          'Item is used by an active recipe; update that recipe before archiving',
        );
      s.run(
        'UPDATE inventory_items SET sku=?,name=?,category=?,base_unit=?,location=?,reorder_point=?,target=?,expiry_tracking=?,archived=? WHERE id=?',
        b.sku,
        b.name,
        b.category,
        b.base_unit,
        b.location,
        b.reorder_point,
        b.target,
        Number(b.expiry_tracking),
        Number(b.archived),
        old.id,
      );
      s.audit(req.user!.id, 'update', 'inventory', old.id, { before: old, after: b });
    });
    res.json({ ok: true });
  });
  app.put('/api/inventory/:id/conversions', admin, (req, res) => {
    const b = z
      .object({ from_unit: z.literal('pack'), factor: z.number().positive().finite().max(1e9) })
      .parse(req.body);
    const item = ledger.item(param(req), false);
    s.tx(() => {
      s.run(
        'INSERT INTO unit_conversions VALUES (?,?,?,?) ON CONFLICT(item_id,from_unit) DO UPDATE SET factor=excluded.factor',
        id(),
        item.id,
        b.from_unit,
        b.factor,
      );
      s.audit(req.user!.id, 'configure-pack', 'inventory', item.id, b);
    });
    res.json({ ok: true });
  });
  app.post('/api/inventory/:id/opening', admin, (req, res) =>
    res.json(ledger.opening(param(req), req.body, req.user!.id)),
  );
  app.get('/api/products', admin, (req, res) => {
    let rows = products();
    const q = String(req.query.q ?? '').toLowerCase();
    if (q)
      rows = rows.filter((p) =>
        `${p.source_name} ${p.sku} ${p.category}`.toLowerCase().includes(q),
      );
    if (req.query.category) rows = rows.filter((p) => p.category === req.query.category);
    if (req.query.status === 'unmapped') rows = rows.filter((p) => !p.recipe_version_id);
    if (req.query.archived !== 'all') rows = rows.filter((p) => !p.archived);
    sendPage(req, res, rows);
  });
  app.post('/api/products', admin, (req, res) => {
    const b = productSchema.parse(req.body);
    const productId = id();
    s.tx(() => {
      s.run(
        'INSERT INTO menu_products VALUES (?,?,?,?,?,?,?)',
        productId,
        b.sku,
        b.source_name,
        normalizeName(b.source_name),
        b.category,
        b.selling_price,
        Number(b.archived),
      );
      s.audit(req.user!.id, 'create', 'product', productId, b);
    });
    res.status(201).json({ id: productId });
  });
  app.put('/api/products/:id', admin, (req, res) => {
    const b = productSchema.parse(req.body);
    requireThat(
      s.get('SELECT 1 FROM menu_products WHERE id=?', param(req)),
      'Product not found',
      404,
    );
    s.tx(() => {
      s.run(
        'UPDATE menu_products SET sku=?,source_name=?,normalized_name=?,category=?,selling_price=?,archived=? WHERE id=?',
        b.sku,
        b.source_name,
        normalizeName(b.source_name),
        b.category,
        b.selling_price,
        Number(b.archived),
        param(req),
      );
      s.audit(req.user!.id, 'update', 'product', param(req), b);
    });
    res.json({ ok: true });
  });
  app.get('/api/products/:id/recipes', admin, (req, res) =>
    res.json(
      s
        .all(
          'SELECT v.* FROM recipe_versions v JOIN recipes r ON r.id=v.recipe_id WHERE r.product_id=? ORDER BY version DESC',
          param(req),
        )
        .map((v) => ({
          ...v,
          ingredients: s.all(
            'SELECT ri.*,i.name FROM recipe_ingredients ri JOIN inventory_items i ON i.id=ri.item_id WHERE version_id=?',
            v.id,
          ),
        })),
    ),
  );
  app.post('/api/products/:id/recipes', admin, (req, res) => {
    const b = recipeSchema.parse(req.body);
    const result = s.tx(() => {
      requireThat(
        s.get('SELECT 1 FROM menu_products WHERE id=? AND archived=0', param(req)),
        'Product not found or archived',
        404,
      );
      requireThat(
        new Set(b.ingredients.map((i) => i.item_id)).size === b.ingredients.length,
        'Combine duplicate recipe ingredients',
      );
      let recipe = s.get('SELECT * FROM recipes WHERE product_id=?', param(req));
      if (!recipe) {
        recipe = { id: id() };
        s.run('INSERT INTO recipes VALUES (?,?)', recipe.id, param(req));
      }
      const version = Number(
        s.get(
          'SELECT COALESCE(MAX(version),0)+1 next FROM recipe_versions WHERE recipe_id=?',
          recipe.id,
        )!.next,
      );
      const versionId = id();
      s.run(
        'INSERT INTO recipe_versions VALUES (?,?,?,?,?,?)',
        versionId,
        recipe.id,
        version,
        req.user!.id,
        now(),
        b.reason,
      );
      for (const line of b.ingredients) {
        const item = ledger.item(line.item_id, false);
        const quantity = ledger.convert(item, line.quantity, line.unit);
        s.run(
          'INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)',
          id(),
          versionId,
          item.id,
          quantity,
          item.base_unit,
        );
      }
      s.audit(req.user!.id, 'publish-recipe', 'product', param(req), { versionId, version, ...b });
      return { id: versionId, version };
    });
    res.status(201).json(result);
  });
  app.get('/api/suppliers', admin, (req, res) => {
    let rows = s.all('SELECT * FROM suppliers ORDER BY name');
    if (req.query.archived !== 'all') rows = rows.filter((r) => !r.archived);
    const q = String(req.query.q ?? '').toLowerCase();
    sendPage(
      req,
      res,
      rows.filter((r) => r.name.toLowerCase().includes(q)),
    );
  });
  app.post('/api/suppliers', admin, (req, res) => {
    const b = supplierSchema.parse(req.body);
    const supplierId = id();
    s.tx(() => {
      s.run(
        'INSERT INTO suppliers VALUES (?,?,?,?,?,?)',
        supplierId,
        b.name,
        b.contact,
        b.email,
        b.address,
        Number(b.archived),
      );
      s.audit(req.user!.id, 'create', 'supplier', supplierId, b);
    });
    res.status(201).json({ id: supplierId });
  });
  app.put('/api/suppliers/:id', admin, (req, res) => {
    const b = supplierSchema.parse(req.body);
    requireThat(s.get('SELECT 1 FROM suppliers WHERE id=?', param(req)), 'Supplier not found', 404);
    s.tx(() => {
      s.run(
        'UPDATE suppliers SET name=?,contact=?,email=?,address=?,archived=? WHERE id=?',
        b.name,
        b.contact,
        b.email,
        b.address,
        Number(b.archived),
        param(req),
      );
      s.audit(req.user!.id, 'update', 'supplier', param(req), b);
    });
    res.json({ ok: true });
  });
  app.get('/api/purchase-orders', (req, res) => {
    const q = `%${String(req.query.q ?? '')}%`;
    let rows = s.all(
      'SELECT p.*,s.name supplier_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.reference LIKE ? ORDER BY created_at DESC',
      q,
    );
    if (req.query.status) rows = rows.filter((p) => p.status === req.query.status);
    sendPage(req, res, rows);
  });
  app.get('/api/purchase-orders/:id', (req, res) => res.json(ledger.poDetail(param(req))));
  app.post('/api/purchase-orders', admin, (req, res) => {
    const b = poSchema.parse(req.body);
    const poId = id();
    s.tx(() => {
      requireThat(
        s.get('SELECT 1 FROM suppliers WHERE id=? AND archived=0', b.supplier_id),
        'Supplier missing or archived',
      );
      requireThat(
        new Set(b.lines.map((l) => l.item_id)).size === b.lines.length,
        'Duplicate purchase order items',
      );
      s.run(
        'INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)',
        poId,
        b.reference,
        b.supplier_id,
        b.expected_date,
        'draft',
        req.user!.id,
        now(),
      );
      for (const line of b.lines) {
        const item = ledger.item(line.item_id, false);
        const quantity = ledger.convert(item, line.quantity, line.unit);
        const baseCost = (line.unit_cost * line.quantity) / quantity;
        s.run(
          'INSERT INTO purchase_order_lines VALUES (?,?,?,?,?)',
          id(),
          poId,
          item.id,
          quantity,
          baseCost,
        );
      }
      s.audit(req.user!.id, 'create', 'purchase-order', poId, b);
    });
    res.status(201).json({ id: poId });
  });
  app.post('/api/purchase-orders/:id/status', admin, (req, res) => {
    const b = z.object({ status: z.enum(['ordered', 'cancelled']) }).parse(req.body);
    s.tx(() => {
      const po = ledger.poDetail(param(req));
      requireThat(
        po.status === 'draft' || (po.status === 'ordered' && b.status === 'cancelled'),
        'Only a draft may be submitted, or an unreceived order cancelled',
      );
      s.run('UPDATE purchase_orders SET status=? WHERE id=?', b.status, param(req));
      s.audit(req.user!.id, 'status', 'purchase-order', param(req), b);
    });
    res.json({ ok: true });
  });
  app.post('/api/purchase-orders/:id/receive', (req, res) =>
    res.json(ledger.receive(param(req), req.body, req.user!.id, req.user!.role)),
  );
  app.post('/api/sales/preview', admin, (req, res) => res.json(ledger.previewSale(req.body)));
  app.post('/api/sales', admin, (req, res) => res.json(ledger.sale(req.body, req.user!.id)));
  app.get('/api/sales', admin, (req, res) => {
    sqlPage(
      req,
      res,
      `SELECT s.*,e.user_id,u.name actor,e.reason,e.created_at,EXISTS(SELECT 1 FROM posted_events r WHERE r.reverses_event_id=s.id) voided,(SELECT SUM(sales_amount) FROM operational_sale_lines l WHERE l.sale_id=s.id) total FROM operational_sales s JOIN posted_events e ON e.id=s.id JOIN users u ON u.id=e.user_id WHERE s.transaction_reference LIKE ? ORDER BY s.transaction_date DESC`,
      [`%${String(req.query.q ?? '')}%`],
    );
  });
  app.get('/api/sales/:id', admin, (req, res) => {
    const sale = s.get('SELECT * FROM operational_sales WHERE id=?', param(req));
    requireThat(sale, 'Sale not found', 404);
    res.json({
      ...sale,
      lines: s.all(
        'SELECT l.*,p.source_name FROM operational_sale_lines l JOIN menu_products p ON p.id=l.product_id WHERE sale_id=?',
        param(req),
      ),
    });
  });
  app.post('/api/wastage', (req, res) => res.json(ledger.waste(req.body, req.user!.id)));
  app.post('/api/counts/preview', (req, res) => res.json(ledger.previewCount(req.body)));
  app.post('/api/counts', (req, res) => res.json(ledger.count(req.body, req.user!.id)));
  app.post('/api/events/:id/reverse', admin, (req, res) =>
    res.json(ledger.reverse(param(req), req.body, req.user!.id)),
  );
  const movementQuery = (req: Request, kind?: string) => {
    const clauses = ['1=1'];
    const args: string[] = [];
    if (kind) {
      clauses.push('e.kind=?');
      args.push(kind);
    }
    for (const [q, col] of [
      ['type', 'e.kind'],
      ['item', 'm.item_id'],
      ['actor', 'e.user_id'],
    ] as const)
      if (req.query[q]) {
        clauses.push(`${col}=?`);
        args.push(String(req.query[q]));
      }
    if (req.query.from) {
      clauses.push('e.occurred_at>=?');
      args.push(new Date(z.iso.datetime({ offset: true }).parse(req.query.from)).toISOString());
    }
    if (req.query.to) {
      clauses.push('e.occurred_at<=?');
      args.push(new Date(z.iso.datetime({ offset: true }).parse(req.query.to)).toISOString());
    }
    if (req.query.q) {
      clauses.push('(e.reference LIKE ? OR i.name LIKE ? OR e.reason LIKE ?)');
      args.push(...Array(3).fill(`%${String(req.query.q)}%`));
    }
    return {
      sql: `SELECT m.*,e.kind,e.reference,e.reason,e.source,e.occurred_at,e.created_at,e.user_id,u.name actor,i.name item_name,i.sku,i.base_unit,b.label batch_label,b.expiry_date,e.reverses_event_id,EXISTS(SELECT 1 FROM posted_events r WHERE r.reverses_event_id=e.id) reversed FROM stock_movements m JOIN posted_events e ON e.id=m.event_id JOIN inventory_items i ON i.id=m.item_id JOIN stock_batches b ON b.id=m.batch_id JOIN users u ON u.id=e.user_id WHERE ${clauses.join(' AND ')} ORDER BY e.created_at DESC,m.id`,
      args,
    };
  };
  app.get('/api/movements', (req, res) => {
    const query = movementQuery(req);
    sqlPage(req, res, query.sql, query.args);
  });
  app.get('/api/events', (req, res) =>
    sqlPage(
      req,
      res,
      `SELECT e.*,u.name actor,EXISTS(SELECT 1 FROM posted_events r WHERE r.reverses_event_id=e.id) reversed FROM posted_events e JOIN users u ON u.id=e.user_id ORDER BY created_at DESC`,
    ),
  );
  app.get('/api/imports', admin, (req, res) =>
    sqlPage(
      req,
      res,
      'SELECT id,kind,filename,hash,created_by,created_at,status,summary,confirmed_at FROM imports ORDER BY created_at DESC',
      [],
      (r) => ({ ...r, summary: JSON.parse(r.summary) }),
    ),
  );
  app.post('/api/imports/preview', admin, async (req, res) => {
    const b = z
      .object({ kind: z.enum(['catalog', 'sales']), filename: z.string(), content: z.string() })
      .parse(req.body);
    res.json(await imports.upload(b.kind, b.filename, b.content, req.user!.id));
  });
  app.get('/api/imports/:id', admin, (req, res) => res.json(imports.detail(param(req))));
  app.post('/api/imports/:id/confirm', admin, (req, res) =>
    res.json(imports.confirm(param(req), req.user!.id)),
  );
  app.get('/api/imports/:id/rejected.csv', admin, (req, res) =>
    res
      .attachment('rejected-rows.csv')
      .type('text/csv')
      .send(imports.rejected(param(req))),
  );
  app.get('/api/templates/operational-sales.csv', admin, (_req, res) =>
    res
      .attachment('operational-sales.csv')
      .type('text/csv')
      .send(
        'TransactionID,TransactionDate,LineNumber,ProductSKUorID,Qty,UnitPrice,SalesAmount\r\n',
      ),
  );
  app.get('/api/reports/:report', (req, res) => {
    const report = param(req, 'report');
    let rows: Row[] = [];
    if (['stock', 'low-stock'].includes(report))
      rows = inventory()
        .filter((i) => !i.archived && (report === 'stock' || ['low', 'out'].includes(i.status)))
        .map((i) => ({
          sku: i.sku,
          name: i.name,
          category: i.category,
          unit: i.base_unit,
          location: i.location,
          balance: i.balance ?? 'Opening stock not configured',
          available: i.available ?? 'Not configured',
          expired: i.expired ?? 'Not configured',
          reorder_point: i.reorder_point,
          target: i.target,
          status: i.status,
        }));
    else if (report === 'expiry')
      rows = s
        .all(
          `SELECT i.sku,i.name,b.label,b.expiry_date,i.base_unit,SUM(m.quantity) quantity FROM stock_batches b JOIN inventory_items i ON i.id=b.item_id JOIN stock_movements m ON m.batch_id=b.id WHERE b.expiry_date IS NOT NULL GROUP BY b.id HAVING quantity>0 ORDER BY b.expiry_date`,
        )
        .map((b) => ({ ...b, status: b.expiry_date < manilaDay() ? 'Expired' : 'Unexpired' }));
    else if (['receipts', 'usage'].includes(report)) {
      const query = movementQuery(req, report === 'receipts' ? 'receipt' : 'sale');
      if (req.query.format !== 'csv') {
        sqlPage(req, res, query.sql, query.args);
        return;
      }
      rows = s.all(query.sql, ...query.args);
    } else throw new AppError(404, 'Report not found');
    if (req.query.format === 'csv')
      res.attachment(`${report}.csv`).type('text/csv').send(csv(rows));
    else sendPage(req, res, rows);
  });
  app.get('/api/users', admin, (req, res) =>
    sendPage(
      req,
      res,
      s.all('SELECT id,email,name,role,active,created_at FROM users ORDER BY name'),
    ),
  );
  app.post('/api/users', admin, async (req, res) => {
    const b = userSchema.parse(req.body);
    const userId = id();
    const passwordHash = await bcrypt.hash(b.password, 12);
    s.tx(() => {
      s.run(
        'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
        userId,
        b.email,
        b.name,
        passwordHash,
        b.role,
        1,
        now(),
      );
      s.audit(req.user!.id, 'create', 'user', userId, {
        email: b.email,
        name: b.name,
        role: b.role,
      });
    });
    res.status(201).json({ id: userId });
  });
  app.put('/api/users/:id', admin, (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(200),
        role: z.enum(['admin', 'staff']),
        active: z.boolean(),
      })
      .parse(req.body);
    s.tx(() => {
      const user = s.get('SELECT * FROM users WHERE id=?', param(req));
      requireThat(user, 'User not found', 404);
      if (user.role === 'admin' && user.active && (!b.active || b.role !== 'admin'))
        requireThat(
          s.get("SELECT COUNT(*) n FROM users WHERE active=1 AND role='admin'")!.n > 1,
          'At least one active administrator is required',
        );
      s.run(
        'UPDATE users SET name=?,role=?,active=? WHERE id=?',
        b.name,
        b.role,
        Number(b.active),
        user.id,
      );
      s.run('DELETE FROM sessions WHERE user_id=?', user.id);
      s.audit(req.user!.id, 'update', 'user', user.id, b);
    });
    res.json({ ok: true });
  });
  app.post('/api/users/:id/password', admin, async (req, res) => {
    const b = z.object({ password: passwordSchema }).parse(req.body);
    requireThat(s.get('SELECT 1 FROM users WHERE id=?', param(req)), 'User not found', 404);
    const passwordHash = await bcrypt.hash(b.password, 12);
    s.tx(() => {
      s.run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, param(req));
      s.run('DELETE FROM sessions WHERE user_id=?', param(req));
      s.audit(req.user!.id, 'reset-password', 'user', param(req), {});
    });
    res.json({ ok: true });
  });
  app.get('/api/settings', admin, (_req, res) =>
    res.json({
      application: 'Under the Balete Inventory',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      expiry_warning_days: 7,
      session_hours: 8,
      costing: 'No inventory valuation configured. Receipt costs are recorded per base unit.',
      sale_amount_tolerance: 0.01,
    }),
  );
  app.get('/api/audit', admin, (req, res) =>
    sqlPage(
      req,
      res,
      'SELECT a.*,u.name actor FROM audit_log a JOIN users u ON u.id=a.user_id ORDER BY created_at DESC',
    ),
  );
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Endpoint not found')));
  if (existsSync(resolve('dist/web/index.html'))) {
    app.use(express.static(resolve('dist/web')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/web/index.html')));
  }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError)
      return res.status(422).json({
        error: 'Validation failed',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    if (err instanceof AppError)
      return res.status(err.status).json({ error: err.message, details: err.details });
    const message = err instanceof Error ? err.message : '';
    if (/UNIQUE constraint|FOREIGN KEY|immutable|Insufficient batch/.test(message))
      return res.status(409).json({
        error: message.includes('UNIQUE')
          ? 'A unique reference already exists; review the existing record.'
          : message,
      });
    if (message.includes('CSV') || message.includes('Invalid Record'))
      return res.status(422).json({ error: 'Invalid CSV structure', details: message });
    if ((err as any)?.type === 'entity.too.large')
      return res.status(413).json({ error: 'Upload exceeds 20 MiB CSV limit' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    return res
      .status(500)
      .json({ error: 'Unexpected server error. No partial stock posting was saved.' });
  });
  return app;
}
