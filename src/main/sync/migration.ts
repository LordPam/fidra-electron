/**
 * Sync migration flows for Local Sync onboarding.
 *
 * Two entry points:
 * 1. joinLocalSync — new peer joins an existing Local Sync group via snapshot
 * 2. migrateCloudToLocalSync — Cloud Connect database migrates to Local Sync
 *
 * Both create a NEW database file (sync mode is immutable per file).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { openDatabase } from '../database/connection';
import { initializeCrr } from './crr-schema';
import { applySnapshot } from './compaction';
import { findLatestSnapshot, isBundleFile, parseBundleFilename, readBundleFile } from './bundle-io';
import { unpackBundle, type CrChangesetRow } from './bundle-format';
import { BundleIntegrityError, BundleCryptoError } from './bundle-crypto';
import { BundleFormatError } from './bundle-format';
import { initializeDeviceIdentity } from './device-identity';
import { syncLog, errorMessage } from './sync-log';

export interface MigrationResult {
  success: boolean;
  newDbPath?: string;
  error?: string;
}

interface JoinLocalSyncOpts {
  syncFolder: string;
  passphrase: string;
  newDbPath: string;
}

interface MigrateCloudToLocalSyncOpts {
  sourceDbPath: string;
  syncFolder: string;
  passphrase: string;
  newDbPath: string;
}

/**
 * Join an existing Local Sync group by importing the latest snapshot.
 * Creates a fresh database at `newDbPath`, populates from snapshot.
 */
export function joinLocalSync(opts: JoinLocalSyncOpts): MigrationResult {
  const { syncFolder, passphrase, newDbPath } = opts;

  try {
    // Validate sync folder
    fs.accessSync(syncFolder, fs.constants.R_OK);

    // Find latest snapshot
    const snapshot = findLatestSnapshot(syncFolder);
    if (!snapshot) {
      return {
        success: false,
        error: 'No snapshot found. Ask an existing team member to create a snapshot first.',
      };
    }

    // Create fresh database (schema DDL + migrations run automatically)
    const db = openDatabase(newDbPath);

    try {
      // Register CRR tables
      initializeCrr(db);

      // Apply snapshot data
      const snapshotResult = applySnapshot(db, snapshot.filePath, passphrase);

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

      // Record the snapshot as applied so tryApplyLatestSnapshot() doesn't re-process it
      const snapshotBundleId = `snapshot:${snapshotResult.deviceId}:${snapshotResult.sequenceNumber}`;
      db.prepare(
        `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at)
         VALUES (?, ?, ?, ?)`,
      ).run(snapshotBundleId, snapshotResult.deviceId, snapshotResult.sequenceNumber, new Date().toISOString());

      // Seed applied_bundles with snapshot coverage so the orchestrator skips
      // already-captured bundles during its first doImportAll()
      if (snapshotResult.coveredDeviceSeqs) {
        for (const [devId, maxSeq] of Object.entries(snapshotResult.coveredDeviceSeqs)) {
          const coverageId = `snapshot-coverage:${devId}:${maxSeq}`;
          db.prepare(
            `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at)
             VALUES (?, ?, ?, ?)`,
          ).run(coverageId, devId, maxSeq, new Date().toISOString());
        }
      }

      // Import all bundles newer than the snapshot so the joiner DB has the
      // complete current state. Without this, data created after the snapshot
      // (e.g., the invited personnel record) wouldn't exist when the caller
      // tries to set the joiner's password.
      importBundlesAfterSnapshot(db, syncFolder, passphrase);

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
    } finally {
      db.close();
    }

    syncLog('info', 'joinLocalSync completed', { newDbPath, syncFolder });
    return { success: true, newDbPath };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    syncLog('error', 'joinLocalSync failed', { error });
    // Clean up partial file on failure
    try { fs.unlinkSync(newDbPath); } catch { /* ignore */ }
    return { success: false, error };
  }
}

/**
 * Migrate a Cloud Connect database to Local Sync.
 * Copies the source database to a new file, strips cloud config, initializes CRR.
 */
