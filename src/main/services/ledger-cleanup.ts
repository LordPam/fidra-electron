import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import type { TransactionRow, PlannedTemplateRow, SheetRow } from '../../shared/ipc-types';
import { ledgerCleanupRequestSchema, ledgerCleanupApplySchema, ledgerCleanupQuerySchema, ledgerCleanupReviewSchema,
  ledgerCleanupHistorySchema, type LedgerCleanupRequest, type LedgerCleanupPreview, type LedgerCleanupState,
  type LedgerCleanupEntry } from '../../shared/ledger-cleanup-types';
import { defaultStatusForType, resolveStatus } from '../../shared/transaction-rules';
import { parsePence, penceToAmount } from '../../shared/money';
import { canonicalJson } from './update-manifest';
import { assertApplicationPermission } from './application-access';
import { assertAiOperationAccess, aiPermittedAccounts, type AiOperationAccess } from './ai-operation-access';
import type { AiAuthorizationStore } from './ai-authorization-store';
import { transactionsBulkDelete, transactionsBulkSave, transactionsSaveTransfer } from './transaction-operations';
import { sheetsRename } from './sheet-operations';
import { plannedBulkSave } from './planned-operations';
import { backupsCreate } from './backup-operations';

interface Snapshot { sheets: SheetRow[]; transactions: TransactionRow[]; planned: PlannedTemplateRow[] }
interface Journal {
  version: 1; id: string; digest: string; connectionId: string; inputHash: string; input: LedgerCleanupRequest;
  createdAt: string; state: LedgerCleanupState; requiresReview: boolean; beforeFingerprint: string; expectedFingerprint: string;
  before: Snapshot; after: Snapshot; accounts: SheetRow[]; transfers: [TransactionRow, TransactionRow][]; backupId: string | null;
  counters: Record<string, number>;
}
type Signer = Pick<AiAuthorizationStore, 'signOperation' | 'verifyOperation'>;
const envelopeSchema = z.object({ body: z.string().max(16_000_000), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const prefix = 'ai.ledgerCleanup.';
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sorted = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));

function snapshot(ctx: WindowContext): Snapshot {
  return { sheets: sorted(ctx.sheetRepo.getAll()), transactions: sorted(ctx.transactionRepo.getAllForSnapshot()), planned: sorted(ctx.plannedRepo.getAll()) };
}
function fingerprint(ctx: WindowContext): string {
  // Audit and device journals do not invalidate a review. Every operational row,
  // attachment and invoice does: conservative refusal is safer than a stale batch.
  const attachments = ctx.attachmentRepo.getAllForSnapshot();
  return hash({ ...snapshot(ctx), invoices: sorted(ctx.repos.invoices.getAll()), attachments });
}
function delta(from: Snapshot, to: Snapshot): Snapshot {
  const changed = <T extends { id: string }>(a: T[], b: T[]) => a.filter((row) => !isDeepStrictEqual(row, b.find((other) => other.id === row.id)));
  return { sheets: changed(from.sheets, to.sheets), transactions: changed(from.transactions, to.transactions), planned: changed(from.planned, to.planned) };
}
function accessFor(ctx: WindowContext, access: AiOperationAccess, input: LedgerCleanupRequest): void {
  for (const action of input.actions) {
    if (action.kind === 'rename_sheet') assertAiOperationAccess(ctx, access, 'sheets.manage');
    else {
      assertAiOperationAccess(ctx, access, 'transactions.read');
      assertAiOperationAccess(ctx, access, action.kind === 'delete_entries' ? 'transactions.delete' : 'transactions.manage');
      if (action.kind === 'replace_with_transfer') {
        assertAiOperationAccess(ctx, access, 'transactions.delete');
        assertAiOperationAccess(ctx, access, 'transfers.manage');
      }
    }
  }
}

/** Bounded semantic composition of the desktop's existing rename, move, status,
 * delete and Add Transfer operations. No external raw-row restoration is accepted. */
