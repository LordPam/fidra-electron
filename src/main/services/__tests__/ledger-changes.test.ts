import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import { InvoiceRepo } from '../../repositories/invoice-repo';
import { AttachmentRepo } from '../../repositories/attachment-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import { CategoryRepo } from '../../repositories/category-repo';
import { ActivityNotesRepo } from '../../repositories/activity-notes-repo';
import type { TransactionRow, PlannedTemplateRow } from '../../../shared/ipc-types';
import type { WindowContext } from '../../window/window-context';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import { applicationCapabilitySchema } from '../../../shared/application-capabilities';
import type { AiOperationAccess } from '../ai-operation-access';
import { AiAuthorizationStore } from '../ai-authorization-store';
import { LedgerChangeService } from '../ledger-changes';
import { backupsList } from '../backup-operations';
import type { LedgerChangeAction, LedgerChangeRequest } from '../../../shared/ledger-change-types';
import type { LedgerCleanupPreview } from '../../../shared/ledger-cleanup-types';
import { aiLedgerChangeDefinitions } from '../../../shared/ai-application-tools';
import { initializeCrr } from '../../sync/crr-schema';
import { expandTemplate } from '../../../shared/forecast';

let root: string, ctx: WindowContext, service: LedgerChangeService, store: AiAuthorizationStore;
const connectionId = randomUUID(), now = '2026-11-25T12:00:00Z';
function present<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing synthetic fixture record.'); return value; }
const details = { description: 'Dinner fee', category: 'Social income', party: 'Synthetic member', activity: '2026-11-26 Christmas Dinner', notes: null };
const actual = { ...details, date: '2026-11-25', type: 'income' as const, amount: '50.00', sheetId: 'main', reference: 'bank-reference' };
const plan = { ...details, startDate: '2026-11-30', type: 'income' as const, amount: '25.00', sheetId: 'main', frequency: 'once' as const, endDate: null, occurrenceCount: null, transferSheetId: null };
const tx = (): TransactionRow => ({ id: 'actual', date: actual.date, type: actual.type, amount: actual.amount, sheet: 'Main', ...details,
  status: '--', reference: actual.reference, linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: null });
const template = (): PlannedTemplateRow => ({ id: 'plan', start_date: plan.startDate, type: plan.type, amount: plan.amount, target_sheet: 'Main', ...details,
  frequency: 'once', end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 1, created_at: now });
