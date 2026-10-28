import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import type { PlannedTemplateRow, TransactionRow } from '../../shared/ipc-types';
import { aiEmptyQuerySchema, aiInvoiceQuerySchema, aiPlannedQuerySchema, aiTransactionQuerySchema, aiSettingsQuerySchema } from '../../shared/ai-ledger-read-types';
import { assertAiOperationAccess, aiPermittedAccounts, type AiOperationAccess } from './ai-operation-access';
import { transactionsGetAll } from './transaction-operations';
import { plannedGetAll } from './planned-operations';
import { invoicesGetAll } from './invoice-operations';
import { categoriesGetAll } from './category-operations';
import { activityNotesGetAll } from './activity-note-operations';
import * as settings from './settings-operations';
import { listPersonnel } from './personnel-administration';
import { syncGetStatus } from './sync-operations';

function page<T>(rows: T[], query: { offset: number; limit: number }) {
  return { rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length,
    nextOffset: query.offset + query.limit < rows.length ? query.offset + query.limit : null };
}

function details(row: TransactionRow | PlannedTemplateRow, access: AiOperationAccess) {
  return Object.fromEntries(access.policy.fields.filter((field) => field in row).map((field) => [field, row[field as keyof typeof row]]));
}

const invoiceItems = z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number() }));
function invoiceLineItems(raw: string) {
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) ? invoiceItems.parse(value) : z.object({ items: invoiceItems,
    taxRate: z.number().optional(), accentMode: z.enum(['fidra', 'black', 'logo']).optional(),
  }).parse(value);
}

export function aiReadTransactions(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'transactions.read');
  const query = aiTransactionQuerySchema.parse(raw);
  const accounts = aiPermittedAccounts(ctx, access, query.sheetIds);
  const rows = transactionsGetAll(ctx).filter((row) => row.date >= query.from && row.date <= query.to
    && accounts.some((sheet) => sheet.name === row.sheet));
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { accounts, ...page(rows.map((row) => ({ id: row.id, version: row.version, date: row.date, amount: row.amount,
    type: row.type, status: row.status, accountId: accounts.find((sheet) => sheet.name === row.sheet)?.id,
    ...details(row, access),
    // Do not disclose a counterpart ID from an unapproved account.
    linkedId: row.linked_id && ctx.transactionRepo.getByLinkedId(row.linked_id).every((other) => accounts.some((sheet) => sheet.name === other.sheet)) ? row.linked_id : null,
  })), query) };
}

export function aiReadPlanned(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'planned.read');
  const query = aiPlannedQuerySchema.parse(raw);
  const accounts = aiPermittedAccounts(ctx, access, query.sheetIds);
  const rows = plannedGetAll(ctx).filter((row) => accounts.some((sheet) => sheet.name === row.target_sheet)
    && (!row.transfer_target_sheet || accounts.some((sheet) => sheet.name === row.transfer_target_sheet)));
  rows.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
  return { accounts, ...page(rows.map((row) => ({ id: row.id, version: row.version, startDate: row.start_date,
    amount: row.amount, type: row.type, frequency: row.frequency, endDate: row.end_date, occurrenceCount: row.occurrence_count,
    skippedDates: JSON.parse(row.skipped_dates), fulfilledDates: JSON.parse(row.fulfilled_dates),
    accountId: accounts.find((sheet) => sheet.name === row.target_sheet)?.id,
    transferAccountId: accounts.find((sheet) => sheet.name === row.transfer_target_sheet)?.id ?? null,
    ...details(row, access),
  })), query) };
}