export function migrateCloudToLocalSync(opts: MigrateCloudToLocalSyncOpts): MigrationResult {
  const { sourceDbPath, syncFolder, passphrase, newDbPath } = opts;

  try {
    // Validate sync folder
    fs.accessSync(syncFolder, fs.constants.R_OK | fs.constants.W_OK);

    // Copy source database to new location
    fs.copyFileSync(sourceDbPath, newDbPath);

    // Open copied database (migrations run, schema up to date)
    const db = openDatabase(newDbPath);

    try {
      // Clean up cloud-specific settings
      const cloudKeys = db
        .prepare("SELECT key FROM settings WHERE key LIKE 'cloudServer.%' OR key LIKE 'cloud.%'")
        .all() as { key: string }[];
      const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
      for (const row of cloudKeys) {
        deleteStmt.run(row.key);
      }

      // Initialize CRR tables (idempotent — cloud cache won't have them)
      initializeCrr(db);

      // Set lastExportedVersion watermark so the orchestrator's first doExport()
      // doesn't re-export the entire dataset that was copied from the Cloud DB.
      const dbVersion = (db.prepare('SELECT crsql_db_version()').pluck().get() as number) ?? 0;
      db.prepare(
        "INSERT INTO sync_meta (key, value) VALUES ('sync.lastExportedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(dbVersion));

      // Write Local Sync settings (device scope)
      db.prepare(
        "INSERT INTO settings (key, value, scope) VALUES (?, ?, 'device') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run('localSync.syncFolder', syncFolder);
      db.prepare(
        "INSERT INTO settings (key, value, scope) VALUES (?, ?, 'device') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run('localSync.passphrase', passphrase);

      // Ensure device identity exists (per-database, stored in sync_meta)
      initializeDeviceIdentity(db, os.hostname());
    } finally {
      db.close();
    }

    syncLog('info', 'migrateCloudToLocalSync completed', { sourceDbPath, newDbPath, syncFolder });
    return { success: true, newDbPath };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    syncLog('error', 'migrateCloudToLocalSync failed', { error });
    // Clean up partial file on failure
    try { fs.unlinkSync(newDbPath); } catch { /* ignore */ }
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
): void {
  const syncDir = path.join(syncFolder, 'sync');
  let entries: string[];
  try {
    entries = fs.readdirSync(syncDir);
  } catch {
    return; // No sync dir yet
  }

  // Collect and sort bundles by sequence number
  const bundles: { filePath: string; deviceId: string; sequenceNumber: number }[] = [];
  for (const entry of entries) {
    if (!isBundleFile(entry)) continue;
    const parsed = parseBundleFilename(entry);
    if (!parsed) continue;
    bundles.push({
      filePath: path.join(syncDir, entry),
      deviceId: parsed.deviceId,
      sequenceNumber: parsed.sequenceNumber,
    });
  }
  bundles.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Check which are already applied (snapshot coverage)
  const isApplied = db.prepare('SELECT 1 FROM applied_bundles WHERE bundle_id = ?');
  const insertApplied = db.prepare(
    `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at)
     VALUES (?, ?, ?, ?)`,
  );
  const insertChangeset = db.prepare(
    `INSERT INTO crsql_changes
     ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let imported = 0;
  for (const bundle of bundles) {
    try {
      const data = readBundleFile(bundle.filePath);
      const unpacked = unpackBundle(data, passphrase);

      if (isApplied.get(unpacked.bundleId)) continue;

      // Apply changesets directly (no merge gate — during join, all remote
      // data is authoritative since we have no local edits yet)
      const applyAll = db.transaction(() => {
        for (const row of unpacked.changesets) {
          const pk = typeof row.pk === 'string' ? Buffer.from(row.pk, 'utf-8') : row.pk;
          insertChangeset.run(
            row.table, pk, row.cid, row.val,
            row.col_version, row.db_version, row.site_id, row.cl, row.seq,
          );
        }
      });
      applyAll();

      insertApplied.run(
        unpacked.bundleId, unpacked.deviceId, unpacked.sequenceNumber,
        new Date().toISOString(),
      );
      imported++;
    } catch (e) {
      if (e instanceof BundleIntegrityError || e instanceof BundleCryptoError || e instanceof BundleFormatError) {
        syncLog('warn', 'Skipping corrupt bundle during join import', { filePath: bundle.filePath, error: errorMessage(e) });
        continue;
      }
      // ENOENT = file disappeared (compaction) — skip
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      syncLog('warn', 'Skipping bundle during join import', { filePath: bundle.filePath, error: errorMessage(e) });
    }
  }

  if (imported > 0) {
    syncLog('info', 'Imported bundles during join', { count: imported });
  }
}
