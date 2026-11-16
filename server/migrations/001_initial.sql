CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX session_user ON sessions(user_id);
CREATE TABLE inventory_items (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 category TEXT NOT NULL, base_unit TEXT NOT NULL CHECK(base_unit IN ('g','ml','piece','bottle')),
 location TEXT NOT NULL, reorder_point REAL NOT NULL CHECK(reorder_point>=0),
 target REAL NOT NULL CHECK(target>=reorder_point), expiry_tracking INTEGER NOT NULL CHECK(expiry_tracking IN (0,1)),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE unit_conversions (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory_items(id),
 from_unit TEXT NOT NULL, factor REAL NOT NULL CHECK(factor>0), UNIQUE(item_id,from_unit)
);
CREATE TABLE menu_products (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, source_name TEXT NOT NULL,
 normalized_name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
 selling_price REAL CHECK(selling_price>=0), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE recipes (id TEXT PRIMARY KEY, product_id TEXT NOT NULL UNIQUE REFERENCES menu_products(id));
CREATE TABLE recipe_versions (
 id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(id), version INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, reason TEXT NOT NULL,
 UNIQUE(recipe_id,version)
);
CREATE TABLE recipe_ingredients (
 id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES recipe_versions(id),
 item_id TEXT NOT NULL REFERENCES inventory_items(id), quantity REAL NOT NULL CHECK(quantity>0),
 base_unit TEXT NOT NULL, UNIQUE(version_id,item_id)
);
CREATE TABLE suppliers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, email TEXT NOT NULL,
 address TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE purchase_orders (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 expected_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','ordered','partial','complete','cancelled')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE purchase_order_lines (
 id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id), item_id TEXT NOT NULL REFERENCES inventory_items(id),
 quantity REAL NOT NULL CHECK(quantity>0), unit_cost REAL NOT NULL CHECK(unit_cost>=0), UNIQUE(po_id,item_id)
);
CREATE TABLE posted_events (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('opening','receipt','sale','wastage','count','reversal')),
 idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, reference TEXT NOT NULL,
 reason TEXT NOT NULL, source TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 occurred_at TEXT NOT NULL, created_at TEXT NOT NULL, reverses_event_id TEXT UNIQUE REFERENCES posted_events(id)
);
CREATE TABLE stock_batches (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory_items(id), label TEXT NOT NULL,
 expiry_date TEXT, created_at TEXT NOT NULL
);
CREATE TABLE stock_movements (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES posted_events(id), item_id TEXT NOT NULL REFERENCES inventory_items(id),
 batch_id TEXT NOT NULL REFERENCES stock_batches(id), quantity REAL NOT NULL,
 reverses_movement_id TEXT UNIQUE REFERENCES stock_movements(id)
);
CREATE INDEX movement_item ON stock_movements(item_id);
CREATE INDEX movement_batch ON stock_movements(batch_id);
CREATE INDEX movement_event ON stock_movements(event_id);
CREATE INDEX event_date ON posted_events(occurred_at);
CREATE TABLE opening_events (item_id TEXT PRIMARY KEY REFERENCES inventory_items(id), event_id TEXT NOT NULL UNIQUE REFERENCES posted_events(id));
CREATE TABLE receipts (
 id TEXT PRIMARY KEY REFERENCES posted_events(id), po_id TEXT NOT NULL REFERENCES purchase_orders(id),
 delivery_reference TEXT NOT NULL UNIQUE, over_receipt_reason TEXT
);
CREATE TABLE receipt_lines (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id), po_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
 batch_id TEXT NOT NULL REFERENCES stock_batches(id), quantity REAL NOT NULL CHECK(quantity>0), unit_cost REAL NOT NULL CHECK(unit_cost>=0)
);
CREATE TABLE operational_sales (
 id TEXT PRIMARY KEY REFERENCES posted_events(id), transaction_reference TEXT NOT NULL UNIQUE, transaction_date TEXT NOT NULL
);
CREATE TABLE operational_sale_lines (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES operational_sales(id), line_number INTEGER NOT NULL CHECK(line_number>0),
 product_id TEXT NOT NULL REFERENCES menu_products(id), quantity REAL NOT NULL CHECK(quantity>0),
 unit_price REAL NOT NULL CHECK(unit_price>=0), sales_amount REAL NOT NULL CHECK(sales_amount>=0),
 recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id), source_key TEXT NOT NULL UNIQUE,
 UNIQUE(sale_id,line_number)
);
CREATE TABLE wastage (
 id TEXT PRIMARY KEY REFERENCES posted_events(id), category TEXT NOT NULL
);
CREATE TABLE wastage_lines (
 id TEXT PRIMARY KEY, wastage_id TEXT NOT NULL REFERENCES wastage(id), item_id TEXT NOT NULL REFERENCES inventory_items(id), quantity REAL NOT NULL CHECK(quantity>0)
);
CREATE TABLE stock_counts (id TEXT PRIMARY KEY REFERENCES posted_events(id));
CREATE TABLE stock_count_lines (
 id TEXT PRIMARY KEY, count_id TEXT NOT NULL REFERENCES stock_counts(id), item_id TEXT NOT NULL REFERENCES inventory_items(id),
 batch_id TEXT NOT NULL REFERENCES stock_batches(id), book_quantity REAL NOT NULL, counted_quantity REAL NOT NULL CHECK(counted_quantity>=0)
);
CREATE TABLE imports (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('catalog','sales')), filename TEXT NOT NULL,
 hash TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('preview','confirmed')), payload TEXT NOT NULL, summary TEXT NOT NULL,
 confirmed_at TEXT, UNIQUE(kind,hash)
);
CREATE TABLE import_rows (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id), row_number INTEGER NOT NULL,
 source_reference TEXT, error TEXT, row_data TEXT NOT NULL, UNIQUE(import_id,row_number)
);
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER immutable_movements_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'Posted ledger is immutable'); END;
CREATE TRIGGER immutable_movements_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'Posted ledger is immutable'); END;
CREATE TRIGGER immutable_events_update BEFORE UPDATE ON posted_events BEGIN SELECT RAISE(ABORT,'Posted events are immutable'); END;
CREATE TRIGGER immutable_events_delete BEFORE DELETE ON posted_events BEGIN SELECT RAISE(ABORT,'Posted events are immutable'); END;
CREATE TRIGGER immutable_version_update BEFORE UPDATE ON recipe_versions BEGIN SELECT RAISE(ABORT,'Recipe versions are immutable'); END;
CREATE TRIGGER immutable_version_delete BEFORE DELETE ON recipe_versions BEGIN SELECT RAISE(ABORT,'Recipe versions are immutable'); END;
CREATE TRIGGER immutable_ingredient_update BEFORE UPDATE ON recipe_ingredients BEGIN SELECT RAISE(ABORT,'Recipe ingredients are immutable'); END;
CREATE TRIGGER immutable_ingredient_delete BEFORE DELETE ON recipe_ingredients BEGIN SELECT RAISE(ABORT,'Recipe ingredients are immutable'); END;
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'Audit log is immutable'); END;
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'Audit log is immutable'); END;
CREATE TRIGGER batch_item_check BEFORE INSERT ON stock_movements WHEN (SELECT item_id FROM stock_batches WHERE id=NEW.batch_id)!=NEW.item_id BEGIN SELECT RAISE(ABORT,'Batch item mismatch'); END;
CREATE TRIGGER stock_not_negative BEFORE INSERT ON stock_movements WHEN NEW.quantity<0 AND COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE batch_id=NEW.batch_id),0)+NEW.quantity < -0.000001 BEGIN SELECT RAISE(ABORT,'Insufficient batch stock'); END;