function plan(ctx: WindowContext, access: AiOperationAccess, input: LedgerCleanupRequest, actor: string) {
  accessFor(ctx, access, input);
  if (input.actions.reduce((count, action) => count + (action.kind === 'rename_sheet' ? 0 : action.entries.length), 0) > 1000) throw new Error('A cleanup may select at most 1,000 entries.');
  const before = snapshot(ctx); const after = structuredClone(before);
  const permitted = new Set(aiPermittedAccounts(ctx, access).map((sheet) => sheet.id));
  const used = new Set<string>(); const renamed = new Set<string>();
  const transfers: [TransactionRow, TransactionRow][] = [];
  const now = new Date().toISOString();
  function account(id: string) {
    const sheet = after.sheets.find((row) => row.id === id);
    if (!sheet || !permitted.has(id)) throw new Error('An affected account is missing or outside this connection.');
    return sheet;
  }
  function entry(ref: { id: string; version: number }) {
    if (used.has(ref.id)) throw new Error('An entry may appear in only one cleanup action.');
    used.add(ref.id);
    if (used.size > 1000) throw new Error('A cleanup may affect at most 1,000 explicitly selected entries.');
    const row = after.transactions.find((item) => item.id === ref.id);
    if (!row || row.version !== ref.version) throw new Error('An entry changed or disappeared. Read fresh records and prepare a new cleanup.');
    if (row.status === 'planned') throw new Error('Planned entries require their existing planned-payment workflow.');
    const source = after.sheets.find((sheet) => sheet.name === row.sheet);
    if (!source) throw new Error('An entry references a missing account. Review it in Fidra.');
    account(source.id);
    if (row.linked_id) throw new Error('This cleanup handles unlinked entries only. Edit an existing linked transfer through its transfer workflow.');
    return row;
  }
  function canRemove(row: TransactionRow) {
    if (ctx.repos.attachments.getForTransaction(row.id).length || ctx.repos.invoices.getAll().some((invoice) => invoice.transaction_id === row.id)) {
      throw new Error('An entry has attachments or an invoice link. Review it through the existing native workflow.');
    }
  }
  for (const action of input.actions) {
    if (action.kind === 'rename_sheet') {
      const sheet = account(action.sheetId);
      if (renamed.has(sheet.id) || sheet.name !== action.expectedName) throw new Error('An account changed or was selected for rename twice.');
      if (after.sheets.some((other) => other.id !== sheet.id && other.name.toLowerCase() === action.name.toLowerCase())) throw new Error('The destination account name already exists.');
      renamed.add(sheet.id);
      const old = sheet.name; sheet.name = action.name;
      for (const row of after.transactions) if (row.sheet === old) row.sheet = action.name;
      for (const row of after.planned) {
        if (row.target_sheet === old) row.target_sheet = action.name;
        if (row.transfer_target_sheet === old) row.transfer_target_sheet = action.name;
      }
      continue;
    }
    const rows = action.entries.map(entry);
    if (action.kind === 'move_entries' || action.kind === 'fix_income_status') {
      const destination = action.kind === 'move_entries' ? account(action.targetSheetId) : null;
      for (const row of rows) {
        if (action.kind === 'fix_income_status' && row.type !== 'income') throw new Error('Income status repair cannot change an expense.');
        const status = resolveStatus(row.type, row.status);
        if (status !== row.status || (destination && row.sheet !== destination.name)) {
          row.status = status; if (destination) row.sheet = destination.name;
          row.version++; row.modified_at = now; row.modified_by = actor;
        }
      }
    } else {
      rows.forEach(canRemove);
      if (action.kind === 'replace_with_transfer') {
        const from = account(action.fromSheetId); const to = account(action.toSheetId);
        if (from.id === to.id) throw new Error('A transfer needs two different accounts.');
        if (rows.length === 2 && rows[0].type === rows[1].type) throw new Error('Choose one expense and one income to match a transfer.');
        if (rows.some((row) => (!action.date && row.date !== rows[0].date) || parsePence(row.amount) !== parsePence(rows[0].amount))
          || (parsePence(rows[0].amount) ?? 0) <= 0) throw new Error('Transfer entries must have the same date and positive amount. Preserve posting-date differences for native review.');
        const amountPence = parsePence(rows[0].amount);
        if (amountPence === null) throw new Error('The transfer amount is invalid.');
        if (rows.length === 1) {
          const otherSheet = rows[0].type === 'expense' ? to.name : from.name;
          const possible = after.transactions.some((row) => row.id !== rows[0].id && row.type !== rows[0].type && !row.linked_id
            && Math.abs(Date.parse(row.date) - Date.parse(rows[0].date)) <= 3 * 86400000 && parsePence(row.amount) === amountPence
            && (row.sheet === otherSheet || (row.sheet === rows[0].sheet && /transfer/i.test(`${row.category ?? ''} ${row.description}`))));
          if (possible) throw new Error('A possible existing counterpart needs review. Select both actual entries instead of adding a duplicate counterpart.');
        }
        const linkedId = randomUUID();
        const side = (type: 'income' | 'expense', sheet: string): TransactionRow => {
          const existing = rows.find((row) => row.type === type);
          const source = existing ?? rows[0];
          return { ...source, id: randomUUID(), amount: penceToAmount(amountPence), type, sheet, date: action.date ?? source.date, status: defaultStatusForType(type), description: action.description,
            category: null, party: null, reference: existing?.reference ?? null,
            notes: existing ? existing.notes : `Counterpart of the transfer recorded as ${rows[0].id}. ${source.notes ?? ''}`.trim(),
            linked_id: linkedId, version: 1, created_at: now, modified_at: null, modified_by: actor };
        };
        const pair: [TransactionRow, TransactionRow] = [side('expense', from.name), side('income', to.name)];
        transfers.push(pair); after.transactions.push(...pair);
      }
      const removed = new Set(rows.map((row) => row.id));
      after.transactions = after.transactions.filter((row) => !removed.has(row.id));
    }
  }
  // Transfers prepared before a later rename follow the same account cascade.
  for (const pair of transfers) for (const side of pair) Object.assign(side, after.transactions.find((row) => row.id === side.id));
  const beforeDelta = delta(before, after); const afterDelta = delta(after, before);
  if (!beforeDelta.sheets.length && !beforeDelta.transactions.length && !afterDelta.transactions.length) throw new Error('These entries already match the requested cleanup.');
  return { before: beforeDelta, after: afterDelta, accounts: [...before.sheets, ...after.sheets], transfers };
}

