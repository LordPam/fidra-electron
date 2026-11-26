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
 *   D4: Export watermark advances only with a durable local outbound bundle
 *   D5: busy flag serializes export/import
 *   D6: Corrupt bundles skipped, not recorded (allows retry)
 *   D7: Attachment sync best-effort after changeset sync
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
import { classifyChangesets, applyMergeResult, isDeleteChangeset } from './merge-gate';
import { ConflictQueue } from './conflict-queue';
import { AppliedBundles } from './applied-bundles';
import { OutboundBundles } from './outbound-bundles';
import { assertFolderBinding, getFolderBinding } from './folder-binding';
import { DeliveryReceipts } from './delivery-receipts';
import { CausalHistory } from './causal-history';
import { reconcileSupersededConflicts } from './conflict-resolution';
import type { LocalSyncDelivery } from '../../shared/sync-delivery-types';
import { CRR_SCHEMA_VERSION } from './crr-schema';
import { isOrgChangeset, isImportableSyncRow } from './settings-filter';
import {
  writeAttachmentFile,
  readAttachmentFile,
} from './attachment-transport';
import { BundleIntegrityError, BundleCryptoError } from './bundle-crypto';
import { BundleFormatError } from './bundle-format';
import { syncLog, errorMessage } from './sync-log';
import { writeHeartbeat, isSyncProviderRunning, isNetworkReachable } from './heartbeat';
import { getAttachmentStoragePath } from '../database/connection';
import type { ImportChangeDetail } from '../../shared/ipc-types';
import { parsePence, penceToAmount } from '../../shared/money';
import {
  createSnapshot as createSnapshotImpl,
  type SnapshotResult,
} from './compaction';

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncOrchestratorOptions {
  db: Database.Database;
  syncFolder: string;
  passphrase: string;
  deviceId: string;
  dbPath?: string;
  /** Stable per-database UUID for attachment storage path resolution. */
  databaseId?: string;
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

export type SyncStatusState = 'idle' | 'exporting' | 'importing' | 'error' | 'stopped' | 'stale';

export interface SyncStatus {
  state: SyncStatusState;
  lastExportAt: string | null;
  lastImportAt: string | null;
  pendingConflicts: number;
  lastError: string | null;
  staleReason: string | null;
  delivery: LocalSyncDelivery;
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

/** Max entities per table to include detail labels for (keeps toasts compact). */
const DETAIL_THRESHOLD = 8;

/** Heartbeat write interval (ms). Each device writes a small file this often. */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes


/**
 * Format a currency amount as a simple £X.XX string.
 * Main-process-only — renderer uses its own formatCurrency().
 */
function fmtAmount(amount: string): string {
  const pence = parsePence(amount);
  if (pence === null) return amount;
  return `£${penceToAmount(Math.abs(pence))}`;
}

/**
 * Build human-readable detail labels for changed entities in a table.
 * Returns labels for created/updated PKs (deleted entities can't be queried).
 */
function buildDetailLabels(
  db: Database.Database,
  table: string,
  pks: { created: Set<string>; updated: Set<string>; deleted: Set<string> },
): ImportChangeDetail[] {
  const total = pks.created.size + pks.updated.size + pks.deleted.size;
  if (total > DETAIL_THRESHOLD) return [];

  const details: ImportChangeDetail[] = [];
  const livePks = [...pks.created, ...pks.updated];

  if (livePks.length > 0) {
    try {
      const placeholders = livePks.map(() => '?').join(',');

      if (table === 'transactions') {
        const rows = db
          .prepare(`SELECT id, description, amount, type, party, date FROM transactions WHERE id IN (${placeholders})`)
          .all(...livePks) as { id: string; description: string; amount: string; type: string; party: string | null; date: string }[];
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const pk of livePks) {
          const r = rowMap.get(pk);
          const action = pks.created.has(pk) ? 'created' as const : 'updated' as const;
          if (r) {
            const partyPart = r.party ? ` · ${r.party}` : '';
            details.push({ action, label: `${fmtAmount(r.amount)} ${r.type} — ${r.description}${partyPart} (${r.date})` });
          } else {
            details.push({ action, label: pk });
          }
        }
      } else if (table === 'planned_templates') {
        const rows = db
          .prepare(`SELECT id, description, amount, type, frequency FROM planned_templates WHERE id IN (${placeholders})`)
          .all(...livePks) as { id: string; description: string; amount: string; type: string; frequency: string }[];
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const pk of livePks) {
          const r = rowMap.get(pk);
          const action = pks.created.has(pk) ? 'created' as const : 'updated' as const;
          if (r) {
            details.push({ action, label: `${fmtAmount(r.amount)} ${r.frequency} ${r.type} — ${r.description}` });
          } else {
            details.push({ action, label: pk });
          }
        }
      } else if (table === 'invoices') {
        const rows = db
          .prepare(`SELECT id, invoice_number, to_name, subtotal FROM invoices WHERE id IN (${placeholders})`)
          .all(...livePks) as { id: string; invoice_number: string; to_name: string; subtotal: string }[];
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const pk of livePks) {
          const r = rowMap.get(pk);
          const action = pks.created.has(pk) ? 'created' as const : 'updated' as const;
          if (r) {
            details.push({ action, label: `Invoice #${r.invoice_number} to ${r.to_name} (${fmtAmount(r.subtotal)})` });
          } else {
            details.push({ action, label: pk });
          }
        }
      } else if (table === 'sheets' || table === 'categories' || table === 'personnel') {
        const rows = db
          .prepare(`SELECT id, name FROM ${table} WHERE id IN (${placeholders})`)
          .all(...livePks) as { id: string; name: string }[];
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const pk of livePks) {
          const r = rowMap.get(pk);
          const action = pks.created.has(pk) ? 'created' as const : 'updated' as const;
          details.push({ action, label: r?.name ?? pk });
        }
      }
      // activity_notes, settings, attachments: skip details — counts only
    } catch {
      // Non-fatal — fall back to count-based display
      return [];
    }
  }

  // Deleted entities: can't query (row gone)
  for (const _pk of pks.deleted) {
    details.push({ action: 'deleted', label: '(deleted)' });
  }

  return details;
}

