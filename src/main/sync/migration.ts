/**
 * Sync migration flows for Local Sync onboarding.
 *
 * Entry point: joinLocalSync — new peer joins an existing Local Sync group
 * via snapshot. Creates a NEW database file (sync mode is immutable per file).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase, getAttachmentStoragePath } from '../database/connection';
import { initializeCrr } from './crr-schema';
import { applySnapshot } from './compaction';
import { findLatestSnapshot, isBundleFile, parseBundleFilename, readBundleFile } from './bundle-io';
import { unpackBundle, BundleFormatError } from './bundle-format';
import { BundleIntegrityError, BundleCryptoError } from './bundle-crypto';
import { initializeDeviceIdentity } from './device-identity';
import { bindExistingSyncFolder, readFolderManifest, assertFolderBinding } from './folder-binding';
import { DeliveryReceipts } from './delivery-receipts';
import { CausalHistory } from './causal-history';
import { ConflictQueue } from './conflict-queue';
import { AppliedBundles } from './applied-bundles';
import { classifyChangesets, applyMergeResult } from './merge-gate';
import { isImportableSyncRow } from './settings-filter';
import { syncLog, errorMessage } from './sync-log';

export interface MigrationResult {
  success: boolean;
  newDbPath?: string;
  error?: string;
  retryable?: boolean;
}

interface JoinLocalSyncOpts {
  syncFolder: string;
  passphrase: string;
  newDbPath: string;
  afterImport?: (db: Database.Database) => void;
}

/**
 * Join an existing Local Sync group by importing the latest snapshot.
 * Creates a fresh database at `newDbPath`, populates from snapshot.
 */
