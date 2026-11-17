import { PGlite } from '@electric-sql/pglite';
import { Store as ApplicationStore, type SQLBackend } from '../../backend/src/db.js';
export class Store extends ApplicationStore {
  constructor(path: string) {
    if (process.env.UTB_TEST_DATABASE === 'postgres') {
      const db = new PGlite(path === ':memory:' ? undefined : path + '.postgres');
      super({ postgres: db as SQLBackend, initialize: true });
    } else super(path);
  }
}
