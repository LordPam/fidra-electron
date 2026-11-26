import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { TransactionRow } from '../src/shared/ipc-types';
import { test, expect } from './fixtures';

const passphrase = 'synthetic-sync-acceptance-secret';

async function saveEntry(window: Page, id: string): Promise<void> {
  const row: TransactionRow = {
    id, sheet: 'General', date: '2026-11-26', description: `Sync acceptance ${id}`,
    amount: '19.50', type: 'expense', status: 'pending', category: null, party: null,
    reference: null, activity: null, notes: null, linked_id: null, version: 1,
    created_at: '2026-11-26T12:00:00Z', modified_at: null, modified_by: null,
  };
  await window.evaluate((entry) => window.api.saveTransaction(entry), row);
}

test('a missing mailbox stays missing while local work is saved and retained exports retry', async ({ window, userHome }) => {
  const folder = path.join(userHome, 'mailbox');
  const parked = path.join(userHome, 'parked-mailbox');
  fs.mkdirSync(folder);
  expect(await window.evaluate((config) => window.api.localSyncConfigure(config), { syncFolder: folder, passphrase })).toMatchObject({ success: true });
  await saveEntry(window, 'before-disappearance');
  await window.evaluate(() => window.api.localSyncExportNow());
  const originalBundles = fs.readdirSync(path.join(folder, 'sync')).filter((name) => name.endsWith('.bundle'));
  expect(originalBundles.length).toBeGreaterThan(0);
  fs.renameSync(folder, parked);
  await saveEntry(window, 'during-disappearance');
  await window.evaluate(() => window.api.localSyncExportNow());
  expect(fs.existsSync(folder)).toBe(false);
  expect((await window.evaluate(() => window.api.getTransactions())).find((entry) => entry.id === 'during-disappearance')?.amount).toBe('19.50');
  expect((await window.evaluate(() => window.api.localSyncGetStatus())).lastError).toBeTruthy();
  fs.renameSync(parked, folder);
  await window.evaluate(() => window.api.localSyncExportNow());
  const recovered = fs.readdirSync(path.join(folder, 'sync')).filter((name) => name.endsWith('.bundle'));
  expect(recovered.length).toBeGreaterThan(originalBundles.length);
  for (const name of originalBundles) expect(recovered).toContain(name);
  expect((await window.evaluate(() => window.api.localSyncGetStatus())).delivery?.folderBound).toBe(true);
});

test('delivery evidence is visible without claiming a peer received the data', async ({ window, userHome }) => {
  const folder = path.join(userHome, 'mailbox'); fs.mkdirSync(folder);
  expect(await window.evaluate((config) => window.api.localSyncConfigure(config), { syncFolder: folder, passphrase })).toMatchObject({ success: true });
  await window.locator('a[href="#/settings"]').click();
  await expect(window.getByText('Configured', { exact: true })).toBeVisible();
  await expect(window.getByText('Delivery evidence', { exact: true })).toBeVisible();
  await expect(window.getByText('No other device has been identified yet. Peer delivery is unverified.', { exact: true })).toBeVisible();
});

test('snapshot onboarding publishes a separate complete ledger and preserves an existing target', async ({ window, app, userHome }) => {
  const folder = path.join(userHome, 'mailbox'); fs.mkdirSync(folder);
  expect(await window.evaluate((config) => window.api.localSyncConfigure(config), { syncFolder: folder, passphrase })).toMatchObject({ success: true });
  await saveEntry(window, 'snapshot-entry');
  expect(await window.evaluate(() => window.api.localSyncCreateSnapshot())).toMatchObject({ success: true });
  const protectedPath = path.join(userHome, 'valuable.fdra');
  fs.writeFileSync(protectedPath, 'existing valuable file');
  expect(await window.evaluate((opts) => window.api.localSyncJoinGroup(opts), { syncFolder: folder, passphrase, newDbPath: protectedPath })).toMatchObject({ success: false });
  expect(fs.readFileSync(protectedPath, 'utf8')).toBe('existing valuable file');
  const joinedPath = path.join(userHome, 'joined.fdra');
  expect(await window.evaluate((opts) => window.api.localSyncJoinGroup(opts), { syncFolder: folder, passphrase, newDbPath: joinedPath })).toMatchObject({ success: true });
  const nextWindow = app.waitForEvent('window');
  await window.evaluate((file) => window.api.createWindow(file), joinedPath);
  const peer = await nextWindow;
  await peer.getByRole('heading', { name: 'Dashboard' }).waitFor();
  expect((await peer.evaluate(() => window.api.getTransactions())).find((entry) => entry.id === 'snapshot-entry')?.amount).toBe('19.50');
});
