import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../database/connection';
import { SettingsRepo } from '../../database/settings-repo';
import { TransactionRepo } from '../../repositories/transaction-repo';
import { SheetRepo } from '../../repositories/sheet-repo';
import { PlannedRepo } from '../../repositories/planned-repo';
import { InvoiceRepo } from '../../repositories/invoice-repo';
import { CategoryRepo } from '../../repositories/category-repo';
import { ActivityNotesRepo } from '../../repositories/activity-notes-repo';
import { AttachmentRepo } from '../../repositories/attachment-repo';
import { AuditRepo } from '../../repositories/audit-repo';
import { PersonnelRepo } from '../../repositories/personnel-repo';
import type { TransactionRow, PlannedTemplateRow, InvoiceRow } from '../../../shared/ipc-types';
import type { WindowContext } from '../../window/window-context';
import * as transactionOps from '../transaction-operations';
import * as sheetOps from '../sheet-operations';
import * as plannedOps from '../planned-operations';
import * as categoryOps from '../category-operations';
import * as invoiceOps from '../invoice-operations';
import * as noteOps from '../activity-note-operations';
import { activitiesApplyChange } from '../activity-operations';
import { renameAttachmentsForTransaction } from '../attachment-service';

vi.mock('../attachment-service', () => ({ renameAttachmentsForTransaction: vi.fn(), moveAttachmentFilesToTrash: vi.fn() }));
let root: string;
let ctx: WindowContext;
const now = '2026-10-26T00:00:00Z';
function transaction(id: string, sheet = 'Main', type: 'income' | 'expense' = 'expense'): TransactionRow {
  return { id, sheet, type, date: '2026-10-26', description: 'Synthetic entry', amount: '12.00',
    status: type === 'income' ? '--' : 'pending', category: null, party: null, reference: null,
    activity: null, notes: null, linked_id: null, version: 1, created_at: now, modified_at: null, modified_by: null };
}
function plan(id: string): PlannedTemplateRow {
  return { id, target_sheet: 'Main', start_date: '2026-10-26', description: 'Synthetic plan', amount: '12.00',
    type: 'income', frequency: 'monthly', category: null, party: null, activity: null, notes: null,
    end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]',
    transfer_target_sheet: null, version: 1, created_at: now };
}
function invoice(id: string, templateId: string): InvoiceRow {
  return { id, invoice_number: id, date: '2026-10-26', due_date: '2026-10-26',
    from_name: 'Synthetic club', from_address: null, to_name: 'Synthetic recipient', to_address: null,
    line_items: JSON.stringify({ items: [{ description: 'Synthetic plan', quantity: 1, unitPrice: 12 }], taxRate: 0 }),
    subtotal: '12.00', notes: null, bank_details: null, planned_template_id: templateId,
    status: 'draft', transaction_id: null, paid_at: null, planned_template_snapshot: null,
    version: 1, created_at: now, modified_at: null, modified_by: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-operations-'));
  const db = openDatabase(path.join(root, 'synthetic.fdra')).db;
  const transactions = new TransactionRepo(db); const planned = new PlannedRepo(db);
  const sheets = new SheetRepo(db); const invoices = new InvoiceRepo(db);
  const categories = new CategoryRepo(db); const activityNotes = new ActivityNotesRepo(db);
  const attachments = new AttachmentRepo(db);
  ctx = { sqlite: db, isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null,
    authSession: null, databaseId: 'synthetic', settingsRepo: new SettingsRepo(db),
    transactionRepo: transactions, plannedRepo: planned, sheetRepo: sheets, invoiceRepo: invoices,
    auditRepo: new AuditRepo(db), personnelRepo: new PersonnelRepo(db),
    repos: { transactions, planned, sheets, invoices, categories, activityNotes, attachments },
  } as unknown as WindowContext;
  sheets.create('main', 'Main'); sheets.create('savings', 'Savings');
});
afterEach(() => { ctx.sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('shared ledger operation boundaries', () => {
  const operations = { ...transactionOps, ...sheetOps, ...plannedOps, ...categoryOps, ...invoiceOps, ...noteOps };
  it.each(Object.keys(operations))('%s rejects a closed window before touching data', (name) => {
    const closed = { isClosed: true } as WindowContext;
    const invoke = operations[name as keyof typeof operations] as (context: WindowContext) => unknown;
    expect(() => invoke(closed)).toThrow('ledger is closed');
  });

  it('rejects signed-out and demoted/deactivated team identities before a write', () => {
    Object.assign(ctx, { isLocalSyncAuthEnabled: true });
    expect(() => transactionOps.transactionsSave(ctx, transaction('blocked'))).toThrow('Sign in');
    expect(ctx.transactionRepo.getAll()).toHaveLength(0);
  });

  it('keeps referential checks at the application boundary', () => {
    expect(() => transactionOps.transactionsSave(ctx, transaction('bad', 'Missing'))).toThrow('No such sheet');
    expect(() => sheetOps.sheetsCreate(ctx, 'other', 'main')).toThrow('capitalisation');
    expect(ctx.transactionRepo.getAll()).toHaveLength(0);
  });
});

describe('atomic linked application operations', () => {
  it('rejects unequal transfers without creating either side', () => {
    const expense = { ...transaction('out'), linked_id: 'pair' };
    const income = { ...transaction('in', 'Savings', 'income'), linked_id: 'pair', amount: '13.00' };
    expect(() => transactionOps.transactionsSaveTransfer(ctx, expense, income)).toThrow('same date and positive amount');
    expect(ctx.transactionRepo.getAll()).toHaveLength(0);
  });

  it('rejects one-account and reused-entry transfer pairs', () => {
    const expense = { ...transaction('out'), linked_id: 'pair' };
    const income = { ...transaction('in', 'Main', 'income'), linked_id: 'pair' };
    expect(() => transactionOps.transactionsSaveTransfer(ctx, expense, income)).toThrow('different accounts');
    ctx.transactionRepo.save({ ...expense, id: 'unrelated' });
    expect(() => transactionOps.transactionsSaveTransfer(ctx, expense, { ...income, sheet: 'Savings' })).toThrow('selected transfer');
  });

  it('rolls back both sides if updating the second half fails', () => {
    const expense = { ...transaction('out'), linked_id: 'pair' };
    const income = { ...transaction('in', 'Savings', 'income'), linked_id: 'pair' };
    transactionOps.transactionsSaveTransfer(ctx, expense, income);
    ctx.sqlite.exec("CREATE TRIGGER synthetic_transfer_failure BEFORE UPDATE ON transactions WHEN NEW.id = 'in' BEGIN SELECT RAISE(ABORT, 'synthetic second-half failure'); END");
    expect(() => transactionOps.transactionsSaveTransfer(ctx, { ...expense, amount: '20.00' }, { ...income, amount: '20.00' })).toThrow('second-half failure');
    expect(ctx.transactionRepo.getById('out')?.amount).toBe('12.00');
    expect(ctx.transactionRepo.getById('in')?.amount).toBe('12.00');
    expect(renameAttachmentsForTransaction).not.toHaveBeenCalled();
  });

  it('edits a transfer together and preserves attachment naming', () => {
    const expense = { ...transaction('out'), linked_id: 'pair' };
    const income = { ...transaction('in', 'Savings', 'income'), linked_id: 'pair' };
    transactionOps.transactionsSaveTransfer(ctx, expense, income);
    transactionOps.transactionsSaveTransfer(ctx, { ...expense, amount: '20.00' }, { ...income, amount: '20.00' });
    expect(ctx.transactionRepo.getByLinkedId('pair').map((row) => row.amount)).toEqual(['20.00', '20.00']);
    expect(renameAttachmentsForTransaction).toHaveBeenCalledWith('out', ctx);
    expect(renameAttachmentsForTransaction).toHaveBeenCalledWith('in', ctx);
  });

  it('rolls back a planned edit when its linked invoice cannot update', () => {
    plannedOps.plannedSave(ctx, plan('plan'));
    invoiceOps.invoicesSave(ctx, invoice('invoice', 'plan'));
    ctx.sqlite.exec("CREATE TRIGGER synthetic_invoice_failure BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT, 'synthetic invoice failure'); END");
    expect(() => plannedOps.plannedSave(ctx, { ...plan('plan'), amount: '22.00' })).toThrow('invoice failure');
    expect(ctx.plannedRepo.getById('plan')?.amount).toBe('12.00');
    expect(ctx.invoiceRepo.getById('invoice')?.subtotal).toBe('12.00');
  });

  it('updates linked invoices for a bulk planned edit', () => {
    plannedOps.plannedSave(ctx, plan('plan'));
    invoiceOps.invoicesSave(ctx, invoice('invoice', 'plan'));
    plannedOps.plannedBulkSave(ctx, [{ ...plan('plan'), amount: '22.00', description: 'Updated plan', start_date: '2026-11-01' }]);
    expect(ctx.invoiceRepo.getById('invoice')).toMatchObject({ due_date: '2026-11-01', subtotal: '22.00' });
    const saved = ctx.invoiceRepo.getById('invoice');
    if (!saved) throw new Error('Expected the linked invoice to exist');
    const contents = JSON.parse(saved.line_items);
    expect(contents.items[0]).toMatchObject({ description: 'Updated plan', unitPrice: 22 });
  });

  it('keeps invoice details unchanged when only plan labels or notes change', () => {
    plannedOps.plannedSave(ctx, plan('plan'));
    invoiceOps.invoicesSave(ctx, { ...invoice('invoice', 'plan'), line_items: '[{"description":"Custom invoice line","quantity":2,"unitPrice":6}]' });
    const before = ctx.invoiceRepo.getById('invoice');
    plannedOps.plannedSave(ctx, { ...plan('plan'), notes: 'Plan note' });
    plannedOps.plannedBulkSave(ctx, [{ ...plan('plan'), activity: 'New label', notes: 'Another note' }]);
    expect(ctx.invoiceRepo.getById('invoice')).toEqual(before);
  });
});

describe('account identity and cascade safeguards', () => {
  it('rejects mismatched account identity and an invalid merge destination', () => {
    transactionOps.transactionsSave(ctx, transaction('entry'));
    expect(() => sheetOps.sheetsDelete(ctx, 'savings', 'Main')).toThrow('ID and name');
    expect(() => sheetOps.sheetsDelete(ctx, 'main', 'Main', 'Missing')).toThrow('destination account');
    expect(() => sheetOps.sheetsDelete(ctx, 'main', 'Main', 'Main')).toThrow('destination account');
    expect(ctx.transactionRepo.getById('entry')?.sheet).toBe('Main');
    expect(ctx.sheetRepo.getAll()).toHaveLength(2);
  });

  it('preserves incoming planned-transfer references during rename and merge', () => {
    plannedOps.plannedSave(ctx, { ...plan('incoming'), target_sheet: 'Savings', transfer_target_sheet: 'Main' });
    sheetOps.sheetsRename(ctx, 'Main', 'Current');
    expect(ctx.plannedRepo.getById('incoming')?.transfer_target_sheet).toBe('Current');
    sheetOps.sheetsDelete(ctx, 'main', 'Current', 'Savings');
    expect(ctx.plannedRepo.getById('incoming')?.transfer_target_sheet).toBe('Savings');
  });

  it('prevents the simple undo-deletion path from orphaning newer entries', () => {
    transactionOps.transactionsSave(ctx, transaction('newer'));
    expect(() => sheetOps.sheetsDeleteSimple(ctx, 'main')).toThrow('no longer empty');
    expect(ctx.sheetRepo.getByName('Main')).not.toBeNull();
  });

  it('validates the complete reorder rather than accepting duplicate or unknown IDs', () => {
    expect(() => sheetOps.sheetsReorder(ctx, ['main', 'main'])).toThrow('exactly once');
    expect(() => sheetOps.sheetsReorder(ctx, ['main', 'unknown'])).toThrow('exactly once');
    sheetOps.sheetsReorder(ctx, ['savings', 'main']);
    expect(ctx.sheetRepo.getAll().map((sheet) => sheet.id)).toEqual(['savings', 'main']);
  });
});

describe('atomic activity workflows', () => {
  function seed() {
    ctx.transactionRepo.save({ ...transaction('entry'), activity: 'Trip' });
    ctx.plannedRepo.save({ ...plan('plan'), activity: 'Trip' });
    ctx.repos.activityNotes.save('Trip', 'Original note');
    return { transactions: [{ id: 'entry', version: 1, expectedActivity: 'Trip', activity: 'Outing' }],
      templates: [{ id: 'plan', version: 1, expectedActivity: 'Trip', activity: 'Outing' }],
      notes: [{ name: 'Trip', expected: 'Original note', text: null }, { name: 'Outing', expected: null, text: 'Original note' }] };
  }
  it('renames entries, schedules and notes in one operation with safe Undo and Redo', () => {
    const input = seed();
    const inverse = activitiesApplyChange(ctx, input);
    expect(ctx.transactionRepo.getById('entry')).toMatchObject({ activity: 'Outing', version: 2 });
    expect(ctx.plannedRepo.getById('plan')).toMatchObject({ activity: 'Outing', version: 2 });
    expect(ctx.repos.activityNotes.getAll()).toEqual({ Outing: 'Original note' });
    const redo = activitiesApplyChange(ctx, inverse);
    expect(ctx.transactionRepo.getById('entry')).toMatchObject({ activity: 'Trip', version: 3 });
    expect(ctx.repos.activityNotes.getAll()).toEqual({ Trip: 'Original note' });
    activitiesApplyChange(ctx, redo);
    expect(ctx.transactionRepo.getById('entry')).toMatchObject({ activity: 'Outing', version: 4 });
  });
  it('rolls back every entity when a note update fails', () => {
    const input = seed();
    ctx.sqlite.exec("CREATE TRIGGER synthetic_note_failure BEFORE INSERT ON activity_notes BEGIN SELECT RAISE(ABORT, 'synthetic note failure'); END");
    expect(() => activitiesApplyChange(ctx, input)).toThrow('note failure');
    expect(ctx.transactionRepo.getById('entry')).toMatchObject({ activity: 'Trip', version: 1 });
    expect(ctx.plannedRepo.getById('plan')).toMatchObject({ activity: 'Trip', version: 1 });
    expect(ctx.repos.activityNotes.getAll()).toEqual({ Trip: 'Original note' });
  });
  it('rejects stale Undo without overwriting a later amount edit or leaving a partial rename', () => {
    const input = seed(); const inverse = activitiesApplyChange(ctx, input);
    const current = ctx.transactionRepo.getById('entry');
    if (!current) throw new Error('Missing synthetic transaction');
    ctx.transactionRepo.save({ ...current, amount: '99.00', version: 3 });
    expect(() => activitiesApplyChange(ctx, inverse)).toThrow('changed');
    expect(ctx.transactionRepo.getById('entry')).toMatchObject({ activity: 'Outing', amount: '99.00' });
    expect(ctx.plannedRepo.getById('plan')?.activity).toBe('Outing');
  });
  it('preserves an existing destination note and rejects duplicate or arbitrary row changes', () => {
    const input = seed(); ctx.repos.activityNotes.save('Outing', 'Keep this');
    expect(() => activitiesApplyChange(ctx, input)).toThrow('destination already');
    expect(ctx.repos.activityNotes.getAll()).toEqual({ Trip: 'Original note', Outing: 'Keep this' });
    expect(ctx.transactionRepo.getById('entry')?.activity).toBe('Trip');
    expect(() => activitiesApplyChange(ctx, { ...input, transactions: [input.transactions[0], input.transactions[0]] })).toThrow();
    expect(() => activitiesApplyChange(ctx, { ...input, transactions: [{ ...input.transactions[0], amount: '1.00' }] })).toThrow();
  });
});
