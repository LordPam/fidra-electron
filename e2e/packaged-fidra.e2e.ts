import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { packagedFidraClient, toolData } from './helpers/packaged-fidra-client';
import { refreshInstalledAiHelper, helperPayloadFiles, type HelperPayload } from '../src/main/services/ai-helper-update';
import type { TransactionRow, PlannedTemplateRow, InvoiceRow } from '../src/shared/ipc-types';

const pluginRoot = process.env.FIDRA_E2E_PLUGIN_ROOT;
test.skip(!pluginRoot, 'Set FIDRA_E2E_PLUGIN_ROOT to an isolated plugin build to run packaged-adapter acceptance.');
test.beforeEach(async ({ app }) => {
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (value) => Buffer.from(value.split('').reverse().join(''));
    safeStorage.decryptString = (value) => value.toString().split('').reverse().join('');
  });
});

async function approve(window: Page, labels: string[], ledgerWide = false) {
  await window.getByRole('button', { name: 'Review connection request' }).click();
  const dialog = window.getByRole('dialog');
  await dialog.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await dialog.getByLabel(ledgerWide ? 'All current and future accounts, including ledger-wide operations' : 'General', { exact: true }).check();
  for (const label of labels) await dialog.getByLabel(label, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

function fixtures() {
  const now = '2026-10-27T00:00:00Z';
  const transaction: TransactionRow = { id: 'public-entry', sheet: 'General', date: '2026-10-27', description: 'Public entry', amount: '12.00', type: 'expense', status: 'pending', category: 'Pool', party: null, reference: null, activity: 'Synthetic trip', notes: 'WITHHELD_PRIVATE_NOTE', linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: null };
  const plan: PlannedTemplateRow = { id: 'public-plan', start_date: '2026-10-27', description: 'Public plan', amount: '12.00', type: 'expense', frequency: 'once', target_sheet: 'General', transfer_target_sheet: null, category: null, party: null, activity: null, notes: 'WITHHELD_PRIVATE_NOTE', end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', version: 1, created_at: now };
  const invoice: InvoiceRow = { id: 'invoice', invoice_number: 'TEST-001', date: '2026-10-27', due_date: '2026-10-27', from_name: 'Synthetic club', from_address: null, to_name: 'Synthetic recipient', to_address: null, line_items: JSON.stringify({ items: [{ description: 'Test invoice', quantity: 1, unitPrice: 12, internal: 'WITHHELD_PRIVATE_NOTE' }], internal: 'WITHHELD_PRIVATE_NOTE', taxRate: 0 }), subtotal: '12.00', notes: 'WITHHELD_PRIVATE_NOTE', bank_details: null, planned_template_id: null, status: 'draft', transaction_id: null, paid_at: null, planned_template_snapshot: null, version: 1, created_at: now, modified_at: null, modified_by: null };
  return { transaction, plan, invoice };
}

test('packaged extension enforces native scope, filters data, retries backups and loses access on revocation', async ({ app, window, userHome }) => {
  test.setTimeout(90_000);
  if (!pluginRoot) throw new Error('Missing packaged plugin root');
  expect(fs.readFileSync(path.join(pluginRoot, 'server/server.cjs'), 'utf8')).toBe(fs.readFileSync(path.resolve('resources/ai-bridge/server.cjs'), 'utf8'));
  const client = packagedFidraClient(pluginRoot, userHome);
  try {
    const initialized = await client.request('initialize', { protocolVersion: '2025-06-18' });
    expect(initialized.result?.instructions).toContain('Work with Fidra');
    const catalog = await client.request('tools/list');
    expect(catalog.result?.tools).toHaveLength(19);
    expect(catalog.result?.tools?.map((tool) => tool.name)).not.toContain('execute_sql');
    expect(toolData(await client.call('list_connections'))).toEqual([]);
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect((await client.call('read_transactions', range)).error).toBeDefined();
    await window.evaluate(async (data) => {
      await window.api.createSheet('private-account', 'Private');
      await window.api.saveTransaction(data.transaction);
      await window.api.saveTransaction({ ...data.transaction, id: 'private-entry', sheet: 'Private', description: 'PRIVATE_ACCOUNT_ENTRY' });
      await window.api.savePlannedTemplate(data.plan);
      await window.api.savePlannedTemplate({ ...data.plan, id: 'transfer-plan', description: 'PRIVATE_TRANSFER_PLAN', transfer_target_sheet: 'Private' });
      await window.api.saveInvoice(data.invoice);
      await window.api.setCategories('expense', ['Pool', 'Travel']);
      await window.api.saveActivityNote('Synthetic trip', 'WITHHELD_PRIVATE_NOTE');
    }, fixtures());
    await window.locator('a[href="#/settings"]').click();
    await window.getByLabel('Owner name', { exact: true }).fill('Synthetic packaged test owner');
    await window.getByLabel('Owner password', { exact: true }).fill('synthetic-owner-password');
    await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
    await client.call('connect_fidra');
    await approve(window, ['Read transactions in permitted accounts', 'Read planned payments']);
    const narrow = toolData(await client.call('list_connections'))[0];
    const actuals = toolData(await client.call('read_transactions', range));
    expect(actuals.rows).toHaveLength(1);
    expect(actuals.rows[0]).toMatchObject({ id: 'public-entry', amount: '12.00', version: 1 });
    expect(JSON.stringify(actuals)).not.toContain('PRIVATE_ACCOUNT_ENTRY');
    expect(JSON.stringify(actuals)).not.toContain('WITHHELD_PRIVATE_NOTE');
    expect((await client.call('read_transactions', { ...range, sheetIds: ['private-account'] })).error).toBeDefined();
    expect((await client.call('read_transactions', { ...range, permissions: { allAccounts: true } })).error).toBeDefined();
    expect(toolData(await client.call('read_planned')).rows).toHaveLength(1);
    expect((await client.call('create_backup', { requestId: crypto.randomUUID() })).error).toBeDefined();
    expect(await window.evaluate(() => window.api.backupList())).toHaveLength(0);
    await window.getByRole('button', { name: 'Revoke access', exact: true }).click();
    expect((await client.call('read_transactions', { ...range, connectionId: narrow.id })).error).toBeDefined();
    expect(toolData(await client.call('list_connections'))).toEqual([]);

    await client.call('connect_fidra');
    await approve(window, ['Read transactions in permitted accounts', 'Read planned payments', 'Read invoices and their billing details', 'Manage ledger categories', 'Manage activities and their notes', 'Read supported application settings', 'Read team names, emails and roles', 'Read synchronization status', 'Run synchronization', 'List this ledger’s backups', 'Create ledger backups'], true);
    expect(toolData(await client.call('read_transactions', range)).rows).toHaveLength(2);
    expect(toolData(await client.call('read_planned')).rows).toHaveLength(2);
    const invoices = toolData(await client.call('read_invoices', range));
    expect(invoices.rows[0]).toMatchObject({ invoiceNumber: 'TEST-001', toName: 'Synthetic recipient' });
    expect(JSON.stringify(invoices)).not.toContain('WITHHELD_PRIVATE_NOTE');
    expect(toolData(await client.call('read_categories')).expense).toEqual(['Pool', 'Travel']);
    expect(toolData(await client.call('read_activities'))).toEqual([{ name: 'Synthetic trip' }]);
    expect(toolData(await client.call('read_settings', { groups: ['financialYear'] }))).toEqual({ financialYear: { startMonth: 1 } });
    expect((await client.call('read_settings', { groups: ['localSync.passphrase'] })).error).toBeDefined();
    expect((await client.call('read_personnel')).error?.message).toContain('administrator');
    expect(toolData(await client.call('read_sync_status'))).toMatchObject({ enabled: false });
    expect((await client.call('run_sync', { direction: 'both' })).error?.message).toContain('stopped');
    const requestId = crypto.randomUUID();
    const backup = toolData(await client.call('create_backup', { requestId }));
    expect(toolData(await client.call('create_backup', { requestId })).id).toBe(backup.id);
    const listed = toolData(await client.call('read_backups'));
    expect(listed.backups).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(userHome);
    expect((await client.call('execute_sql', { query: 'DELETE FROM transactions' })).error).toBeDefined();
    expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(2);
    await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('lock-screen'); powerMonitor.emit('unlock-screen'); });
    expect((await client.call('read_transactions', range)).error).toBeDefined();
    await window.getByLabel('Owner name', { exact: true }).fill('Synthetic packaged test owner');
    await window.getByLabel('Owner password', { exact: true }).fill('synthetic-owner-password');
    await window.getByRole('button', { name: 'Unlock access', exact: true }).click();
    expect(toolData(await client.call('read_transactions', range)).rows).toHaveLength(2);
    await window.getByRole('button', { name: 'Revoke access', exact: true }).click();
    expect((await client.call('read_backups')).error).toBeDefined();
  } finally { await client.close(); }
});

test('packaged extension reads team roles and runs configured sync only for the current approved administrator', async ({ window, userHome }) => {
  if (!pluginRoot) throw new Error('Missing packaged plugin root');
  const folder = path.join(userHome, 'synthetic-shared'); fs.mkdirSync(folder);
  expect(await window.evaluate((syncFolder) => window.api.localSyncConfigure({ syncFolder, passphrase: 'synthetic-team-passphrase' }), folder)).toMatchObject({ success: true });
  expect(await window.evaluate(() => window.api.localAuthCreateFirstAdmin({ name: 'Synthetic admin', email: 'admin@example.test', password: 'synthetic-admin-password', syncPassphrase: 'synthetic-team-passphrase' }))).toMatchObject({ success: true });
  await window.reload();
  await window.locator('a[href="#/settings"]').click();
  const client = packagedFidraClient(pluginRoot, userHome);
  try {
    await client.call('connect_fidra');
    await approve(window, ['Read team names, emails and roles', 'Read synchronization status', 'Run synchronization'], true);
    const people = toolData(await client.call('read_personnel'));
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: 'Synthetic admin', email: 'admin@example.test', role: 'admin' });
    expect(Object.keys(people[0]).sort()).toEqual(['email', 'id', 'name', 'role']);
    expect(toolData(await client.call('read_sync_status'))).toMatchObject({ enabled: true });
    const result = toolData(await client.call('run_sync', { direction: 'both' }));
    expect(result.exported).toHaveProperty('changesetCount');
    expect(result.imported).toHaveProperty('conflictsQueued');
    expect(result.instructions).toContain('human review');
    expect(JSON.stringify(result)).not.toContain('synthetic-team-passphrase');
    expect(JSON.stringify(result)).not.toContain(userHome);
    expect((await client.call('run_sync', { direction: 'import', passphrase: 'invented-secret' })).error).toBeDefined();
    expect(await window.evaluate(() => window.api.localAuthSignOut())).toEqual({ success: true });
    expect((await client.call('read_personnel')).error).toBeDefined();
    expect((await client.call('run_sync', { direction: 'both' })).error).toBeDefined();
    expect(toolData(await client.call('list_connections'))[0].active).toBe(false);
  } finally { await client.close(); }
});


