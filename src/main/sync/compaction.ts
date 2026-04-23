/**
 * Compaction and snapshots for Local Sync.
 *
 * Snapshot-based compaction model:
 * - Snapshots are periodic full-state exports via cr-sqlite changesets
 * - Any bundles older than the latest snapshot can be deleted (all their data
 *   is captured in the snapshot)
 * - On every import cycle, devices check for a newer snapshot and apply it
 *   (cr-sqlite changesets are CRDTs — re-applying is idempotent)
 * - New devices bootstrap from the latest snapshot + subsequent bundles
 * - Auto-snapshot triggers when the latest snapshot is >1 day old
 *
 * No HWM files needed — the snapshot is the single compaction boundary.
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  type CrChangesetRow,
  packBundle,
  unpackBundle,
} from './bundle-format';
import {
  parseBundleFilename,
  isBundleFile,
  writeSnapshotAtomically,
  readSnapshotFile,
  findLatestSnapshot,
} from './bundle-io';
import { CRR_SCHEMA_VERSION } from './crr-schema';
import { isOrgKey } from '../database/settings-repo';

// ─── Constants ──────────────────────────────────────────────────────

const AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

// ─── Compaction ─────────────────────────────────────────────────────

/**
 * Delete bundles that are fully covered by the latest snapshot.
 *
 * Uses the snapshot's `coveredDeviceSeqs` metadata — a map of
 * `{ deviceId → maxSequenceNumber }` recorded at snapshot creation time.
 * A bundle is covered (safe to delete) if its device has an entry in the
 * map and its sequence number is <= the recorded max for that device.
 *
 * This is deterministic and filesystem-independent — no mtime comparisons,
 * so it's safe on OneDrive (where file hydration can change mtime) and
 * across devices with clock skew.
 *
 * Requires the passphrase to read the snapshot and extract coverage metadata.
 */
export function compactBundles(syncFolder: string, passphrase: string): number {
  const snapshot = findLatestSnapshot(syncFolder);
  if (!snapshot) return 0;

  // Read snapshot to extract coverage map
  let coveredSeqs: Record<string, number>;
  try {
    const data = readSnapshotFile(snapshot.filePath);
    const unpacked = unpackBundle(data, passphrase);
    if (!unpacked.coveredDeviceSeqs || Object.keys(unpacked.coveredDeviceSeqs).length === 0) {
      // Legacy snapshot without coverage metadata — skip compaction
      return 0;
    }
    coveredSeqs = unpacked.coveredDeviceSeqs;
  } catch {
    return 0;
  }

  const syncDir = path.join(syncFolder, 'sync');
  let entries: string[];
  try {
    entries = fs.readdirSync(syncDir);
  } catch {
    return 0;
  }

  let deleted = 0;

  for (const entry of entries) {
    if (!isBundleFile(entry)) continue;
    const parsed = parseBundleFilename(entry);
    if (!parsed) continue;

    const maxSeq = coveredSeqs[parsed.deviceId];
    if (maxSeq === undefined) continue; // Device not in coverage map — keep

    if (parsed.sequenceNumber <= maxSeq) {
      const bundlePath = path.join(syncDir, entry);
      try {
        fs.unlinkSync(bundlePath);
        deleted++;
      } catch {
        // File may have been deleted by another device — ignore
      }
    }
  }

  return deleted;
}

// ─── Auto-snapshot check ────────────────────────────────────────────

/**
 * Check if a new snapshot should be created automatically.
 * Returns true if there is no snapshot or the latest is older than 1 day.
 */
export function shouldAutoSnapshot(syncFolder: string): boolean {
  const snapshot = findLatestSnapshot(syncFolder);
  if (!snapshot) return true;

  try {
    const stat = fs.statSync(snapshot.filePath);
    return Date.now() - stat.mtimeMs > AUTO_SNAPSHOT_INTERVAL_MS;
  } catch {
    return true;
  }
}

// ─── Snapshots ──────────────────────────────────────────────────────

export interface SnapshotResult {
  path: string;
  changesetCount: number;
  coveredDeviceSeqs: Record<string, number>;
}

