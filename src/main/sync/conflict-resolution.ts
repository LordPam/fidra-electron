import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictQueue, type SyncConflict } from './conflict-queue';
import { CausalHistory } from './causal-history';
import { deserializeChangesetRow, serializeChangesetRow, type SerializedChangesetRow, type CrChangesetRow } from './bundle-format';
import { entityChanges, CRSQL_DELETE_SENTINEL, LINKED_TRANSFER_REVIEW, isDeleteChangeset } from './merge-gate';
import { SYNCED_TABLES } from './crr-schema';

export function decodeConflictRows(json: string): CrChangesetRow[] {
  const value: unknown = JSON.parse(json);
  const rows = (Array.isArray(value) ? value : [value]).map((row) => deserializeChangesetRow(row as SerializedChangesetRow));
  for (const row of rows) {
    if (!(SYNCED_TABLES as readonly string[]).includes(row.table) || !row.cid || row.site_id.length !== 16) throw new Error('Invalid conflict changeset');
    if (typeof row.pk === 'string') row.pk = Buffer.from(row.pk);
  }
  return rows;
}
const decodeRows = decodeConflictRows;

function display(value: unknown): string | null { return value == null ? null : Buffer.isBuffer(value) ? value.toString('hex') : String(value); }

function revisions(rows: CrChangesetRow[]): string {
  return JSON.stringify(rows.map((row) => JSON.stringify({ ...serializeChangesetRow(row), db_version: 0 })).sort());
}

/** A causally later reviewed choice can retire the other peer's old review,
 * but only when it descends from BOTH recorded alternatives.
 */
export function reconcileSupersededConflicts(db: Database.Database, history: CausalHistory, queue: ConflictQueue): number {
  let resolved = 0;
  for (const conflict of queue.getUnresolved()) {
    if (!conflict.changeset_json || !conflict.local_changeset_json) continue;
    const remote = decodeRows(conflict.changeset_json);
    const local = decodeRows(conflict.local_changeset_json);
    if (local.length === 0 || remote.length === 0) continue;
    const current = entityChanges(db, remote[0].table, remote[0].pk);
    if ([...local, ...remote].every((alternative) => current.some((row) => history.dominates(row, alternative)))) {
      if (queue.resolve(conflict.id, 'superseded')) resolved++;
      history.promoteReviewedBundle(conflict.bundle_id);
    }
  }
  return resolved;
}

export type ResolveConflictResult = { success: true; table: string } | { success: false; error: string };

/** Creates a fresh local revision above both alternatives, atomically with its
 * review record and audit entry. A no-op UPDATE or importing the old remote
 * revision cannot reliably publish a chosen lower-version value.
 */