/** Signed, per-device operation journals; financial snapshots never enter tool arguments. */
export class LedgerCleanupService {
  private readonly applying = new Map<string, Promise<{ preview: LedgerCleanupPreview; changed: boolean }>>();
  constructor(private readonly signer: Signer) {}
  private scope(ctx: WindowContext) { return JSON.stringify(['ledger-cleanup-v1', ctx.databaseId, fs.realpathSync.native(ctx.dbPath)]); }
  private read(ctx: WindowContext, id: string): Journal {
    const value = ctx.settingsRepo.getSetting(prefix + id);
    if (!value) throw new Error('This cleanup is no longer available.');
    const envelope = envelopeSchema.parse(JSON.parse(value));
    if (!this.signer.verifyOperation(this.scope(ctx), envelope.body, envelope.signature)) throw new Error('This cleanup journal could not be authenticated.');
    // Only this application's signed writer can produce the body.
    const saved = JSON.parse(envelope.body) as Journal;
    if (saved.version !== 1 || saved.id !== id) throw new Error('Unsupported cleanup journal.');
    return saved;
  }
  private write(ctx: WindowContext, saved: Journal) {
    const body = JSON.stringify(saved);
    if (Buffer.byteLength(body) > 16_000_000) throw new Error('This cleanup is too large. Prepare a smaller scoped batch.');
    ctx.settingsRepo.setSetting(prefix + saved.id, JSON.stringify({ body, signature: this.signer.signOperation(this.scope(ctx), body) }), 'device');
  }
  private view(saved: Journal, descriptions: boolean, readTransactions = true): LedgerCleanupPreview {
    const allSheets = saved.accounts;
    const row = (entry: TransactionRow): LedgerCleanupEntry => ({ id: entry.id, version: entry.version, date: entry.date, amount: entry.amount,
      type: entry.type, status: entry.status, account: entry.sheet, accountId: allSheets.find((sheet) => sheet.name === entry.sheet)?.id ?? '',
      linkedId: entry.linked_id, ...(descriptions ? { description: entry.description } : {}) });
    return { id: saved.id, digest: saved.digest, label: saved.input.label, createdAt: saved.createdAt, state: saved.state, requiresReview: saved.requiresReview,
      reasons: saved.input.actions.map(({ kind, reason }) => ({ kind, reason })),
      sheets: saved.before.sheets.map((sheet) => ({ id: sheet.id, before: sheet.name, after: saved.after.sheets.find((item) => item.id === sheet.id)?.name ?? sheet.name })),
      before: readTransactions ? saved.before.transactions.map(row) : [], after: readTransactions ? saved.after.transactions.map(row) : [], transferCount: saved.transfers.length, backupId: saved.backupId };
  }
  private requireAccess(ctx: WindowContext, access: AiOperationAccess, connectionId: string, saved: Journal) {
    if (saved.connectionId !== connectionId) throw new Error('This cleanup belongs to another connection.');
    accessFor(ctx, access, saved.input);
    const permitted = new Set(aiPermittedAccounts(ctx, access).map((sheet) => sheet.id));
    for (const row of [...saved.before.transactions, ...saved.after.transactions]) {
      const sheet = saved.accounts.find((item) => item.name === row.sheet);
      if (!sheet || (!access.policy.permissions.allAccounts && !permitted.has(sheet.id))) throw new Error('An affected entry is outside this connection.');
    }
  }
  prepare(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, raw: unknown): LedgerCleanupPreview {
    const input = ledgerCleanupRequestSchema.parse(raw); accessFor(ctx, access, input);
    const id = hash([connectionId, input.requestId]); const inputHash = hash(input);
    return ctx.sqlite.transaction(() => {
      if (ctx.settingsRepo.getSetting(prefix + id)) {
        const saved = this.read(ctx, id); this.requireAccess(ctx, access, connectionId, saved);
        if (saved.inputHash !== inputHash) throw new Error('This requestId was used for a different cleanup.');
        return this.externalView(saved, access);
      }
      const prepared = plan(ctx, access, input, actor);
      const requiresReview = input.actions.some((action) => action.kind === 'delete_entries' || action.kind === 'replace_with_transfer');
      const beforeFingerprint = fingerprint(ctx);
      const saved: Journal = { version: 1, id, digest: hash([id, inputHash, beforeFingerprint, prepared]), connectionId, inputHash, input,
        createdAt: new Date().toISOString(), state: requiresReview ? 'draft' : 'ready', requiresReview, beforeFingerprint, expectedFingerprint: beforeFingerprint,
        ...prepared, backupId: null, counters: Object.fromEntries([
          ...[...prepared.before.transactions, ...prepared.after.transactions].map((row) => [`transaction:${row.id}`, row.version]),
          ...[...prepared.before.planned, ...prepared.after.planned].map((row) => [`planned:${row.id}`, row.version]),
        ]) };
      this.write(ctx, saved);
      return this.externalView(saved, access);
    }).immediate();
  }
  get(ctx: WindowContext, access: AiOperationAccess, connectionId: string, raw: unknown) {
    const { id } = ledgerCleanupQuerySchema.parse(raw); const saved = this.read(ctx, id);
    this.requireAccess(ctx, access, connectionId, saved);
    return this.externalView(saved, access);
  }
  private externalView(saved: Journal, access: AiOperationAccess) {
    return this.view(saved, access.policy.fields.includes('description'), access.policy.permissions.capabilities.includes('transactions.read'));
  }
  list(ctx: WindowContext, activeConnections: Set<string>): LedgerCleanupPreview[] {
    assertApplicationPermission(ctx, 'ledgerUse');
    return Object.keys(ctx.settingsRepo.getAll()).filter((key) => key.startsWith(prefix)).flatMap((key) => {
      try { const saved = this.read(ctx, key.slice(prefix.length)); return activeConnections.has(saved.connectionId) ? [this.view(saved, true)] : []; }
      catch { return []; } // Invalid or foreign-device journals never confer review/Undo authority.
    });
  }
  review(ctx: WindowContext, activeConnections: Set<string>, actor: string, raw: unknown) {
    assertApplicationPermission(ctx, 'ledgerUse');
    const input = ledgerCleanupReviewSchema.parse(raw);
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, input.id);
      if (!activeConnections.has(saved.connectionId)) throw new Error('Unlock the original approving identity and connection before reviewing this cleanup.');
      if (saved.digest !== input.digest || !['draft', 'approved', 'ready'].includes(saved.state)) throw new Error('This cleanup is no longer awaiting review.');
      if (saved.beforeFingerprint !== fingerprint(ctx)) throw new Error('The ledger changed. Prepare a fresh cleanup before review.');
      saved.state = input.approve ? 'approved' : 'rejected'; this.write(ctx, saved);
      this.audit(ctx, saved, actor, input.approve ? 'reviewed' : 'rejected');
      return this.view(saved, true);
    }).immediate();
  }
  private audit(ctx: WindowContext, saved: Journal, actor: string, operation: string) {
    ctx.auditRepo.log({ id: randomUUID(), timestamp: new Date().toISOString(), action: 'update', entity_type: 'ledger_cleanup', entity_id: saved.id,
      user: actor, summary: `${operation}: ${saved.input.label}`, details: JSON.stringify({ origin: 'personal-ai', digest: saved.digest, operation,
        transactionIds: [...new Set([...saved.before.transactions, ...saved.after.transactions].map((row) => row.id))] }) });
  }
  async apply(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, raw: unknown) {
    const input = ledgerCleanupApplySchema.parse(raw); const saved = this.read(ctx, input.id);
    this.requireAccess(ctx, access, connectionId, saved);
    if (saved.digest !== input.digest) throw new Error('The cleanup digest does not match.');
    if (['committed', 'undone'].includes(saved.state)) return { preview: this.externalView(saved, access), changed: false };
    if (saved.state !== 'ready' && saved.state !== 'approved') throw new Error('Review and approve this cleanup inside Fidra Settings before applying it.');
    const key = `${fs.realpathSync.native(ctx.dbPath)}:${saved.id}`;
    const running = this.applying.get(key); if (running) return running.then((result) => ({ ...result, changed: false }));
    const promise = this.commit(ctx, access, connectionId, actor, saved.id, saved.digest);
    this.applying.set(key, promise);
    try { return await promise; } finally { if (this.applying.get(key) === promise) this.applying.delete(key); }
  }
  private async commit(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, id: string, digest: string) {
    if (this.read(ctx, id).beforeFingerprint !== fingerprint(ctx)) throw new Error('The ledger changed. Prepare a fresh cleanup before applying.');
    const backup = await backupsCreate(ctx, hash(['ledger-cleanup-backup', connectionId, id]));
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, id); this.requireAccess(ctx, access, connectionId, saved);
      if (saved.digest !== digest || !['ready', 'approved'].includes(saved.state) || fingerprint(ctx) !== saved.beforeFingerprint) {
        throw new Error('The cleanup or ledger changed while backing up. Prepare a fresh review.');
      }
      // The plan admits only file-free writes. Do not broaden these operations
      // to attached/invoiced/linked inputs without a shared complete workflow.
      for (const action of saved.input.actions) if (action.kind === 'rename_sheet') sheetsRename(ctx, action.expectedName, action.name);
      const afterIds = new Set(saved.after.transactions.map((row) => row.id));
      const removed = saved.before.transactions.filter((row) => !afterIds.has(row.id)).map((row) => row.id);
      transactionsBulkDelete(ctx, removed);
      const added = new Set(saved.transfers.flat().map((row) => row.id));
      const updates = saved.after.transactions.filter((row) => !added.has(row.id) && !isDeepStrictEqual(ctx.transactionRepo.getById(row.id), row));
      transactionsBulkSave(ctx, updates);
      for (const [expense, income] of saved.transfers) transactionsSaveTransfer(ctx, expense, income);
      // Verify the shared controls produced precisely the proposed business effect.
      for (const row of saved.after.transactions) if (!isDeepStrictEqual(ctx.transactionRepo.getById(row.id), row)) throw new Error('The native transaction result differs from the reviewed cleanup.');
      for (const row of saved.after.planned) if (!isDeepStrictEqual(ctx.plannedRepo.getById(row.id), row)) throw new Error('The native planned-account cascade differs from the reviewed cleanup.');
      for (const row of saved.after.sheets) if (!isDeepStrictEqual(ctx.sheetRepo.getAll().find((sheet) => sheet.id === row.id), row)) throw new Error('The native account result differs from the reviewed cleanup.');
      saved.state = 'committed'; saved.backupId = backup.metadata.id; saved.expectedFingerprint = fingerprint(ctx);
      this.audit(ctx, saved, actor, 'Applied ledger cleanup'); this.write(ctx, saved);
      return { preview: this.externalView(saved, access), changed: true };
    }).immediate();
  }
  history(ctx: WindowContext, raw: unknown): LedgerCleanupPreview {
    const actor = assertApplicationPermission(ctx, 'ledgerUse'); const input = ledgerCleanupHistorySchema.parse(raw);
    return ctx.sqlite.transaction(() => {
      const saved = this.read(ctx, input.id); const targetState = input.direction === 'undo' ? 'undone' : 'committed';
      if (saved.state === targetState) return this.view(saved, true);
      if ((input.direction === 'undo' ? 'committed' : 'undone') !== saved.state) throw new Error('This cleanup is not available for this history action.');
      if (fingerprint(ctx) !== saved.expectedFingerprint) throw new Error('The ledger changed after this cleanup. Review those changes before using Undo or Redo.');
      const target = input.direction === 'undo' ? saved.before : saved.after;
      const current = input.direction === 'undo' ? saved.after : saved.before;
      // Rename cascades are reversed before restoring individual affected rows.
      const renames = input.direction === 'undo' ? [...saved.input.actions].reverse() : saved.input.actions;
      for (const action of renames) if (action.kind === 'rename_sheet') {
        sheetsRename(ctx, input.direction === 'undo' ? action.name : action.expectedName, input.direction === 'undo' ? action.expectedName : action.name);
      }
      const wanted = new Set(target.transactions.map((row) => row.id));
      transactionsBulkDelete(ctx, current.transactions.filter((row) => !wanted.has(row.id)).map((row) => row.id));
      const versioned = <T extends { id: string; version: number }>(entity: string, rows: T[]) => rows.map((row) => {
        const key = `${entity}:${row.id}`;
        const version = Math.max(saved.counters[key] ?? 0, row.version) + 1; saved.counters[key] = version;
        return { ...row, version };
      });
      // These trusted, authenticated snapshots are native Undo data, never tool input.
      transactionsBulkSave(ctx, versioned('transaction', target.transactions));
      plannedBulkSave(ctx, versioned('planned', target.planned));
      saved.state = targetState; saved.expectedFingerprint = fingerprint(ctx);
      this.audit(ctx, saved, actor.kind === 'team' ? actor.name : 'Local user', input.direction === 'undo' ? 'Undid ledger cleanup' : 'Redid ledger cleanup');
      this.write(ctx, saved); return this.view(saved, true);
    }).immediate();
  }
}
