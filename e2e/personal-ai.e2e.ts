import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { test, expect } from './fixtures';
import type { AiConnection } from '../src/shared/ai-bridge-types';
import type { ReconciliationProposal } from '../src/shared/reconciliation-types';

function draft(sheetId: string, hash: string, fulfil = false) {
  return { label: 'October pool statement', rows: [{ sheetId, source: { statementHash: hash, row: 0, date: '2026-10-24', amount: '12.00', type: 'expense', description: 'CLUB PAYMENT', evidence: '2026-10-24,CLUB PAYMENT,-12.00' },
    description: 'Pool hire', party: 'Pool', category: 'Venue', activity: 'Training', action: fulfil ? 'fulfil' : 'new', ...(fulfil ? { planned: { templateId: 'planned-ai-payment', date: '2026-10-24' } } : {}) }] };
}
async function rpc(userHome: string, dbPath: string, connection: AiConnection, method: string, params: unknown) {
  const hash = createHash('sha256').update(dbPath).digest('hex').slice(0, 24);
  const paired = JSON.parse(fs.readFileSync(path.join(userHome, '.fidra', 'ai-connections', `${connection.client}-${hash}.json`), 'utf8'));
  const result = await fetch(paired.url, { method: 'POST', headers: { Authorization: `Bearer ${paired.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return result.json();
}

test('an authorised chat attachment imports directly, fulfils a plan and remains undoable in Fidra', async ({ window, app, userHome }) => {
  await window.evaluate(() => window.api.savePlannedTemplate({ id: 'planned-ai-payment', start_date: '2026-10-24', description: 'Pool hire', amount: '12.00', type: 'expense', frequency: 'monthly', target_sheet: 'General', category: 'Venue', party: 'Pool', activity: 'Training', notes: null,
    end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 1, created_at: '2026-10-01T12:00:00Z' }));
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw new Error('Chat attachments must not require a second file picker'); }; });
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('AI desktop app').selectOption('chatgpt');
  await window.getByLabel('General', { exact: true }).check();
  await window.getByLabel('AI context from').fill('2026-10-01'); await window.getByLabel('AI context to').fill('2026-10-31');
  await window.getByLabel('Receive statements I attach in my AI chat', { exact: true }).check();
  await window.getByLabel('Add missing entries and fulfil planned payments when I ask in chat', { exact: true }).check();
  await window.getByRole('button', { name: 'Share selected context with ChatGPT', exact: true }).click();
  const connection = (await window.evaluate(() => window.api.getAiBridgeState())).connections[0];
  const dbPath = await window.evaluate(() => window.api.getDbPath());
  const content = 'Date,Description,Amount\n2026-10-24,CLUB PAYMENT,-12.00\n';
  const uploaded = await rpc(userHome, dbPath, connection, 'tools/call', { name: 'register_statement', arguments: { name: 'chat-statement.csv', encoding: 'utf8', content } });
  expect(uploaded.error).toBeUndefined();
  const source = JSON.parse(uploaded.result.content[0].text);
  expect(source.hash).toBe(createHash('sha256').update(content).digest('hex'));
  const staged = await rpc(userHome, dbPath, connection, 'tools/call', { name: 'stage_reconciliation', arguments: draft(connection.scope.sheetIds[0], source.hash, true) });
  expect(staged.error).toBeUndefined(); const proposal = JSON.parse(staged.result.content[0].text) as ReconciliationProposal;
  const input = { id: proposal.id, digest: proposal.digest, resolutions: [] as { rowIndex: number; answer: string }[] };
  expect((await rpc(userHome, dbPath, connection, 'tools/call', { name: 'apply_reconciliation', arguments: input })).error).toBeDefined();
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(0);
  input.resolutions = proposal.review.filter((row) => row.questions.length).map((row) => ({ rowIndex: row.index, answer: 'User confirmed this is Pool hire for Pool, category Venue, activity Training, fulfilling the selected planned payment.' }));
  const applied = await rpc(userHome, dbPath, connection, 'tools/call', { name: 'apply_reconciliation', arguments: input });
  expect(applied.error).toBeUndefined(); expect(JSON.parse(applied.result.content[0].text).count).toBe(1);
  expect((await window.evaluate(() => window.api.getTransactions()))[0].status).toBe('pending');
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('["2026-10-24"]');
  expect(await window.evaluate(() => window.api.backupList())).toHaveLength(1);
  expect((await rpc(userHome, dbPath, connection, 'tools/call', { name: 'apply_reconciliation', arguments: input })).error).toBeUndefined();
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(1);
  await expect(window.getByRole('button', { name: 'Undo this import', exact: true })).toBeEnabled();
  await window.getByRole('button', { name: 'Undo this import', exact: true }).click();
  await expect.poll(async () => (await window.evaluate(() => window.api.getTransactions())).length).toBe(0);
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('[]');
});

test('a desktop AI can stage a selected statement but only native approval imports and fulfils it', async ({ window, app, userHome }) => {
  const statementFile = path.join(userHome, 'statement.csv'); fs.writeFileSync(statementFile, 'Date,Description,Amount\n2026-10-24,CLUB PAYMENT,-12.00\n');
  await window.evaluate(() => window.api.savePlannedTemplate({ id: 'planned-ai-payment', start_date: '2026-10-24', description: 'Pool hire', amount: '12.00', type: 'expense', frequency: 'monthly', target_sheet: 'General', category: 'Venue', party: 'Pool', activity: 'Training', notes: null,
    end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 1, created_at: '2026-10-01T12:00:00Z' }));
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, statementFile);
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('General', { exact: true }).check();
  await window.getByLabel('AI context from').fill('2026-10-01'); await window.getByLabel('AI context to').fill('2026-10-31');
  await window.getByRole('button', { name: 'Select bank statement' }).click();
  await expect(window.getByLabel('statement.csv')).toBeChecked();
  await window.getByRole('button', { name: 'Share selected context with Claude' }).click();
  const state = await window.evaluate(() => window.api.getAiBridgeState());
  expect(state.connections).toHaveLength(1);
  const dbPath = await window.evaluate(() => window.api.getDbPath());
  const staged = await rpc(userHome, dbPath, state.connections[0], 'tools/call', { name: 'stage_reconciliation', arguments: draft(state.connections[0].scope.sheetIds[0], state.statements[0].hash, true) });
  expect(staged.error).toBeUndefined();
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(0);
  await expect(window.getByText('October pool statement', { exact: false })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Approve this batch' })).toBeDisabled();
  await window.getByLabel('I checked all flagged rows').check();
  await window.getByRole('button', { name: 'Approve this batch' }).click();
  await expect.poll(async () => (await window.evaluate(() => window.api.getTransactions())).length).toBe(1);
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('["2026-10-24"]');
  await window.getByRole('button', { name: 'Undo this import' }).click();
  await expect.poll(async () => (await window.evaluate(() => window.api.getTransactions())).length).toBe(0);
  expect((await window.evaluate(() => window.api.getPlannedTemplates()))[0].fulfilled_dates).toBe('[]');
});

test('a disconnected connection cannot approve its draft, and Claude packages contain no access token', async ({ window, app, userHome }) => {
  const file = path.join(userHome, 'statement.csv'); fs.writeFileSync(file, 'Date,Description,Amount\n2026-10-24,CLUB PAYMENT,-12.00\n');
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, file);
  const selected = await window.evaluate(() => window.api.selectAiStatement()); expect(selected).not.toBeNull();
  const sheet = (await window.evaluate(() => window.api.getSheets()))[0];
  const connection = await window.evaluate((scope) => window.api.connectAi('claude', scope), { sheetIds: [sheet.id], statementIds: [selected!.id], from: '2026-10-01', to: '2026-10-31', fields: ['description'] });
  const packageFile = path.join(userHome, 'Fidra-test.mcpb');
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, packageFile);
  await window.evaluate((id) => window.api.exportAiConnection(id), connection.id);
  const zip = await JSZip.loadAsync(fs.readFileSync(packageFile));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.manifest_version).toBe('0.3'); expect(manifest.server.type).toBe('node');
  expect(manifest.server.mcp_config.args).toContain('--connection-file');
  expect(await zip.file('server/server.cjs')!.async('string')).toContain('127\\.0\\.0\\.1');
  expect(JSON.stringify(manifest)).not.toContain('token');
  const dbPath = await window.evaluate(() => window.api.getDbPath());
  const staged = await rpc(userHome, dbPath, connection, 'tools/call', { name: 'stage_reconciliation', arguments: draft(sheet.id, selected!.hash) });
  const proposal = JSON.parse(staged.result.content[0].text) as ReconciliationProposal;
  await window.evaluate((id) => window.api.disconnectAi(id), connection.id);
  const approvalError = await window.evaluate(async (approval) => {
    try { await window.api.approveAiProposal(approval); return ''; } catch (error) { return String(error); }
  }, { id: proposal.id, digest: proposal.digest, reviewedRows: [0] });
  expect(approvalError).toContain('Reconnect'); expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(0);
});

test('ChatGPT can use selected context and proposal files without a publisher certificate or a remote service', async ({ window, app, userHome }) => {
  const file = path.join(userHome, 'statement.csv'); fs.writeFileSync(file, 'Date,Description,Amount\n2026-10-24,CLUB PAYMENT,-12.00\n');
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, file);
  const statement = await window.evaluate(() => window.api.selectAiStatement());
  const sheet = (await window.evaluate(() => window.api.getSheets()))[0];
  const connection = await window.evaluate((scope) => window.api.connectAi('chatgpt', scope), { sheetIds: [sheet.id], statementIds: [statement!.id], from: '2026-10-01', to: '2026-10-31', fields: ['description'] });
  const extensionFile = path.join(userHome, 'Fidra-extension.zip');
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, extensionFile);
  await window.evaluate((id) => window.api.exportAiConnection(id), connection.id);
  const extension = await JSZip.loadAsync(fs.readFileSync(extensionFile));
  const manifest = JSON.parse(await extension.file('plugin.json')!.async('string'));
  const onboarding = manifest.extensions['com.openai'].onboardingSkill as string;
  expect(extension.file(onboarding.replace(/^\.\//, ''))).not.toBeNull();
  const workflow = await extension.file('skills/fidra-reconcile/SKILL.md')!.async('string');
  const dbPath = await window.evaluate(() => window.api.getDbPath());
  const initialized = await rpc(userHome, dbPath, connection, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'extension-trial', version: '1' } });
  expect(initialized.result.instructions).toBe(workflow);
  const exported = path.join(userHome, 'Fidra-context.json');
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, exported);
  await window.evaluate((id) => window.api.exportAiContext(id), connection.id);
  const context = JSON.parse(fs.readFileSync(exported, 'utf8'));
  expect(context.context.selectedStatements[0].hash).toBe(statement!.hash);
  const pairingName = `chatgpt-${createHash('sha256').update(dbPath).digest('hex').slice(0, 24)}.json`;
  const privatePairing = JSON.parse(fs.readFileSync(path.join(userHome, '.fidra', 'ai-connections', pairingName), 'utf8'));
  expect(JSON.stringify(context)).not.toContain(privatePairing.token); expect(JSON.stringify(context)).not.toContain(userHome);
  const proposalFile = path.join(userHome, 'Fidra-proposal.json');
  fs.writeFileSync(proposalFile, JSON.stringify({ format: 'fidra-proposal', version: 1, grantId: context.grantId, draft: draft(sheet.id, statement!.hash) }));
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, proposalFile);
  await window.evaluate(() => window.api.openAiProposal());
  expect(await window.evaluate(() => window.api.getTransactions())).toHaveLength(0);
  await window.locator('a[href="#/settings"]').click();
  await window.getByLabel('I checked all flagged rows').check();
  await window.getByRole('button', { name: 'Approve this batch' }).click();
  await expect.poll(async () => (await window.evaluate(() => window.api.getTransactions())).length).toBe(1);
});
