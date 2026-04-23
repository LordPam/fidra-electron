/**
 * Sync orchestrator for Local Sync.
 *
 * Ties together all Local Sync building blocks into end-to-end sync:
 *   local edits → outbound bundles → shared folder
 *   inbound bundles → unpack → merge gate → apply/conflict-queue
 *
 * Design decisions (see plan):
 *   D1: State in SQLite settings table (scope=device), in-memory copies
 *   D2: Poll MAX(db_version) every 1s, 2s debounce before export
 *   D3: Settings pk decoded via Buffer→string, filtered by isOrgKey()
 *   D4: Post-import watermark update prevents re-exporting imported changes
 *   D5: busy flag serializes export/import
 *   D6: Corrupt bundles skipped, not recorded (allows retry)
 *   D7: Attachment sync best-effort after changeset sync
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  type CrChangesetRow,
  type UnpackedBundle,
  packBundle,
  unpackBundle,
} from './bundle-format';
import {
  ensureSyncFolderStructure,
  readBundleFile,
  writeBundleAtomically,
} from './bundle-io';
import { scanForNewBundles } from './bundle-scanner';
import { FolderWatcher } from './folder-watcher';
import { classifyChangesets, applyMergeResult } from './merge-gate';
import { ConflictQueue } from './conflict-queue';
import { AppliedBundles } from './applied-bundles';
import { CRR_SCHEMA_VERSION } from './crr-schema';
import { isOrgKey } from '../database/settings-repo';
import {
  writeAttachmentFile,
  readAttachmentFile,
  listRemoteAttachments,
} from './attachment-transport';
import { BundleIntegrityError, BundleCryptoError } from './bundle-crypto';
import { BundleFormatError } from './bundle-format';
import { syncLog, errorMessage } from './sync-log';
import { findLatestSnapshot } from './bundle-io';
import {
  compactBundles,
  shouldAutoSnapshot,
  createSnapshot as createSnapshotImpl,
  applySnapshot,
  type SnapshotResult,
} from './compaction';

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncOrchestratorOptions {
  db: Database.Database;
  syncFolder: string;
  passphrase: string;
  deviceId: string;
  dbPath?: string;
  /** Name of the person using this device (embedded in bundles for notifications). */
  personName?: string;
  onDataChanged?: (tables: string[]) => void;
  onConflictsDetected?: (count: number) => void;
  onStatusChanged?: (status: SyncStatus) => void;
  onError?: (error: string) => void;
  onImportSummary?: (notification: import('../../shared/ipc-types').ImportNotification) => void;
  exportDebounceMs?: number;
  versionPollMs?: number;
}

export type SyncStatusState = 'idle' | 'exporting' | 'importing' | 'error' | 'stopped';

export interface SyncStatus {
  state: SyncStatusState;
  lastExportAt: string | null;
  lastImportAt: string | null;
  pendingConflicts: number;
  lastError: string | null;
}

export interface ExportResult {
  bundleId: string | null;
  changesetCount: number;
  attachmentCount: number;
}

export interface ImportResult {
  bundlesProcessed: number;
  changesetsApplied: number;
  conflictsQueued: number;
  bundlesSkipped: number;
  attachmentsImported: number;
}

// ─── Settings keys ──────────────────────────────────────────────────

const SETTING_LAST_EXPORTED_VERSION = 'sync.lastExportedVersion';
const SETTING_SEQUENCE_NUMBER = 'sync.sequenceNumber';

// ─── Class ──────────────────────────────────────────────────────────

export class SyncOrchestrator {
  private readonly db: Database.Database;
  private readonly syncFolder: string;
  private readonly passphrase: string;
  private readonly deviceId: string;
  private readonly dbPath: string | null;
  private readonly personName: string | null;
  private readonly exportDebounceMs: number;
  private readonly versionPollMs: number;

  // Callbacks
  private readonly onDataChanged: ((tables: string[]) => void) | null;
  private readonly onConflictsDetected: ((count: number) => void) | null;
  private readonly onStatusChanged: ((status: SyncStatus) => void) | null;
  private readonly onError: ((error: string) => void) | null;
  private readonly onImportSummary: ((notification: import('../../shared/ipc-types').ImportNotification) => void) | null;