/**
 * Create a full-state snapshot from all cr-sqlite changesets.
 * Reuses the bundle encryption format for consistency.
 *
 * Scans all existing bundles in the sync folder to build a coverage map
 * (`{ deviceId → maxSequenceNumber }`). This map is embedded in the snapshot
 * so that `compactBundles` can use deterministic sequence-based deletion
 * instead of relying on filesystem mtime.
 */
export function createSnapshot(
  db: Database.Database,
  syncFolder: string,
  deviceId: string,
  siteId: Buffer,
  sequenceNumber: number,
  passphrase: string,
): SnapshotResult {
  // Get ALL changesets (full state)
  const changesets = db
    .prepare(
      `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
       FROM crsql_changes
       ORDER BY db_version, seq`,
    )
    .all() as CrChangesetRow[];

  // Filter: exclude device-scoped settings
  const exportable = changesets.filter((row) => isExportableChangeset(row));

  // Convert pk Buffers to UTF-8 strings for JSON serialization
  for (const row of exportable) {
    if (Buffer.isBuffer(row.pk)) {
      (row as { pk: string }).pk = (row.pk as unknown as Buffer).toString('utf-8');
    }
  }

  // Scan existing bundles to build coverage map
  const coveredDeviceSeqs = scanBundleCoverage(syncFolder);

  // Pack as a bundle (reuses existing encryption/compression)
  const packed = packBundle({
    deviceId,
    siteId,
    sequenceNumber,
    schemaVersion: CRR_SCHEMA_VERSION,
    changesets: exportable,
    passphrase,
    coveredDeviceSeqs,
  });

  const snapshotPath = writeSnapshotAtomically(syncFolder, deviceId, sequenceNumber, packed);

  return { path: snapshotPath, changesetCount: exportable.length, coveredDeviceSeqs };
}

/**
 * Apply a snapshot's changesets to the local database.
 * Safe to call on both fresh and existing databases — cr-sqlite changesets
 * are CRDTs, so re-applying already-known data is a no-op.
 */
export function applySnapshot(
  db: Database.Database,
  snapshotPath: string,
  passphrase: string,
): { changesetCount: number; bundleId: string; deviceId: string; sequenceNumber: number; coveredDeviceSeqs?: Record<string, number> } {
  const data = readSnapshotFile(snapshotPath);
  const unpacked = unpackBundle(data, passphrase);

  const insertStmt = db.prepare(
    `INSERT INTO crsql_changes
     ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const applyAll = db.transaction(() => {
    for (const row of unpacked.changesets) {
      // Restore pk from string to Buffer for cr-sqlite compatibility
      const pk = typeof row.pk === 'string' ? Buffer.from(row.pk, 'utf-8') : row.pk;
      insertStmt.run(
        row.table, pk, row.cid, row.val,
        row.col_version, row.db_version, row.site_id, row.cl, row.seq,
      );
    }
  });

  applyAll();

  return {
    changesetCount: unpacked.changesets.length,
    bundleId: unpacked.bundleId,
    deviceId: unpacked.deviceId,
    sequenceNumber: unpacked.sequenceNumber,
    coveredDeviceSeqs: unpacked.coveredDeviceSeqs,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Scan all bundle files in the sync folder and build a coverage map:
 * `{ deviceId → maxSequenceNumber }`. This represents which bundles
 * exist at snapshot creation time and are therefore fully captured
 * by the snapshot's full-state changeset dump.
 */
function scanBundleCoverage(syncFolder: string): Record<string, number> {
  const syncDir = path.join(syncFolder, 'sync');
  const coverage: Record<string, number> = {};

  let entries: string[];
  try {
    entries = fs.readdirSync(syncDir);
  } catch {
    return coverage;
  }

  for (const entry of entries) {
    if (!isBundleFile(entry)) continue;
    const parsed = parseBundleFilename(entry);
    if (!parsed) continue;

    const current = coverage[parsed.deviceId];
    if (current === undefined || parsed.sequenceNumber > current) {
      coverage[parsed.deviceId] = parsed.sequenceNumber;
    }
  }

  return coverage;
}

function isExportableChangeset(row: CrChangesetRow): boolean {
  if (row.table !== 'settings') return true;
  try {
    const raw = Buffer.isBuffer(row.pk) ? row.pk.toString('utf-8') : String(row.pk);
    const key = raw.replace(/^[\x00-\x1f]+/, '');
    return isOrgKey(key);
  } catch {
    return false;
  }
}
