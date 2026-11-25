import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../database/connection';
import { initializeCrr } from '../../sync/crr-schema';
import { SettingsRepo } from '../../database/settings-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import { InvoiceRepo } from '../../repositories/invoice-repo';
import { AttachmentRepo } from '../../repositories/attachment-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import type { TransactionRow, PlannedTemplateRow } from '../../../shared/ipc-types';
import type { WindowContext } from '../../window/window-context';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import type { AiOperationAccess } from '../ai-operation-access';
import { AiAuthorizationStore } from '../ai-authorization-store';
import { LedgerCleanupService } from '../ledger-cleanup';
import { backupsList } from '../backup-operations';
import { aiLedgerCleanupDefinitions } from '../../../shared/ai-application-tools';
import type { LedgerCleanupAction, LedgerCleanupPreview, LedgerCleanupRequest } from '../../../shared/ledger-cleanup-types';

let root: string; let ctx: WindowContext; let service: LedgerCleanupService; let store: AiAuthorizationStore;
const connectionId = randomUUID(); const now = '2026-11-04T12:00:00Z';
const ref = (id: string, version = 1) => ({ id, version });
function tx(id: string, type: 'expense' | 'income' = 'expense', sheet = 'Main'): TransactionRow {
  return { id, date: '2026-10-24', amount: '12.00', type, status: 'pending', sheet, description: `Synthetic ${id}`,
    party: null, category: 'Internal transfer', reference: null, activity: null, notes: 'Original statement evidence', linked_id: null,
    version: 1, created_at: now, modified_at: null, modified_by: null };
}
function planned(): PlannedTemplateRow {
  return { id: 'plan', target_sheet: 'Main', transfer_target_sheet: 'Pocket', start_date: '2026-10-24', description: 'Synthetic plan', amount: '12.00',
    type: 'expense', frequency: 'once', party: null, category: null, activity: null, notes: null, end_date: null, occurrence_count: null,
    skipped_dates: '[]', fulfilled_dates: '[]', version: 1, created_at: now };
}
function access(): AiOperationAccess {
  return { policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: ['description'], permissions: { allAccounts: true,
    capabilities: ['sheets.manage', 'transactions.read', 'transactions.manage', 'transactions.delete', 'transfers.manage'] } }), isCurrent: () => true };
}
const draft = (actions: LedgerCleanupAction[]): LedgerCleanupRequest => ({ requestId: randomUUID(), label: 'Synthetic cleanup', actions });
const fix = (): LedgerCleanupAction => ({ kind: 'fix_income_status', entries: [ref('income')], reason: 'Apply the native income default.' });
const transfer = (entries = [ref('expense'), ref('income')]): LedgerCleanupAction => ({ kind: 'replace_with_transfer', entries,
  fromSheetId: 'main', toSheetId: 'pocket', description: 'Synthetic transfer', reason: 'Both unlinked statement sides belong to this transfer.' });