const access = (): AiOperationAccess => ({ policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: ['description', 'party', 'category', 'activity', 'notes', 'reference'], permissions: { allAccounts: true, capabilities: applicationCapabilitySchema.options } }), isCurrent: () => true });
const request = (actions: LedgerChangeAction[]): LedgerChangeRequest => ({ requestId: randomUUID(), label: 'Synthetic ledger edits', actions });
const prepare = (actions: LedgerChangeAction[], allowed = access()) => service.prepare(ctx, allowed, connectionId, 'Owner via chatgpt', request(actions));
const apply = (preview: LedgerCleanupPreview, allowed = access()) => service.apply(ctx, allowed, connectionId, 'Owner via chatgpt', { id: preview.id, digest: preview.digest });
const edit = (): LedgerChangeAction => ({ kind: 'edit_transaction', id: 'actual', version: 1, changes: { date: '2026-11-26', reference: 'agreed-reference', notes: 'Paid together' }, reason: 'Correct source attribution' });
const invoiceValue = { invoiceNumber: 'SYN-001', date: '2026-11-25', dueDate: '2026-11-30', fromName: 'Club', fromAddress: null, toName: 'Member', toAddress: null,
  items: [{ description: 'Dinner', quantity: 2, unitPrice: '25.00' }], taxRate: 20, accentMode: 'fidra' as const, notes: null, bankDetails: null };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-ledger-edits-'));
  const dbPath = path.join(root, 'synthetic.fdra'), sqlite = openDatabase(dbPath).db;
  const transactions = new TransactionRepo(sqlite), sheets = new SheetRepo(sqlite), planned = new PlannedRepo(sqlite), invoices = new InvoiceRepo(sqlite), attachments = new AttachmentRepo(sqlite), categories = new CategoryRepo(sqlite), activityNotes = new ActivityNotesRepo(sqlite);
  ctx = { sqlite, dbPath, databaseId: randomUUID(), isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null, authSession: null,
    transactionRepo: transactions, sheetRepo: sheets, plannedRepo: planned, invoiceRepo: invoices, attachmentRepo: attachments,
    settingsRepo: new SettingsRepo(sqlite), auditRepo: new AuditRepo(sqlite), personnelRepo: new PersonnelRepo(sqlite),
    repos: { transactions, sheets, planned, invoices, attachments, categories, activityNotes } } as unknown as WindowContext;
  ctx.settingsRepo.setSetting('backup.dir', path.join(root, 'backups'));
  sheets.create('main', 'Main'); sheets.create('pocket', 'Pocket'); sheets.create('private', 'Private');
  transactions.save(tx());
  store = new AiAuthorizationStore(path.join(root, 'ai', 'approvals.enc'), { available: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() });
  service = new LedgerChangeService(store);
});
afterEach(() => { vi.restoreAllMocks(); if (ctx.sqlite.open) ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('ordinary ledger creation and editing', () => {
  it('previews actual corrections with no financial or audit writes, then backs up, applies and natively reverses them', async () => {
    const original = ctx.transactionRepo.getById('actual'), preview = prepare([edit()]);
    expect(preview.state).toBe('ready'); expect(preview.changes?.[0].after).toMatchObject({ date: '2026-11-26', reference: 'agreed-reference', notes: 'Paid together' });
    expect(ctx.transactionRepo.getById('actual')).toEqual(original); expect(ctx.auditRepo.getAll()).toEqual([]); expect(backupsList(ctx)).toEqual([]);
    expect((await apply(preview)).preview.state).toBe('committed'); expect(backupsList(ctx)).toHaveLength(1);
    expect(ctx.transactionRepo.getById('actual')).toMatchObject({ date: '2026-11-26', version: 2 });
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.transactionRepo.getById('actual')).toMatchObject({ date: original?.date, version: 3 });
    service.history(ctx, { id: preview.id, direction: 'redo' }); expect(ctx.transactionRepo.getById('actual')).toMatchObject({ date: '2026-11-26', version: 4 });
    expect(ctx.auditRepo.getAll().some((row) => row.user === 'Owner via chatgpt' && row.entity_type === 'ledger_changes')).toBe(true);
  });
  it('creates six one-off planned payments, preserving activity, party and exact due date, without a statement', async () => {
    const actions: LedgerChangeAction[] = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((party) => ({ kind: 'create_planned', value: { ...plan, party }, reason: 'Expected dinner payment' }));
    const preview = prepare(actions); expect(ctx.plannedRepo.getAll()).toEqual([]);
    await apply(preview); const rows = ctx.plannedRepo.getAll(); expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.start_date === '2026-11-30' && row.amount === '25.00' && row.frequency === 'once' && row.activity === details.activity)).toBe(true);
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.plannedRepo.getAll()).toEqual([]);
    service.history(ctx, { id: preview.id, direction: 'redo' }); expect(ctx.plannedRepo.getAll().map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).sort());
  });
  it('splits one payment exactly, retaining its original ID and shared reference while keeping total income unchanged', async () => {
    const preview = prepare([{ kind: 'split_transaction', id: 'actual', version: 1, reason: 'Paid together', parts: [
      { ...details, amount: '25.00', reference: actual.reference, notes: 'Paid together: dinner and trip' },
      { ...details, description: 'Weekend trip fee (driver)', activity: '2026-11-28 to 2026-11-29 Weekend Trip', amount: '25.00', reference: actual.reference, notes: 'Paid together: dinner and trip' },
    ] }]);
    await apply(preview); const rows = ctx.transactionRepo.getAll(); expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === 'actual')?.amount).toBe('25.00'); expect(rows.every((row) => row.reference === actual.reference && row.notes?.includes('Paid together'))).toBe(true);
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.transactionRepo.getAll()).toHaveLength(1); expect(ctx.transactionRepo.getById('actual')?.amount).toBe('50.00');
  });
  it('rejects non-balancing splits, stale versions, forged internal fields and invalid dates before journalling', () => {
    expect(() => prepare([{ kind: 'split_transaction', id: 'actual', version: 1, reason: 'Split', parts: [{ ...details, amount: '24.99', reference: null }, { ...details, amount: '25.00', reference: null }] }])).toThrow('total');
    expect(() => prepare([{ ...edit(), version: 9 } as LedgerChangeAction])).toThrow('changed');
    expect(() => prepare([{ ...edit(), changes: { modified_by: 'Administrator' } } as unknown as LedgerChangeAction])).toThrow();
    expect(() => prepare([{ ...edit(), changes: { date: '2026-02-31' } } as LedgerChangeAction])).toThrow();
    expect(ctx.transactionRepo.getById('actual')).toEqual(tx());
  });
  it('uses shared default statuses for created income/expense and native approval-date behavior', async () => {
    const preview = prepare([{ kind: 'create_transaction', value: { ...actual, description: 'Another income' }, reason: 'Record income' }, { kind: 'create_transaction', value: { ...actual, type: 'expense', description: 'Expense' }, reason: 'Record expense' }]);
    await apply(preview); expect(ctx.transactionRepo.getAll().find((row) => row.description === 'Another income')?.status).toBe('--');
    const expense = ctx.transactionRepo.getAll().find((row) => row.type === 'expense'); expect(expense?.status).toBe('pending');
    ctx.settingsRepo.setSetting('tx.dateOnApprove', 'true');
    const status = prepare([{ kind: 'set_transaction_status', id: present(expense).id, version: present(expense).version, status: 'approved', reason: 'Approve the expense' }]);
    await apply(status); expect(ctx.transactionRepo.getById(present(expense).id)?.date).toBe(new Date().toISOString().slice(0, 10));
  });
  it('edits recurring schedules without resetting fulfilment and validates the full recurrence', async () => {
    ctx.plannedRepo.save({ ...template(), frequency: 'weekly', fulfilled_dates: '["2026-11-30"]' });
    const preview = prepare([{ kind: 'edit_planned', id: 'plan', version: 1, changes: { amount: '30.00', endDate: '2026-12-31' }, reason: 'Revise the future fee' }]);
    await apply(preview); expect(ctx.plannedRepo.getById('plan')).toMatchObject({ amount: '30.00', fulfilled_dates: '["2026-11-30"]', version: 2 });
    expect(() => prepare([{ kind: 'create_planned', value: { ...plan, endDate: '2026-11-01' }, reason: 'Invalid end' }])).toThrow('end before');
  });
  it.each([1, 3])('edits one occurrence of a %i-payment series without adding future payment slots, and restores its history on Undo', async (count) => {
    ctx.plannedRepo.save({ ...template(), frequency: 'weekly', occurrence_count: count });
    const original = expandTemplate(present(ctx.plannedRepo.getById('plan')), '2027-01-31', true);
    const preview = prepare([{ kind: 'edit_planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', changes: { date: '2026-12-01', amount: '30.00', notes: 'One agreed exception' }, reason: 'Change this payment only' }]);
    expect(ctx.plannedRepo.getAll()).toHaveLength(1);
    await apply(preview);
    const all = ctx.plannedRepo.getAll().flatMap((row) => expandTemplate(row, '2027-01-31', true));
    expect(all).toHaveLength(count); expect(all.some((row) => row.instanceDate === '2026-11-30')).toBe(false);
    expect(all.find((row) => row.instanceDate === '2026-12-01')?.transaction.amount).toBe('30.00');
    expect(all.filter((row) => row.instanceDate !== '2026-12-01').every((row) => row.transaction.amount === '25.00')).toBe(true);
    service.history(ctx, { id: preview.id, direction: 'undo' });
    expect(ctx.plannedRepo.getAll()).toHaveLength(1); expect(expandTemplate(present(ctx.plannedRepo.getById('plan')), '2027-01-31', true).map((row) => row.instanceDate)).toEqual(original.map((row) => row.instanceDate));
  });
  it('edits an existing one-off instance in place, preserving its ID without leaving a second payment', async () => {
    ctx.plannedRepo.save(template());
    await apply(prepare([{ kind: 'edit_planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', changes: { amount: '26.00', party: 'Corrected member' }, reason: 'Correct this one-off' }]));
    expect(ctx.plannedRepo.getAll()).toHaveLength(1); expect(ctx.plannedRepo.getById('plan')).toMatchObject({ amount: '26.00', party: 'Corrected member', version: 2 });
  });
  it('preserves attachments when editing or splitting an ordinary actual and refuses stale Undo after a new attachment', async () => {
    const attachment = { id: 'scan', transaction_id: 'actual', filename: 'scan.pdf', stored_name: 'scan.pdf', mime_type: 'application/pdf', file_size: 10, created_at: now };
    ctx.attachmentRepo.save(attachment);
    const preview = prepare([edit()]); await apply(preview);
    expect(ctx.attachmentRepo.getForTransaction('actual')).toEqual([attachment]);
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.attachmentRepo.getForTransaction('actual')).toEqual([attachment]);
    service.history(ctx, { id: preview.id, direction: 'redo' });
    ctx.attachmentRepo.save({ ...attachment, id: 'new-scan', stored_name: 'new-scan.pdf' });
    expect(() => service.history(ctx, { id: preview.id, direction: 'undo' })).toThrow('ledger changed');
  });
  it('fulfils a planned transfer as one linked pair and restores both accounts and the occurrence on Undo', async () => {
    ctx.plannedRepo.save({ ...template(), type: 'expense', transfer_target_sheet: 'Pocket' });
    const preview = prepare([{ kind: 'planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', actualDate: '2026-11-25', operation: 'fulfil', reason: 'Record the scheduled transfer' }]);
    await apply(preview); const pair = ctx.transactionRepo.getAll().filter((row) => row.linked_id);
    expect(pair).toHaveLength(2); expect(pair[0].linked_id).toBe(pair[1].linked_id); expect(pair.map((row) => row.sheet).sort()).toEqual(['Main', 'Pocket']);
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.transactionRepo.getAll()).toHaveLength(1); expect(ctx.plannedRepo.getById('plan')?.fulfilled_dates).toBe('[]');
  });
  it('skips, restores and fulfils an exact occurrence with atomic actual/plan effects and reversible history', async () => {
    ctx.plannedRepo.save({ ...template(), frequency: 'weekly' });
    await apply(prepare([{ kind: 'planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', operation: 'skip', reason: 'Skip this week' }]));
    expect(ctx.plannedRepo.getById('plan')?.skipped_dates).toBe('["2026-11-30"]');
    await apply(prepare([{ kind: 'planned_occurrence', id: 'plan', version: 2, date: '2026-11-30', operation: 'restore', reason: 'Restore this week' }]));
    const preview = prepare([{ kind: 'planned_occurrence', id: 'plan', version: 3, date: '2026-11-30', actualDate: '2026-11-25', operation: 'fulfil', reason: 'The payment arrived' }]);
    await apply(preview); expect(ctx.transactionRepo.getAll()).toHaveLength(2); expect(ctx.plannedRepo.getById('plan')?.fulfilled_dates).toBe('["2026-11-30"]');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.transactionRepo.getAll()).toHaveLength(1); expect(ctx.plannedRepo.getById('plan')?.fulfilled_dates).toBe('[]');
    expect(() => prepare([{ kind: 'planned_occurrence', id: 'plan', version: present(ctx.plannedRepo.getById('plan')).version, date: '2026-12-01', operation: 'skip', reason: 'Not an occurrence' }])).toThrow('exact occurrence');
  });
  it('records and edits both transfer sides atomically, with both account/version requirements', async () => {
    const preview = prepare([{ kind: 'create_transfer', fromSheetId: 'main', toSheetId: 'pocket', date: actual.date, amount: '12.34', description: 'Internal move', reference: null, notes: null, reason: 'Record a ledger transfer' }]);
    await apply(preview); const rows = ctx.transactionRepo.getAll().filter((row) => row.linked_id), expense = present(rows.find((row) => row.type === 'expense')), income = present(rows.find((row) => row.type === 'income'));
    const update = prepare([{ kind: 'edit_transfer', expenseId: expense.id, expenseVersion: expense.version, incomeId: income.id, incomeVersion: income.version, changes: { amount: '13.00', date: '2026-11-26' }, reason: 'Correct both sides' }]);
    await apply(update); expect(ctx.transactionRepo.getByLinkedId(present(expense.linked_id)).every((row) => row.amount === '13.00' && row.date === '2026-11-26')).toBe(true);
    expect(() => prepare([{ kind: 'edit_transaction', id: expense.id, version: 2, changes: { amount: '99.00' }, reason: 'Single side' }])).toThrow('edit_transfer');
    service.history(ctx, { id: update.id, direction: 'undo' }); expect(ctx.transactionRepo.getById(expense.id)?.amount).toBe('12.34');
  });
});

