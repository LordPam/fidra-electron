import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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

const missingMailboxScenario = process.platform === 'win32'
  ? 'startup with a missing mailbox preserves local work and retries retained exports'
  : 'a missing mailbox stays missing while local work is saved and retained exports retry';

test(missingMailboxScenario, async ({ app, window, userHome }) => {
  const folder = path.join(userHome, 'mailbox');
  const parked = path.join(userHome, 'parked-mailbox');
  fs.mkdirSync(folder);
  expect(await window.evaluate((config) => window.api.localSyncConfigure(config), { syncFolder: folder, passphrase })).toMatchObject({ success: true });
  await saveEntry(window, 'before-disappearance');
  await window.evaluate(() => window.api.localSyncExportNow());
  const originalBundles = fs.readdirSync(path.join(folder, 'sync')).filter((name) => name.endsWith('.bundle'));
  expect(originalBundles.length).toBeGreaterThan(0);
  let restarted: ElectronApplication | undefined;
  let page = window;
  try {
    if (process.platform === 'win32') {
      // Windows keeps the watched directory open. Exercise the original incident:
      // the saved mailbox vanishes between launches, before startup can recreate it.
      await app.close();
      fs.renameSync(folder, parked);
      restarted = await electron.launch({
        args: ['.', `--user-data-dir=${path.join(userHome, 'userData')}`],
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' },
      });
      page = await restarted.firstWindow();
      await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
    } else {
      fs.renameSync(folder, parked);
    }
    await saveEntry(page, 'during-disappearance');
    await page.evaluate(() => window.api.localSyncExportNow());
    expect(fs.existsSync(folder)).toBe(false);
    expect((await page.evaluate(() => window.api.getTransactions())).find((entry) => entry.id === 'during-disappearance')?.amount).toBe('19.50');
    expect((await page.evaluate(() => window.api.localSyncGetStatus())).lastError).toBeTruthy();
    fs.renameSync(parked, folder);
    expect(await page.evaluate((config) => window.api.localSyncConfigure(config), { syncFolder: folder, passphrase })).toMatchObject({ success: true });
    await page.evaluate(() => window.api.localSyncExportNow());
    const recovered = fs.readdirSync(path.join(folder, 'sync')).filter((name) => name.endsWith('.bundle'));
    expect(recovered.length).toBeGreaterThan(originalBundles.length);
    for (const name of originalBundles) expect(recovered).toContain(name);
    expect((await page.evaluate(() => window.api.localSyncGetStatus())).delivery?.folderBound).toBe(true);
  } finally {
    await restarted?.close();
  }
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

test('administrator reviews and publishes recovery into a separate mailbox through the native dialog', async ({ app, window, userHome }) => {
  const old = path.join(userHome, 'old-mailbox'); const destination = path.join(userHome, 'recovered-mailbox');
  fs.mkdirSync(old); fs.mkdirSync(destination);
  expect(await window.evaluate(() => window.api.recoveryList())).toMatchObject({ success: false });
  expect(await window.evaluate((syncFolder) => window.api.localSyncConfigure({ syncFolder, passphrase: 'synthetic-sync-acceptance-secret' }), old)).toMatchObject({ success: true });
  expect(await window.evaluate(() => window.api.localAuthCreateFirstAdmin({ name: 'Recovery Admin', email: 'recovery@example.test', password: 'admin-password', syncPassphrase: 'synthetic-sync-acceptance-secret' }))).toMatchObject({ success: true });
  await saveEntry(window, 'recovery-entry');
  const original = await window.evaluate(() => window.api.getDbPath());
  await window.reload();
  await window.locator('a[href="#/settings"]').click();
  await window.getByRole('button', { name: 'Review sync recovery', exact: true }).click();
  await window.getByRole('button', { name: 'Prepare private review', exact: true }).click();
  await expect(window.getByText('Account totals include pending entries; rejected and planned entries are excluded.', { exact: true })).toBeVisible();
  await expect(window.getByText('Ledger captured', { exact: false })).toBeVisible();
  expect(fs.readdirSync(destination)).toEqual([]);
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, destination);
  await window.getByRole('button', { name: 'Choose empty new mailbox', exact: true }).click();
  await window.getByLabel('Every old client is paused and will rejoin the new mailbox.', { exact: true }).check();
  await window.getByLabel('I have reviewed the account changes, file choices and missing-device decisions.', { exact: true }).check();
  await window.getByRole('button', { name: 'Publish recovered account and mailbox', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Open recovered account', exact: true })).toBeVisible();
  expect(await window.evaluate(() => window.api.getDbPath())).toBe(original);
  expect(fs.existsSync(path.join(old, '.fidra-sync'))).toBe(true);
  expect(fs.existsSync(path.join(destination, '.fidra-sync'))).toBe(true);
  expect((await window.evaluate(() => window.api.getTransactions())).find((entry) => entry.id === 'recovery-entry')?.amount).toBe('19.50');
  await window.getByRole('button', { name: 'Refresh review', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Open recovered account', exact: true })).toBeVisible();
});
