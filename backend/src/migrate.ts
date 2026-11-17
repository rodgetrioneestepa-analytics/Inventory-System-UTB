import 'dotenv/config';
import { Store } from './db.js';
const s = new Store(process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? './data/utb.sqlite');
await s.migratePostgres();
console.info(await s.all('SELECT * FROM schema_migrations ORDER BY version'));
await s.close();
