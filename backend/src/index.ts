import 'dotenv/config';
import { Store } from './db.js';
import { createApp } from './app.js';
const store = new Store(
  process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? './data/utb.sqlite',
);
const server = createApp(store).listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? '127.0.0.1',
  () =>
    console.info(
      `Under the Balete Inventory API listening on http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3001}`,
    ),
);
function close() {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
