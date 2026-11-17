import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Store, id, now } from './db.js';
import { Ledger } from './ledger.js';
import { Imports } from './imports.js';
const source = process.argv[2];
if (!source)
  throw new Error('Usage: npm run catalog:import -- "path/to/catalog.csv" [admin-email]');
const s = new Store(process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? './data/utb.sqlite');
try {
  const actorEmail = process.argv[3];
  let actor = actorEmail
    ? await s.get("SELECT id FROM users WHERE email=? AND role='admin' AND active=1", actorEmail)
    : undefined;
  if (actorEmail && !actor) throw new Error('The specified active administrator was not found.');
  if (!actor) {
    // Local maintenance principal. No known password, no login and no invented restaurant operator.
    actor = await s.get('SELECT id FROM users WHERE email=?', 'catalog-import@system.invalid');
    if (!actor) {
      actor = { id: id() };
      await s.run(
        'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
        actor.id,
        'catalog-import@system.invalid',
        'Local catalog import (disabled)',
        bcrypt.hashSync(randomBytes(32).toString('hex'), 12),
        'staff',
        0,
        now(),
      );
    }
  }
  const importer = new Imports(s, new Ledger(s));
  const preview = await importer.upload(
    'catalog',
    basename(source),
    readFileSync(source, 'utf8'),
    actor.id,
  );
  console.info(
    JSON.stringify(
      { filename: preview.filename, hash: preview.hash, summary: preview.summary },
      null,
      2,
    ),
  );
  if (preview.error_count)
    throw new Error(
      'Catalog has validation errors. Review it in the Imports page. No catalog changes made.',
    );
  console.info(await importer.confirm(preview.id, actor.id));
  console.info(
    'Imported names and categories only. No prices, ingredients, balances or sales were created.',
  );
} finally {
  await s.close();
}