test('app-managed helper upgrade preserves installation identity and existing narrow native approval', async ({ window, userHome }) => {
  if (!pluginRoot) throw new Error('Missing packaged plugin root');
  const root = path.join(userHome, '.fidra/ai-plugin/2.0.4');
  fs.cpSync(pluginRoot, root, { recursive: true });
  fs.copyFileSync(path.resolve('src/main/services/__tests__/fixtures/fidra-helper-2.0.4.cjs'), path.join(root, 'server/server.cjs'));
  const originalNames = ['connect_fidra', 'list_connections', 'read_context', 'register_statement', 'read_statement', 'stage_reconciliation', 'get_proposal', 'apply_reconciliation'];
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'tools.json'), JSON.stringify({ tools: catalog.tools.filter((tool: { name: string }) => originalNames.includes(tool.name)) }));
  const old = packagedFidraClient(root, userHome);
  let connectionId: string;
  try {
    expect((await old.request('tools/list')).result?.tools).toHaveLength(8);
    await window.locator('a[href="#/settings"]').click();
    await window.getByLabel('Owner name', { exact: true }).fill('Synthetic upgrade owner');
    await window.getByLabel('Owner password', { exact: true }).fill('synthetic-upgrade-password');
    await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
    await old.call('connect_fidra');
    await approve(window, []);
    const connection = toolData(await old.call('list_connections'))[0];
    expect(connection.permissions.capabilities).toEqual([]);
    connectionId = connection.id;
  } finally { await old.close(); }
  const identity = fs.readFileSync(path.join(userHome, 'synthetic-test-identity.pem'), 'utf8');
  const bootstrap = fs.readFileSync(path.resolve('resources/ai-bridge/helper-bootstrap.cjs'), 'utf8');
  const payload = Object.fromEntries(helperPayloadFiles.map((name) => [name, fs.readFileSync(path.join(pluginRoot, name), 'utf8')])) as HelperPayload;
  expect(refreshInstalledAiHelper(userHome, bootstrap, payload)).toBe('updated');
  const updated = packagedFidraClient(root, userHome);
  try {
    expect((await updated.request('initialize', {})).result?.instructions).toContain('Work with Fidra');
    expect((await updated.request('tools/list')).result?.tools).toHaveLength(19);
    const connection = toolData(await updated.call('list_connections'))[0];
    expect(connection.id).toBe(connectionId);
    expect(connection.permissions.capabilities).toEqual([]);
    expect((await updated.call('read_transactions', { from: '2026-10-01', to: '2026-10-31' })).error?.message).toContain('permission');
    expect(fs.readFileSync(path.join(userHome, 'synthetic-test-identity.pem'), 'utf8')).toBe(identity);
    expect(refreshInstalledAiHelper(userHome, bootstrap, payload)).toBe('current');
  } finally { await updated.close(); }
});
