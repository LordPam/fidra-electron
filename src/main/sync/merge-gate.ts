/** Critical financial fields require causal evidence or explicit review. */
import type Database from 'better-sqlite3';
import { type CrChangesetRow, serializeChangesetRow } from './bundle-format';
import { isCriticalField, isTrackedTable } from './critical-fields';
import type { ConflictQueue, InsertConflictParams } from './conflict-queue';
import type { CausalHistory, BundleCausality } from './causal-history';

export const CRSQL_DELETE_SENTINEL = '-1';
export const LINKED_TRANSFER_REVIEW = '__linked_transfer__';
/** Odd sentinel clocks represent a recreated live row; even clocks are deletes. */
export function isDeleteChangeset(row: CrChangesetRow): boolean {
  return row.cid === CRSQL_DELETE_SENTINEL && row.cl % 2 === 0;
}
export interface PendingConflict {
  changeset: CrChangesetRow;
  incomingRows?: CrChangesetRow[];
  localRows?: CrChangesetRow[];
  entityType: string;
  entityId: string;
  fieldName: string;
  localValue: unknown;
  remoteValue: unknown;
  localVersion: number;
  remoteVersion: number;
  localSiteId: string;
  remoteSiteId: string;
}
export interface MergeGateResult { autoMerge: CrChangesetRow[]; conflicts: PendingConflict[] }
export interface MergeCausality { history: CausalHistory; incoming: BundleCausality; reviewSameSiteDivergence?: boolean }

export function entityChanges(db: Database.Database, table: string, pk: string | Buffer): CrChangesetRow[] {
  return db.prepare(`SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
    FROM crsql_changes WHERE "table" = ? AND "pk" = ?`).all(table, pk) as CrChangesetRow[];
}
function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b || (Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b));
}
function sameSite(a: CrChangesetRow, b: CrChangesetRow): boolean { return a.site_id.equals(b.site_id); }
function pkToString(pk: string | Buffer): string {
  if (Buffer.isBuffer(pk)) {
    if (pk.length > 3 && pk[0] === 1 && pk[1] === 0x0b && pk[2] < 128) return pk.subarray(3).toString('utf8');
    return pk.toString('hex');
  }
  return pk;
}
function valueToString(value: unknown): string | null {
  return value == null ? null : Buffer.isBuffer(value) ? value.toString('hex') : String(value);
}
function entityKey(row: CrChangesetRow): string {
  return JSON.stringify([row.table, Buffer.isBuffer(row.pk) ? row.pk.toString('hex') : Buffer.from(row.pk).toString('hex')]);
}
function conflictFor(row: CrChangesetRow, local: CrChangesetRow | undefined, incomingRows?: CrChangesetRow[], localRows?: CrChangesetRow[]): PendingConflict {
  return {
    changeset: row, incomingRows, localRows: localRows ?? (local ? [local] : []),
    entityType: row.table, entityId: pkToString(row.pk), fieldName: row.cid,
    localValue: local?.val ?? null, remoteValue: row.val,
    localVersion: local?.col_version ?? 0, remoteVersion: row.col_version,
    localSiteId: local?.site_id.toString('hex') ?? '', remoteSiteId: row.site_id.toString('hex'),
  };
}

/** Same-origin history and identical values are safe. Different-origin critical
 * edits require exact causal ancestry; numeric versions and export watermarks
 * do not establish observation. Unproved divergence is reviewed on every peer.
 */
