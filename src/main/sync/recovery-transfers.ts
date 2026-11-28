import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictQueue, type SyncConflict } from './conflict-queue';
import { decodeConflictRows } from './conflict-resolution';
import { entityChanges, isDeleteChangeset, CRSQL_DELETE_SENTINEL, LINKED_TRANSFER_REVIEW } from './merge-gate';
import { CausalHistory } from './causal-history';
import { transactionRowSchema } from '../../shared/ipc-schemas';
import { parsePence } from '../../shared/money';
import type { CrChangesetRow } from './bundle-format';
import type { DomainRow } from './recovery-state';

interface TransferComparison { local: DomainRow[]; remote: DomainRow[]; ids: string[]; conflicts: SyncConflict[]; alternatives: CrChangesetRow[]; remoteError?: string }
function pack(db: Database.Database, id: string): Buffer { return db.prepare('SELECT crsql_pack_columns(?)').pluck().get(id) as Buffer; }
function live(db: Database.Database, id: string): DomainRow | undefined { return db.prepare('SELECT * FROM transactions WHERE id=?').get(id) as DomainRow | undefined; }
function samePk(row: CrChangesetRow, pk: Buffer): boolean { return Buffer.isBuffer(row.pk) ? row.pk.equals(pk) : Buffer.from(row.pk).equals(pk); }
function pairError(rows: DomainRow[]): string | undefined {
  if (rows.length !== 2) return 'Both complete transfer entries are required.';
  const [a, b] = rows;
  if (rows.some((row) => !transactionRowSchema.safeParse(row).success)
    || a.id === b.id || a.linked_id !== b.id || b.linked_id !== a.id || a.sheet === b.sheet
    || a.type === b.type || parsePence(String(a.amount)) !== parsePence(String(b.amount))) return 'The selected transfer must be reciprocal, use different accounts and have equal amounts with opposite directions.';
  return undefined;
}

/** Reads both alternatives without applying a partial transfer or guessing a
 * deleted row's defaults. A one-sided delete is a separate explicit action. */
export function compareRecoveryTransfer(db: Database.Database, conflict: SyncConflict): TransferComparison {
  if (conflict.entity_type !== 'transactions' || conflict.field_name !== LINKED_TRANSFER_REVIEW || !conflict.changeset_json) throw new Error('This is not a preserved transfer comparison.');
  const initial = decodeConflictRows(conflict.changeset_json);
  const ids = new Set([conflict.entity_id]);
  const current = live(db, conflict.entity_id);
  if (current?.linked_id) ids.add(String(current.linked_id));
  for (const row of [...initial, ...decodeConflictRows(conflict.local_changeset_json ?? '[]')]) if (row.cid === 'linked_id' && typeof row.val === 'string' && row.val) ids.add(row.val);
  // Follow only this bundle and this linked pair. Unrelated pending transfers
  // are not part of the administrator's choice.
  const queue = new ConflictQueue(db);
  const conflicts = queue.getUnresolved().filter((item) => item.bundle_id === conflict.bundle_id && ids.has(item.entity_id) && item.entity_type === 'transactions');
  const alternatives = conflicts.flatMap((item) => decodeConflictRows(item.changeset_json ?? '[]'));
  if (ids.size !== 2) throw new Error('The transfer has ambiguous links. Provide complete originating ledger backups.');
  const ordered = [...ids].sort();
  const local = ordered.map((id) => live(db, id)).filter((row): row is DomainRow => !!row);
  const remote: DomainRow[] = [];
  let remoteError: string | undefined;
  const columns = db.prepare('PRAGMA table_info(transactions)').all() as { name: string; pk: number }[];
  for (const id of ordered) {
    const rows = alternatives.filter((row) => samePk(row, pack(db, id)));
    if (rows.some(isDeleteChangeset)) { remoteError = 'Incoming history deletes a transfer entry. Choose Delete both entries explicitly, or keep a complete local pair.'; continue; }
    const base = live(db, id);
    if (!base && columns.some((column) => !column.pk && !rows.some((row) => row.cid === column.name))) { remoteError = 'A deleted transfer entry needs its complete originating row history.'; continue; }
    const row = { ...(base ?? { id }) } as DomainRow;
    for (const change of rows) if (columns.some((column) => !column.pk && column.name === change.cid)) row[change.cid] = change.val as DomainRow[string];
    remote.push(row);
  }
  remoteError ??= pairError(remote);
  return { local, remote, ids: ordered, conflicts, alternatives, remoteError };
}

export function resolveRecoveryTransfer(db: Database.Database, id: string, choice: 'keep-local' | 'accept-remote' | 'delete-both', actor: string): void {
  const queue = new ConflictQueue(db);
  const conflict = queue.getById(id);
  if (!conflict || conflict.resolved_at) throw new Error('This transfer comparison changed. Reload the review.');
  const comparison = compareRecoveryTransfer(db, conflict);
  const desired = choice === 'keep-local' ? comparison.local : comparison.remote;
  if (choice !== 'delete-both') {
    const error = choice === 'accept-remote' ? comparison.remoteError : pairError(desired);
    if (error) throw new Error(error);
    const accounts = new Set((db.prepare('SELECT name FROM sheets').pluck().all() as string[]));
    if (desired.some((row) => !accounts.has(String(row.sheet)))) throw new Error('A transfer names a missing account. Resolve accounts first.');
  }
  db.transaction(() => {
    const site = db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer;
    const version = db.prepare('SELECT crsql_next_db_version()').pluck().get() as number;
    const insert = db.prepare('INSERT INTO crsql_changes ("table",pk,cid,val,col_version,db_version,site_id,cl,seq) VALUES (?,?,?,?,?,?,?,?,?)');
    let sequence = 0;
    for (const entity of comparison.ids) {
      const pk = pack(db, entity);
      const current = entityChanges(db, 'transactions', pk);
      const alternatives = comparison.alternatives.filter((row) => samePk(row, pk));
      let length = Math.max(1, ...current.map((row) => row.cl), ...alternatives.map((row) => row.cl)) + 1;
      if ((length % 2 === 0) !== (choice === 'delete-both')) length++;
      const fieldVersion = Math.max(0, ...current.map((row) => row.col_version), ...alternatives.map((row) => row.col_version)) + 1;
      insert.run('transactions', pk, CRSQL_DELETE_SENTINEL, null, length, version, site, length, sequence++);
      if (choice !== 'delete-both') {
        const row = desired.find((item) => item.id === entity);
        if (!row) throw new Error('Incomplete transfer choice.');
        for (const [column, value] of Object.entries(row)) if (column !== 'id') insert.run('transactions', pk, column, value, fieldVersion, version, site, length, sequence++);
      }
    }
    for (const item of comparison.conflicts) if (!queue.resolve(item.id, choice === 'delete-both' ? 'manual' : choice)) throw new Error('The transfer review changed.');
    new CausalHistory(db).promoteReviewedBundle(conflict.bundle_id);
    db.prepare(`INSERT INTO audit_log (id,timestamp,action,entity_type,entity_id,user,summary,details) VALUES (?,?,'update','transactions',?,?,?,?)`)
      .run(crypto.randomUUID(), new Date().toISOString(), comparison.ids.join(','), actor, `Reviewed both transfer entries (${choice})`, JSON.stringify({ conflictId: id, choice, ids: comparison.ids }));
  }).immediate();
}
