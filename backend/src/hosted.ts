import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { attachDatabasePool } from '@vercel/functions';
import { createApp } from './app.js';
import { Store } from './db.js';

let application: ReturnType<typeof createApp> | undefined;
export function getHostedApplication() {
  if (!application) {
    const url = process.env.DATABASE_URL;
    if (!url || !/^postgres(?:ql)?:\/\//.test(url))
      throw new Error('Configure the hosted PostgreSQL DATABASE_URL before deploying the API.');
    const store = new Store(url);
    if (process.env.VERCEL && store.pool) attachDatabasePool(store.pool);
    application = createApp(store, { production: true, hosted: true });
  }
  return application;
}
export default function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    return getHostedApplication()(request, response);
  } catch {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'The inventory service is not configured yet.' }));
  }
}