function prepare(input: LedgerCleanupRequest, allowed = access()) { return service.prepare(ctx, allowed, connectionId, 'Owner via chatgpt', input); }
function approve(preview: LedgerCleanupPreview) { return service.review(ctx, new Set([connectionId]), 'Owner', { id: preview.id, digest: preview.digest, approve: true }); }
const apply = (preview: LedgerCleanupPreview, allowed = access()) => service.apply(ctx, allowed, connectionId, 'Owner via chatgpt', { id: preview.id, digest: preview.digest });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-cleanup-'));
  const dbPath = path.join(root, 'synthetic.fdra'); const db = openDatabase(dbPath).db;
  const transactions = new TransactionRepo(db), sheets = new SheetRepo(db), planned = new PlannedRepo(db), invoices = new InvoiceRepo(db), attachments = new AttachmentRepo(db);
  ctx = { sqlite: db, dbPath, databaseId: randomUUID(), isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null, authSession: null,
    transactionRepo: transactions, sheetRepo: sheets, plannedRepo: planned, invoiceRepo: invoices, attachmentRepo: attachments,
    settingsRepo: new SettingsRepo(db), auditRepo: new AuditRepo(db), personnelRepo: new PersonnelRepo(db),
    repos: { transactions, sheets, planned, invoices, attachments } } as unknown as WindowContext;
  ctx.settingsRepo.setSetting('backup.dir', path.join(root, 'backups'));
  sheets.create('main', 'Main'); sheets.create('pocket', 'Pocket'); sheets.create('private', 'Private');
  transactions.save(tx('expense')); transactions.save(tx('income', 'income'));
  store = new AiAuthorizationStore(path.join(root, 'ai', 'approvals.enc'), { available: () => true,
    encrypt: (value) => Buffer.from(value.split('').reverse().join('')), decrypt: (value) => value.toString().split('').reverse().join('') });
  service = new LedgerCleanupService(store);
});
afterEach(() => { vi.restoreAllMocks(); if (ctx.sqlite.open) ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('semantic ledger cleanup and native parity', () => {
  it('prepares a signed review without changing financial rows or audit history', () => {
    const before = ctx.transactionRepo.getAll(); const preview = prepare(draft([transfer()]));
    expect(preview).toMatchObject({ state: 'draft', requiresReview: true, transferCount: 1 });
    expect(preview.before).toHaveLength(2); expect(preview.after).toHaveLength(2);
    expect(ctx.transactionRepo.getAll()).toEqual(before); expect(backupsList(ctx)).toEqual([]);
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
    expect(Object.keys(ctx.settingsRepo.getOrgSettings()).some((key) => key.startsWith('ai.ledgerCleanup.'))).toBe(false);
  });
  it('requires native destructive review, creates a safety backup and records one actual linked pair', async () => {
    const preview = prepare(draft([transfer()]));
    await expect(apply(preview)).rejects.toThrow('inside Fidra'); expect(backupsList(ctx)).toEqual([]);
    approve(preview); const result = await apply(preview);
    expect(result.preview.state).toBe('committed'); expect(result.changed).toBe(true);
    const rows = ctx.transactionRepo.getAll(); expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).not.toContain('expense'); expect(rows.map((row) => row.id)).not.toContain('income');
    expect(rows[0].linked_id).toBeTruthy(); expect(rows[0].linked_id).toBe(rows[1].linked_id);
    expect(rows.find((row) => row.type === 'income')).toMatchObject({ sheet: 'Pocket', status: '--', category: null, party: null });
    expect(rows.find((row) => row.type === 'expense')).toMatchObject({ sheet: 'Main', status: 'pending', category: null, party: null });
    expect(rows.reduce((sum, row) => sum + (row.type === 'income' ? 1200 : -1200), 0)).toBe(0);
    const backups = backupsList(ctx); expect(backups).toHaveLength(1); expect(result.preview.backupId).toBe(backups[0].metadata.id);
    const backup = openDatabase(path.join(backups[0].path, 'synthetic.fdra')).db;
    try { expect(new TransactionRepo(backup).getById('expense')).not.toBeNull(); expect(new TransactionRepo(backup).getAll()).toHaveLength(2); }
    finally { backup.close(); }
    expect(JSON.stringify(result.preview)).not.toContain(root);
  });
  it('creates a missing counterpart from one selected entry without inventing a bank reference', async () => {
    ctx.transactionRepo.remove('income');
    ctx.transactionRepo.save({ ...tx('expense'), reference: 'original-bank-reference' });
    const preview = prepare(draft([transfer([ref('expense')])])); approve(preview); await apply(preview);
    const linked = ctx.transactionRepo.getAll().filter((row) => row.linked_id);
    expect(linked).toHaveLength(2);
    expect(linked.find((row) => row.type === 'income')).toMatchObject({ reference: null, status: '--', sheet: 'Pocket' });
    expect(linked.find((row) => row.type === 'expense')?.reference).toBe('original-bank-reference');
  });
  it('does not add a missing counterpart when a likely existing leg needs matching', () => {
    expect(() => prepare(draft([transfer([ref('expense')])]))).toThrow('possible existing counterpart');
  });
  it('does not reuse an already matched leg as another transfer counterpart', async () => {
    ctx.transactionRepo.save(tx('second-expense'));
    const preview = prepare(draft([transfer(), transfer([ref('second-expense')])]));
    approve(preview); await apply(preview);
    const rows = ctx.transactionRepo.getAll();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.linked_id)).size).toBe(2);
    expect(rows.filter((row) => row.type === 'income').every((row) => row.status === '--')).toBe(true);
  });
  it('uses shared rename cascades, moves entries and fixes income status without approving expenses', async () => {
    ctx.plannedRepo.save(planned());
    const preview = prepare(draft([
      { kind: 'rename_sheet', sheetId: 'main', expectedName: 'Main', name: 'Bank: Personal', reason: 'Rename the existing history sheet.' },
      { kind: 'move_entries', entries: [ref('income')], targetSheetId: 'pocket', reason: 'The source identifies this pocket.' },
    ]));
    expect(preview.state).toBe('ready'); await apply(preview);
    expect(ctx.sheetRepo.getByName('Bank: Personal')?.id).toBe('main');
    expect(ctx.transactionRepo.getById('income')).toMatchObject({ sheet: 'Pocket', status: '--', version: 2 });
    expect(ctx.transactionRepo.getById('expense')).toMatchObject({ sheet: 'Bank: Personal', status: 'pending' });
    expect(ctx.plannedRepo.getById('plan')).toMatchObject({ target_sheet: 'Bank: Personal', transfer_target_sheet: 'Pocket' });
  });
  it('fixes income statuses using the shared rule and rejects an expense status repair', async () => {
    const preview = prepare(draft([fix()])); await apply(preview);
    expect(ctx.transactionRepo.getById('income')?.status).toBe('--'); expect(ctx.transactionRepo.getById('expense')?.status).toBe('pending');
    expect(() => prepare(draft([{ ...fix(), entries: [ref('expense')] } as LedgerCleanupAction]))).toThrow('cannot change an expense');
  });
  it('requires matching transfer dates unless the common date is explicitly selected for native review', async () => {
    ctx.transactionRepo.save({ ...tx('income', 'income'), date: '2026-10-25' });
    expect(() => prepare(draft([transfer()]))).toThrow('same date');
    const action = { ...transfer(), date: '2026-10-24' } as LedgerCleanupAction;
    const preview = prepare(draft([action])); expect(preview.requiresReview).toBe(true);
    expect(preview.before.map((row) => row.date)).toContain('2026-10-25');
    approve(preview); await apply(preview); expect(ctx.transactionRepo.getAll().every((row) => row.date === '2026-10-24')).toBe(true);
  });
  it('does not delete until reviewed and refuses rejected cleanups', async () => {
    const preview = prepare(draft([{ kind: 'delete_entries', entries: [ref('expense')], reason: 'Source review confirms a duplicate.' }]));
    service.review(ctx, new Set([connectionId]), 'Owner', { id: preview.id, digest: preview.digest, approve: false });
    await expect(apply(preview)).rejects.toThrow('Review'); expect(ctx.transactionRepo.getAll()).toHaveLength(2);
  });
  it('reverses an explicitly reviewed deletion using its exact native snapshot', async () => {
    const preview = prepare(draft([{ kind: 'delete_entries', entries: [ref('expense')], reason: 'Confirmed duplicate' }]));
    approve(preview); await apply(preview); expect(ctx.transactionRepo.getById('expense')).toBeNull();
    service.history(ctx, { id: preview.id, direction: 'undo' });
    expect(ctx.transactionRepo.getById('expense')).toMatchObject({ amount: '12.00', sheet: 'Main', linked_id: null });
    service.history(ctx, { id: preview.id, direction: 'redo' }); expect(ctx.transactionRepo.getById('expense')).toBeNull();
  });
  it('leaves every financial row unchanged if the safety backup fails', async () => {
    const preview = prepare(draft([fix()]));
    const file = path.join(root, 'not-a-directory'); fs.writeFileSync(file, 'synthetic');
    ctx.settingsRepo.setSetting('backup.dir', file);
    await expect(apply(preview)).rejects.toThrow(); expect(ctx.transactionRepo.getById('income')?.status).toBe('pending');
    expect(service.get(ctx, access(), connectionId, { id: preview.id }).state).toBe('ready');
  });
});

