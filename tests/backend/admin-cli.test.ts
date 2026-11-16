import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Store } from '../../backend/src/db.js';

test('administrator CLI creates a hashed account without operational seeds and refuses overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utb-admin-cli-'));
  const path = join(dir, 'test.sqlite');
  const password = randomUUID();
  const env = {
    ...process.env,
    DATABASE_PATH: path,
    ADMIN_EMAIL: 'cli@test.local',
    ADMIN_NAME: 'TEST CLI',
    ADMIN_PASSWORD: password,
  };
  try {
    const first = spawnSync(process.execPath, ['--import', 'tsx', 'backend/src/admin.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.ok(!first.stdout.includes(password));
    const second = spawnSync(process.execPath, ['--import', 'tsx', 'backend/src/admin.ts'], {
      cwd: process.cwd(),
      env: { ...env, ADMIN_PASSWORD: randomUUID() },
      encoding: 'utf8',
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
    const s = new Store(path);
    try {
      const user = s.get('SELECT * FROM users WHERE email=?', 'cli@test.local')!;
      assert.equal(user.role, 'admin');
      assert.equal(bcrypt.getRounds(user.password_hash), 12);
      assert.ok(bcrypt.compareSync(password, user.password_hash));
      for (const table of ['inventory_items', 'stock_movements', 'operational_sales'])
        assert.equal(s.get(`SELECT COUNT(*) n FROM ${table}`)!.n, 0);
    } finally {
      s.close();
    }
  } finally {
    assert.equal(resolve(dirname(dir)), resolve(tmpdir()));
    assert.ok(dir.includes('utb-admin-cli-'));
    rmSync(dir, { recursive: true, force: true });
  }
});