describe('other editable ledger records', () => {
  it('creates/edits an unpaid invoice using integer-pence totals, protects numbering, and restores all fields on Undo', async () => {
    const creation = prepare([{ kind: 'create_invoice', value: invoiceValue, reason: 'Requested invoice' }]); await apply(creation);
    const invoice = ctx.invoiceRepo.getAll()[0]; expect(invoice.subtotal).toBe('60.00');
    const preview = prepare([{ kind: 'edit_invoice', id: invoice.id, version: invoice.version, changes: { toName: 'Corrected member', notes: 'Agreed invoice note', taxRate: 0 }, reason: 'Correct invoice' }]);
    await apply(preview); expect(ctx.invoiceRepo.getById(invoice.id)).toMatchObject({ subtotal: '50.00', to_name: 'Corrected member', notes: 'Agreed invoice note' });
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.invoiceRepo.getById(invoice.id)).toMatchObject({ subtotal: '60.00', to_name: 'Member' });
    expect(() => prepare([{ kind: 'create_invoice', value: invoiceValue, reason: 'Duplicate number' }])).toThrow('number already exists');
  });
  it('includes linked invoice recalculation in planned edits and restores custom fields on Undo', async () => {
    ctx.plannedRepo.save(template());
    await apply(prepare([{ kind: 'create_invoice', value: { ...invoiceValue, taxRate: 0, items: [{ description: 'Custom wording', quantity: 1, unitPrice: '25.00' }] }, reason: 'Invoice' }]));
    const invoice = ctx.invoiceRepo.getAll()[0]; ctx.invoiceRepo.save({ ...invoice, planned_template_id: 'plan' });
    const preview = prepare([{ kind: 'edit_planned', id: 'plan', version: 1, changes: { amount: '30.00', description: 'Revised fee' }, reason: 'Agreed revision' }]);
    expect(ctx.invoiceRepo.getById(invoice.id)?.subtotal).toBe('25.00'); expect(preview.changes?.some((change) => change.resource === 'Invoice')).toBe(true);
    await apply(preview); expect(ctx.invoiceRepo.getById(invoice.id)?.subtotal).toBe('30.00');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.invoiceRepo.getById(invoice.id)?.subtotal).toBe('25.00'); expect(ctx.invoiceRepo.getById(invoice.id)?.line_items).toContain('Custom wording');
  });
  it('fulfils a linked invoice once and restores its unpaid state and exact plan occurrence on Undo', async () => {
    ctx.plannedRepo.save(template());
    await apply(prepare([{ kind: 'create_invoice', value: { ...invoiceValue, taxRate: 0, items: [{ description: 'Dinner fee', quantity: 1, unitPrice: '25.00' }] }, reason: 'Invoice' }]));
    const invoice = ctx.invoiceRepo.getAll()[0]; ctx.invoiceRepo.save({ ...invoice, planned_template_id: 'plan' });
    const preview = prepare([{ kind: 'planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', actualDate: '2026-11-25', operation: 'fulfil', reason: 'Payment arrived' }]);
    await apply(preview); expect(ctx.invoiceRepo.getById(invoice.id)?.status).toBe('paid');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.invoiceRepo.getById(invoice.id)).toMatchObject({ status: 'draft', transaction_id: null });
    expect(ctx.plannedRepo.getById('plan')?.fulfilled_dates).toBe('[]');
  });
  it('renames an activity across actuals, plans and notes without changing invoice amounts', async () => {
    ctx.plannedRepo.save(template()); ctx.repos.activityNotes.save(details.activity, 'Original note');
    const preview = prepare([{ kind: 'rename_activity', name: details.activity, newName: '2026-11-26 Club Dinner', reason: 'Correct activity label' }]);
    await apply(preview); expect(ctx.transactionRepo.getById('actual')?.activity).toBe('2026-11-26 Club Dinner'); expect(ctx.plannedRepo.getById('plan')?.activity).toBe('2026-11-26 Club Dinner');
    expect(ctx.repos.activityNotes.getAll()).toEqual({ '2026-11-26 Club Dinner': 'Original note' });
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.repos.activityNotes.getAll()).toEqual({ [details.activity]: 'Original note' });
  });
  it('requires exact native review before removing an activity and its notes, and never accepts tool-side approval', async () => {
    ctx.repos.activityNotes.save(details.activity, 'Original note');
    const preview = prepare([{ kind: 'rename_activity', name: details.activity, newName: null, reason: 'Remove this activity grouping' }]);
    expect(preview).toMatchObject({ state: 'draft', requiresReview: true });
    await expect(apply(preview)).rejects.toThrow('inside Fidra');
    await expect(service.apply(ctx, access(), connectionId, 'Owner', { id: preview.id, digest: preview.digest, approve: true })).rejects.toThrow();
    expect(() => service.review(ctx, new Set(), 'Other identity', { id: preview.id, digest: preview.digest, approve: true })).toThrow('original approving');
    service.review(ctx, new Set([connectionId]), 'Owner', { id: preview.id, digest: preview.digest, approve: true });
    await apply(preview); expect(ctx.transactionRepo.getById('actual')?.activity).toBeNull(); expect(ctx.repos.activityNotes.getAll()).toEqual({});
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.repos.activityNotes.getAll()).toEqual({ [details.activity]: 'Original note' });
  });
  it('refuses invoice/plan payment amount mismatches and protects linked actuals from partial corrections', async () => {
    ctx.plannedRepo.save(template());
    await apply(prepare([{ kind: 'create_invoice', value: invoiceValue, reason: 'Invoice' }]));
    const invoice = ctx.invoiceRepo.getAll()[0]; ctx.invoiceRepo.save({ ...invoice, planned_template_id: 'plan' });
    expect(() => prepare([{ kind: 'planned_occurrence', id: 'plan', version: 1, date: '2026-11-30', operation: 'fulfil', reason: 'Wrong payment amount' }])).toThrow('invoice total differs');
    expect(ctx.transactionRepo.getAll()).toHaveLength(1);
    ctx.invoiceRepo.markPaid(invoice.id, 'actual');
    expect(() => prepare([edit()])).toThrow('linked to an invoice');
  });
  it('edits categories, notes and supported settings in one batch with exact expected values and Undo', async () => {
    const originalCategories = ctx.repos.categories.getAll('income');
    const preview = prepare([{ kind: 'set_categories', type: 'income', expected: originalCategories, names: ['Fees', 'Merchandise'], reason: 'Organise income' },
      { kind: 'set_activity_note', name: details.activity, expected: null, text: 'Dinner attendance notes', reason: 'Record organiser notes' },
      { kind: 'set_financial_year', expected: 1, startMonth: 9, reason: 'Use the academic financial year' },
      { kind: 'set_organisation', expected: '', name: 'Synthetic Club', reason: 'Set the report heading' }]);
    await apply(preview); expect(ctx.repos.categories.getAll('income')).toEqual(['Fees', 'Merchandise']); expect(ctx.settingsRepo.getSetting('fy.startMonth')).toBe('9');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect(ctx.repos.categories.getAll('income')).toEqual(originalCategories); expect(ctx.repos.activityNotes.getAll()).toEqual({}); expect(ctx.settingsRepo.getSetting('fy.startMonth')).toBeNull();
  });
});

