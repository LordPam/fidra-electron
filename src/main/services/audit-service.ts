import crypto from 'node:crypto';
import type { WindowContext } from '../window/window-context';
import type { AuditLogRow, TransactionRow, PlannedTemplateRow, InvoiceRow } from '../../shared/ipc-types';

function resolveUser(ctx: WindowContext): string {
  if (ctx.localAuthPersonnel?.name) return ctx.localAuthPersonnel.name;
  if (ctx.localAuthPersonnel?.email) return ctx.localAuthPersonnel.email;
  if (ctx.authSession?.user?.email) return ctx.authSession.user.email;
  const initials = ctx.settingsRepo.getSetting('profile.initials') ?? '';
  const name = ctx.settingsRepo.getSetting('profile.name') ?? '';
  return initials || name || 'System';
}

function makeEntry(
  action: AuditLogRow['action'],
  entityType: string,
  entityId: string,
  user: string,
  summary: string,
  details?: string | null,
): AuditLogRow {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entity_type: entityType,
    entity_id: entityId,
    user,
    summary,
    details: details ?? null,
  };
}

function safeLog(ctx: WindowContext, entry: AuditLogRow): void {
  try {
    ctx.activeAuditRepo.log(entry);
  } catch (e) {
    console.warn('[audit] Failed to write audit entry:', e);
  }
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  return `£${num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function logTransactionCreated(ctx: WindowContext, tx: TransactionRow): void {
  const user = resolveUser(ctx);
  const summary = `Created ${tx.type} '${tx.description}' for ${formatAmount(tx.amount)} on ${tx.date}`;
  safeLog(ctx, makeEntry('create', 'transaction', tx.id, user, summary));
}

export function logTransactionUpdated(ctx: WindowContext, old: TransactionRow, updated: TransactionRow): void {
  const changes = diffTransactions(old, updated);
  if (Object.keys(changes).length === 0) return;

  const user = resolveUser(ctx);
  const changeParts = Object.entries(changes).map(
    ([k, v]) => `${k}: ${(v as { old: string; new: string }).old} -> ${(v as { old: string; new: string }).new}`,
  );
  const summary = `Updated '${updated.description}': ${changeParts.join(', ')}`;
  safeLog(ctx, makeEntry('update', 'transaction', updated.id, user, summary, JSON.stringify(changes)));
}

export function logTransactionDeleted(ctx: WindowContext, tx: TransactionRow): void {
  const user = resolveUser(ctx);
  const summary = `Deleted ${tx.type} '${tx.description}' (${formatAmount(tx.amount)})`;
  safeLog(ctx, makeEntry('delete', 'transaction', tx.id, user, summary));
}

export function logBulkTransactionsSaved(ctx: WindowContext, created: number, updated: number, ids: string[]): void {
  const user = resolveUser(ctx);
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  const summary = `Bulk saved ${ids.length} transaction${ids.length !== 1 ? 's' : ''} (${parts.join(', ')})`;
  safeLog(ctx, makeEntry(updated > 0 ? 'update' : 'create', 'transaction', ids[0] ?? '', user, summary, JSON.stringify({ ids })));
}

export function logBulkTransactionsDeleted(ctx: WindowContext, count: number, ids: string[]): void {
  const user = resolveUser(ctx);
  const summary = `Bulk deleted ${count} transaction${count !== 1 ? 's' : ''}`;
  safeLog(ctx, makeEntry('delete', 'transaction', ids[0] ?? '', user, summary, JSON.stringify({ ids })));
}

export function logAttachmentAdded(ctx: WindowContext, transactionId: string, filename: string): void {
  const user = resolveUser(ctx);
  const summary = `Added attachment '${filename}' to transaction`;
  safeLog(ctx, makeEntry('update', 'attachment', transactionId, user, summary, JSON.stringify({ attachment_added: filename })));
}

export function logAttachmentRemoved(ctx: WindowContext, transactionId: string, filename: string): void {
  const user = resolveUser(ctx);
  const summary = `Removed attachment '${filename}' from transaction`;
  safeLog(ctx, makeEntry('update', 'attachment', transactionId, user, summary, JSON.stringify({ attachment_removed: filename })));
}

export function logPlannedCreated(ctx: WindowContext, planned: PlannedTemplateRow): void {
  const user = resolveUser(ctx);
  const summary = `Created planned ${planned.type} '${planned.description}' for ${formatAmount(planned.amount)} (${planned.frequency})`;
  safeLog(ctx, makeEntry('create', 'planned', planned.id, user, summary));
}

export function logPlannedUpdated(ctx: WindowContext, old: PlannedTemplateRow, updated: PlannedTemplateRow): void {
  const user = resolveUser(ctx);
  const changes: string[] = [];
  if (old.description !== updated.description) changes.push(`description: '${old.description}' -> '${updated.description}'`);
  if (old.amount !== updated.amount) changes.push(`amount: ${formatAmount(old.amount)} -> ${formatAmount(updated.amount)}`);
  if (old.frequency !== updated.frequency) changes.push(`frequency: ${old.frequency} -> ${updated.frequency}`);
  if (old.start_date !== updated.start_date) changes.push(`start_date: ${old.start_date} -> ${updated.start_date}`);
  if (changes.length === 0) return;
  const summary = `Updated planned '${updated.description}': ${changes.join(', ')}`;
  safeLog(ctx, makeEntry('update', 'planned', updated.id, user, summary));
}

export function logBulkPlannedSaved(ctx: WindowContext, created: number, updated: number, ids: string[]): void {
  const user = resolveUser(ctx);
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  const summary = `Bulk saved ${ids.length} planned template${ids.length !== 1 ? 's' : ''} (${parts.join(', ')})`;
  safeLog(ctx, makeEntry('update', 'planned', ids[0] ?? '', user, summary, JSON.stringify({ ids })));
}

export function logPlannedDeleted(ctx: WindowContext, id: string): void {
  const user = resolveUser(ctx);
  const summary = `Deleted planned template`;
  safeLog(ctx, makeEntry('delete', 'planned', id, user, summary));
}

export function logSheetCreated(ctx: WindowContext, name: string, id: string): void {
  const user = resolveUser(ctx);
  const summary = `Created sheet '${name}'`;
  safeLog(ctx, makeEntry('create', 'sheet', id, user, summary));
}

export function logSheetRenamed(ctx: WindowContext, oldName: string, newName: string, id: string): void {
  const user = resolveUser(ctx);
  const summary = `Renamed sheet '${oldName}' to '${newName}'`;
  safeLog(ctx, makeEntry('update', 'sheet', id, user, summary));
}

export function logSheetDeleted(ctx: WindowContext, name: string, id: string, mergeTarget?: string): void {
  const user = resolveUser(ctx);
  const summary = mergeTarget
    ? `Deleted sheet '${name}' (merged into '${mergeTarget}')`
    : `Deleted sheet '${name}'`;
  safeLog(ctx, makeEntry('delete', 'sheet', id, user, summary));
}

export function logInvoiceCreated(ctx: WindowContext, invoice: InvoiceRow): void {
  const user = resolveUser(ctx);
  const summary = `Created invoice ${invoice.invoice_number} for ${invoice.to_name}`;
  safeLog(ctx, makeEntry('create', 'invoice', invoice.id, user, summary));
}

export function logInvoiceUpdated(ctx: WindowContext, invoice: InvoiceRow): void {
  const user = resolveUser(ctx);
  const summary = `Updated invoice ${invoice.invoice_number}`;
  safeLog(ctx, makeEntry('update', 'invoice', invoice.id, user, summary));
}

export function logInvoiceDeleted(ctx: WindowContext, id: string): void {
  const user = resolveUser(ctx);
  const summary = `Deleted invoice`;
  safeLog(ctx, makeEntry('delete', 'invoice', id, user, summary));
}

export function logInvoiceMarkedPaid(ctx: WindowContext, invoice: InvoiceRow): void {
  const user = resolveUser(ctx);
  const summary = `Marked invoice ${invoice.invoice_number} as paid`;
  safeLog(ctx, makeEntry('update', 'invoice', invoice.id, user, summary));
}

function diffTransactions(old: TransactionRow, updated: TransactionRow): Record<string, { old: string; new: string }> {
  const changes: Record<string, { old: string; new: string }> = {};
  const fields: (keyof TransactionRow)[] = [
    'description', 'amount', 'type', 'date', 'sheet', 'category',
    'party', 'status', 'notes', 'reference',
  ];

  for (const field of fields) {
    const oldVal = old[field];
    const newVal = updated[field];
    if (oldVal !== newVal) {
      const format = (v: unknown) => {
        if (v == null) return '';
        if (field === 'amount') return formatAmount(String(v));
        return String(v);
      };
      changes[field] = { old: format(oldVal), new: format(newVal) };
    }
  }

  return changes;
}
