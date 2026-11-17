import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('inventory and API workflows preserve their guarantees on PostgreSQL', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      'tests/backend/workflows.test.ts',
      'tests/backend/edge-cases.test.ts',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, UTB_TEST_DATABASE: 'postgres' },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
