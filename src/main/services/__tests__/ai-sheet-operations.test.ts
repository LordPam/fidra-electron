import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import type { WindowContext } from '../../window/window-context';
import type { AiOperationAccess } from '../ai-operation-access';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import { aiCreateSheet, changeAiSheetCreation } from '../ai-sheet-operations';
import { sheetsCreate, sheetsRename } from '../sheet-operations';
import { aiSheetCreateDefinition } from '../../../shared/ai-application-tools';

let root: string; let ctx: WindowContext;
const connectionId = randomUUID();
function openContext() {
  const sqlite = openDatabase(path.join(root, 'synthetic.fdra')).db;
  const sheets = new SheetRepo(sqlite);
  return { sqlite, dbPath: path.join(root, 'synthetic.fdra'), databaseId: 'synthetic', isClosed: false,
    isLocalSyncAuthEnabled: false, localAuthPersonnel: null, authSession: null,
    sheetRepo: sheets, repos: { sheets }, settingsRepo: new SettingsRepo(sqlite),
    auditRepo: new AuditRepo(sqlite), personnelRepo: new PersonnelRepo(sqlite),
  } as unknown as WindowContext;
}
function access(): AiOperationAccess {
  return { policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: [], permissions: { allAccounts: true, capabilities: ['sheets.manage'] } }), isCurrent: () => true };
}
const input = () => ({ requestId: randomUUID(), name: 'Synthetic: Savings' });
const create = (raw: unknown = input(), allowed = access()) => aiCreateSheet(ctx, allowed, connectionId, 'Synthetic owner via chatgpt', raw).creation;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-sheets-')); ctx = openContext(); ctx.sheetRepo.create('main', 'Main'); });
afterEach(() => { vi.restoreAllMocks(); ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('external sheet creation through native application controls', () => {
  it('creates a normal empty sheet and preserves native sort order and name rules', () => {
    const external = create({ ...input(), name: '  Synthetic: Savings  ' });
    const native = sheetsCreate(ctx, randomUUID(), 'Synthetic: Wants');
    expect(ctx.sheetRepo.getAll().map(({ name, sort_order, is_virtual, is_planned }) => ({ name, sort_order, is_virtual, is_planned }))).toEqual([
      { name: 'Main', sort_order: 0, is_virtual: 0, is_planned: 0 },
      { name: 'Synthetic: Savings', sort_order: 1, is_virtual: 0, is_planned: 0 },
      { name: 'Synthetic: Wants', sort_order: 2, is_virtual: 0, is_planned: 0 },
    ]);
    expect(external).toMatchObject({ state: 'applied', sheet: { name: 'Synthetic: Savings' }, currentSheet: { name: 'Synthetic: Savings' } });
    expect(external.sheet.id).not.toBe(native.id);
    expect(ctx.sheetRepo.getTransactionsOnSheet(external.sheet.name)).toEqual([]);
    expect(ctx.sqlite.prepare("SELECT user, details FROM audit_log WHERE entity_type = 'ai_sheet_creation'").get()).toMatchObject({ user: 'Synthetic owner via chatgpt' });
    expect(ctx.settingsRepo.getOrgSettings()).not.toHaveProperty(`ai.sheetCreation.${external.receiptId}`);
  });
  it('requires live authority, sheets permission and all-future-account consent before creating anything', () => {
    const old: AiOperationAccess = { policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: [], permissions: { allowAdd: true } }), isCurrent: () => true };
    expect(() => create(input(), old)).toThrow('permission');
    const narrow = access(); narrow.policy.permissions.allAccounts = false;
    expect(() => create(input(), narrow)).toThrow('ledger-wide');
    expect(() => create(input(), { ...access(), isCurrent: () => false })).toThrow('paused');
    Object.assign(ctx, { isLocalSyncAuthEnabled: true });
    expect(() => create()).toThrow('Sign in');
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
  });
  it('rechecks access inside the transaction and leaves no partial sheet', () => {
    const permitted = access(); permitted.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect(() => create(input(), permitted)).toThrow('paused');
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
  });
  it.each(['', '   ', 'All Sheets', '  ALL SHEETS  ', 'main'])('rejects invalid or duplicate name %j in both native and external paths', (name) => {
    expect(() => create({ ...input(), name })).toThrow();
    expect(() => sheetsCreate(ctx, randomUUID(), name)).toThrow();
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
  });
  it('rejects raw row fields, permission assertions, SQL and invalid request IDs', () => {
    for (const raw of [{ ...input(), id: 'caller-id' }, { ...input(), is_virtual: 1 }, { ...input(), permissions: { allAccounts: true } },
      { ...input(), sql: 'DELETE FROM sheets' }, { ...input(), requestId: 'not-a-uuid' }]) expect(() => create(raw)).toThrow();
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
  });
  it('matches the native Unicode case-insensitive duplicate rule', () => {
    sheetsCreate(ctx, 'accent', 'Épargne');
    expect(() => create({ ...input(), name: 'épargne' })).toThrow('capitalisation');
    expect(() => sheetsCreate(ctx, 'accent-duplicate', 'épargne')).toThrow('capitalisation');
  });
  it('returns one durable receipt on retries and refuses reuse for different input', () => {
    const raw = input(); const first = create(raw);
    expect(create(raw)).toEqual(first);
    ctx.sqlite.close(); ctx = openContext();
    expect(create(raw)).toEqual(first);
    expect(() => create({ ...raw, name: 'Another sheet' })).toThrow('different sheet');
    expect(ctx.sheetRepo.getAll()).toHaveLength(2);
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'ai_sheet_creation'").get()).toEqual({ count: 1 });
  });
  it('binds request IDs to the connection and cannot disclose a receipt through old permissions', () => {
    const raw = input(); create(raw);
    expect(() => aiCreateSheet(ctx, access(), randomUUID(), 'Another client', raw)).toThrow('already exists');
    expect(() => create(raw, { ...access(), isCurrent: () => false })).toThrow('paused');
  });
  it('rolls back the sheet and receipt when mandatory external audit fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(ctx.auditRepo, 'log').mockImplementation(() => { throw new Error('Synthetic audit failure'); });
    expect(() => create()).toThrow('Synthetic audit failure');
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
    expect(Object.keys(ctx.settingsRepo.getAll()).filter((key) => key.startsWith('ai.sheetCreation.'))).toEqual([]);
  });
});