  // Infrastructure
  private readonly conflictQueue: ConflictQueue;
  private readonly appliedBundles: AppliedBundles;
  private watcher: FolderWatcher | null = null;

  // In-memory state (D1)
  private lastExportedVersion = 0;
  private sequenceNumber = 0;
  private siteId: Buffer | null = null;

  // Timers
  private versionPollTimer: ReturnType<typeof setInterval> | null = null;
  private exportDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Serialization (D5)
  private busy = false;
  private importQueued = false;

  // Startup flag: true during start(), false after first import completes
  private isStartupImport = true;

  // Status
  private running = false;
  private statusState: SyncStatusState = 'stopped';
  private lastExportAt: string | null = null;
  private lastImportAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: SyncOrchestratorOptions) {
    this.db = options.db;
    this.syncFolder = options.syncFolder;
    this.passphrase = options.passphrase;
    this.deviceId = options.deviceId;
    this.dbPath = options.dbPath ?? null;
    this.personName = options.personName ?? null;
    this.exportDebounceMs = options.exportDebounceMs ?? 2000;
    this.versionPollMs = options.versionPollMs ?? 1000;

    this.onDataChanged = options.onDataChanged ?? null;
    this.onConflictsDetected = options.onConflictsDetected ?? null;
    this.onStatusChanged = options.onStatusChanged ?? null;
    this.onError = options.onError ?? null;
    this.onImportSummary = options.onImportSummary ?? null;

    this.conflictQueue = new ConflictQueue(this.db);
    this.appliedBundles = new AppliedBundles(this.db);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Get cr-sqlite site ID
    this.siteId = this.getSiteId();

    // Ensure folder structure
    ensureSyncFolderStructure(this.syncFolder);

    // Load watermarks from settings (D1)
    this.lastExportedVersion = this.loadSettingInt(SETTING_LAST_EXPORTED_VERSION);
    this.sequenceNumber = this.loadSettingInt(SETTING_SEQUENCE_NUMBER);

    this.setStatus('idle');

    // Flush any unexported local changes BEFORE importing. If the orchestrator
    // was stopped while the user made edits (e.g., offline, sync disabled),
    // those changes have db_versions below what the import will set as the new
    // watermark. Exporting first ensures they reach the shared folder before
    // the D4 watermark jump in doImportAll() would hide them.
    this.doExport();

    // If no snapshot exists yet (first peer, or migration from Cloud Connect),
    // create one now so new devices can bootstrap from a single file instead of
    // replaying all historical bundles.
    this.ensureInitialSnapshot();

    // Check for newer snapshot and apply if found (idempotent — safe on both
    // fresh and existing databases since cr-sqlite changesets are CRDTs)
    this.tryApplyLatestSnapshot();

    // Initial import scan
    this.doImportAll();

    // Start version poll timer (D2)
    this.versionPollTimer = setInterval(() => this.onVersionPoll(), this.versionPollMs);

    // Start folder watcher
    this.watcher = new FolderWatcher({
      syncFolder: this.syncFolder,
      onBundleDetected: () => this.onBundleDetected(),
      onError: (msg) => {
        this.lastError = msg;
        this.onError?.(msg);
        this.setStatus('error');
      },
    });
    this.watcher.start();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.versionPollTimer) {
      clearInterval(this.versionPollTimer);
      this.versionPollTimer = null;
    }

    if (this.exportDebounceTimer) {
      clearTimeout(this.exportDebounceTimer);
      this.exportDebounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }

    this.busy = false;
    this.importQueued = false;

    this.setStatus('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): SyncStatus {
    let pendingConflicts = 0;
    try {
      pendingConflicts = this.conflictQueue.count();
    } catch {
      // Database may have been closed during teardown
    }
    return {
      state: this.statusState,
      lastExportAt: this.lastExportAt,
      lastImportAt: this.lastImportAt,
      pendingConflicts,
      lastError: this.lastError,
    };
  }

  // ─── Export path ────────────────────────────────────────────────

  exportNow(): ExportResult {
    return this.doExport();
  }

  private doExport(): ExportResult {
    if (this.busy) return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
    this.busy = true;

    try {
      this.setStatus('exporting');

      // Query changesets since last exported version
      const changesets = this.getChangesetsSinceVersion(this.lastExportedVersion);

      // Filter: exclude device-scoped settings (D3)
      const exportable = changesets.filter((row) => this.isExportableChangeset(row));

      if (exportable.length === 0) {
        // No exportable changes — update watermark to current version anyway
        const currentVersion = this.getCurrentDbVersion();
        if (currentVersion > this.lastExportedVersion) {
          this.lastExportedVersion = currentVersion;
          this.persistSetting(SETTING_LAST_EXPORTED_VERSION, currentVersion);
        }
        this.setStatus('idle');
        this.busy = false;
        return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
      }

      // Pack and write bundle
      this.sequenceNumber++;
      const packed = packBundle({
        deviceId: this.deviceId,
        siteId: this.siteId!,
        sequenceNumber: this.sequenceNumber,
        schemaVersion: CRR_SCHEMA_VERSION,
        changesets: exportable,
        passphrase: this.passphrase,
        deviceName: this.personName ?? undefined,
      });

      writeBundleAtomically(this.syncFolder, this.deviceId, this.sequenceNumber, packed);

      // Update watermarks
      const newVersion = this.getCurrentDbVersion();
      this.lastExportedVersion = newVersion;
      this.persistSetting(SETTING_LAST_EXPORTED_VERSION, newVersion);
      this.persistSetting(SETTING_SEQUENCE_NUMBER, this.sequenceNumber);

      // Attachment sync (D7)
      let attachmentCount = 0;
      try {
        attachmentCount = this.exportNewAttachments(exportable);
      } catch (e) {
        syncLog('warn', 'Attachment export error (non-fatal)', { error: errorMessage(e) });
      }

      this.lastExportAt = new Date().toISOString();
      this.setStatus('idle');

      // Extract bundleId from the packed bundle (we need to unpack to get it,
      // but we can compute it from sequence number for the result)
      const bundleId = `${this.deviceId}_${this.sequenceNumber}`;

      return { bundleId, changesetCount: exportable.length, attachmentCount };
    } catch (e) {
      const msg = errorMessage(e);
      this.lastError = msg;
      this.onError?.(msg);
      this.setStatus('error');
      return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
    } finally {
      this.busy = false;
    }
  }

  private onVersionPoll(): void {
    if (!this.running || this.busy) return;

    try {
      const currentVersion = this.getCurrentDbVersion();
      if (currentVersion > this.lastExportedVersion) {
        this.scheduleExport();
      }
    } catch (e) {
      // Database may have been closed during a window switch — stop gracefully
      if (e instanceof TypeError && String(e.message).includes('not open')) {
        this.running = false;
        return;
      }
      throw e;
    }
  }

  private scheduleExport(): void {
    if (this.exportDebounceTimer) return; // Already scheduled
    this.exportDebounceTimer = setTimeout(() => {
      this.exportDebounceTimer = null;
      if (this.running) {
        this.doExport();
      }
    }, this.exportDebounceMs);
  }

  // ─── Import path ───────────────────────────────────────────────

  importAll(): ImportResult {
    return this.doImportAll();
  }

  private doImportAll(): ImportResult {
    if (this.busy) {
      this.importQueued = true;
      return { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
    }
    this.busy = true;

    try {
      this.setStatus('importing');

      // Scan for new bundles
      const bundles = scanForNewBundles(this.syncFolder, this.deviceId, this.appliedBundles);
      if (bundles.length === 0) {
        this.isStartupImport = false;
        this.setStatus('idle');
        this.busy = false;
        return { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
      }

      // Pause watcher during import
      this.watcher?.pause();

      let bundlesProcessed = 0;
      let changesetsApplied = 0;
      let conflictsQueued = 0;
      let bundlesSkipped = 0;
      const affectedTables = new Set<string>();

      // Per-device per-table change tracking for notifications
      const deviceChanges = new Map<string, Map<string, { created: Set<string>; updated: Set<string>; deleted: Set<string> }>>();
      // Device name from bundle metadata (fallback for person name lookup)
      const bundleDeviceNames = new Map<string, string>();

      for (const scanned of bundles) {
        try {
          // Read and unpack
          const data = readBundleFile(scanned.filePath);
          const unpacked = this.unpackAndValidate(data, scanned.filePath);
          if (!unpacked) {
            bundlesSkipped++;
            continue;
          }

          // Dedup check
          if (this.appliedBundles.hasApplied(unpacked.bundleId)) {
            bundlesSkipped++;
            continue;
          }

          // Capture person name from bundle metadata (for notification fallback)
          if (unpacked.deviceName) {
            bundleDeviceNames.set(unpacked.deviceId, unpacked.deviceName);
          }

          // Filter settings (D3)
          const filtered = unpacked.changesets.filter((row) => this.isImportableChangeset(row));

          // Restore pk to Buffer format for cr-sqlite compatibility.
          // Export converts Buffer→UTF-8 string for JSON serialization;
          // cr-sqlite stores pk as Buffer, so we need to convert back
          // for proper WHERE pk = ? matching in classifyChangesets.
          for (const row of filtered) {
            if (typeof row.pk === 'string') {
              (row as { pk: unknown }).pk = Buffer.from(row.pk, 'utf-8');
            }
          }

          // Classify and apply (pass local siteId for deterministic tiebreaker —
          // ensures only ONE peer shows a conflict screen for any concurrent edit)
          const mergeResult = classifyChangesets(this.db, filtered, this.siteId ?? undefined);
          applyMergeResult(this.db, mergeResult, this.conflictQueue, unpacked.bundleId);

          // Record as applied
          this.appliedBundles.insert(unpacked.bundleId, unpacked.deviceId, unpacked.sequenceNumber);

          // Track affected tables
          for (const row of mergeResult.autoMerge) {
            affectedTables.add(row.table);
          }
          for (const conflict of mergeResult.conflicts) {
            affectedTables.add(conflict.entityType);
          }

          // Collect per-device per-table change counts for notifications
          if (this.onImportSummary && mergeResult.autoMerge.length > 0) {
            if (!deviceChanges.has(unpacked.deviceId)) {
              deviceChanges.set(unpacked.deviceId, new Map());
            }
            const tableMap = deviceChanges.get(unpacked.deviceId)!;
            for (const row of mergeResult.autoMerge) {
              // Skip tables/fields that shouldn't trigger user-visible notifications
              if (row.table === 'audit_log') continue;
              // Skip internal personnel fields (device_id, auth credentials)
              if (row.table === 'personnel' && (
                row.cid === 'device_id' || row.cid === 'password_hash' ||
                row.cid === 'encrypted_passphrase' || row.cid === 'passphrase_salt'
              )) continue;

              if (!tableMap.has(row.table)) {
                tableMap.set(row.table, { created: new Set(), updated: new Set(), deleted: new Set() });
              }
              const counts = tableMap.get(row.table)!;
              // Extract pk as string for dedup
              const pkStr = Buffer.isBuffer(row.pk) ? row.pk.toString('utf-8') : String(row.pk);
              if (row.cid === '-1') {
                counts.deleted.add(pkStr);
              } else if (row.col_version === 1) {
                counts.created.add(pkStr);
              } else {
                counts.updated.add(pkStr);
              }
            }
          }

          bundlesProcessed++;
          changesetsApplied += mergeResult.autoMerge.length;
          conflictsQueued += mergeResult.conflicts.length;
        } catch (e) {
          // D6: skip corrupt/missing bundles
          const code = (e as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            // Bundle deleted between scan and read — normal during compaction
            syncLog('info', 'Bundle disappeared between scan and read (compaction?)', { filePath: scanned.filePath });
          } else {
            syncLog('warn', 'Skipping bundle', { filePath: scanned.filePath, error: errorMessage(e) });
          }
          bundlesSkipped++;
        }
      }

      // Attachment import (D7)
      let attachmentsImported = 0;
      try {
        attachmentsImported = this.importNewAttachments();
      } catch (e) {
        syncLog('warn', 'Attachment import error (non-fatal)', { error: errorMessage(e) });
      }

      // D4: Update lastExportedVersion to current db_version to prevent re-export
      const currentVersion = this.getCurrentDbVersion();
      if (currentVersion > this.lastExportedVersion) {
        this.lastExportedVersion = currentVersion;
        this.persistSetting(SETTING_LAST_EXPORTED_VERSION, currentVersion);
      }

      // Auto-snapshot + compaction: create a snapshot if the latest is >1 day
      // old, then delete bundles that are covered by it
      try {
        if (shouldAutoSnapshot(this.syncFolder)) {
          const snap = this.createSnapshot();
          syncLog('info', 'Auto-snapshot created', { changesetCount: snap.changesetCount });
        }
        const compacted = compactBundles(this.syncFolder, this.passphrase);
        if (compacted > 0) {
          syncLog('info', 'Compacted bundles', { deletedCount: compacted });
        }
      } catch (e) {
        syncLog('warn', 'Snapshot/compaction error (non-fatal)', { error: errorMessage(e) });
      }

      // Resume watcher
      this.watcher?.resume();

      this.lastImportAt = new Date().toISOString();
      this.setStatus('idle');

      // Emit callbacks
      if (affectedTables.size > 0) {
        this.onDataChanged?.([...affectedTables]);
      }
      if (conflictsQueued > 0) {
        this.onConflictsDetected?.(conflictsQueued);
      }

      // Emit import summary for notifications
      if (this.onImportSummary && deviceChanges.size > 0) {
        const summaries: import('../../shared/ipc-types').ImportPersonSummary[] = [];
        for (const [devId, tableMap] of deviceChanges) {
          // Look up person name: DB device_id → bundle metadata → fallback
          let personName: string | null = null;
          try {
            const person = this.db
              .prepare('SELECT name FROM personnel WHERE device_id = ?')
              .get(devId) as { name: string } | undefined;
            if (person) personName = person.name;
          } catch { /* non-fatal */ }
          if (!personName) personName = bundleDeviceNames.get(devId) ?? 'A team member';

          const changes: Record<string, import('../../shared/ipc-types').ImportChangeSummary> = {};
          for (const [table, sets] of tableMap) {
            changes[table] = {
              created: sets.created.size,
              updated: sets.updated.size,
              deleted: sets.deleted.size,
            };
          }
          summaries.push({ personName, deviceId: devId, changes });
        }
        this.onImportSummary({ summaries, isStartupCatchup: this.isStartupImport });
      }

      // After first import, clear startup flag
      this.isStartupImport = false;

      return { bundlesProcessed, changesetsApplied, conflictsQueued, bundlesSkipped, attachmentsImported };
    } catch (e) {
      const msg = errorMessage(e);
      this.lastError = msg;
      this.onError?.(msg);
      this.setStatus('error');
      this.watcher?.resume();
      return { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
    } finally {
      this.busy = false;
      // If an import was queued while we were busy, run it now
      if (this.importQueued) {
        this.importQueued = false;
        if (this.running) {
          // Defer to next tick to avoid deep recursion
          setTimeout(() => this.doImportAll(), 0);
        }
      }
    }
  }

  private unpackAndValidate(data: Buffer, filePath: string): UnpackedBundle | null {
    try {
      const unpacked = unpackBundle(data, this.passphrase);

      // Check schema version
      if (unpacked.schemaVersion !== CRR_SCHEMA_VERSION) {
        syncLog('warn', 'Bundle schema version mismatch, skipping', {
          filePath, actual: unpacked.schemaVersion, expected: CRR_SCHEMA_VERSION,
        });
        return null;
      }

      return unpacked;
    } catch (e) {
      if (e instanceof BundleIntegrityError) {
        syncLog('warn', 'Bundle failed integrity check', { filePath, error: e.message });
      } else if (e instanceof BundleCryptoError) {
        syncLog('warn', 'Bundle decryption failed', { filePath, error: e.message });
      } else if (e instanceof BundleFormatError) {
        syncLog('warn', 'Bundle format error', { filePath, error: e.message });
      } else {
        syncLog('warn', 'Bundle unpack error', { filePath, error: errorMessage(e) });
      }
      return null;
    }
  }

  private onBundleDetected(): void {
    if (!this.running) return;
    this.doImportAll();
  }

  // ─── Compaction / Snapshots ────────────────────────────────────

  /** Create a full-state snapshot for new-device onboarding and compaction. */
  createSnapshot(): SnapshotResult {
    return createSnapshotImpl(
      this.db,
      this.syncFolder,
      this.deviceId,
      this.siteId!,
      this.sequenceNumber,
      this.passphrase,
    );
  }

  /** Delete bundles covered by the latest snapshot. */
  compact(): number {
    return compactBundles(this.syncFolder, this.passphrase);
  }

  /**
   * Check for a newer snapshot in the shared folder and apply it.
   * Safe on both fresh and existing databases — cr-sqlite changesets are CRDTs,
   * so re-applying already-known data is a no-op.
   */
  private tryApplyLatestSnapshot(): void {
    try {
      const snapshot = findLatestSnapshot(this.syncFolder);
      if (!snapshot) return;

      // Skip if we've already applied this snapshot
      const snapshotBundleId = `snapshot:${snapshot.deviceId}:${snapshot.sequenceNumber}`;
      if (this.appliedBundles.hasApplied(snapshotBundleId)) return;

      syncLog('info', 'Applying snapshot', { filePath: snapshot.filePath });
      const result = applySnapshot(this.db, snapshot.filePath, this.passphrase);
      syncLog('info', 'Snapshot applied', { changesetCount: result.changesetCount });

      // Record so we don't re-apply this same snapshot
      this.appliedBundles.insert(
        snapshotBundleId,
        result.deviceId,
        result.sequenceNumber,
      );

      // Seed applied_bundles with the snapshot's coverage map so that bundles
      // already captured by the snapshot are skipped during doImportAll().
      // Without this, a joining device re-imports every bundle in the folder,
      // potentially triggering false conflicts against local modifications
      // (e.g., setPasswordForPersonnel after joinLocalSync).
      if (result.coveredDeviceSeqs) {
        for (const [devId, maxSeq] of Object.entries(result.coveredDeviceSeqs)) {
          const coverageId = `snapshot-coverage:${devId}:${maxSeq}`;
          this.appliedBundles.insert(coverageId, devId, maxSeq);
        }
        syncLog('info', 'Seeded applied_bundles from snapshot coverage', {
          devices: Object.keys(result.coveredDeviceSeqs).length,
        });
      }

      // Update lastExportedVersion to prevent re-exporting snapshot data
      const currentVersion = this.getCurrentDbVersion();
      if (currentVersion > this.lastExportedVersion) {
        this.lastExportedVersion = currentVersion;
        this.persistSetting(SETTING_LAST_EXPORTED_VERSION, currentVersion);
      }
    } catch (e) {
      syncLog('warn', 'Snapshot apply failed (will proceed with bundle import)', { error: errorMessage(e) });
    }
  }

  /**
   * Create an initial snapshot if none exists yet. This ensures new devices
   * can bootstrap from a single snapshot file rather than replaying all
   * historical bundles. Particularly important for Cloud→Local Sync migration
   * where the first peer's initial export may contain the full dataset.
   */
  private ensureInitialSnapshot(): void {
    try {
      if (findLatestSnapshot(this.syncFolder)) return; // Already have one
      if (this.getCurrentDbVersion() === 0) return;    // Empty database, nothing to snapshot

      const snap = this.createSnapshot();
      syncLog('info', 'Initial snapshot created', { changesetCount: snap.changesetCount });
    } catch (e) {
      syncLog('warn', 'Initial snapshot creation failed (non-fatal)', { error: errorMessage(e) });
    }
  }

  // ─── Changeset filtering (D3) ─────────────────────────────────

  private getChangesetsSinceVersion(version: number): CrChangesetRow[] {
    // Only export this device's own changesets. Remote changesets applied via
    // import/snapshot have the remote peer's site_id and must not be re-exported
    // — re-exporting a remote delete sentinel would trigger false conflicts on
    // the originating peer.
    const rows = this.db
      .prepare(
        `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
         FROM crsql_changes
         WHERE db_version > ? AND "site_id" = ?
         ORDER BY db_version, seq`,
      )
      .all(version, this.siteId) as CrChangesetRow[];

    // cr-sqlite returns pk as a Buffer for TEXT PKs. Convert to string
    // so it survives JSON serialization in bundle format.
    for (const row of rows) {
      if (Buffer.isBuffer(row.pk)) {
        (row as { pk: string }).pk = (row.pk as unknown as Buffer).toString('utf-8');
      }
    }

    return rows;
  }

  /**
   * Check if a changeset row should be included in an export bundle.
   * All non-settings rows pass. Settings rows pass only if the key is org-scoped.
   */
  private isExportableChangeset(row: CrChangesetRow): boolean {
    if (row.table !== 'settings') return true;
    return this.isOrgSettingsRow(row);
  }

  /**
   * Check if an imported changeset row should be applied locally.
   * Same filter as export — only org-scoped settings pass.
   */
  private isImportableChangeset(row: CrChangesetRow): boolean {
    if (row.table !== 'settings') return true;
    return this.isOrgSettingsRow(row);
  }

  /**
   * Decode the pk from a settings changeset and check if it's an org key.
   * cr-sqlite encodes TEXT PKs with a binary header (e.g. \x01\x0b\x0e + key).
   * Strip leading non-printable bytes to extract the actual settings key.
   */
  private isOrgSettingsRow(row: CrChangesetRow): boolean {
    try {
      const raw = Buffer.isBuffer(row.pk) ? row.pk.toString('utf-8') : String(row.pk);
      const key = raw.replace(/^[\x00-\x1f]+/, '');
      return isOrgKey(key);
    } catch {
      return false;
    }
  }

  // ─── Attachment sync (D7) ──────────────────────────────────────

  /**
   * Export attachment files referenced by changeset rows.
   * Looks for attachment table changes with stored_name column.
   */
  private exportNewAttachments(changesets: CrChangesetRow[]): number {
    if (!this.dbPath) return 0;

    const attachmentDir = path.join(path.dirname(this.dbPath), 'fidra_attachments');
    let count = 0;

    for (const row of changesets) {
      if (row.table !== 'attachments' || row.cid !== 'stored_name') continue;
      if (typeof row.val !== 'string' || !row.val) continue;

      const storedName = row.val;
      const localPath = path.join(attachmentDir, storedName);

      if (!fs.existsSync(localPath)) continue;

      try {
        writeAttachmentFile(this.syncFolder, storedName, localPath, this.passphrase);
        count++;
      } catch (e) {
        syncLog('warn', 'Failed to export attachment', { storedName, error: errorMessage(e) });
      }
    }

    return count;
  }

  /**
   * Import attachment files from remote that we don't have locally.
   * Only imports files where the metadata row exists in our attachments table.
   */
  private importNewAttachments(): number {
    if (!this.dbPath) return 0;

    const attachmentDir = path.join(path.dirname(this.dbPath), 'fidra_attachments');
    let count = 0;

    const remoteNames = listRemoteAttachments(this.syncFolder);
    if (remoteNames.length === 0) return 0;

    for (const storedName of remoteNames) {
      const localPath = path.join(attachmentDir, storedName);

      // Skip if we already have it
      if (fs.existsSync(localPath)) continue;

      // Verify metadata row exists
      const row = this.db
        .prepare('SELECT 1 FROM attachments WHERE stored_name = ?')
        .get(storedName);
      if (!row) continue;

      try {
        const ok = readAttachmentFile(this.syncFolder, storedName, localPath, this.passphrase);
        if (ok) count++;
      } catch (e) {
        syncLog('warn', 'Failed to import attachment', { storedName, error: errorMessage(e) });
      }
    }

    return count;
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private getSiteId(): Buffer {
    return (
      this.db.prepare('SELECT crsql_site_id() as site_id').get() as { site_id: Buffer }
    ).site_id;
  }

  private getCurrentDbVersion(): number {
    const row = this.db
      .prepare('SELECT MAX(db_version) as v FROM crsql_changes')
      .get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  }

  private loadSettingInt(key: string): number {
    const row = this.db
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) || 0 : 0;
  }

  private persistSetting(key: string, value: number): void {
    this.db
      .prepare(
        "INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, String(value));
  }

  private setStatus(state: SyncStatusState): void {
    this.statusState = state;
    this.onStatusChanged?.(this.getStatus());
  }
}