export function joinLocalSync(opts: JoinLocalSyncOpts): MigrationResult {
  const { syncFolder, passphrase, newDbPath } = opts;

  let stagingDirectory: string | undefined;
  let createdDatabaseId: string | undefined;
  try {
    if (!path.isAbsolute(newDbPath)) return { success: false, error: 'Choose an absolute location for the new ledger.' };
    if (fs.existsSync(newDbPath)) return { success: false, error: 'A file already exists at this location. Choose another name; existing files are never replaced when joining.' };
    // Validate sync folder
    fs.accessSync(syncFolder, fs.constants.R_OK);

    // Find latest snapshot
    const manifest = readFolderManifest(syncFolder, passphrase);
    const snapshot = findLatestSnapshot(syncFolder, passphrase, manifest.groupId);
    if (!snapshot) {
      return {
        success: false,
        error: 'No snapshot found. Waiting for the team data to arrive through OneDrive.', retryable: true,
      };
    }

    // Create fresh database (schema DDL + migrations run automatically)
    stagingDirectory = fs.mkdtempSync(path.join(path.dirname(newDbPath), '.fidra-join-'));
    const stagedPath = path.join(stagingDirectory, 'ledger.fdra');
    const { db, databaseId } = openDatabase(stagedPath);
    createdDatabaseId = databaseId;
    fs.chmodSync(stagedPath, 0o600);

    try {
      // Register CRR tables
      initializeCrr(db);

      // Apply snapshot data
      const snapshotResult = applySnapshot(db, snapshot.filePath, passphrase, { bootstrap: true, expectedGroupId: manifest.groupId });
      bindExistingSyncFolder(db, syncFolder, passphrase);

      // Ensure applied_bundles table exists (normally created by SyncOrchestrator,
      // but we need it now to record the snapshot before the orchestrator starts)
      db.exec(`
        CREATE TABLE IF NOT EXISTS applied_bundles (
          bundle_id TEXT PRIMARY KEY NOT NULL,
          device_id TEXT NOT NULL,
          sequence_number INTEGER NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_applied_bundles_device_seq
          ON applied_bundles (device_id, sequence_number)
      `);

      // Bootstrap evidence only; this never stands in for an exact bundle receipt.
      const snapshotBundleId = `snapshot:${snapshotResult.bundleId}`;
      db.prepare(
        `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at)
         VALUES (?, ?, ?, ?)`,
      ).run(snapshotBundleId, snapshotResult.deviceId, snapshotResult.sequenceNumber, new Date().toISOString());

      // Replay every available exact bundle through the merge gate so the joiner has the
      // complete current state. Without this, data created after the snapshot
      // (e.g., the invited personnel record) wouldn't exist when the caller
      // tries to set the joiner's password.
      const identity = initializeDeviceIdentity(db, os.hostname());
      importBundlesAfterSnapshot(db, syncFolder, passphrase, identity.deviceId);

      // Set lastExportedVersion watermark AFTER snapshot + bundle import so the
      // orchestrator's first doExport() doesn't re-export any of this data.
      const dbVersion = (db.prepare('SELECT crsql_db_version()').pluck().get() as number) ?? 0;
      db.prepare(
        "INSERT INTO sync_meta (key, value) VALUES ('sync.lastExportedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(dbVersion));

      // Write Local Sync settings (device scope — never synced)
      db.prepare(
        "INSERT INTO settings (key, value, scope) VALUES (?, ?, 'device') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run('localSync.syncFolder', syncFolder);
      db.prepare(
        "INSERT INTO settings (key, value, scope) VALUES (?, ?, 'device') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run('localSync.passphrase', passphrase);

      // Ensure device identity exists (per-database, stored in sync_meta)
      initializeDeviceIdentity(db, os.hostname());
      assertFolderBinding(db, syncFolder);
      opts.afterImport?.(db);
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }

    // Same-filesystem hard link publishes a complete closed DB without replacing
    // an existing destination, including a file created during the import.
    fs.linkSync(stagedPath, newDbPath);
    try { fs.rmSync(stagingDirectory, { recursive: true, force: true }); } catch { /* Published ledger is complete; stale staging can be removed later. */ }
    stagingDirectory = undefined;
    syncLog('info', 'joinLocalSync completed', { newDbPath, syncFolder });
    return { success: true, newDbPath };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    syncLog('error', 'joinLocalSync failed', { error });
    // Clean up partial file on failure
    if (stagingDirectory) fs.rmSync(stagingDirectory, { recursive: true, force: true });
    if (createdDatabaseId) fs.rmSync(getAttachmentStoragePath(createdDatabaseId), { recursive: true, force: true });
    return { success: false, error };
  }
}

/**
 * Import all bundles from the sync folder into the database.
 * Used during join to bring the DB up to date beyond the snapshot.
 * Bundles already recorded in applied_bundles are skipped.
 */
function importBundlesAfterSnapshot(
  db: Database.Database,
  syncFolder: string,
  passphrase: string,
  deviceId: string,
): void {
  const receipts = new DeliveryReceipts(db, deviceId);
  const syncDir = path.join(syncFolder, 'sync');
  let entries: string[];
  try {
    entries = fs.readdirSync(syncDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  // Collect and sort bundles by sequence number
  const bundles: { filePath: string; deviceId: string; sequenceNumber: number }[] = [];
  for (const entry of entries) {
    if (!isBundleFile(entry)) continue;
    const parsed = parseBundleFilename(entry);
    if (!parsed) throw new Error('An unrecognised bundle filename needs review before onboarding.');
    bundles.push({
      filePath: path.join(syncDir, entry),
      deviceId: parsed.deviceId,
      sequenceNumber: parsed.sequenceNumber,
    });
  }
  bundles.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Check which are already applied (snapshot coverage)
  const isApplied = db.prepare('SELECT 1 FROM applied_bundles WHERE bundle_id = ?');
  const applied = new AppliedBundles(db);
  const history = new CausalHistory(db);
  const queue = new ConflictQueue(db);

  let imported = 0;
  for (const bundle of bundles) {
    try {
      const data = readBundleFile(bundle.filePath);
      applied.assertAppliedPayload(bundle.deviceId, bundle.sequenceNumber, data);
      const unpacked = unpackBundle(data, passphrase);
      const group = db.prepare("SELECT value FROM settings WHERE key = 'localSync.groupId'").get() as { value: string } | undefined;
      if (!group || unpacked.groupId !== group.value) throw new Error('Bundle team identity is missing or different. Reviewed recovery is required.');

      if (isApplied.get(unpacked.bundleId)) continue;

      if (unpacked.version !== 2 || unpacked.deviceId !== bundle.deviceId || unpacked.sequenceNumber !== bundle.sequenceNumber) {
        throw new Error('Bundle protocol or identity mismatch during staged onboarding.');
      }
      const filtered = unpacked.changesets.filter((row) => isImportableSyncRow(row, group.value));
      for (const row of filtered) if (typeof row.pk === 'string') row.pk = Buffer.from(row.pk);
      const causalBundle = { deviceId: unpacked.deviceId, sequenceNumber: unpacked.sequenceNumber, observed: unpacked.observedBundles ?? {} };
      const merge = classifyChangesets(db, filtered, { history, incoming: causalBundle });
      db.transaction(() => {
        applyMergeResult(db, merge, queue, unpacked.bundleId);
        applied.insert(unpacked.bundleId, unpacked.deviceId, unpacked.sequenceNumber, data);
        history.record(causalBundle, filtered, merge.conflicts.length === 0);
        receipts.recordApplied({ sourceDeviceId: unpacked.deviceId, sequenceNumber: unpacked.sequenceNumber,
          bundleId: unpacked.bundleId, payloadHash: crypto.createHash('sha256').update(data).digest('hex'), conflictsQueued: merge.conflicts.length });
      })();
      imported++;
    } catch (e) {
      if (e instanceof BundleIntegrityError || e instanceof BundleCryptoError || e instanceof BundleFormatError) {
        syncLog('warn', 'Unverified bundle blocks join import', { filePath: bundle.filePath, error: errorMessage(e) });
        throw new Error('Team history is not fully verified. Wait for OneDrive or use reviewed recovery before joining.');
      }
      syncLog('warn', 'Failed bundle blocks join import', { filePath: bundle.filePath, error: errorMessage(e) });
      throw new Error('Team history changed or could not be applied during onboarding. No account file was published; retry after sync completes.');
    }
  }

  if (imported > 0) {
    syncLog('info', 'Imported bundles during join', { count: imported });
  }
}