describe('access, durable receipts and atomicity', () => {
  it('never promotes reconciliation-only grants, and checks both source and destination accounts', () => {
    const legacy: AiOperationAccess = { policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: ['description'], permissions: { allowAdd: true } }), isCurrent: () => true };
    expect(() => prepare([{ kind: 'create_planned', value: plan, reason: 'Plan' }], legacy)).toThrow('planned.manage');
    const scoped = access(); scoped.policy.permissions.allAccounts = false; scoped.policy.sheetIds = ['main'];
    expect(() => prepare([{ ...edit(), changes: { sheetId: 'private' } } as LedgerChangeAction], scoped)).toThrow('outside');
    expect(() => prepare([{ kind: 'create_planned', value: { ...plan, type: 'expense', transferSheetId: 'pocket' }, reason: 'Transfer plan' }], scoped)).toThrow('outside');
  });
  it('prevents editing or clearing unapproved fields, and projects existing private data out of previews', () => {
    const allowed = access(); allowed.policy.fields = ['description'];
    expect(() => prepare([{ ...edit(), changes: { notes: null } } as LedgerChangeAction], allowed)).toThrow('notes field');
    const preview = prepare([{ ...edit(), changes: { amount: '51.00' } } as LedgerChangeAction], allowed);
    expect(JSON.stringify(preview)).not.toContain('Synthetic member'); expect(preview.changes?.[0].after).not.toHaveProperty('reference');
  });
  it('preserves unshared metadata during a financial-only split without exposing or clearing it', async () => {
    ctx.transactionRepo.save({ ...tx(), notes: 'Private source note' });
    const allowed = access(); allowed.policy.fields = ['description'];
    const preview = prepare([{ kind: 'split_transaction', id: 'actual', version: 1, parts: [{ amount: '25.00', description: 'Dinner' }, { amount: '25.00', description: 'Trip' }], reason: 'Allocate two fees' }], allowed);
    expect(JSON.stringify(preview)).not.toContain('Private source note');
    await apply(preview, allowed); expect(ctx.transactionRepo.getAll().every((row) => row.notes === 'Private source note' && row.reference === actual.reference)).toBe(true);
  });
  it('rechecks revocation after backup and refuses stale ledger state without any financial change', async () => {
    const allowed = access(), preview = prepare([edit()], allowed); let current = true; allowed.isCurrent = () => current;
    const pending = apply(preview, allowed); current = false; await expect(pending).rejects.toThrow('paused'); expect(ctx.transactionRepo.getById('actual')).toEqual(tx());
    const fresh = prepare([edit()]); ctx.transactionRepo.save({ ...tx(), notes: 'Concurrent change without version bump' });
    await expect(apply(fresh)).rejects.toThrow('ledger changed');
  });
  it('coalesces retries and survives restart without replaying a committed or undone split', async () => {
    const input = request([{ kind: 'create_planned', value: plan, reason: 'Expected payment' }]);
    const preview = service.prepare(ctx, access(), connectionId, 'Owner', input);
    const results = await Promise.all([apply(preview), apply(preview)]); expect(results.filter((result) => result.changed)).toHaveLength(1); expect(backupsList(ctx)).toHaveLength(1);
    service = new LedgerChangeService(store); expect(service.prepare(ctx, access(), connectionId, 'Owner', input).state).toBe('committed');
    service.history(ctx, { id: preview.id, direction: 'undo' }); expect((await apply(preview)).preview.state).toBe('undone'); expect(ctx.plannedRepo.getAll()).toEqual([]);
    expect(() => service.prepare(ctx, access(), connectionId, 'Owner', { ...input, label: 'Changed input' })).toThrow('different changes');
  });
  it('rolls back the whole preview on a late validation failure and the whole commit on an audit failure', async () => {
    expect(() => prepare([{ kind: 'create_planned', value: plan, reason: 'Valid first' }, { ...edit(), version: 99 } as LedgerChangeAction])).toThrow('changed'); expect(ctx.plannedRepo.getAll()).toEqual([]);
    const preview = prepare([{ kind: 'create_planned', value: plan, reason: 'Plan' }]);
    vi.spyOn(ctx.auditRepo, 'log').mockImplementation((row) => { if (row.entity_type === 'ledger_changes') throw new Error('Mandatory attribution failed'); return row; });
    await expect(apply(preview)).rejects.toThrow('Mandatory attribution failed'); expect(ctx.plannedRepo.getAll()).toEqual([]);
  });
  it('refuses stale Undo, foreign connection journals and tampered device receipts', async () => {
    const preview = prepare([edit()]); await apply(preview);
    ctx.plannedRepo.save(template()); expect(() => service.history(ctx, { id: preview.id, direction: 'undo' })).toThrow('ledger changed');
    expect(() => service.get(ctx, access(), randomUUID(), { id: preview.id })).toThrow('another connection');
    const key = `ai.ledgerChanges.${preview.id}`, raw = present(ctx.settingsRepo.getSetting(key));
    ctx.settingsRepo.setSetting(key, raw.replace('Correct source attribution', 'Forged reason'), 'device');
    expect(() => service.get(ctx, access(), connectionId, { id: preview.id })).toThrow('authenticated');
  });
  it('rolls back CRDT row and clock changes during preview and emits real changes only on commit', async () => {
    initializeCrr(ctx.sqlite);
    const before = ctx.sqlite.prepare('SELECT * FROM crsql_changes').all();
    const preview = prepare([{ kind: 'create_planned', value: plan, reason: 'Plan' }]);
    // Device-only journals may change settings CRDT internals; no financial plan
    // rows or planned-template clock changes may escape the savepoint.
    expect(ctx.sqlite.prepare("SELECT * FROM crsql_changes WHERE \"table\" = 'planned_templates'").all()).toEqual(before.filter((row) => (row as { table: string }).table === 'planned_templates'));
    await apply(preview); expect(ctx.plannedRepo.getAll()).toHaveLength(1);
  });
  it('publishes validated named tools without exposing raw saves, SQL or approval arguments', () => {
    const definitions = aiLedgerChangeDefinitions(); expect(definitions.map((tool) => tool.name)).toEqual(['prepare_ledger_changes', 'get_ledger_changes', 'apply_ledger_changes']);
    const schemas = JSON.stringify(definitions.map((tool) => tool.inputSchema));
    expect(schemas).not.toContain('modified_by'); expect(schemas).not.toContain('password');
  });
});
