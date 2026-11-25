import { test, expect } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function aiClient(userHome: string) {
  const key = crypto.generateKeyPairSync('ed25519');
  const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return async (name: string, args: unknown = {}) => {
    const endpoint = JSON.parse(fs.readFileSync(path.join(userHome, '.fidra', 'ai-access', 'endpoint.json'), 'utf8'));
    const post = async (route: string, value: unknown) => (await fetch(endpoint.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).json();
    const challenge = await post('/challenge', { publicKey, client: 'chatgpt' });
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify([challenge.serverId, challenge.id, challenge.value, 'chatgpt', request])), key.privateKey).toString('base64');
    return post('/rpc', { publicKey, client: 'chatgpt', challengeId: challenge.id, signature, request });
  };
}
function content(result: { result: { content: { text: string }[] } }) { return JSON.parse(result.result.content[0].text); }
// Override only secure storage's crypto implementation inside the isolated app.
// These tests never use the developer's Keychain or a real financial ledger.
test.beforeEach(async ({ app }) => {
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (value) => Buffer.from(value.split('').reverse().join(''), 'utf8');
    safeStorage.decryptString = (value) => value.toString('utf8').split('').reverse().join('');
  });
});

test('sheet creation uses native permission, refreshes the view and supports guarded Undo and Redo', async ({ window, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('Owner name', { exact: true }).fill('Synthetic owner');
  await window.getByLabel('Owner password', { exact: true }).fill('synthetic-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome);
  const args = { requestId: crypto.randomUUID(), name: 'Synthetic: Savings' };
  expect((await call('create_sheet', args)).error).toBeDefined();
  const pending = content(await call('connect_fidra')).pending;
  await window.getByRole('button', { name: 'Review connection request' }).click();
  const dialog = window.getByRole('dialog');
  await expect(dialog.getByText(pending.code, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Create, rename, merge, delete and reorder accounts', { exact: true })).toBeDisabled();
  await dialog.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await dialog.getByLabel('All current and future accounts, including ledger-wide operations', { exact: true }).check();
  await dialog.getByLabel('Create, rename, merge, delete and reorder accounts', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Allow access', exact: true }).click();
  expect(content(await call('list_connections'))[0].permissions.capabilities).toEqual(['sheets.manage']);
  const created = content(await call('create_sheet', args));
  expect(created).toMatchObject({ state: 'applied', sheet: { name: args.name }, currentSheet: { name: args.name } });
  expect(content(await call('create_sheet', args))).toEqual(created);
  await expect(window.getByRole('status', { name: 'AI sheet created', exact: true })).toBeVisible();
  await window.getByRole('button', { name: 'View sheets', exact: true }).click();
  await expect(window.getByTitle(`Undo: Create sheet: ${args.name}`, { exact: true })).toBeEnabled();
  await window.getByTitle(`Undo: Create sheet: ${args.name}`, { exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.api.getSheets()).then((sheets) => sheets.some((sheet) => sheet.name === 'Synthetic: Savings'))).toBe(false);
  expect(content(await call('create_sheet', args))).toMatchObject({ state: 'undone', currentSheet: null });
  await window.getByTitle(`Redo: Create sheet: ${args.name}`, { exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.api.getSheets()).then((sheets) => sheets.some((sheet) => sheet.name === 'Synthetic: Savings'))).toBe(true);
  expect(content(await call('list_connections'))[0].accounts).toContainEqual(created.sheet);
  await window.evaluate(async () => {
    await window.api.saveTransaction({ id: 'synthetic-after-create', date: '2026-11-02', description: 'Synthetic entry', amount: '1.00', type: 'income', status: '--',
      sheet: 'Synthetic: Savings', category: null, party: null, reference: null, activity: null, notes: null, linked_id: null, version: 1,
      created_at: '2026-11-02T12:00:00Z', modified_at: null, modified_by: null });
  });
  const error = await window.evaluate(async (receiptId) => {
    try { await window.api.changeAiSheetCreation({ receiptId, direction: 'undo' }); return null; }
    catch (error) { return String(error); }
  }, created.receiptId);
  expect(error).toContain('no longer empty');
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(1);
  expect((await call('create_sheet', { ...args, requestId: crypto.randomUUID(), name: ' ALL SHEETS ' })).error).toBeDefined();
  await window.locator('a[href="#/settings"]').click();
  await window.getByRole('button', { name: 'Revoke access', exact: true }).click();
  expect((await call('create_sheet', { ...args, requestId: crypto.randomUUID(), name: 'Denied' })).error).toBeDefined();
  expect((await window.evaluate(() => window.api.getSheets())).map((sheet) => sheet.name)).not.toContain('Denied');
});

test('general ledger edits create statement-free plans, split receipts and record native Undo without expanding consent', async ({ window, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('Owner name', { exact: true }).fill('Synthetic owner');
  await window.getByLabel('Owner password', { exact: true }).fill('synthetic-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome);
  const pending = content(await call('connect_fidra')).pending;
  await window.getByRole('button', { name: 'Review connection request' }).click();
  const dialog = window.getByRole('dialog');
  await expect(dialog.getByText(pending.code, { exact: true })).toBeVisible();
  await dialog.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  for (const name of ['Read transactions in permitted accounts', 'Create and edit transactions', 'Read planned payments', 'Create, edit and fulfil planned payments']) await dialog.getByLabel(name, { exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Allow access', exact: true })).toBeDisabled();
  await dialog.getByLabel('General', { exact: true }).check();
  await expect(dialog.getByLabel('All current and future accounts, including ledger-wide operations', { exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Allow access', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Allow access', exact: true }).click();
  const accounts = content(await call('list_connections'))[0].accounts;
  const main = accounts.find((row: { name: string }) => row.name === 'General');
  expect(main).toBeTruthy();
  await window.evaluate(async () => {
    await window.api.saveTransaction({ id: 'split-receipt', date: '2026-11-25', description: 'Two fees paid together', amount: '50.00', type: 'income', status: '--', sheet: 'General',
      category: null, party: null, reference: null, activity: null, notes: null, linked_id: null, version: 1, created_at: '2026-11-25T12:00:00Z', modified_at: null, modified_by: null });
  });
  const optional = { category: null, party: null, activity: null, notes: null };
  const input = { requestId: crypto.randomUUID(), label: 'Synthetic dinner and trip changes', actions: [
    { kind: 'create_planned', value: { ...optional, description: 'Expected dinner fee', startDate: '2026-11-30', amount: '25.00', type: 'income', sheetId: main.id,
      frequency: 'once', endDate: null, occurrenceCount: null, transferSheetId: null }, reason: 'The owner requested one expected payment.' },
    { kind: 'split_transaction', id: 'split-receipt', version: 1, parts: [
      { description: 'Dinner fee', amount: '25.00' }, { description: 'Weekend trip fee (driver)', amount: '25.00' },
    ], reason: 'The owner confirmed two fees paid together.' },
  ] };
  const preview = content(await call('prepare_ledger_changes', input));
  expect(preview.state).toBe('ready'); expect(await window.evaluate(() => window.api.getPlannedTemplates())).toEqual([]);
  expect(content(await call('apply_ledger_changes', { id: preview.id, digest: preview.digest })).state).toBe('committed');
  await expect.poll(() => window.evaluate(() => window.api.getPlannedTemplates()).then((rows) => rows.length)).toBe(1);
  expect((await window.evaluate(() => window.api.getTransactions())).map((row) => row.amount)).toEqual(['25.00', '25.00']);
  await expect(window.getByText('Synthetic dinner and trip changes · Applied', { exact: true })).toBeVisible();
  await window.getByText('Synthetic dinner and trip changes · Applied', { exact: true }).click();
  await window.getByRole('button', { name: 'Undo these changes', exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.api.getPlannedTemplates()).then((rows) => rows.length)).toBe(0);
  expect((await window.evaluate(() => window.api.getTransactions()))[0].amount).toBe('50.00');
  expect(content(await call('apply_ledger_changes', { id: preview.id, digest: preview.digest })).state).toBe('undone');
  expect((await call('prepare_ledger_changes', { ...input, requestId: crypto.randomUUID(), actions: [{ kind: 'set_financial_year', expected: 1, startMonth: 9, reason: 'Not approved' }] })).error).toBeDefined();
});

test('ledger cleanup requires native destructive review and supports atomic linked transfers, income defaults and Undo/Redo', async ({ window, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('Owner name', { exact: true }).fill('Synthetic owner');
  await window.getByLabel('Owner password', { exact: true }).fill('synthetic-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome); await call('connect_fidra');
  await window.getByRole('button', { name: 'Review connection request' }).click();
  const dialog = window.getByRole('dialog');
  await dialog.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await dialog.getByLabel('All current and future accounts, including ledger-wide operations', { exact: true }).check();
  for (const label of ['Read transactions in permitted accounts', 'Create and edit transactions', 'Delete transactions', 'Record and edit internal ledger transfers', 'Create, rename, merge, delete and reorder accounts']) await dialog.getByLabel(label, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Allow access', exact: true }).click();
  const mainId = await window.evaluate(async () => {
    await window.api.createSheet('cleanup-pocket', 'Pocket');
    const sheet = (await window.api.getSheets()).find((row) => row.name === 'General');
    if (!sheet) throw new Error('Missing synthetic main sheet');
    const now = '2026-11-04T12:00:00Z';
    for (const [id, type, amount] of [['cleanup-out', 'expense', '12.00'], ['cleanup-in', 'income', '12.00'], ['cleanup-move', 'income', '3.00']] as const) {
      await window.api.saveTransaction({ id, date: '2026-10-24', description: `Synthetic ${id}`, amount, type, status: 'pending', sheet: 'General',
        category: null, party: null, reference: null, activity: null, notes: null, linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: null });
    }
    return sheet.id;
  });
  const input = { requestId: crypto.randomUUID(), label: 'Synthetic ledger cleanup', actions: [
    { kind: 'rename_sheet', sheetId: mainId, expectedName: 'General', name: 'Synthetic: Personal', reason: 'Preserve history while renaming.' },
    { kind: 'move_entries', entries: [{ id: 'cleanup-move', version: 1 }], targetSheetId: 'cleanup-pocket', reason: 'Move this identified pocket income.' },
    { kind: 'replace_with_transfer', entries: [{ id: 'cleanup-out', version: 1 }, { id: 'cleanup-in', version: 1 }], fromSheetId: mainId, toSheetId: 'cleanup-pocket', description: 'Synthetic linked transfer', reason: 'Match the two statement sides as an internal transfer.' },
  ] };
  const preview = content(await call('prepare_ledger_cleanup', input));
  expect(preview.state).toBe('draft');
  expect((await call('apply_ledger_cleanup', { id: preview.id, digest: preview.digest })).error.message).toContain('inside Fidra');
  expect((await window.evaluate(() => window.api.getTransactions())).every((row) => row.linked_id === null)).toBe(true);
  await window.getByText('Synthetic ledger cleanup · Review required', { exact: true }).click();
  await expect(window.getByRole('button', { name: 'Approve this cleanup', exact: true })).toBeDisabled();
  await window.getByLabel('I reviewed the accounts, dates, amounts and removals', { exact: true }).check();
  await window.getByRole('button', { name: 'Approve this cleanup', exact: true }).click();
  expect(content(await call('get_ledger_cleanup', { id: preview.id })).state).toBe('approved');
  expect(content(await call('apply_ledger_cleanup', { id: preview.id, digest: preview.digest })).state).toBe('committed');
  expect(content(await call('apply_ledger_cleanup', { id: preview.id, digest: preview.digest })).state).toBe('committed');
  await expect(window.getByRole('status', { name: 'AI ledger cleanup applied', exact: true })).toBeVisible();
  const after = await window.evaluate(() => window.api.getTransactions());
  expect(after).toHaveLength(3); expect(after.filter((row) => row.linked_id)).toHaveLength(2);
  expect(after.filter((row) => row.type === 'income').every((row) => row.status === '--')).toBe(true);
  expect(after.find((row) => row.id === 'cleanup-move')?.sheet).toBe('Pocket');
  expect((await window.evaluate(() => window.api.backupList()))).toHaveLength(1);
  await window.getByRole('button', { name: 'Undo this cleanup', exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.api.getTransactions()).then((rows) => rows.some((row) => row.id === 'cleanup-out'))).toBe(true);
  expect(content(await call('apply_ledger_cleanup', { id: preview.id, digest: preview.digest })).state).toBe('undone');
  await window.locator('a[href="#/transactions"]').click();
  await window.getByTitle('Redo: Synthetic ledger cleanup', { exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.api.getTransactions()).then((rows) => rows.filter((row) => row.linked_id).length)).toBe(2);
  expect((await window.evaluate(() => window.api.getTransactions())).filter((row) => row.type === 'income').every((row) => row.status === '--')).toBe(true);
});

test('plugin initiates a persistent permission prompt, imports a statement, and supports native Undo', async ({ window, app, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await expect(window.getByRole('button', { name: 'Save ChatGPT extension (trial)' })).toHaveCount(0);
  await expect(window.getByText('Export selected context', { exact: true })).toHaveCount(0);
  await window.getByLabel('Owner name', { exact: true }).fill('Trial owner');
  await window.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome);
  const pending = content(await call('connect_fidra')).pending;
  await window.getByRole('button', { name: 'Review connection request' }).click();
  await expect(window.getByText(pending.code, { exact: true })).toBeVisible();
  await window.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await window.getByRole('dialog').getByLabel('General', { exact: true }).check();
  await window.getByLabel('Receive statements I attach in my AI chat', { exact: true }).check();
  await window.getByLabel('Add missing entries and fulfil planned payments when I ask', { exact: true }).check();
  await window.getByRole('button', { name: 'Allow access', exact: true }).click();
  expect(content(await call('connect_fidra'))).toMatchObject({ connected: true });
  const context = content(await call('read_context', { from: '2026-10-01', to: '2026-10-31' }));
  await window.evaluate(() => window.api.savePlannedTemplate({ id: 'ai-plan', start_date: '2026-10-24', description: 'Pool hire', amount: '12.00', type: 'expense', frequency: 'once', target_sheet: 'General', category: null, party: null, activity: null, notes: null, end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 1, created_at: '2026-10-01T12:00:00Z' }));
  const source = content(await call('register_statement', { name: 'trial.csv', encoding: 'utf8', content: 'Date,Description,Amount\n2026-10-24,POOL PAYMENT,-12.00\n' }));
  const proposal = content(await call('stage_reconciliation', { label: 'Trial import', rows: [{ sheetId: context.accounts[0].id, source: { statementHash: source.hash, row: 0, date: '2026-10-24', amount: '12.00', type: 'expense', description: 'POOL PAYMENT', evidence: '2026-10-24,POOL PAYMENT,-12.00' }, description: 'Pool hire', party: null, category: null, activity: null, action: 'fulfil', planned: { templateId: 'ai-plan', date: '2026-10-24' } }] }));
  const input = { id: proposal.id, digest: proposal.digest, resolutions: proposal.review.filter((row: { questions: string[] }) => row.questions.length).map((row: { index: number }) => ({ rowIndex: row.index, answer: 'User confirmed the pool hire and the exact planned payment, with optional fields unassigned.' })) };
  expect((await call('apply_reconciliation', input)).error).toBeUndefined();
  expect((await call('apply_reconciliation', input)).error).toBeUndefined();
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(1);
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('["2026-10-24"]');
  expect(await window.evaluate(() => window.api.backupList())).toHaveLength(1);
  await window.getByText('Trial import · 1 rows · committed', { exact: true }).click();
  await window.getByRole('button', { name: 'Undo this import', exact: true }).click();
  await expect.poll(async () => (await window.evaluate(() => window.api.getTransactions())).length).toBe(0);
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('[]');
  // A lock suspends use without discarding consent.
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('lock-screen'); powerMonitor.emit('unlock-screen'); });
  expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
  expect((await window.evaluate(() => window.api.getAiBridgeState())).proposals).toEqual([]);
  await window.getByLabel('Owner name', { exact: true }).fill('Trial owner');
  await window.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
  await window.getByRole('button', { name: 'Unlock access', exact: true }).click();
  expect(content(await call('connect_fidra'))).toMatchObject({ connected: true });
  expect(content(await call('read_context', { from: '2026-09-01', to: '2026-09-30' })).accounts).toHaveLength(1);
  await window.getByRole('button', { name: 'Revoke access', exact: true }).click();
  expect(content(await call('list_connections'))).toEqual([]);
  expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
});

test('denied requests never access ledger context and cannot use the former export API', async ({ window, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('Owner name', { exact: true }).fill('Trial owner');
  await window.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome); await call('connect_fidra');
  await window.getByRole('button', { name: 'Review connection request' }).click();
  await expect(window.getByRole('button', { name: 'Allow access', exact: true })).toBeDisabled();
  await window.getByRole('button', { name: 'Deny', exact: true }).click();
  expect((await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
  expect(content(await call('list_connections'))).toEqual([]);
  expect(await window.evaluate(() => 'exportAiContext' in window.api || 'connectAi' in window.api || 'exportAiConnection' in window.api)).toBe(false);
});

test('approved access survives a full application restart without a second consent prompt', async ({ window, app, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('Owner name', { exact: true }).fill('Trial owner');
  await window.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome); await call('connect_fidra');
  await window.getByRole('button', { name: 'Review connection request' }).click();
  await window.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await window.getByRole('dialog').getByLabel('General', { exact: true }).check();
  await window.getByRole('button', { name: 'Allow access', exact: true }).click();
  const before = content(await call('list_connections'));
  expect(before).toHaveLength(1);
  await app.close();
  const { _electron: electron } = await import('@playwright/test');
  const restarted = await electron.launch({ args: ['.', `--user-data-dir=${path.join(userHome, 'userData')}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, HOME: userHome, USERPROFILE: userHome, FIDRA_E2E: '1' } });
  try {
    await restarted.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (value) => Buffer.from(value.split('').reverse().join(''), 'utf8');
      safeStorage.decryptString = (value) => value.toString('utf8').split('').reverse().join('');
    });
    const page = await restarted.firstWindow(); await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="#/settings"]').click();
    await page.getByLabel('Owner name', { exact: true }).fill('Trial owner');
    await page.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
    await page.getByRole('button', { name: 'Unlock access', exact: true }).click();
    const after = content(await call('list_connections'));
    expect(after[0]).toMatchObject({ id: before[0].id, active: true });
    expect(content(await call('connect_fidra'))).toMatchObject({ connected: true });
    await expect(page.getByRole('button', { name: 'Review connection request' })).toHaveCount(0);
    expect(content(await call('read_context', { from: '2026-10-01', to: '2026-10-31' })).accounts).toHaveLength(1);
  } finally { await restarted.close(); }
});

test('Settings-first approval loads accounts and grants only explicitly selected capabilities', async ({ window, userHome }) => {
  await window.locator('a[href="#/settings"]').click();
  // Fresh renderer stores, with Settings as the first mounted view.
  await window.reload();
  await window.getByLabel('Owner name', { exact: true }).fill('Trial owner');
  await window.getByLabel('Owner password', { exact: true }).fill('trial-owner-password');
  await window.getByRole('button', { name: 'Set access owner', exact: true }).click();
  const call = aiClient(userHome); await call('connect_fidra');
  await window.getByRole('button', { name: 'Review connection request' }).click();
  const dialog = window.getByRole('dialog');
  await expect(dialog.getByLabel('General', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Read transactions in permitted accounts', { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel('Change supported application settings', { exact: true })).toBeDisabled();
  await dialog.getByLabel('This code matches the connection I requested in my AI app', { exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Allow access', exact: true })).toBeDisabled();
  await dialog.getByLabel('All current and future accounts, including ledger-wide operations', { exact: true }).check();
  for (const label of ['Read transactions in permitted accounts', 'Read planned payments', 'Read supported application settings', 'List this ledger’s backups', 'Create ledger backups', 'Read synchronization status']) await dialog.getByLabel(label, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Allow access', exact: true }).click();
  const connection = content(await call('list_connections'))[0];
  expect(connection.permissions).toEqual({ allAccounts: true, allowAdd: false, allowStatementUploads: false, capabilities: ['transactions.read', 'planned.read', 'settings.read', 'backups.read', 'backups.create', 'sync.read'] });
  await window.evaluate(async () => {
    await window.api.saveTransaction({ id: 'capability-read', date: '2026-10-26', description: 'Visible entry', amount: '12.00', type: 'expense', status: 'pending', sheet: 'General', category: null, party: null, reference: null, activity: null, notes: 'Unapproved private note', linked_id: null, version: 1, created_at: '2026-10-26T00:00:00Z', modified_at: null, modified_by: null });
    await window.api.createSheet('future', 'Future');
  });
  const transactions = content(await call('read_transactions', { from: '2026-10-01', to: '2026-10-31' }));
  expect(transactions.rows[0]).toMatchObject({ id: 'capability-read', description: 'Visible entry' });
  expect(JSON.stringify(transactions)).not.toContain('Unapproved private note');
  expect(content(await call('list_connections'))[0].accounts).toContainEqual({ id: 'future', name: 'Future' });
  expect(content(await call('read_planned'))).toMatchObject({ rows: [] });
  expect(content(await call('read_settings', { groups: ['financialYear'] }))).toEqual({ financialYear: { startMonth: 1 } });
  const requestId = crypto.randomUUID();
  const backup = content(await call('create_backup', { requestId }));
  expect(content(await call('create_backup', { requestId })).id).toBe(backup.id);
  expect(content(await call('read_backups')).backups).toHaveLength(1);
  expect(JSON.stringify(backup)).not.toContain(userHome);
  expect(content(await call('read_sync_status'))).toMatchObject({ enabled: false });
  expect((await call('run_sync', { direction: 'both' })).error).toBeDefined();
  expect((await call('read_invoices', { from: '2026-10-01', to: '2026-10-31' })).error).toBeDefined();
  expect((await call('read_settings', { groups: ['localSync.passphrase'] })).error).toBeDefined();
});