describe('permissions, versions, idempotency and atomicity', () => {
  it('keeps old reconciliation-only access narrow and validates every affected account', () => {
    const old: AiOperationAccess = { ...access(), policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: [], permissions: { allowAdd: true } }) };
    expect(() => prepare(draft([fix()]), old)).toThrow('permission');
    const narrow = access(); narrow.policy.permissions.allAccounts = false; narrow.policy.sheetIds = ['main'];
    expect(() => prepare(draft([{ kind: 'move_entries', entries: [ref('income')], targetSheetId: 'pocket', reason: 'Move' }]), narrow)).toThrow('outside');
    expect(() => prepare(draft([{ kind: 'rename_sheet', sheetId: 'main', expectedName: 'Main', name: 'Renamed', reason: 'Rename' }]), narrow)).toThrow('ledger-wide');
    expect(() => prepare(draft([fix()]), { ...access(), isCurrent: () => false })).toThrow('paused');
  });
  it('rejects missing transfer/delete capabilities and stale record versions', () => {
    const denied = access(); denied.policy.permissions.capabilities = ['transactions.read', 'transactions.manage'];
    expect(() => prepare(draft([transfer()]), denied)).toThrow('transactions.delete');
    denied.policy.permissions.capabilities.push('transactions.delete');
    expect(() => prepare(draft([transfer()]), denied)).toThrow('transfers.manage');
    expect(() => prepare(draft([{ ...fix(), entries: [ref('income', 99)] } as LedgerCleanupAction]))).toThrow('changed');
  });
  it('requires native user authority and rechecks connection authority after asynchronous backup', async () => {
    const allowed = access(); const preview = prepare(draft([fix()]), allowed);
    let current = true; allowed.isCurrent = () => current;
    const applying = apply(preview, allowed); current = false;
    await expect(applying).rejects.toThrow('paused'); expect(ctx.transactionRepo.getById('income')?.status).toBe('pending');
    Object.assign(ctx, { isLocalSyncAuthEnabled: true });
    expect(() => prepare(draft([fix()]))).toThrow('Sign in');
  });
  it('rejects any ledger or version drift between preparation, review and apply', async () => {
    const preview = prepare(draft([transfer()]));
    ctx.transactionRepo.save({ ...tx('expense'), description: 'Edited without a version bump' });
    expect(() => approve(preview)).toThrow('ledger changed');
    const fresh = prepare(draft([transfer()])); approve(fresh);
    ctx.sheetRepo.create('new', 'New account');
    await expect(apply(fresh)).rejects.toThrow('ledger changed'); expect(ctx.transactionRepo.getAll()).toHaveLength(2);
  });
  it('coalesces concurrent delivery, survives service recreation and never reapplies an undone cleanup', async () => {
    const input = draft([transfer()]); const preview = prepare(input); approve(preview);
    const results = await Promise.all([apply(preview), apply(preview)]);
    expect(results.filter((result) => result.changed)).toHaveLength(1); expect(backupsList(ctx)).toHaveLength(1);
    expect(prepare(input).state).toBe('committed');
    service = new LedgerCleanupService(store);
    expect((await apply(preview)).changed).toBe(false);
    service.history(ctx, { id: preview.id, direction: 'undo' });
    expect((await apply(preview)).preview.state).toBe('undone'); expect(ctx.transactionRepo.getById('expense')).not.toBeNull();
    expect(() => prepare({ ...input, label: 'Changed input' })).toThrow('different cleanup');
  });
  it('rolls back the whole cleanup when a native operation fails after earlier changes', async () => {
    const preview = prepare(draft([
      { kind: 'rename_sheet', sheetId: 'main', expectedName: 'Main', name: 'Renamed', reason: 'Rename' }, transfer(),
    ])); approve(preview);
    vi.spyOn(ctx.transactionRepo, 'saveTransfer').mockImplementation(() => { throw new Error('Synthetic transfer failure'); });
    await expect(apply(preview)).rejects.toThrow('Synthetic transfer failure');
    expect(ctx.sheetRepo.getByName('Main')).not.toBeNull(); expect(ctx.sheetRepo.getByName('Renamed')).toBeNull();
    expect(ctx.transactionRepo.getById('expense')).not.toBeNull(); expect(ctx.transactionRepo.getById('income')).not.toBeNull();
    expect(ctx.transactionRepo.getAll().every((row) => row.linked_id === null)).toBe(true);
    expect(service.get(ctx, access(), connectionId, { id: preview.id }).state).toBe('approved');
  });
  it('refuses attached, invoiced and already linked removals/replacements and duplicate selections', () => {
    ctx.attachmentRepo.save({ id: 'attachment', transaction_id: 'expense', filename: 'synthetic.txt', stored_name: 'synthetic.txt', mime_type: 'text/plain', file_size: 1, created_at: now });
    expect(() => prepare(draft([transfer()]))).toThrow('attachments'); ctx.attachmentRepo.remove('attachment');
    ctx.transactionRepo.save({ ...tx('expense'), linked_id: 'existing-pair' });
    expect(() => prepare(draft([transfer()]))).toThrow('unlinked'); ctx.transactionRepo.save(tx('expense'));
    expect(() => prepare(draft([fix(), fix()]))).toThrow('only one');
    ctx.invoiceRepo.save({ id: 'invoice', invoice_number: 'SYN-1', date: '2026-10-24', due_date: '2026-10-24', from_name: 'Synthetic', from_address: null,
      to_name: 'Synthetic', to_address: null, line_items: '[]', subtotal: '12.00', notes: null, bank_details: null, planned_template_id: null,
      transaction_id: 'expense', paid_at: null, planned_template_snapshot: null, status: 'draft', version: 1, created_at: now, modified_at: null, modified_by: null });
    expect(() => prepare(draft([transfer()]))).toThrow('invoice');
  });
  it('rejects raw rows, SQL, forged authority, unsupported fields and invalid dates', () => {
    for (const raw of [{ ...draft([fix()]), approved: true }, { ...draft([fix()]), sql: 'DELETE FROM transactions' },
      draft([{ ...fix(), status: 'pending', rows: [tx('income', 'income')] } as unknown as LedgerCleanupAction]),
      draft([{ ...transfer(), date: '2026-02-31' } as LedgerCleanupAction])]) {
      expect(() => service.prepare(ctx, access(), connectionId, 'Actor', raw)).toThrow();
    }
    expect(ctx.transactionRepo.getAll()).toHaveLength(2);
  });
});

