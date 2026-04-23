/**
 * Merge gate for Local Sync.
 *
 * Sits between bundle import and cr-sqlite changeset application.
 * Classifies each incoming changeset row as either:
 *   - auto-merge: safe to apply directly via cr-sqlite
 *   - needs-review: critical-field conflict, diverted to ConflictQueue
 *
 * Key invariant: critical-field conflicts are NEVER silently overwritten.
 */
import type Database from 'better-sqlite3';
import { type CrChangesetRow, serializeChangesetRow } from './bundle-format';
import { isCriticalField, isTrackedTable } from './critical-fields';
import type { ConflictQueue, InsertConflictParams } from './conflict-queue';

/**
 * cr-sqlite uses cid = "-1" as the delete sentinel in crsql_changes.
 * (Not "__crsql_del" as some older docs suggest.)
 */
export const CRSQL_DELETE_SENTINEL = '-1';

// ─── Types ──────────────────────────────────────────────────────────

export interface PendingConflict {
  changeset: CrChangesetRow;
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

export interface MergeGateResult {
  autoMerge: CrChangesetRow[];
  conflicts: PendingConflict[];
}

// ─── Local state query ──────────────────────────────────────────────

interface LocalChangeRow {
  val: unknown;
  col_version: number;
  site_id: Buffer;
}

/**
 * Query crsql_changes for the local state of a specific (table, pk, cid).
 * Returns the most recent local change, or null if none exists.
 */
function getLocalChange(
  db: Database.Database,
  table: string,
  pk: string,
  cid: string,
): LocalChangeRow | null {
  const row = db
    .prepare(
      `SELECT "val", "col_version", "site_id"
       FROM crsql_changes
       WHERE "table" = ? AND "pk" = ? AND "cid" = ?
       ORDER BY "col_version" DESC
       LIMIT 1`,
    )
    .get(table, pk, cid) as LocalChangeRow | undefined;
  return row ?? null;
}

/**
 * Check if the local database has concurrent edits for an entity that conflict
 * with an incoming delete. "Concurrent" means the local edit's col_version is
 * >= the delete's col_version — the deleter couldn't have seen it.
 *
 * Local edits with lower col_version are sequential — the deleter saw them
 * and chose to delete anyway. Those are safe to auto-merge.
 */
function hasConcurrentLocalEdits(
  db: Database.Database,
  table: string,
  pk: string,
  remoteSiteId: Buffer,
  deleteColVersion: number,
): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM crsql_changes
       WHERE "table" = ? AND "pk" = ? AND "site_id" IS NOT ?
       AND "cid" != ? AND "col_version" >= ?`,
    )
    .get(table, pk, remoteSiteId, CRSQL_DELETE_SENTINEL, deleteColVersion) as { cnt: number } | undefined;
  return (row?.cnt ?? 0) > 0;
}

// ─── Value comparison ───────────────────────────────────────────────

/** Compare two cr-sqlite values for equality. Handles Buffer comparison. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  return false;
}

/** Convert a site_id Buffer to a hex string for storage. */
function siteIdHex(siteId: Buffer): string {
  return siteId.toString('hex');
}

/** Serialize a cr-sqlite value to string for conflict queue storage. */
function valueToString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (Buffer.isBuffer(val)) return val.toString('hex');
  return String(val);
}

/**
 * Convert a pk value to a display string.
 * cr-sqlite returns pk as a Buffer (binary-encoded composite key).
 * Format: \x01\x0b<length_byte><key_string> — strip the 3-byte header.
 */
function pkToString(pk: string | Buffer): string {
  if (Buffer.isBuffer(pk)) {
    // Skip the 3-byte binary header (type marker + length byte) if present
    if (pk.length > 3 && pk[0] === 0x01 && pk[1] === 0x0b) {
      return pk.subarray(3).toString('utf-8');
    }
    return pk.toString('utf-8');
  }
  // String pk — may have survived UTF-8 roundtrip with prefix intact.
  // Strip any leading non-printable control characters and length byte.
  const cleaned = pk.replace(/^[\x00-\x1f]+/, '');
  // If a non-alphanumeric char precedes a UUID-like pattern, strip it (length byte artifact)
  if (/^[^a-zA-Z0-9][\da-f]{8}-/.test(cleaned)) {
    return cleaned.slice(1);
  }
  return cleaned;
}

// ─── Classification ─────────────────────────────────────────────────

/**
 * Classify incoming changesets into auto-merge vs needs-review.
 *
 * Rules:
 * 1. Non-tracked table → auto-merge
 * 2. Non-critical field → auto-merge
 * 3. Delete marker (__crsql_del): if local has concurrent edits (col_version
 *    >= delete's col_version, different site) → needs-review on ONE peer only
 *    (deterministic tiebreaker); otherwise → auto-merge
 * 4. Critical field, no local change for (table, pk, cid) → auto-merge
 * 5. Critical field, local change with same value → auto-merge
 * 6. Critical field, local change from same site → auto-merge
 * 7a. Critical field, different col_version (sequential edit) → auto-merge
 *     (higher version was made after seeing the lower — not concurrent)
 * 7b. Critical field, equal col_version + different site + different value
 *     → needs-review on ONE peer only (deterministic tiebreaker via site_id
 *     comparison — lower site_id "owns" the conflict, higher auto-merges)
 *
 * @param localSiteId - This device's cr-sqlite site_id. Used for deterministic
 *   tiebreaking so only ONE peer shows a conflict screen for any given concurrent
 *   edit. If not provided, all true conflicts are flagged (legacy behavior).
 */
export function classifyChangesets(
  db: Database.Database,
  incoming: CrChangesetRow[],
  localSiteId?: Buffer,
): MergeGateResult {
  const autoMerge: CrChangesetRow[] = [];
  const conflicts: PendingConflict[] = [];

  for (const row of incoming) {
    // Rule 1: untracked table — auto-merge
    if (!isTrackedTable(row.table)) {
      autoMerge.push(row);
      continue;
    }

    // Rule 3: delete marker
    if (row.cid === CRSQL_DELETE_SENTINEL) {
      // If local already has a delete sentinel for this entity, the incoming
      // delete is redundant (e.g., already applied via snapshot). Auto-merge.
      const localDelete = getLocalChange(db, row.table, row.pk as string, CRSQL_DELETE_SENTINEL);
      if (localDelete) {
        autoMerge.push(row);
        continue;
      }

      if (hasConcurrentLocalEdits(db, row.table, row.pk, row.site_id, row.col_version)) {
        // Delete-vs-edit conflict — only show on one peer (deterministic tiebreaker).
        // The peer with the lower site_id "owns" the conflict; the other auto-merges.
        if (localSiteId && Buffer.compare(localSiteId, row.site_id) >= 0) {
          autoMerge.push(row);
        } else {
          conflicts.push({
            changeset: row,
            entityType: row.table,
            entityId: pkToString(row.pk),
            fieldName: CRSQL_DELETE_SENTINEL,
            localValue: null,
            remoteValue: 'DELETE',
            localVersion: 0,
            remoteVersion: row.col_version,
            localSiteId: localSiteId ? siteIdHex(localSiteId) : '',
            remoteSiteId: siteIdHex(row.site_id),
          });
        }
      } else {
        autoMerge.push(row);
      }
      continue;
    }

    // Rule 2: non-critical field — auto-merge
    if (!isCriticalField(row.table, row.cid)) {
      autoMerge.push(row);
      continue;
    }

    // Critical field — check local state
    const local = getLocalChange(db, row.table, row.pk, row.cid);

    // Rule 4: no local change — auto-merge
    if (!local) {
      autoMerge.push(row);
      continue;
    }

    // Rule 6: same site — auto-merge (our own change coming back)
    if (Buffer.isBuffer(local.site_id) && local.site_id.equals(row.site_id)) {
      autoMerge.push(row);
      continue;
    }

    // Rule 5: same value — auto-merge (convergent edits)
    if (valuesEqual(local.val, row.val)) {
      autoMerge.push(row);
      continue;
    }

    // Rule 7a: version ordering determines concurrency.
    // If col_versions differ, the edits were sequential — one side saw the
    // other's value before editing. cr-sqlite will pick the higher version
    // (or keep local if local is higher). No human review needed.
    if (row.col_version !== local.col_version) {
      autoMerge.push(row);
      continue;
    }

    // Rule 7b: equal col_version + different site + different value = true
    // concurrent edit. Neither side saw the other's change.
    // Deterministic tiebreaker: only the peer with the lower site_id shows
    // the conflict screen. The other peer auto-merges (cr-sqlite's LWW picks
    // a deterministic winner). The conflict owner's resolution then propagates.
    if (localSiteId && Buffer.compare(localSiteId, row.site_id) >= 0) {
      // This peer has the higher (or equal) site_id — auto-merge, let cr-sqlite decide.
      autoMerge.push(row);
    } else {
      // This peer has the lower site_id — show the conflict for human review.
      conflicts.push({
        changeset: row,
        entityType: row.table,
        entityId: pkToString(row.pk),
        fieldName: row.cid,
        localValue: local.val,
        remoteValue: row.val,
        localVersion: local.col_version,
        remoteVersion: row.col_version,
        localSiteId: siteIdHex(local.site_id),
        remoteSiteId: siteIdHex(row.site_id),
      });
    }
  }

  return { autoMerge, conflicts };
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
        changeset_json: JSON.stringify(serializeChangesetRow(conflict.changeset)),
      };
      conflictQueue.insert(params);
    }
  });

  applyTx();
}
