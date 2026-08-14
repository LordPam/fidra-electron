import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real Electron app, so there are no browser projects
 * here and no parallelism: each test launches its own Electron process against its
 * own sandboxed HOME, and running several at once makes failures hard to read for
 * no real speed gain at this suite size.
 *
 * Requires a build (`npm run package`) — Playwright launches `.vite/build/index.js`
 * via package.json `main`, not the Forge dev server. It also requires better-sqlite3
 * built for Electron's ABI, which is the opposite of what vitest needs; see
 * `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