export function aiReadInvoices(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'invoices.read');
  const query = aiInvoiceQuerySchema.parse(raw);
  const fields = access.policy.fields;
  // Invoice permission explicitly covers billing details; optional context fields
  // remain separately restricted, including free text inside line items.
  return page(invoicesGetAll(ctx).filter((row) => row.date >= query.from && row.date <= query.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((row) => ({ id: row.id, version: row.version, invoiceNumber: row.invoice_number, date: row.date,
      dueDate: row.due_date, subtotal: row.subtotal, status: row.status, paidAt: row.paid_at,
      plannedTemplateId: row.planned_template_id, transactionId: row.transaction_id,
      ...(fields.includes('party') ? { fromName: row.from_name, fromAddress: row.from_address, toName: row.to_name, toAddress: row.to_address, bankDetails: row.bank_details } : {}),
      ...(fields.includes('description') ? { lineItems: invoiceLineItems(row.line_items) } : {}),
      ...(fields.includes('notes') ? { notes: row.notes } : {}),
    })), query);
}

export function aiReadCategories(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'categories.manage'); aiEmptyQuerySchema.parse(raw);
  return { income: categoriesGetAll(ctx, 'income'), expense: categoriesGetAll(ctx, 'expense') };
}

export function aiReadActivities(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'activities.manage'); aiEmptyQuerySchema.parse(raw);
  const notes = activityNotesGetAll(ctx);
  const names = new Set([...transactionsGetAll(ctx), ...plannedGetAll(ctx)].map((row) => row.activity).filter((name): name is string => !!name));
  Object.keys(notes).forEach((name) => names.add(name));
  return [...names].sort().map((name) => ({ name, ...(access.policy.fields.includes('notes') ? { notes: notes[name] ?? '' } : {}) }));
}

export function aiReadSettings(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'settings.read');
  const query = aiSettingsQuerySchema.parse(raw);
  const result: Record<string, unknown> = {};
  for (const group of query.groups) {
    if (group === 'profile') result.profile = settings.settingsGetProfile(ctx);
    else if (group === 'transactionBehavior') result.transactionBehavior = settings.settingsGetTransactionSettings(ctx);
    else if (group === 'financialYear') result.financialYear = { startMonth: settings.settingsGetFYStartMonth(ctx) };
    else if (group === 'organisation') result.organisation = { name: settings.settingsGetOrgName(ctx) };
    else if (group === 'appearance') result.appearance = settings.settingsGetUiPreferences(ctx);
    else {
      const defaults = settings.settingsGetInvoiceDefaults(ctx);
      result.invoiceDefaults = {
        accentMode: defaults.accentMode,
        ...(access.policy.fields.includes('party') ? { fromName: defaults.fromName, fromAddress: defaults.fromAddress, bankDetails: defaults.bankDetails } : {}),
        ...(access.policy.fields.includes('notes') ? { notes: defaults.notes } : {}),
      };
    }
  }
  return result;
}

export function aiReadPersonnel(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'personnel.read'); aiEmptyQuerySchema.parse(raw);
  return listPersonnel(ctx).map(({ id, name, email, role }) => ({ id, name, email, role }));
}

export function aiReadSyncStatus(ctx: WindowContext, access: AiOperationAccess, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'sync.read'); aiEmptyQuerySchema.parse(raw);
  const status = syncGetStatus(ctx);
  return { enabled: status.enabled, state: status.state, lastExportAt: status.lastExportAt,
    lastImportAt: status.lastImportAt, pendingConflicts: status.pendingConflicts,
    needsAttention: !!status.lastError || !!status.staleReason,
    ...(status.lastError || status.staleReason ? { instructions: 'Review synchronization in native Fidra. Critical-field conflicts require human review.' } : {}) };
}

export const aiLedgerReads = {
  read_transactions: aiReadTransactions,
  read_planned: aiReadPlanned,
  read_invoices: aiReadInvoices,
  read_categories: aiReadCategories,
  read_activities: aiReadActivities,
  read_settings: aiReadSettings,
  read_personnel: aiReadPersonnel,
  read_sync_status: aiReadSyncStatus,
};
export type AiLedgerReadName = keyof typeof aiLedgerReads;
export function isAiLedgerRead(name: string): name is AiLedgerReadName { return Object.hasOwn(aiLedgerReads, name); }
