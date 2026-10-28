import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from './fixtures';
import type { UpdateStatus } from '../src/shared/update-types';

const ready: UpdateStatus = {
  revision: 1000, phase: 'ready', currentVersion: '0.1.23', version: '0.1.24', releaseNotes: ['Simpler app updates'],
  progress: 100, lastCheckedAt: '2026-10-21T12:00:00Z', automatic: true, remindAfter: null,
  installerReady: true, error: null, message: null,
};

test('updates have a persistent Settings panel with honest installation controls', async ({ window, app }) => {
  await window.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await window.locator('a[href="#/settings"]').click();
  await expect(window.getByText('Updates', { exact: true })).toBeVisible();
  await expect(window.getByText('Update checks are available in installed macOS and Windows builds.')).toBeVisible();
  await app.evaluate(({ BrowserWindow }, status) => {
    BrowserWindow.getAllWindows()[0].webContents.send('updates:status', status);
  }, ready);
  await expect(window.getByRole('button', { name: 'Open installer', exact: true })).toHaveCount(2);
  await expect(window.getByText('Simpler app updates')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Install & Restart' })).toHaveCount(0);
  await window.locator('a[href="#/"]').click();
  await expect(window.getByRole('status', { name: 'Fidra update' })).toBeVisible();
  await window.locator('a[href="#/settings"]').click();
  await expect(window.getByText('Version 0.1.24 is ready')).toBeVisible();
  await window.getByText('Updates', { exact: true }).scrollIntoViewIfNeeded();
  // Optional review artifact, separate from the functional acceptance above.
  // Chromium capture can stall on macOS even after every UI assertion passes.
  if (process.env.FIDRA_E2E_CAPTURE_UI === '1') await window.screenshot({ path: '/tmp/fidra-update-panel.png' });
});

test('update status reaches every window and manual-only preferences persist', async ({ window, app, userHome }) => {
  await window.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await window.evaluate(() => window.api.setAutomaticUpdates(false));
  const saved = path.join(userHome, 'userData', 'updates', 'state.json');
  await expect.poll(() => JSON.parse(fs.readFileSync(saved, 'utf8')).automatic).toBe(false);
  await window.reload();
  await expect.poll(() => window.evaluate(async () => (await window.api.getUpdateStatus()).automatic)).toBe(false);
  const newWindow = app.waitForEvent('window');
  await window.evaluate((dbPath) => window.api.createWindow(dbPath), path.join(userHome, 'second.fdra'));
  const second = await newWindow;
  await second.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }, status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updates:status', status);
  }, ready);
  for (const page of [window, second]) await expect(page.getByRole('status', { name: 'Fidra update' })).toBeVisible();
  // A late initial-status reply must not replace a newer pushed status.
  await app.evaluate(({ BrowserWindow }, status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updates:status', { ...status, revision: 1, phase: 'idle', installerReady: false });
  }, ready);
  for (const page of [window, second]) await expect(page.getByText('Fidra is ready to update')).toBeVisible();
});

test('preparing an update preserves an unfinished transaction and releases the window on cancellation', async ({ window, app }) => {
  await window.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await window.locator('a[href="#/transactions"]').click();
  // The form is a persistent side panel; show it if collapsed.
  const show = window.getByTitle('Show form', { exact: true });
  if (await show.isVisible()) await show.click();
  await window.getByPlaceholder('What was this for?').fill('Unfinished update test');
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('updates:prepared');
    ipcMain.handle('updates:prepared', (event, reply) => {
      event.sender.send('updates:status', { revision: 1000, phase: 'error', currentVersion: '0.1.23', version: '0.1.24',
        releaseNotes: [], progress: 100, lastCheckedAt: null, automatic: true, remindAfter: null,
        installerReady: true, message: null, error: reply.reason });
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updates:cancelPreparation');
    });
    BrowserWindow.getAllWindows()[0].webContents.send('updates:prepare', '04b5d8da-1b58-4ee2-b1da-53137a397c70');
  });
  await expect(window.getByRole('alert')).toContainText('unfinished transaction', { timeout: 15_000 });
  await expect(window.getByPlaceholder('What was this for?')).toHaveValue('Unfinished update test');
  await expect.poll(() => window.evaluate(() => document.body.inert)).toBe(false);
});

test('invoice autosaves finish before the update acknowledgement', async ({ window, app }) => {
  await window.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await window.locator('a[href="#/invoices"]').click();
  await window.getByRole('button', { name: 'Start a new invoice' }).click();
  await window.getByPlaceholder('Organisation / sender name').fill('Update test club');
  await window.getByPlaceholder('Recipient name').fill('Update test recipient');
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('updates:prepared');
    ipcMain.handle('updates:prepared', (event, reply) => {
      BrowserWindow.fromWebContents(event.sender)?.setTitle(reply.reason ?? 'Update preparation complete');
      event.sender.send('updates:cancelPreparation');
    });
    BrowserWindow.getAllWindows()[0].webContents.send('updates:prepare', '88bd6c97-5449-4f47-92f4-ea61c59751a4');
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), { timeout: 15_000 }).toBe('Update preparation complete');
  const invoices = await window.evaluate(() => window.api.getInvoices());
  expect(invoices).toHaveLength(1);
  expect(invoices[0].to_name).toBe('Update test recipient');
  expect(invoices[0].from_name).toBe('Update test club');
  expect((await window.evaluate(() => window.api.getInvoiceDefaults())).fromName).toBe('Update test club');
  await expect.poll(() => window.evaluate(() => document.body.inert)).toBe(false);
});

test('the next launch restores the ledger windows recorded by an update handoff', async ({ window, app, userHome }) => {
  await window.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  const firstPath = await window.evaluate(() => window.api.getDbPath());
  const secondPath = path.join(userHome, 'restored-ledger.fdra');
  const newWindow = app.waitForEvent('window');
  await window.evaluate((dbPath) => window.api.createWindow(dbPath), secondPath);
  const second = await newWindow;
  await second.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  const settingsPath = path.join(userHome, '.fidra', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.updateReopenPaths = [firstPath, secondPath];
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  await app.close();
  const reopened = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(userHome, 'userData')}`], cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' },
  });
  try {
    await expect.poll(() => reopened.windows().length).toBe(2);
    const paths = await Promise.all(reopened.windows().map(async (page) => {
      await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      return page.evaluate(() => window.api.getDbPath());
    }));
    expect(paths.sort()).toEqual([firstPath, secondPath].sort());
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).updateReopenPaths).toBeUndefined();
  } finally {
    await reopened.close();
  }
});
