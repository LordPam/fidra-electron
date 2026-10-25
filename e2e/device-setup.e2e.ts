import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

test.describe('first installation', () => {
  test.use({ startInSetup: true });
  test('offers setup and creates a local ledger without a save dialog', async ({ window, app, userHome }) => {
    await expect(window.getByRole('heading', { name: 'Welcome to Fidra' })).toBeVisible();
    expect(fs.existsSync(path.join(userHome, 'userData', 'fidra.db'))).toBe(false);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('Setup should choose a location automatically'); }; });
    await window.getByRole('button', { name: /Start a ledger/ }).click();
    await expect(window.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const file = await window.evaluate(() => window.api.getDbPath());
    expect(file.startsWith(path.join(userHome, '.fidra', 'accounts'))).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    await window.reload();
    await expect(window.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

test('device reset keeps financial files and offers them again on reinstall', async ({ window, app, userHome }) => {
  const originalPath = await window.evaluate(() => window.api.getDbPath());
  await window.evaluate(async () => {
    await window.api.saveTransaction({ id: 'retained-reset-row', date: '2026-10-24', description: 'Keep this transaction', amount: '12.34',
      type: 'expense', status: '--', sheet: 'General', category: null, party: null, reference: null, activity: null, notes: null,
      linked_id: null, version: 1, created_at: '2026-10-24T12:00:00Z', modified_at: null, modified_by: null });
  });
  const attachments = path.join(userHome, '.fidra', 'attachments', 'retention-test');
  fs.mkdirSync(attachments, { recursive: true }); fs.writeFileSync(path.join(attachments, 'receipt.pdf'), 'retain receipt');
  fs.mkdirSync(path.join(userHome, '.fidra', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(userHome, '.fidra', 'sessions', 'test.enc'), 'old session');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  const closed = app.waitForEvent('close');
  await window.evaluate(() => { void window.api.resetDevice(); });
  await closed;
  expect(fs.existsSync(originalPath)).toBe(true);
  expect(fs.readFileSync(path.join(attachments, 'receipt.pdf'), 'utf8')).toBe('retain receipt');
  expect(fs.existsSync(path.join(userHome, '.fidra', 'sessions'))).toBe(false);
  expect(fs.existsSync(path.join(userHome, '.fidra', 'settings.json'))).toBe(false);
  const relaunched = await electron.launch({ args: ['.', `--user-data-dir=${path.join(userHome, 'userData')}`], cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' } });
  try {
    const page = await relaunched.firstWindow();
    await expect(page.getByText('Continue with saved accounts', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(path.basename(originalPath)) }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => window.api.getTransaction('retained-reset-row'))).toMatchObject({ amount: '12.34' });
  } finally { await relaunched.close(); }
});

test('reset is blocked by unfinished work in another window and leaves both usable', async ({ window, app, userHome }) => {
  const created = app.waitForEvent('window');
  await window.evaluate((file) => window.api.createWindow(file), path.join(userHome, 'another.fdra'));
  const second = await created;
  await second.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await second.locator('a[href="#/transactions"]').click();
  const show = second.getByTitle('Show form', { exact: true }); if (await show.isVisible()) await show.click();
  await second.getByPlaceholder('What was this for?').fill('Still working');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  const result = await window.evaluate(() => window.api.resetDevice());
  expect(result.success).toBe(false); expect(result.error).toContain('unfinished transaction');
  await expect(second.getByPlaceholder('What was this for?')).toHaveValue('Still working');
  await expect.poll(() => window.evaluate(() => document.body.inert)).toBe(false);
  expect(await window.evaluate(() => window.api.getSheets())).toHaveLength(1);
});
