import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deploymentConfig, buildVercel } from '../scripts/build-vercel.mjs';
import { httpsOrigin } from '../scripts/local-tunnel.mjs';

test('local tunnel frontend allowlist accepts only explicit HTTPS origins', () => {
  assert.equal(
    httpsOrigin('https://actual-project.vercel.app/'),
    'https://actual-project.vercel.app',
  );
  for (const origin of [
    '*',
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com?all=1',
  ])
    assert.throws(() => httpsOrigin(origin));
});

test('Vercel deployment requires a hosted HTTPS backend and rejects credentials and paths', () => {
  for (const value of [
    undefined,
    'not a url',
    'http://api.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://api.example.com/api',
    'https://user:secret@api.example.com',
    'https://api.example.com?secret=1',
  ])
    assert.throws(() => deploymentConfig(value));
});

test('API routes use the fixed backend before SPA fallback without redirects or caching sessions', () => {
  const config = deploymentConfig('https://inventory-api.example.com');
  const route = config.routes[0];
  for (const path of ['/api/auth/login', '/api/imports/preview', '/api/reports/stock'])
    assert.ok(new RegExp(route.src).test(path));
  assert.equal(route.dest, 'https://inventory-api.example.com/api/$1');
  assert.equal(route.headers['Cache-Control'], 'private, no-store');
  assert.equal(route.status, undefined);
  assert.ok(config.routes.findIndex((route) => route.handle === 'filesystem') > 0);
  assert.equal(config.routes.at(-1).dest, '/index.html');
});

test('deployment output contains frontend files and routes, never local credentials or SQLite files', () => {
  const root = mkdtempSync(join(tmpdir(), 'utb-deploy-test-'));
  try {
    mkdirSync(join(root, 'dist/web/assets'), { recursive: true });
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'dist/web/index.html'), '<html>TEST frontend</html>');
    writeFileSync(join(root, 'dist/web/assets/app.js'), 'console.log("TEST");');
    writeFileSync(join(root, '.env'), 'TEST_PRIVATE=must-not-upload');
    writeFileSync(join(root, 'data/test.sqlite'), 'TEST private data');
    buildVercel({ root, apiOrigin: 'https://inventory-api.example.com' });
    assert.ok(existsSync(join(root, '.vercel/output/static/index.html')));
    assert.ok(existsSync(join(root, '.vercel/output/static/assets/app.js')));
    assert.ok(!existsSync(join(root, '.vercel/output/static/.env')));
    assert.ok(!existsSync(join(root, '.vercel/output/static/data')));
    assert.equal(
      JSON.parse(readFileSync(join(root, '.vercel/output/config.json'), 'utf8')).version,
      3,
    );
    writeFileSync(join(root, '.vercel/output/static/stale.txt'), 'Must not survive a new build');
    buildVercel({ root, apiOrigin: 'https://inventory-api.example.com' });
    assert.ok(!existsSync(join(root, '.vercel/output/static/stale.txt')));
  } finally {
    assert.equal(resolve(dirname(root)), resolve(tmpdir()));
    assert.ok(root.includes('utb-deploy-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});
