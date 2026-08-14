import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, assertSandboxed } from './fixtures';

/**
 * Before any test is allowed to trust its results, prove the app is running against
 * a throwaway home. Without this the suite would open whatever ledger the developer
 * last had open and write to it.
 */
test('runs against a sandboxed home, not the real one', async ({ window, userHome }) => {
  assertSandboxed(userHome);

  // The app created its state inside the sandbox...
  const sandboxDb = path.join(userHome, 'userData', 'fidra.db');
  await expect.poll(() => fs.existsSync(sandboxDb), {
    message: 'app should create its database inside the sandbox',
  }).toBe(true);

  // ...and the window is real.
  expect(await window.title()).toBeTruthy();
});

test('boots to a usable window without main-process errors', async ({ window, mainErrors }) => {
  // Something rendered, and it is not a blank page or an error screen
  const body = await window.locator('body').innerText();
  expect(body.length).toBeGreaterThan(0);
  expect(body).not.toContain('Startup Error');

  expect(mainErrors, `main process wrote to stderr:\n${mainErrors.join('\n')}`).toEqual([]);
});

test('lands on an empty dashboard, not a setup wizard', async ({ window }) => {
  await expect(window.getByText('Dashboard')).toBeVisible({ timeout: 20_000 });
  await expect(window.getByText('CURRENT BALANCE')).toBeVisible();
  await expect(window.getByText('No recent transactions')).toBeVisible();
});

// The default-sheet creation on first run is covered by transactions.e2e.ts rather
// than here: saving a transaction only succeeds if the sheet it names exists, since
// `assertSheetsExist` rejects it otherwise. That is a stronger check than reading
// the sheet picker, and it does not depend on how the picker is built.