// ─── Class ──────────────────────────────────────────────────────────

export class SyncOrchestrator {
  private readonly db: Database.Database;
  private readonly syncFolder: string;
  private readonly passphrase: string;
  private readonly deviceId: string;
  private readonly dbPath: string | null;
  private readonly databaseId: string | null;
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
  private readonly outboundBundles: OutboundBundles;
  private readonly deliveryReceipts: DeliveryReceipts;
  private readonly causalHistory: CausalHistory;
  private bindingVerified = false;
  private receiptError: string | null = null;
  private attachmentImportError: string | null = null;
  private attachmentExportError: string | null = null;
  private exportError: string | null = null;
  private importError: string | null = null;
  private watcher: FolderWatcher | null = null;

  // In-memory state (D1)
  private lastExportedVersion = 0;
  private sequenceNumber = 0;
  private siteId: Buffer | null = null;

  // Timers
  private versionPollTimer: ReturnType<typeof setInterval> | null = null;
  private exportDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
  private staleReason: string | null = null;

  constructor(options: SyncOrchestratorOptions) {
    this.db = options.db;
    this.syncFolder = options.syncFolder;
    this.passphrase = options.passphrase;
    this.deviceId = options.deviceId;
    this.dbPath = options.dbPath ?? null;
    this.databaseId = options.databaseId ?? null;
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
    this.outboundBundles = new OutboundBundles(this.db);
    this.deliveryReceipts = new DeliveryReceipts(this.db, this.deviceId);
    this.causalHistory = new CausalHistory(this.db);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Get cr-sqlite site ID
    this.siteId = this.getSiteId();

    // A vanished provider root is an error, never a directory to recreate.
    try {
      this.assertSyncRootUnchanged();
      ensureSyncFolderStructure(this.syncFolder);
    } catch (error) {
      this.exportError = `Sync folder unavailable: ${errorMessage(error)}`;
      this.lastError = this.exportError;
      this.running = false;
      this.setStatus('error');
      this.onError?.(this.lastError);
      return;
    }

    // Load watermarks from settings (D1)
    this.lastExportedVersion = this.loadSettingInt(SETTING_LAST_EXPORTED_VERSION);
    this.sequenceNumber = this.loadSettingInt(SETTING_SEQUENCE_NUMBER);

    this.setStatus('idle');

    // Stage outgoing changes durably before attempting shared-folder delivery.
    this.doExport();

    // Existing ledgers must not ingest snapshots outside the conflict gate.
    // Automatic snapshot application/pruning stays disabled until its coverage
    // and conflict semantics have their own acceptance gates.

    // Initial import scan
    this.doImportAll();

    // Start version poll timer (D2)
    this.versionPollTimer = setInterval(() => this.onVersionPoll(), this.versionPollMs);

    // Start folder watcher
    this.watcher = new FolderWatcher({
      syncFolder: this.syncFolder,
      onBundleDetected: () => this.onBundleDetected(),
      onReconcile: () => {
        if (!this.running) return;
        this.doExport();
        this.doImportAll();
      },
      onError: (msg) => {
        this.importError = msg;
        this.lastError = msg;
        this.onError?.(msg);
        this.setStatus('error');
      },
    });
    this.watcher.start();

    // Start heartbeat timer — write our heartbeat and check peer staleness
    this.onHeartbeatTick();
    this.heartbeatTimer = setInterval(() => this.onHeartbeatTick(), HEARTBEAT_INTERVAL_MS);
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

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
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
    let delivery: LocalSyncDelivery = { folderBound: false, outboundBundles: 0, peers: [] };
    try {
      pendingConflicts = this.conflictQueue.count();
      delivery = this.deliveryReceipts.summary(this.bindingVerified);
    } catch {
      // Database may have been closed during teardown
    }
    return {
      state: this.statusState,
      lastExportAt: this.lastExportAt,
      lastImportAt: this.lastImportAt,
      pendingConflicts,
      lastError: this.lastError,
      staleReason: this.staleReason,
      delivery,
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

      this.siteId ??= this.getSiteId();
      const binding = getFolderBinding(this.db);
      if (!binding) throw new Error('This sync folder needs a reviewed identity upgrade before sending changes.');
      // SQLite serializes competing windows. The ciphertext and its export
      // checkpoint commit together BEFORE any cloud-folder write is attempted.
      const staged = this.db.transaction(() => {
        const version = this.loadSettingInt(SETTING_LAST_EXPORTED_VERSION);
        const sequence = this.loadSettingInt(SETTING_SEQUENCE_NUMBER);
        const currentVersion = this.getCurrentDbVersion();
        const exportable = this.getChangesetsSinceVersion(version)
          .filter((row) => this.isExportableChangeset(row) && !this.causalHistory.hasRevision(row));
        const nextSequence = exportable.length > 0 ? sequence + 1 : sequence;
        if (exportable.length > 0) {
          const observed = this.causalHistory.observedContext();
          const packed = packBundle({
            deviceId: this.deviceId,
            siteId: this.siteId!,
            sequenceNumber: nextSequence,
            schemaVersion: CRR_SCHEMA_VERSION,
            changesets: exportable,
            passphrase: this.passphrase,
            deviceName: this.personName ?? undefined,
            groupId: binding.groupId,
            observedBundles: observed,
          });
          this.outboundBundles.insert(this.deviceId, nextSequence, packed);
          this.causalHistory.record({ deviceId: this.deviceId, sequenceNumber: nextSequence, observed }, exportable, true);
        }
        this.persistSetting(SETTING_LAST_EXPORTED_VERSION, currentVersion);
        this.persistSetting(SETTING_SEQUENCE_NUMBER, nextSequence);
        return { exportable, currentVersion, nextSequence };
      }).immediate();
      this.lastExportedVersion = staged.currentVersion;
      this.sequenceNumber = staged.nextSequence;

      this.assertSyncRootUnchanged();
      for (const bundle of this.outboundBundles.all(this.deviceId)) {
        writeBundleAtomically(this.syncFolder, bundle.device_id, bundle.sequence_number, bundle.payload);
      }
      this.reconcileReceipts();

      // Attachment sync (D7)
      let attachmentCount = 0;
      try {
        // Retry missing files even when their metadata was previously exported.
        attachmentCount = this.exportAllAttachmentFiles();
      } catch (e) {
        syncLog('warn', 'Attachment export error (non-fatal)', { error: errorMessage(e) });
      }

      if (staged.exportable.length > 0) this.lastExportAt = new Date().toISOString();
      this.exportError = null;
      this.setStatus('idle');

      // Extract bundleId from the packed bundle (we need to unpack to get it,
      // but we can compute it from sequence number for the result)
      const bundleId = staged.exportable.length > 0 ? `${this.deviceId}_${this.sequenceNumber}` : null;

      return { bundleId, changesetCount: staged.exportable.length, attachmentCount };
    } catch (e) {
      const msg = errorMessage(e);
      this.exportError = msg;
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
      if (currentVersion > this.lastExportedVersion || this.exportError) {
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
    try {
      // Preserve local edits before an inbound CRDT write can replace their
      // latest-column representation. Delivery may fail; staging must succeed.
      this.siteId ??= this.getSiteId();
      const hasUnstagedChanges = () => this.getChangesetsSinceVersion(
        this.loadSettingInt(SETTING_LAST_EXPORTED_VERSION),
      ).some((row) => this.isExportableChangeset(row));
      if (hasUnstagedChanges()) {
        this.doExport();
        if (hasUnstagedChanges()) {
          throw new Error('Incoming sync is paused until outgoing changes can be saved safely.');
        }
      }
      this.busy = true;

      this.setStatus('importing');
      this.assertSyncRootUnchanged();

      // Scan for new bundles
      const bundles = scanForNewBundles(this.syncFolder, this.deviceId, this.appliedBundles);
      if (bundles.length === 0) {
        this.importNewAttachments();
        this.reconcileReceipts();
        this.importError = null;
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

          if (unpacked.deviceId !== scanned.deviceId || unpacked.sequenceNumber !== scanned.sequenceNumber) {
            throw new Error('Bundle identity does not match its filename; history was preserved for review.');
          }
          if (unpacked.groupId !== getFolderBinding(this.db)?.groupId) {
            throw new Error('Bundle team identity is missing or different. Legacy history requires reviewed recovery.');
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

          // Only legacy/test string keys need conversion; v2 preserves binary keys.
          for (const row of filtered) {
            if (typeof row.pk === 'string') {
              (row as { pk: unknown }).pk = Buffer.from(row.pk, 'utf-8');
            }
          }

          const causalBundle = { deviceId: unpacked.deviceId, sequenceNumber: unpacked.sequenceNumber,
            observed: unpacked.observedBundles ?? {} };
          const mergeResult = classifyChangesets(this.db, filtered, { history: this.causalHistory, incoming: causalBundle });
          // Data, conflict queue and receipt must commit or roll back together.
          this.db.transaction(() => {
            applyMergeResult(this.db, mergeResult, this.conflictQueue, unpacked.bundleId);
            this.appliedBundles.insert(unpacked.bundleId, unpacked.deviceId, unpacked.sequenceNumber, data);
            this.causalHistory.record(causalBundle, filtered, mergeResult.conflicts.length === 0);
            reconcileSupersededConflicts(this.db, this.causalHistory, this.conflictQueue);
            this.deliveryReceipts.recordApplied({
              sourceDeviceId: unpacked.deviceId, sequenceNumber: unpacked.sequenceNumber,
              bundleId: unpacked.bundleId, payloadHash: crypto.createHash('sha256').update(data).digest('hex'),
              conflictsQueued: mergeResult.conflicts.length,
            });
          })();

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
              if (isDeleteChangeset(row)) {
                counts.deleted.add(pkStr);
              } else if (row.cid === '-1' || row.col_version === 1) {
                counts.created.add(pkStr);
                counts.updated.delete(pkStr);
              } else {
                if (!counts.created.has(pkStr)) counts.updated.add(pkStr);
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

      // Imports never advance the outbound checkpoint. Remote-site changes are
      // already excluded by getChangesetsSinceVersion's site_id predicate.
      this.importError = bundlesSkipped > 0
        ? `${bundlesSkipped} sync bundle(s) could not be applied. They will be retried; delivery is incomplete.`
        : null;
      this.reconcileReceipts();

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
            const details = buildDetailLabels(this.db, table, sets);
            changes[table] = {
              created: sets.created.size,
              updated: sets.updated.size,
              deleted: sets.deleted.size,
              ...(details.length > 0 ? { details } : {}),
            };
          }
          // Only include this device if it has any visible changes
          const hasVisibleChanges = Object.values(changes).some(
            (c) => c.created + c.updated + c.deleted > 0,
          );
          if (hasVisibleChanges) {
            summaries.push({ personName, deviceId: devId, changes });
          }
        }
        if (summaries.length > 0) {
          this.onImportSummary({ summaries, isStartupCatchup: this.isStartupImport });
        }
      }

      // After first import, clear startup flag
      this.isStartupImport = false;

      return { bundlesProcessed, changesetsApplied, conflictsQueued, bundlesSkipped, attachmentsImported };
    } catch (e) {
      const msg = errorMessage(e);
      this.importError = msg;
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
      if (unpacked.version !== 2) throw new BundleFormatError('Legacy protocol requires reviewed recovery; upgrade all peers before reconnecting.');

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
    this.assertSyncRootUnchanged();
    if (this.busy) throw new Error('Wait for the current sync operation before creating a snapshot.');
    if (this.conflictQueue.count() > 0) throw new Error('Review outstanding financial conflicts before creating an onboarding snapshot.');
    this.doExport();
    if (this.exportError) throw new Error('Outgoing history must be published safely before creating a snapshot.');
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
    throw new Error('History cleanup is paused until snapshot coverage and peer acknowledgements can be verified. No bundles were deleted.');
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

    return rows;
  }

  /**
   * Check if a changeset row should be included in an export bundle.
   * All non-settings rows pass. Settings rows pass only if the key is org-scoped.
   */
  private isExportableChangeset(row: CrChangesetRow): boolean {
    return isOrgChangeset(row);
  }

  /**
   * Check if an imported changeset row should be applied locally.
   * Same filter as export — only org-scoped settings pass.
   */
  private isImportableChangeset(row: CrChangesetRow): boolean {
    const binding = getFolderBinding(this.db);
    if (!binding) throw new Error('The sync folder needs a reviewed identity upgrade.');
    return isImportableSyncRow(row, binding.groupId);
  }

  // ─── Attachment sync (D7) ──────────────────────────────────────

  /**
   * Import attachment files from remote that we don't have locally.
   * Only imports files where the metadata row exists in our attachments table.
   */
  private importNewAttachments(): number {
    if (!this.databaseId) return 0;

    const attachmentDir = getAttachmentStoragePath(this.databaseId);
    let count = 0;

    const binding = assertFolderBinding(this.db, this.syncFolder);
    const rows = this.db.prepare('SELECT stored_name FROM attachments').all() as { stored_name: string }[];
    let pending = 0;

    for (const { stored_name: storedName } of rows) {
      const localPath = path.join(attachmentDir, storedName);

      // Skip if we already have it
      if (fs.existsSync(localPath)) continue;

      try {
        const ok = readAttachmentFile(this.syncFolder, storedName, localPath, this.passphrase, binding.groupId);
        if (ok) count++;
        else pending++;
      } catch (e) {
        pending++;
        syncLog('warn', 'Failed to import attachment', { storedName, error: errorMessage(e) });
      }
    }

    this.attachmentImportError = pending > 0 ? `${pending} attachment(s) are awaiting verified transfer or legacy migration.` : null;

    return count;
  }

  // ─── Bulk attachment export ──────────────────────────────────

  /**
   * Export ALL local attachment files to the sync shared folder.
   * Used by the recovery handler and optionally after migration.
   * Returns the number of files exported.
   */
  exportAllAttachmentFiles(): number {
    if (!this.databaseId) return 0;
    this.assertSyncRootUnchanged();

    const attachmentDir = getAttachmentStoragePath(this.databaseId);
    const binding = assertFolderBinding(this.db, this.syncFolder);
    let count = 0;
    let failed = 0;

    const rows = this.db
      .prepare('SELECT stored_name FROM attachments')
      .all() as { stored_name: string }[];

    for (const row of rows) {
      if (!row.stored_name) continue;
      const localPath = path.join(attachmentDir, row.stored_name);
      if (!fs.existsSync(localPath)) continue;

      try {
        if (writeAttachmentFile(this.syncFolder, row.stored_name, localPath, this.passphrase, binding.groupId)) count++;
      } catch (e) {
        failed++;
        syncLog('warn', 'Failed to export attachment (bulk)', { storedName: row.stored_name, error: errorMessage(e) });
      }
    }

    this.attachmentExportError = failed > 0 ? `${failed} attachment export(s) need attention. Local originals were preserved.` : null;

    return count;
  }

  // ─── Heartbeat / staleness ─────────────────────────────────────

  private onHeartbeatTick(): void {
    if (!this.running) return;
    try {
      this.assertSyncRootUnchanged();
      writeHeartbeat(this.syncFolder, this.deviceId);
      this.evaluateStaleness().catch((e) => {
        syncLog('warn', 'Staleness evaluation failed', { error: errorMessage(e) });
      });
    } catch (e) {
      syncLog('warn', 'Heartbeat tick failed', { error: errorMessage(e) });
      this.exportError = `Sync folder unavailable: ${errorMessage(e)}`;
      this.lastError = this.exportError;
      this.setStatus('error');
    }
  }

  /**
   * Check whether this device's sync provider is running and whether
   * the network is reachable. Transition to/from 'stale' as appropriate.
   *
   * Two signals trigger stale:
   * 1. Sync provider process not running (OneDrive, Dropbox, etc.)
   * 2. No internet connectivity (DNS lookup fails)
   *
   * Peer heartbeat staleness is NOT used because teammates may simply
   * not have Fidra open, which is normal and not an indication of a
   * sync problem.
   */
  private async evaluateStaleness(): Promise<void> {
    const providerDown = !isSyncProviderRunning(this.syncFolder);

    if (providerDown) {
      this.staleReason = 'sync provider not running';
      if (this.statusState === 'idle' || this.statusState === 'stale') {
        this.statusState = 'stale';
        this.onStatusChanged?.(this.getStatus());
      }
      return;
    }

    // Provider is running — check network reachability
    const networkUp = await isNetworkReachable();

    if (!networkUp) {
      this.staleReason = 'no internet connection';
      if (this.statusState === 'idle' || this.statusState === 'stale') {
        this.statusState = 'stale';
        this.onStatusChanged?.(this.getStatus());
      }
      return;
    }

    // Everything healthy — clear stale if previously set
    if (this.statusState === 'stale') {
      this.staleReason = null;
      this.statusState = 'idle';
      this.onStatusChanged?.(this.getStatus());
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private assertSyncRootUnchanged(): void {
    this.bindingVerified = false;
    assertFolderBinding(this.db, this.syncFolder);
    this.bindingVerified = true;
  }

  private reconcileReceipts(): void {
    try {
      this.assertSyncRootUnchanged();
      const binding = assertFolderBinding(this.db, this.syncFolder);
      this.deliveryReceipts.publish(this.syncFolder, this.passphrase, binding);
      const rejected = this.deliveryReceipts.scan(this.syncFolder, this.passphrase, binding);
      this.receiptError = rejected > 0 ? `${rejected} delivery receipt(s) could not be verified. They will be retried.` : null;
    } catch (error) {
      this.receiptError = `Delivery receipts pending: ${errorMessage(error)}`;
    }
  }

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
    this.lastError = this.exportError ?? this.importError ?? this.receiptError ?? this.attachmentExportError ?? this.attachmentImportError;
    if (state === 'idle') {
      if (this.lastError) {
        this.statusState = 'error';
        this.onStatusChanged?.(this.getStatus());
        return;
      }
      // Before confirming idle, check if we should be stale instead
      try {
        if (!isSyncProviderRunning(this.syncFolder)) {
          state = 'stale';
        }
      } catch {
        // Non-fatal — default to idle
      }
    }
    this.statusState = state;
    this.onStatusChanged?.(this.getStatus());
  }
}
