import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import { aiReadTransactions, aiReadPlanned, aiReadInvoices, aiReadActivities, aiReadCategories } from '../ai-ledger-reads';
import { aiLedgerReadDefinitions } from '../../../shared/ai-application-tools';
import type { AiOperationAccess } from '../ai-operation-access';

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


function access(overrides = {}): AiOperationAccess {
  return { policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: ['description'], permissions: { capabilities: ['transactions.read', 'planned.read'], ...overrides } }), isCurrent: () => true };
}
const range = { from: '2026-10-01', to: '2026-10-31' };
describe('external ledger reads', () => {
  it('requires a current connection and a specific read capability', () => {
    const old = { ...access(), policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: [], permissions: { allowAdd: true } }) };
    expect(() => aiReadTransactions(ctx, old, range)).toThrow('permission');
    expect(() => aiReadTransactions(ctx, { ...access(), isCurrent: () => false }, range)).toThrow('paused');
    const signedOut = { ...ctx, isLocalSyncAuthEnabled: true } as WindowContext;
    expect(() => aiReadTransactions(signedOut, access(), range)).toThrow();
  });
  it('filters accounts and dates, redacts optional fields and private counterpart IDs', () => {
    ctx.transactionRepo.save({ ...transaction('visible'), description: 'Visible', notes: 'SECRET', party: 'SECRET', linked_id: 'private-transfer' });
    ctx.transactionRepo.save({ ...transaction('private', 'Savings', 'income'), description: 'SECRET', linked_id: 'private-transfer' });
    ctx.transactionRepo.save({ ...transaction('old'), date: '2026-09-30', description: 'SECRET' });
    const result = aiReadTransactions(ctx, access(), range);
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({ id: 'visible', description: 'Visible', linkedId: null });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('Savings');
    expect(() => aiReadTransactions(ctx, access(), { ...range, sheetIds: ['savings'] })).toThrow('outside');
  });
  it('honours pagination and rejects invalid ranges, oversized pages and caller-supplied grants', () => {
    ctx.transactionRepo.save(transaction('a')); ctx.transactionRepo.save(transaction('b'));
    expect(aiReadTransactions(ctx, access(), { ...range, limit: 1 })).toMatchObject({ total: 2, nextOffset: 1, rows: [{ id: 'a' }] });
    expect(aiReadTransactions(ctx, access(), { ...range, offset: 1, limit: 1 })).toMatchObject({ nextOffset: null, rows: [{ id: 'b' }] });
    for (const query of [{ ...range, from: '2026-11-01' }, { ...range, limit: 201 }, { ...range, permissions: { allAccounts: true } }]) expect(() => aiReadTransactions(ctx, access(), query)).toThrow();
  });
  it('includes future accounts only after explicit all-accounts approval', () => {
    const narrow = access(); const whole = access({ allAccounts: true });
    ctx.sheetRepo.create('future', 'Future'); ctx.transactionRepo.save(transaction('new', 'Future'));
    expect(aiReadTransactions(ctx, narrow, range).total).toBe(0);
    expect(aiReadTransactions(ctx, whole, range).total).toBe(1);
  });
  it('does not disclose a planned transfer unless both accounts are approved', () => {
    ctx.plannedRepo.save({ ...plan('transfer'), transfer_target_sheet: 'Savings', notes: 'SECRET' });
    expect(aiReadPlanned(ctx, access(), {}).rows).toHaveLength(0);
    const result = aiReadPlanned(ctx, access({ allAccounts: true }), {});
    expect(result.rows[0]).toMatchObject({ id: 'transfer', transferAccountId: 'savings', frequency: 'monthly', skippedDates: [] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('requires ledger-wide invoice consent and keeps unapproved text and billing details private', () => {
    ctx.invoiceRepo.save({ ...invoice('invoice', 'plan'), notes: 'SECRET', to_name: 'SECRET', bank_details: 'SECRET', line_items: '[{"description":"SECRET","quantity":1,"unitPrice":12}]' });
    expect(() => aiReadInvoices(ctx, access(), range)).toThrow('permission');
    const permitted = access({ allAccounts: true, capabilities: ['invoices.read'] }); permitted.policy.fields = [];
    const result = aiReadInvoices(ctx, permitted, range);
    expect(result.rows[0]).toMatchObject({ id: 'invoice', subtotal: '12.00' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    permitted.policy.fields = ['party', 'description', 'notes'];
    expect(aiReadInvoices(ctx, permitted, range).rows[0]).toMatchObject({ toName: 'SECRET', notes: 'SECRET' });
  });
  it('uses category and activity services under separate ledger-wide consent', () => {
    ctx.repos.categories.setAll('income', ['Dues']); ctx.repos.activityNotes.save('Trip', 'SECRET');
    expect(() => aiReadCategories(ctx, access(), {})).toThrow();
    const permitted = access({ allAccounts: true, capabilities: ['categories.manage', 'activities.manage'] });
    expect(aiReadCategories(ctx, permitted, {})).toEqual({ income: ['Dues'], expense: [] });
    expect(aiReadActivities(ctx, permitted, {})).toEqual([{ name: 'Trip' }]);
    permitted.policy.fields = ['notes'];
    expect(aiReadActivities(ctx, permitted, {})).toEqual([{ name: 'Trip', notes: 'SECRET' }]);
  });
  it('publishes strict read-only tool schemas with connection selection', () => {
    for (const tool of aiLedgerReadDefinitions()) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toHaveProperty('connectionId');
    }
  });
});
