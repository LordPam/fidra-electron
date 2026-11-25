import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import type { InvoiceRow, PlannedTemplateRow, TransactionRow } from '../../shared/ipc-types';
import type { ApplicationCapability } from '../../shared/application-capabilities';
import { ledgerChangeRequestSchema, type LedgerChangeRequest } from '../../shared/ledger-change-types';
import { ledgerCleanupApplySchema, ledgerCleanupQuerySchema, ledgerCleanupHistorySchema, ledgerCleanupReviewSchema, type LedgerCleanupPreview, type LedgerCleanupState } from '../../shared/ledger-cleanup-types';
import type { AiAuthorizationStore } from './ai-authorization-store';
import { assertAiOperationAccess, aiPermittedAccounts, type AiOperationAccess } from './ai-operation-access';
import { assertApplicationPermission } from './application-access';
import { executeLedgerChanges } from './ledger-change-operations';
import { canonicalJson } from './update-manifest';
import { backupsCreate } from './backup-operations';
import { transactionsBulkSave, transactionsBulkDelete } from './transaction-operations';
import { plannedBulkSave, plannedDelete } from './planned-operations';
import { invoicesSave, invoicesDelete } from './invoice-operations';
import { categoriesSetAll } from './category-operations';
import { activityNotesSave, activityNotesDelete } from './activity-note-operations';

const prefix = 'ai.ledgerChanges.';
const envelopeSchema = z.object({ body: z.string().max(16_000_000), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const ordered = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
const settingKeys = ['profile.name', 'profile.initials', 'tx.dateOnApprove', 'tx.dateOnPlannedConversion', 'fy.startMonth', 'report.orgName',
  'invoice.fromName', 'invoice.fromAddress', 'invoice.bankDetails', 'invoice.notes', 'invoice.accentMode'] as const;
interface Snapshot {
  transactions: TransactionRow[]; planned: PlannedTemplateRow[]; invoices: InvoiceRow[];
  categories: { income: string[]; expense: string[] }; notes: Record<string, string>; settings: Record<string, string | null>;
}
interface Journal {
  version: 1; id: string; digest: string; connectionId: string; inputHash: string; input: LedgerChangeRequest; seed: string;
  actor: string; createdAt: string; state: LedgerCleanupState; requiresReview: boolean; before: Snapshot; after: Snapshot;
  requiredCapabilities: ApplicationCapability[]; fingerprint: string; expectedFingerprint: string; backupId: string | null;
  counters: Record<string, number>;
}
type Signer = Pick<AiAuthorizationStore, 'signOperation' | 'verifyOperation'>;

function snapshot(ctx: WindowContext): Snapshot {
  return { transactions: ordered(ctx.transactionRepo.getAllForSnapshot()), planned: ordered(ctx.plannedRepo.getAll()), invoices: ordered(ctx.invoiceRepo.getAll()),
    categories: { income: ctx.repos.categories.getAll('income'), expense: ctx.repos.categories.getAll('expense') }, notes: ctx.repos.activityNotes.getAll(),
    settings: Object.fromEntries(settingKeys.map((key) => [key, ctx.settingsRepo.getSetting(key)])) };
}
function fingerprint(ctx: WindowContext) {
  return hash({ ...snapshot(ctx), sheets: ordered(ctx.sheetRepo.getAll()), attachments: ordered(ctx.attachmentRepo.getAllForSnapshot()) });
}
function delta(from: Snapshot, to: Snapshot): Snapshot {
  const changed = <T extends { id: string }>(a: T[], b: T[]) => { const lookup = new Map(b.map((row) => [row.id, row])); return a.filter((row) => !isDeepStrictEqual(row, lookup.get(row.id))); };
  return { ...from, transactions: changed(from.transactions, to.transactions), planned: changed(from.planned, to.planned), invoices: changed(from.invoices, to.invoices) };
}
function businessEffect(value: Snapshot): unknown {
  const rows = <T extends { id: string }>(items: T[]) => items.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['version', 'modified_at', 'modified_by', 'paid_at'].includes(key))));
  return { ...value, transactions: rows(value.transactions), planned: rows(value.planned), invoices: rows(value.invoices) };
}

/** Private signed journals bind native Undo and retries to the device, ledger,
 * connection, exact application effects and immutable request. No raw rows or
 * receipt signatures are accepted from an external caller. */