describe('native history for externally created sheets', () => {
  it('undoes and redoes atomically; external retries never reapply an undone creation', () => {
    const raw = input(); const first = create(raw);
    const undo = { receiptId: first.receiptId, direction: 'undo' };
    expect(changeAiSheetCreation(ctx, undo)).toMatchObject({ state: 'undone', currentSheet: null });
    expect(changeAiSheetCreation(ctx, undo).state).toBe('undone');
    expect(create(raw)).toMatchObject({ state: 'undone', currentSheet: null });
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
    expect(changeAiSheetCreation(ctx, { ...undo, direction: 'redo' })).toEqual(first);
    expect(ctx.sheetRepo.getAll()).toHaveLength(2);
  });
  it('does not undo a renamed or reordered sheet and reports its current name on retry', () => {
    const raw = input(); const first = create(raw);
    sheetsRename(ctx, first.sheet.name, 'Changed');
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' })).toThrow('changed');
    expect(create(raw)).toMatchObject({ currentSheet: { name: 'Changed' } });
    sheetsRename(ctx, 'Changed', first.sheet.name);
    ctx.sheetRepo.reorder([first.sheet.id, 'main']);
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' })).toThrow('changed');
  });
  it('never recreates a deleted sheet on a tool retry', () => {
    const raw = input(); const first = create(raw); ctx.sheetRepo.deleteSimple(first.sheet.id);
    expect(create(raw)).toMatchObject({ state: 'applied', currentSheet: null });
    expect(ctx.sheetRepo.getAll()).toHaveLength(1);
  });
  it('refuses Undo after a transaction is added', () => {
    const first = create(); const now = new Date().toISOString();
    new TransactionRepo(ctx.sqlite).save({ id: 'actual', date: '2026-11-02', description: 'Synthetic actual', amount: '1.00', type: 'income', status: '--',
      sheet: first.sheet.name, party: null, category: null, activity: null, reference: null, notes: null, linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: null });
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' })).toThrow('no longer empty');
    expect(ctx.sheetRepo.getAll()).toHaveLength(2);
    expect(new TransactionRepo(ctx.sqlite).getAll()).toHaveLength(1);
  });
  it('refuses Undo when a schedule on another sheet transfers into this sheet', () => {
    const first = create();
    new PlannedRepo(ctx.sqlite).save({ id: 'plan', target_sheet: 'Main', transfer_target_sheet: first.sheet.name, start_date: '2026-11-02',
      description: 'Synthetic transfer', amount: '1.00', type: 'expense', frequency: 'once', party: null, category: null, activity: null,
      notes: null, end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', version: 1, created_at: new Date().toISOString() });
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' })).toThrow('no longer empty');
    expect(new PlannedRepo(ctx.sqlite).getAll()).toHaveLength(1);
  });
  it('refuses Redo if a user has created a different sheet with the same name', () => {
    const first = create(); changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' });
    const native = sheetsCreate(ctx, 'replacement', first.sheet.name);
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'redo' })).toThrow('already exists');
    expect(ctx.sheetRepo.getByName(first.sheet.name)?.id).toBe(native.id);
  });
  it('validates native history inputs and live authority without touching arbitrary sheets', () => {
    const first = create();
    expect(() => changeAiSheetCreation(ctx, { receiptId: 'main', direction: 'undo' })).toThrow();
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo', sheet: { id: 'main' } })).toThrow();
    Object.assign(ctx, { isLocalSyncAuthEnabled: true });
    expect(() => changeAiSheetCreation(ctx, { receiptId: first.receiptId, direction: 'undo' })).toThrow('Sign in');
    expect(ctx.sheetRepo.getAll()).toHaveLength(2);
  });
  it('publishes a strict named tool without caller-supplied IDs or raw rows', () => {
    expect(aiSheetCreateDefinition.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(aiSheetCreateDefinition.inputSchema.properties).sort()).toEqual(['connectionId', 'name', 'requestId']);
    expect(aiSheetCreateDefinition.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });
  });
});
