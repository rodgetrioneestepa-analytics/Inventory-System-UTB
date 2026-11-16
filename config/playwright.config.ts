import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
process.env.UTB_E2E_PASSWORD ??= randomUUID();
export default defineConfig({
  testDir: resolve(import.meta.dirname, '../tests/browser'),
  outputDir: resolve(import.meta.dirname, '../test-results'),
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3012',
    headless: true,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    cwd: resolve(import.meta.dirname, '..'),
    command: `"${process.execPath}" --import tsx tests/browser-server.ts`,
    url: 'http://127.0.0.1:3012/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: { UTB_E2E_PASSWORD: process.env.UTB_E2E_PASSWORD },
  },
});
