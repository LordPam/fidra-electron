/** Immutable bootstrap snapshots. History pruning remains disabled. */
import type Database from 'better-sqlite3';
import { packBundle, unpackBundle, type CrChangesetRow } from './bundle-format';
import { writeSnapshotAtomically, readSnapshotFile } from './bundle-io';
import { CRR_SCHEMA_VERSION, SYNCED_TABLES } from './crr-schema';
import { isOrgChangeset, isImportableSyncRow } from './settings-filter';
import { assertFolderBinding } from './folder-binding';
import { CausalHistory } from './causal-history';
import { assertSnapshotCausalContext } from './causal-context';
import { isTrackedTable } from './critical-fields';

export interface SnapshotResult { path: string; changesetCount: number; coveredDeviceSeqs: Record<string, number> }

export function createSnapshot(
  db: Database.Database, syncFolder: string, deviceId: string, siteId: Buffer,
  sequenceNumber: number, passphrase: string,
): SnapshotResult {
  const binding = assertFolderBinding(db, syncFolder);
  const history = new CausalHistory(db);
  const snapshot = db.transaction(() => {
    const rows = db.prepare(`SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
      FROM crsql_changes ORDER BY db_version, seq`).all() as CrChangesetRow[];
    const exportable = rows.filter(isOrgChangeset);
    if (exportable.some((row) => isTrackedTable(row.table) && !history.hasAcceptedRevision(row))) {
      throw new Error('Snapshot history is incomplete. Export and review all local changes before creating a snapshot.');
    }
    const previous = db.prepare("SELECT value FROM sync_meta WHERE key = 'snapshot.generation'").pluck().get() as string | undefined;
    const generation = Number(previous ?? 0) + 1;
    if (!Number.isSafeInteger(generation) || generation > 9_999_999_999) throw new Error('Invalid snapshot generation');
    const packed = packBundle({
      deviceId, siteId, sequenceNumber, schemaVersion: CRR_SCHEMA_VERSION, changesets: exportable, passphrase,
      groupId: binding.groupId, coveredDeviceSeqs: {}, snapshotGeneration: generation,
      observedBundles: history.observedContext(), causalState: history.exportState(),
    });
    db.prepare("INSERT INTO sync_meta (key, value) VALUES ('snapshot.generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(generation));
    return { packed, generation, count: exportable.length };
  }).immediate();
  const file = writeSnapshotAtomically(syncFolder, deviceId, snapshot.generation, snapshot.packed);
  return { path: file, changesetCount: snapshot.count, coveredDeviceSeqs: {} };
}

/** Only a fresh, isolated onboarding database may bootstrap from a snapshot.
 * Existing ledgers use reviewed changesets; no snapshot bypasses their merge gate.
 */
export function applySnapshot(
  db: Database.Database, snapshotPath: string, passphrase: string,
  mode: { bootstrap: true; expectedGroupId: string },
): { changesetCount: number; bundleId: string; deviceId: string; sequenceNumber: number; coveredDeviceSeqs?: Record<string, number> } {
  if (!mode?.bootstrap) throw new Error('Snapshot application requires an explicit staged bootstrap.');
  const unpacked = unpackBundle(readSnapshotFile(snapshotPath), passphrase);
  if (unpacked.version !== 2 || unpacked.groupId !== mode.expectedGroupId || !unpacked.causalState || !unpacked.observedBundles || !unpacked.snapshotGeneration) {
    throw new Error('This snapshot needs reviewed legacy recovery or belongs to another team.');
  }
  if (unpacked.schemaVersion !== CRR_SCHEMA_VERSION) throw new Error('Snapshot schema is incompatible. Upgrade Fidra before joining.');
  const causalState = unpacked.causalState;
  assertSnapshotCausalContext(causalState, unpacked.observedBundles);
  const history = new CausalHistory(db);
  const insert = db.prepare(`INSERT INTO crsql_changes
    ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const table of SYNCED_TABLES) {
      if (table !== 'settings' && (db.prepare(`SELECT COUNT(*) FROM "${table}"`).pluck().get() as number) > 0) {
        throw new Error('A snapshot cannot overwrite an existing ledger. Use reviewed recovery.');
      }
    }
    history.restoreState(causalState);
    for (const row of unpacked.changesets.filter((row) => isImportableSyncRow(row, mode.expectedGroupId))) {
      if (isTrackedTable(row.table) && !history.hasAcceptedRevision(row)) throw new Error('Snapshot contains financial state without accepted causal history.');
      const pk = typeof row.pk === 'string' ? Buffer.from(row.pk) : row.pk;
      insert.run(row.table, pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
    }
  }).immediate();
  return { changesetCount: unpacked.changesets.length, bundleId: unpacked.bundleId, deviceId: unpacked.deviceId,
    sequenceNumber: unpacked.sequenceNumber, coveredDeviceSeqs: {} };
}