export function classifyChangesets(db: Database.Database, incoming: CrChangesetRow[], causality?: MergeCausality): MergeGateResult {
  const autoMerge: CrChangesetRow[] = [];
  const conflicts: PendingConflict[] = [];
  const groups = new Map<string, CrChangesetRow[]>();
  for (const row of incoming) {
    const key = entityKey(row);
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  const remoteObserved = (row: CrChangesetRow) => causality?.history.remoteObserved(row, causality.incoming) ?? false;
  const localObservedIncoming = (row: CrChangesetRow) => causality?.history.localObservedIncoming(row, causality.incoming) ?? false;
  // Recovery can encounter a copied database whose site identity was forked.
  // In that mode even a same-site clock is not proof of causal observation.
  const sameOrigin = (a: CrChangesetRow, b: CrChangesetRow) => !causality?.reviewSameSiteDivergence && sameSite(a, b);

  for (const rows of groups.values()) {
    const first = rows[0];
    if (!isTrackedTable(first.table)) { autoMerge.push(...rows); continue; }
    const local = entityChanges(db, first.table, first.pk);
    const localDelete = local.find(isDeleteChangeset);
    const incomingDelete = rows.find(isDeleteChangeset);
    if (incomingDelete) {
      if (rows.length === 1 && (localDelete || local.length === 0
        || local.every((row) => sameOrigin(row, incomingDelete) || remoteObserved(row)))) {
        autoMerge.push(incomingDelete);
      } else if (local.length > 0 && local.every(localObservedIncoming)) {
        // The current row descends from this old delete; retain its recreation.
      } else {
        const conflict = conflictFor(incomingDelete, local[0], rows, local);
        conflict.localValue = localDelete ? 'DELETE' : 'EXISTS';
        conflict.remoteValue = 'DELETE';
        conflicts.push(conflict);
      }
      continue;
    }
    if (localDelete) {
      if (rows.every((row) => sameOrigin(row, localDelete))) {
        // Same-origin stale edits cannot resurrect a later tombstone.
        if (rows.every((row) => row.cl > localDelete.cl)) autoMerge.push(...rows);
      } else if (remoteObserved(localDelete) && rows.every((row) => row.cl > localDelete.cl)) {
        autoMerge.push(...rows);
      } else if (!localObservedIncoming(localDelete)) {
        // Hold ALL fields together: even a description could resurrect defaults.
        const conflict = conflictFor(first, localDelete, rows, [localDelete]);
        conflict.fieldName = CRSQL_DELETE_SENTINEL;
        conflict.localValue = 'DELETE';
        conflict.remoteValue = 'RESTORE';
        conflicts.push(conflict);
      }
      continue;
    }
    if (local.length > 0 && rows.some((row) => row.cl !== local[0].cl)) {
      if (rows.every((row) => row.cl > local[0].cl)
        && local.every((row) => sameOrigin(row, first) || remoteObserved(row))) {
        autoMerge.push(...rows);
      } else if (!rows.every((row) => row.cl < local[0].cl)
        || !local.every((row) => sameOrigin(row, first) || localObservedIncoming(row))) {
        const conflict = conflictFor(first, local[0], rows, local);
        conflict.fieldName = CRSQL_DELETE_SENTINEL;
        conflict.localValue = 'EXISTS';
        conflict.remoteValue = 'RECREATE';
        conflicts.push(conflict);
      }
      continue;
    }
    for (const row of rows) {
      const current = local.find((value) => value.cid === row.cid);
      if (!isCriticalField(row.table, row.cid) || !current || sameOrigin(current, row) || valuesEqual(current.val, row.val)) {
        autoMerge.push(row);
      } else if (remoteObserved(current) && (row.cl > current.cl || row.col_version > current.col_version)) {
        autoMerge.push(row);
      } else if (!localObservedIncoming(current)) {
        conflicts.push(conflictFor(row, current));
      }
    }
  }
  return holdLinkedTransferConflicts(db, groups, { autoMerge, conflicts });
}

/** A financial disagreement on one half must not apply the other half of the
 * same incoming transfer. Joint resolution remains an explicit recovery action.
 */
function holdLinkedTransferConflicts(
  db: Database.Database, groups: Map<string, CrChangesetRow[]>, result: MergeGateResult,
): MergeGateResult {
  if (!result.conflicts.some((conflict) => conflict.entityType === 'transactions')) return result;
  const links = new Map<string, Set<string>>();
  const locals = new Map<string, CrChangesetRow[]>();
  for (const [key, rows] of groups) {
    if (rows[0].table !== 'transactions') continue;
    const local = entityChanges(db, 'transactions', rows[0].pk);
    locals.set(key, local);
    for (const row of [...local, ...rows]) {
      if (row.cid !== 'linked_id' || typeof row.val !== 'string' || !row.val) continue;
      const partner = db.prepare('SELECT crsql_pack_columns(?)').pluck().get(row.val) as Buffer;
      const other = entityKey({ ...row, pk: partner });
      if (!links.has(key)) links.set(key, new Set());
      if (!links.has(other)) links.set(other, new Set());
      links.get(key)?.add(other);
      links.get(other)?.add(key);
    }
  }
  const held = new Set(result.conflicts.map((conflict) => entityKey(conflict.changeset)).filter((key) => links.has(key)));
  const pending = [...held];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key) continue;
    for (const partner of links.get(key) ?? []) if (!held.has(partner)) { held.add(partner); pending.push(partner); }
  }
  if (held.size === 0) return result;
  const conflicts = result.conflicts.filter((conflict) => !held.has(entityKey(conflict.changeset)));
  for (const key of held) {
    const rows = groups.get(key);
    if (!rows) continue;
    const local = locals.get(key) ?? [];
    const conflict = conflictFor(rows[0], local[0], rows, local);
    conflict.fieldName = LINKED_TRANSFER_REVIEW;
    conflict.localValue = 'LINKED TRANSFER';
    conflict.remoteValue = 'JOINT REVIEW REQUIRED';
    conflicts.push(conflict);
  }
  return { autoMerge: result.autoMerge.filter((row) => !held.has(entityKey(row))), conflicts };
}

// ─── Application ────────────────────────────────────────────────────

/**
 * Apply a merge result: insert auto-merge rows into crsql_changes,
 * and enqueue conflicts into the ConflictQueue.
 */
export function applyMergeResult(
  db: Database.Database,
  result: MergeGateResult,
  conflictQueue: ConflictQueue,
  bundleId: string,
): void {
  const insertChange = db.prepare(
    `INSERT INTO crsql_changes
     ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const applyTx = db.transaction(() => {
    // Apply auto-merge rows
    for (const row of result.autoMerge) {
      insertChange.run(
        row.table,
        row.pk,
        row.cid,
        row.val,
        row.col_version,
        row.db_version,
        row.site_id,
        row.cl,
        row.seq,
      );
    }

    // Enqueue conflicts with serialized changeset for later application
    for (const conflict of result.conflicts) {
      const params: InsertConflictParams = {
        entity_type: conflict.entityType,
        entity_id: conflict.entityId,
        field_name: conflict.fieldName,
        local_value: valueToString(conflict.localValue),
        remote_value: valueToString(conflict.remoteValue),
        local_site_id: conflict.localSiteId,
        remote_site_id: conflict.remoteSiteId,
        local_version: conflict.localVersion,
        remote_version: conflict.remoteVersion,
        bundle_id: bundleId,
        changeset_json: JSON.stringify(conflict.incomingRows
          ? conflict.incomingRows.map(serializeChangesetRow) : serializeChangesetRow(conflict.changeset)),
        local_changeset_json: JSON.stringify((conflict.localRows ?? []).map(serializeChangesetRow)),
      };
      conflictQueue.insert(params);
    }
  });

  applyTx();
}
