import 'dotenv/config';
import { Store } from './db.js';
const s = new Store(process.env.DATABASE_PATH ?? './data/utb.sqlite');
console.info(s.all('SELECT * FROM schema_migrations ORDER BY version'));
s.close();