export function resolveSyncConflict(
  db: Database.Database, id: string, choice: 'keep-local' | 'accept-remote', actor: string,
): ResolveConflictResult {
  const queue = new ConflictQueue(db);
  const history = new CausalHistory(db);
  const conflict = queue.getById(id);
  if (!conflict) return { success: false, error: 'This conflict is no longer pending. Reload the review.' };
  if (conflict.resolved_at) return conflict.resolution === choice || conflict.resolution === 'superseded'
    ? { success: true, table: conflict.entity_type }
    : { success: false, error: 'This conflict was already resolved with another choice. Reload the review.' };
  if (conflict.field_name === LINKED_TRANSFER_REVIEW) return { success: false, error: 'This transfer requires joint review of both sides. Its incoming changes have been preserved for reviewed recovery.' };
  if (!conflict.changeset_json || !conflict.local_changeset_json) return { success: false, error: 'This legacy conflict needs reviewed recovery before it can be resolved safely.' };
  const remote = decodeRows(conflict.changeset_json);
  if (remote.length === 0 || remote.some((row) => row.table !== conflict.entity_type)) return { success: false, error: 'Conflict history is incomplete.' };
  const first = remote[0];
  const current = entityChanges(db, first.table, first.pk);
  const columns = db.prepare(`PRAGMA table_info("${first.table}")`).all() as { name: string; pk: number }[];
  const primary = columns.filter((column) => column.pk > 0);
  if (primary.length !== 1) return { success: false, error: 'This entity needs reviewed recovery.' };
  const liveRow = db.prepare(`SELECT * FROM "${first.table}" WHERE crsql_pack_columns("${primary[0].name}") = ?`).get(first.pk) as Record<string, unknown> | undefined;
  if (first.table === 'transactions' && (liveRow?.linked_id || remote.some((row) => row.cid === 'linked_id' && row.val))) {
    return { success: false, error: 'Linked transfers require joint review of both sides. Use reviewed recovery.' };
  }
  const localDelete = current.find(isDeleteChangeset);
  const isEntityChoice = conflict.field_name === CRSQL_DELETE_SENTINEL;
  let chosenRows: CrChangesetRow[];
  let desiredDelete = false;
  const template = current[0] ?? first;
  if (!isEntityChoice) {
    if (!liveRow || localDelete || !columns.some((column) => column.name === conflict.field_name && column.pk === 0)) {
      return { success: false, error: 'This entity changed or was deleted. Review its history before resolving this field.' };
    }
    const value = liveRow[conflict.field_name];
    if (display(value) !== conflict.local_value) {
      const local = current.find((row) => row.cid === conflict.field_name);
      if (local) refreshLocalReview(db, conflict, local);
      return { success: false, error: 'The local value changed after this conflict was recorded. The comparison has been refreshed; review it again.' };
    }
    chosenRows = [{ ...template, cid: conflict.field_name, val: choice === 'keep-local' ? value : first.val }];
    if (first.table === 'personnel' && conflict.field_name === 'role' && liveRow.role === 'admin'
      && chosenRows[0].val !== 'admin'
      && (db.prepare("SELECT COUNT(*) FROM personnel WHERE role = 'admin'").pluck().get() as number) <= 1) {
      return { success: false, error: 'The last team administrator cannot be demoted.' };
    }
  } else {
    const reviewed = decodeRows(conflict.local_changeset_json);
    if (revisions(current) !== revisions(reviewed)) {
      db.prepare(`UPDATE sync_conflicts SET local_value = ?, local_changeset_json = ? WHERE id = ? AND resolved_at IS NULL`)
        .run(localDelete ? 'DELETE' : 'EXISTS', JSON.stringify(current.map(serializeChangesetRow)), id);
      return { success: false, error: 'This entity changed after the comparison was recorded. The comparison has been refreshed; review it again.' };
    }
    const chooseDelete = choice === 'keep-local' ? !!localDelete : remote.some(isDeleteChangeset);
    desiredDelete = chooseDelete;
    if (chooseDelete) {
      chosenRows = [{ ...template, cid: CRSQL_DELETE_SENTINEL, val: null }];
    } else if (choice === 'keep-local' && liveRow) {
      chosenRows = columns.filter((column) => column.pk === 0).map((column) => ({ ...template, cid: column.name, val: liveRow[column.name] }));
    } else {
      const required = columns.filter((column) => column.pk === 0);
      if (required.some((column) => !remote.some((row) => row.cid === column.name))) {
        return { success: false, error: 'Restoring this entity needs its complete row history. The partial edit has been preserved for reviewed recovery.' };
      }
      chosenRows = remote;
    }
    if (first.table === 'personnel' && liveRow?.role === 'admin'
      && (desiredDelete || chosenRows.find((row) => row.cid === 'role')?.val !== 'admin')
      && (db.prepare("SELECT COUNT(*) FROM personnel WHERE role = 'admin'").pluck().get() as number) <= 1) {
      return { success: false, error: 'The last team administrator cannot be removed or demoted.' };
    }
  }

  return db.transaction((): ResolveConflictResult => {
    const maximumVersion = Math.max(0, ...current.map((row) => row.col_version), ...remote.map((row) => row.col_version));
    const maximumLength = Math.max(1, ...current.map((row) => row.cl), ...remote.map((row) => row.cl));
    let causalLength = maximumLength;
    if (isEntityChoice) {
      causalLength++;
      if ((causalLength % 2 === 0) !== desiredDelete) causalLength++;
    }
    const site = db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer;
    const version = db.prepare('SELECT crsql_next_db_version()').pluck().get() as number;
    const insert = db.prepare(`INSERT INTO crsql_changes
      ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let sequence = 0;
    if (isEntityChoice) {
      // cr-sqlite's existence sentinel version equals its causal length. Its
      // parity distinguishes deletion from recreation; it is not a field clock.
      insert.run(first.table, first.pk, CRSQL_DELETE_SENTINEL, null,
        causalLength, version, site, causalLength, sequence++);
    }
    if (!desiredDelete) {
      for (const row of chosenRows.filter((row) => row.cid !== CRSQL_DELETE_SENTINEL)) {
        insert.run(row.table, row.pk, row.cid, row.val, maximumVersion + 1, version, site, causalLength, sequence++);
      }
    }
    if (!queue.resolve(id, choice)) throw new Error('Conflict changed during resolution');
    history.promoteReviewedBundle(conflict.bundle_id);
    db.prepare(`INSERT INTO audit_log (id, timestamp, action, entity_type, entity_id, user, summary, details)
      VALUES (?, ?, 'update', ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), new Date().toISOString(), conflict.entity_type, conflict.entity_id, actor,
        `Reviewed sync conflict: ${conflict.field_name} (${choice})`, JSON.stringify({ conflictId: id, choice, local: conflict.local_value, remote: conflict.remote_value }));
    return { success: true, table: first.table };
  }).immediate();
}

function refreshLocalReview(db: Database.Database, conflict: SyncConflict, local: CrChangesetRow): void {
  // Stored comparisons are device-local review state, not a ledger mutation.
  const serialized = serializeChangesetRow(local);
  db.prepare(`UPDATE sync_conflicts SET local_value = ?, local_version = ?, local_site_id = ?, local_changeset_json = ?
    WHERE id = ? AND resolved_at IS NULL`).run(display(local.val), local.col_version, local.site_id.toString('hex'), JSON.stringify([serialized]), conflict.id);
}