export class LedgerChangeService {
  private readonly applying = new Map<string, Promise<{ preview: LedgerCleanupPreview; changed: boolean }>>();
  constructor(private readonly signer: Signer) {}
  private scope(ctx: WindowContext) { return JSON.stringify(['ledger-changes-v1', ctx.databaseId, fs.realpathSync.native(ctx.dbPath)]); }
  has(ctx: WindowContext, id: string) { return ctx.settingsRepo.getSetting(prefix + id) !== null; }
  private read(ctx: WindowContext, id: string): Journal {
    const raw = ctx.settingsRepo.getSetting(prefix + id);
    if (!raw) throw new Error('This change batch is no longer available.');
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    if (!this.signer.verifyOperation(this.scope(ctx), envelope.body, envelope.signature)) throw new Error('The change journal could not be authenticated.');
    const saved = JSON.parse(envelope.body) as Journal;
    if (saved.id !== id || saved.version !== 1) throw new Error('Unsupported change journal.');
    return saved;
  }
  private write(ctx: WindowContext, saved: Journal) {
    const body = JSON.stringify(saved);
    if (Buffer.byteLength(body) > 16_000_000) throw new Error('This batch is too large. Prepare a smaller batch.');
    ctx.settingsRepo.setSetting(prefix + saved.id, JSON.stringify({ body, signature: this.signer.signOperation(this.scope(ctx), body) }), 'device');
  }
  private access(ctx: WindowContext, access: AiOperationAccess, connectionId: string, saved: Journal) {
    if (!access.isCurrent()) throw new Error('This connection is paused or revoked.');
    if (saved.connectionId !== connectionId) throw new Error('This batch belongs to another connection.');
    for (const capability of saved.requiredCapabilities) assertAiOperationAccess(ctx, access, capability);
    const accounts = aiPermittedAccounts(ctx, access);
    for (const row of [...saved.before.transactions, ...saved.after.transactions]) if (!accounts.some((sheet) => sheet.name === row.sheet)) throw new Error('An affected transaction is outside this connection.');
    for (const row of [...saved.before.planned, ...saved.after.planned]) if (!accounts.some((sheet) => sheet.name === row.target_sheet)
      || (row.transfer_target_sheet && !accounts.some((sheet) => sheet.name === row.transfer_target_sheet))) throw new Error('An affected plan is outside this connection.');
  }
  private view(saved: Journal, access?: AiOperationAccess): LedgerCleanupPreview {
    const permitted = (cap: ApplicationCapability) => !access || access.policy.permissions.capabilities.includes(cap);
    const fields = access?.policy.fields ?? ['description', 'party', 'category', 'activity', 'notes', 'reference'];
    const changes: NonNullable<LedgerCleanupPreview['changes']> = [];
    const details = (value: object) => Object.fromEntries(fields.filter((field) => field in value).map((field) => [field, value[field as keyof typeof value]]));
    const addRows = <T extends { id: string }>(resource: string, before: T[], after: T[], project: (row: T) => Record<string, unknown>) => {
      for (const id of new Set([...before, ...after].map((row) => row.id))) {
        const old = before.find((row) => row.id === id), current = after.find((row) => row.id === id);
        changes.push({ resource, id, before: old ? project(old) : null, after: current ? project(current) : null });
      }
    };
    if (permitted('transactions.read')) addRows('Transaction', saved.before.transactions, saved.after.transactions, (row) => ({ id: row.id, version: row.version, date: row.date,
      amount: row.amount, type: row.type, status: row.status, account: row.sheet, linkedId: row.linked_id, ...details(row) }));
    else addRows('New transaction', [], saved.after.transactions.filter((row) => !saved.before.transactions.some((item) => item.id === row.id)), (row) => ({ id: row.id }));
    if (permitted('planned.read')) addRows('Planned payment', saved.before.planned, saved.after.planned, (row) => ({ id: row.id, version: row.version, startDate: row.start_date,
      amount: row.amount, type: row.type, account: row.target_sheet, transferAccount: row.transfer_target_sheet, frequency: row.frequency,
      endDate: row.end_date, occurrenceCount: row.occurrence_count, skippedDates: JSON.parse(row.skipped_dates), fulfilledDates: JSON.parse(row.fulfilled_dates), ...details(row) }));
    else addRows('New planned payment', [], saved.after.planned.filter((row) => !saved.before.planned.some((item) => item.id === row.id)), (row) => ({ id: row.id }));
    if (permitted('invoices.read')) addRows('Invoice', saved.before.invoices, saved.after.invoices, (row) => ({ id: row.id, version: row.version, invoiceNumber: row.invoice_number,
      date: row.date, dueDate: row.due_date, total: row.subtotal, status: row.status, transactionId: row.transaction_id, plannedTemplateId: row.planned_template_id,
      ...(fields.includes('party') ? { fromName: row.from_name, fromAddress: row.from_address, toName: row.to_name, toAddress: row.to_address, bankDetails: row.bank_details } : {}),
      ...(fields.includes('description') ? { lineItems: JSON.parse(row.line_items) } : {}), ...(fields.includes('notes') ? { notes: row.notes } : {}) }));
    else addRows('New invoice', [], saved.after.invoices.filter((row) => !saved.before.invoices.some((item) => item.id === row.id)), (row) => ({ id: row.id }));
    if (permitted('categories.manage')) for (const type of ['income', 'expense'] as const) if (!isDeepStrictEqual(saved.before.categories[type], saved.after.categories[type])) changes.push({ resource: 'Categories', id: type, before: { names: saved.before.categories[type] }, after: { names: saved.after.categories[type] } });
    if (permitted('activities.manage')) for (const name of new Set([...Object.keys(saved.before.notes), ...Object.keys(saved.after.notes)])) {
      if (saved.before.notes[name] !== saved.after.notes[name]) changes.push({ resource: 'Activity note', id: name, before: { name, ...(fields.includes('notes') ? { notes: saved.before.notes[name] ?? null } : {}) }, after: { name, ...(fields.includes('notes') ? { notes: saved.after.notes[name] ?? null } : {}) } });
    }
    if (permitted('settings.read')) for (const key of settingKeys) {
      const field = key.startsWith('invoice.') ? key === 'invoice.notes' ? 'notes' : key === 'invoice.accentMode' ? null : 'party' : null;
      if (field && !fields.includes(field)) continue;
      if (saved.before.settings[key] !== saved.after.settings[key]) changes.push({ resource: 'Settings', id: key, before: { value: saved.before.settings[key] }, after: { value: saved.after.settings[key] } });
    }
    return { id: saved.id, digest: saved.digest, label: saved.input.label, createdAt: saved.createdAt, state: saved.state, requiresReview: saved.requiresReview,
      reasons: saved.input.actions.map(({ kind, reason }) => ({ kind, reason })), sheets: [], before: [], after: [], transferCount: 0, backupId: saved.backupId, changes };
  }
  prepare(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, raw: unknown) {
    if (!access.isCurrent()) throw new Error('This connection is paused or revoked.');
    assertApplicationPermission(ctx, 'ledgerUse');
    const input = ledgerChangeRequestSchema.parse(raw), id = hash(['ledger-changes', connectionId, input.requestId]), inputHash = hash(input);
    return ctx.sqlite.transaction(() => {
      if (this.has(ctx, id)) {
        const saved = this.read(ctx, id); this.access(ctx, access, connectionId, saved);
        if (saved.inputHash !== inputHash) throw new Error('This requestId was used for different changes.');
        return this.view(saved, access);
      }
      const before = snapshot(ctx), beforeFingerprint = fingerprint(ctx), seed = randomUUID(), createdAt = new Date().toISOString();
      let after: Snapshot; let requiredCapabilities: ApplicationCapability[];
      ctx.sqlite.exec('SAVEPOINT fidra_ledger_change_preview');
      try {
        requiredCapabilities = executeLedgerChanges(ctx, access, input, actor, seed, createdAt);
        after = snapshot(ctx);
      } finally {
        // Every admitted operation is DB-only. Roll back audit rows, CRDT clocks,
        // linked invoices and all financial effects before publishing the draft.
        ctx.sqlite.exec('ROLLBACK TO fidra_ledger_change_preview');
        ctx.sqlite.exec('RELEASE fidra_ledger_change_preview');
      }
      if (isDeepStrictEqual(businessEffect(before), businessEffect(after))) throw new Error('The ledger already matches these changes.');
      const beforeDelta = delta(before, after), afterDelta = delta(after, before);
      if (beforeDelta.transactions.length + afterDelta.transactions.length + beforeDelta.planned.length + afterDelta.planned.length + beforeDelta.invoices.length + afterDelta.invoices.length > 2000) throw new Error('Prepare a batch affecting at most 1,000 records.');
      const requiresReview = input.actions.some((action) => action.kind === 'rename_activity' && action.newName === null);
      const saved: Journal = { version: 1, id, digest: hash([id, inputHash, beforeFingerprint, businessEffect(after)]), connectionId, inputHash, input, seed, actor,
        createdAt, state: requiresReview ? 'draft' : 'ready', requiresReview, before: beforeDelta, after: afterDelta, requiredCapabilities, fingerprint: beforeFingerprint, expectedFingerprint: beforeFingerprint, backupId: null, counters: {} };
      this.access(ctx, access, connectionId, saved); this.write(ctx, saved); return this.view(saved, access);
    }).immediate();
  }
  get(ctx: WindowContext, access: AiOperationAccess, connectionId: string, raw: unknown) {
    const saved = this.read(ctx, ledgerCleanupQuerySchema.parse(raw).id); this.access(ctx, access, connectionId, saved); return this.view(saved, access);
  }
  list(ctx: WindowContext, activeConnections: Set<string>): LedgerCleanupPreview[] {
    assertApplicationPermission(ctx, 'ledgerUse');
    return Object.keys(ctx.settingsRepo.getAll()).filter((key) => key.startsWith(prefix)).flatMap((key) => {
      try { const saved = this.read(ctx, key.slice(prefix.length)); return activeConnections.has(saved.connectionId) ? [this.view(saved)] : []; }
      catch { return []; }
    });
  }
  review(ctx: WindowContext, activeConnections: Set<string>, actor: string, raw: unknown) {
    assertApplicationPermission(ctx, 'ledgerUse');
    const input = ledgerCleanupReviewSchema.parse(raw);
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, input.id);
      if (!activeConnections.has(saved.connectionId)) throw new Error('Unlock the original approving connection before reviewing these changes.');
      if (saved.digest !== input.digest || !['ready', 'draft', 'approved'].includes(saved.state)) throw new Error('This batch is no longer awaiting review.');
      if (fingerprint(ctx) !== saved.fingerprint) throw new Error('The ledger changed. Prepare a fresh batch before review.');
      saved.state = input.approve ? 'approved' : 'rejected';
      this.audit(ctx, saved, actor, input.approve ? 'Reviewed ledger changes' : 'Rejected ledger changes');
      this.write(ctx, saved); return this.view(saved);
    }).immediate();
  }
  private audit(ctx: WindowContext, saved: Journal, actor: string, operation: string) {
    ctx.auditRepo.log({ id: randomUUID(), timestamp: new Date().toISOString(), action: 'update', entity_type: 'ledger_changes', entity_id: saved.id, user: actor,
      summary: `${operation}: ${saved.input.label}`, details: JSON.stringify({ origin: 'personal-ai', digest: saved.digest, operation, reasons: saved.input.actions.map((action) => action.reason) }) });
  }
  async apply(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, raw: unknown) {
    const input = ledgerCleanupApplySchema.parse(raw), saved = this.read(ctx, input.id); this.access(ctx, access, connectionId, saved);
    if (saved.digest !== input.digest) throw new Error('The change digest does not match.');
    if (saved.state === 'committed' || saved.state === 'undone') return { preview: this.view(saved, access), changed: false };
    if (saved.state !== 'ready' && saved.state !== 'approved') throw new Error('Review and approve these changes inside Fidra Settings before applying.');
    const key = `${fs.realpathSync.native(ctx.dbPath)}:${saved.id}`, current = this.applying.get(key);
    if (current) return current.then((result) => ({ ...result, changed: false }));
    const promise = this.commit(ctx, access, connectionId, actor, saved.id, saved.digest); this.applying.set(key, promise);
    try { return await promise; } finally { if (this.applying.get(key) === promise) this.applying.delete(key); }
  }
  private async commit(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, id: string, digest: string) {
    if (this.read(ctx, id).fingerprint !== fingerprint(ctx)) throw new Error('The ledger changed. Prepare a fresh batch before applying.');
    const backup = await backupsCreate(ctx, hash(['ledger-changes-backup', connectionId, id]));
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, id); this.access(ctx, access, connectionId, saved);
      if (saved.digest !== digest || !['ready', 'approved'].includes(saved.state) || saved.fingerprint !== fingerprint(ctx)) throw new Error('The ledger or request changed while backing up. Prepare a new batch.');
      const before = snapshot(ctx);
      executeLedgerChanges(ctx, access, saved.input, actor, saved.seed, saved.createdAt);
      const after = snapshot(ctx), effect = delta(after, before);
      if (!isDeepStrictEqual(businessEffect(effect), businessEffect(saved.after))) throw new Error('The application result differs from the prepared changes.');
      saved.after = effect; saved.state = 'committed'; saved.expectedFingerprint = fingerprint(ctx); saved.backupId = backup.metadata.id;
      this.audit(ctx, saved, actor, 'Applied ledger changes'); this.write(ctx, saved); return { preview: this.view(saved, access), changed: true };
    }).immediate();
  }
  history(ctx: WindowContext, raw: unknown) {
    const actor = assertApplicationPermission(ctx, 'ledgerUse'), input = ledgerCleanupHistorySchema.parse(raw);
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, input.id), state = input.direction === 'undo' ? 'undone' : 'committed';
      if (saved.state === state) return this.view(saved);
      if (saved.state !== (input.direction === 'undo' ? 'committed' : 'undone')) throw new Error('This batch is not available for that history action.');
      if (fingerprint(ctx) !== saved.expectedFingerprint) throw new Error('The ledger changed after this batch. Review those changes before Undo or Redo.');
      // Same live authority ceiling as the original shared operation, including
      // organisation administration. Native Undo does not require AI consent.
      if (saved.input.actions.some((action) => action.kind.startsWith('set_') && !['set_transaction_status', 'set_categories', 'set_activity_note', 'set_invoice_status'].includes(action.kind))) assertApplicationPermission(ctx, 'ledgerAdministration');
      const target = input.direction === 'undo' ? saved.before : saved.after, current = input.direction === 'undo' ? saved.after : saved.before;
      const bump = <T extends { id: string; version: number }>(entity: string, rows: T[]) => rows.map((row) => {
        const key = `${entity}:${row.id}`, previous = [...saved.before[entity as 'transactions'], ...saved.after[entity as 'transactions']].filter((item) => item.id === row.id);
        const version = Math.max(saved.counters[key] ?? 0, row.version, ...previous.map((item) => item.version)) + 1; saved.counters[key] = version; return { ...row, version };
      });
      const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
      const wantedActuals = ids(target.transactions), wantedPlans = ids(target.planned), wantedInvoices = ids(target.invoices);
      for (const row of current.invoices) if (!wantedInvoices.has(row.id)) invoicesDelete(ctx, row.id);
      for (const row of current.planned) if (!wantedPlans.has(row.id)) plannedDelete(ctx, row.id);
      transactionsBulkDelete(ctx, current.transactions.filter((row) => !wantedActuals.has(row.id)).map((row) => row.id));
      transactionsBulkSave(ctx, bump('transactions', target.transactions));
      plannedBulkSave(ctx, bump('planned', target.planned));
      // Restore invoice snapshots after planned saves so linked recalculation
      // cannot overwrite custom invoice items captured by the original batch.
      for (const row of target.invoices) {
        const currentVersion = ctx.invoiceRepo.getById(row.id)?.version ?? 0;
        invoicesSave(ctx, { ...row, version: Math.max(saved.counters[`invoices:${row.id}`] ?? 0, row.version, currentVersion) + 1 });
        saved.counters[`invoices:${row.id}`] = ctx.invoiceRepo.getById(row.id)?.version ?? row.version;
      }
      for (const type of ['income', 'expense'] as const) if (!isDeepStrictEqual(current.categories[type], target.categories[type])) categoriesSetAll(ctx, type, target.categories[type]);
      for (const name of new Set([...Object.keys(current.notes), ...Object.keys(target.notes)])) if (current.notes[name] !== target.notes[name]) {
        if (Object.hasOwn(target.notes, name)) activityNotesSave(ctx, name, target.notes[name]); else activityNotesDelete(ctx, name);
      }
      for (const key of settingKeys) if (current.settings[key] !== target.settings[key]) {
        const value = target.settings[key];
        if (value === null) ctx.settingsRepo.deleteSetting(key); else ctx.settingsRepo.setSetting(key, value, key === 'fy.startMonth' ? 'org' : undefined);
      }
      saved.state = state; saved.expectedFingerprint = fingerprint(ctx);
      this.audit(ctx, saved, actor.kind === 'team' ? actor.name : 'Local user', input.direction === 'undo' ? 'Undid ledger changes' : 'Redid ledger changes');
      this.write(ctx, saved); return this.view(saved);
    }).immediate();
  }
}
