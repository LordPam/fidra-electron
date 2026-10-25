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
  await window.getByLabel('Add missing pending entries and fulfil planned payments when I ask', { exact: true }).check();
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