describe('authenticated receipts and guarded native history', () => {
  it('keeps a CRR ledger atomic across failed transfer creation and native Undo/Redo', async () => {
    initializeCrr(ctx.sqlite);
    const original = ctx.transactionRepo.getAll();
    const preview = prepare(draft([transfer()])); approve(preview);
    const failing = vi.spyOn(ctx.transactionRepo, 'saveTransfer').mockImplementation(() => { throw new Error('Synthetic CRR failure'); });
    await expect(apply(preview)).rejects.toThrow('Synthetic CRR failure');
    expect(ctx.transactionRepo.getAll()).toEqual(original); failing.mockRestore();
    await apply(preview);
    expect(ctx.transactionRepo.getAll().filter((row) => row.linked_id)).toHaveLength(2);
    service.history(ctx, { id: preview.id, direction: 'undo' });
    expect(ctx.transactionRepo.getById('expense')).not.toBeNull();
    service.history(ctx, { id: preview.id, direction: 'redo' });
    expect(ctx.transactionRepo.getAll().find((row) => row.type === 'income')?.status).toBe('--');
  });
  it('refuses approval/snapshot tampering and ledger or connection substitution', async () => {
    const preview = prepare(draft([transfer()])); const key = `ai.ledgerCleanup.${preview.id}`;
    const original = ctx.settingsRepo.getSetting(key);
    if (!original) throw new Error('Expected a signed journal');
    const envelope = JSON.parse(original);
    const body = JSON.parse(envelope.body); body.state = 'approved'; envelope.body = JSON.stringify(body);
    ctx.settingsRepo.setSetting(key, JSON.stringify(envelope));
    await expect(apply(preview)).rejects.toThrow('authenticated'); expect(service.list(ctx, new Set([connectionId]))).toEqual([]);
    ctx.settingsRepo.setSetting(key, original);
    expect(() => service.get(ctx, access(), randomUUID(), { id: preview.id })).toThrow('another connection');
    Object.assign(ctx, { databaseId: 'another-ledger' });
    expect(() => service.get(ctx, access(), connectionId, { id: preview.id })).toThrow('authenticated');
  });
  it('does not expose private descriptions or transaction records through sheet-only consent', () => {
    const allowed = access(); allowed.policy.fields = [];
    const preview = prepare(draft([fix()]), allowed);
    expect(JSON.stringify(preview)).not.toContain('Synthetic income'); expect(preview.before[0]).not.toHaveProperty('description');
    allowed.policy.permissions.capabilities = ['sheets.manage'];
    const rename = prepare(draft([{ kind: 'rename_sheet', sheetId: 'main', expectedName: 'Main', name: 'Renamed', reason: 'Rename' }]), allowed);
    expect(rename.before).toEqual([]); expect(rename.after).toEqual([]);
    expect(service.list(ctx, new Set())).toEqual([]); expect(service.list(ctx, new Set([connectionId]))).toHaveLength(2);
  });
  it('undoes and redoes row/account cascades with monotonic versions', async () => {
    ctx.plannedRepo.save(planned());
    const preview = prepare(draft([{ kind: 'rename_sheet', sheetId: 'pocket', expectedName: 'Pocket', name: 'Bank: Pocket', reason: 'Rename destination' }, transfer()]));
    approve(preview); await apply(preview);
    const newIds = ctx.transactionRepo.getAll().map((row) => row.id);
    service.history(ctx, { id: preview.id, direction: 'undo' });
    expect(ctx.sheetRepo.getByName('Pocket')?.id).toBe('pocket');
    expect(ctx.plannedRepo.getById('plan')?.transfer_target_sheet).toBe('Pocket');
    expect(ctx.transactionRepo.getById('expense')?.version).toBeGreaterThan(1);
    service.history(ctx, { id: preview.id, direction: 'redo' });
    expect(ctx.transactionRepo.getAll().map((row) => row.id).sort()).toEqual([...newIds].sort());
    expect(ctx.transactionRepo.getAll().every((row) => row.version > 1)).toBe(true);
    expect(ctx.transactionRepo.getAll().find((row) => row.type === 'income')?.status).toBe('--');
    expect(ctx.plannedRepo.getById('plan')?.transfer_target_sheet).toBe('Bank: Pocket');
    const version = ctx.transactionRepo.getAll()[0].version;
    service.history(ctx, { id: preview.id, direction: 'undo' }); service.history(ctx, { id: preview.id, direction: 'redo' });
    expect(ctx.transactionRepo.getAll()[0].version).toBeGreaterThan(version);
  });
  it('refuses stale Undo and forged native history arguments without changing any entries', async () => {
    const preview = prepare(draft([transfer()])); approve(preview); await apply(preview);
    ctx.transactionRepo.save(tx('later'));
    expect(() => service.history(ctx, { id: preview.id, direction: 'undo' })).toThrow('ledger changed');
    expect(ctx.transactionRepo.getAll()).toHaveLength(3);
    expect(() => service.history(ctx, { id: preview.id, direction: 'undo', rows: [] })).toThrow();
    Object.assign(ctx, { isLocalSyncAuthEnabled: true });
    expect(() => service.history(ctx, { id: preview.id, direction: 'undo' })).toThrow('Sign in');
  });
  it('protects legacy planned rows when renaming and reversing an account', async () => {
    ctx.transactionRepo.save({ ...tx('legacy-plan', 'income'), status: 'planned' });
    const preview = prepare(draft([{ kind: 'rename_sheet', sheetId: 'main', expectedName: 'Main', name: 'Renamed', reason: 'Rename' }]));
    await apply(preview); expect(ctx.transactionRepo.getById('legacy-plan')?.sheet).toBe('Renamed');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.transactionRepo.getById('legacy-plan')?.sheet).toBe('Main');
  });
  it('advertises only the three strict semantic tools and keeps native approval/history out of MCP', () => {
    const definitions = aiLedgerCleanupDefinitions();
    expect(definitions.map((tool) => tool.name)).toEqual(['prepare_ledger_cleanup', 'get_ledger_cleanup', 'apply_ledger_cleanup']);
    expect(definitions.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(definitions.some((tool) => /approve|undo|sql/.test(tool.name))).toBe(false);
  });
});
