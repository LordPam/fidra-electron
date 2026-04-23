/**
 * Background sync service for cloud synchronization.
 *
 * Processes pending changes from the sync queue and syncs them to the cloud.
 * Handles conflicts, retries, and offline/online transitions.
 *
 * Port of Python's sync_service.py.
 */

import type { TransactionRow, PlannedTemplateRow, SheetRow, AttachmentRow, InvoiceRow, AuditLogRow } from '../../shared/ipc-types';
import type { SyncQueue, PendingChange, SyncOperation } from './sync-queue';
import type {
  CachingTransactionRepo,
  CachingPlannedRepo,
  CachingSheetRepo,
  CachingCategoryRepo,
  CachingActivityNotesRepo,
  CachingAttachmentRepo,
  CachingInvoiceRepo,
  CachingAuditRepo,
} from './caching-repos';
import type { ConnectionStateProvider } from './connection-state';
import { classifyError, ErrorCategory } from './cloud-connection';
import { EntityDeletedError } from './errors';

export type ConflictStrategy = 'ask_user' | 'last_write_wins' | 'server_wins' | 'client_wins';

export class SyncService {
  private _isSyncing = false;
  private _running = false;
  private _lastPendingCount = 0;
  private _maxRetries = 10;
  private _syncTimer: ReturnType<typeof setInterval> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks for IPC events
  onSyncStarted: (() => void) | null = null;
  onSyncCompleted: ((count: number) => void) | null = null;
  onSyncFailed: ((error: string) => void) | null = null;
  onPendingCountChanged: ((count: number) => void) | null = null;
  onConflictDetected: ((changeId: string, local: unknown, server: unknown) => void) | null = null;

  constructor(
    private readonly queue: SyncQueue,
    private readonly transactionRepo: CachingTransactionRepo,
    private readonly plannedRepo: CachingPlannedRepo,
    private readonly sheetRepo: CachingSheetRepo,
    private readonly categoryRepo: CachingCategoryRepo,
    private readonly connectionState: ConnectionStateProvider,
    private readonly activityNotesRepo: CachingActivityNotesRepo | null = null,
    private readonly attachmentRepo: CachingAttachmentRepo | null = null,
    private readonly invoiceRepo: CachingInvoiceRepo | null = null,
    private readonly auditRepo: CachingAuditRepo | null = null,
    private readonly conflictStrategy: ConflictStrategy = 'ask_user',
    private readonly syncIntervalMs: number = 30_000,
  ) {}

  start(): void {
    if (this._running) return;
    this._running = true;

    // Safety-net timer: periodic sync in case event-driven triggers are missed
    this._syncTimer = setInterval(() => this.onSyncTimer(), this.syncIntervalMs);

    // Register for event-driven sync: queue notifies us immediately on changes
    this.queue.onChange = () => this.onQueueChanged();

    console.log(`[SYNC] Service started (interval: ${this.syncIntervalMs}ms)`);
  }

  stop(): void {
    this._running = false;
    this.queue.onChange = null;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    console.log('[SYNC] Service stopped');
  }

  get isSyncing(): boolean {
    return this._isSyncing;
  }

  private onQueueChanged(): void {
    if (!this._running) return;
    // Debounce: batch rapid changes into a single sync ~1s after last change
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (this._running && this.connectionState.isConnected && !this._isSyncing) {
        this.syncNow().catch((e) => console.error('[SYNC] Error:', e instanceof Error ? e.message : String(e)));
      }
    }, 1000);
  }

  private onSyncTimer(): void {
    if (!this._running) return;
    if (this.connectionState.isConnected && !this._isSyncing) {
      this.syncNow().catch((e) => console.error('[SYNC] Error:', e instanceof Error ? e.message : String(e)));
    }
  }

  async syncNow(): Promise<number> {
    if (!this._running) return 0;
    if (this._isSyncing) return 0;
    if (!this.connectionState.isConnected) return 0;

    this._isSyncing = true;
    this.onSyncStarted?.();

    try {
      const syncedCount = await this.processPendingChanges();
      if (syncedCount > 0) {
        console.log(`[SYNC] Synced ${syncedCount} changes`);
      }
      this.onSyncCompleted?.(syncedCount);
      return syncedCount;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[SYNC] Failed: ${msg}`);
      this.onSyncFailed?.(msg);
      return 0;
    } finally {
      this._isSyncing = false;
      this.updatePendingCount();
    }
  }

  private async processPendingChanges(): Promise<number> {
    const pending = this.queue.getPending();
    if (pending.length === 0) return 0;

    console.log(`[SYNC] Processing ${pending.length} pending changes...`);
    let synced = 0;

    for (const change of pending) {
      if (!this._running) break;
      try {
        this.queue.markProcessing(change.id);
        await this.syncChange(change);
        this.queue.dequeue(change.id);
        synced++;
      } catch (e) {
        await this.handleSyncError(change, e);
        // Stop on transient errors — no point burning retries when network is down
        const category = classifyError(e);
        if (category === ErrorCategory.TRANSIENT) {
          console.log('[SYNC] Stopping batch — transient error, will retry next cycle');
          break;
        }
      }
    }

    return synced;
  }

  private async syncChange(change: PendingChange): Promise<void> {
    switch (change.entity_type) {
      case 'transaction':
        return this.syncTransaction(change);
      case 'planned_template':
        return this.syncPlanned(change);
      case 'sheet':
        return this.syncSheet(change);
      case 'category':
        return this.syncCategory(change);
      case 'activity_note':
        return this.syncActivityNote(change);
      case 'attachment':
        return this.syncAttachment(change);
      case 'invoice':
        return this.syncInvoice(change);
      case 'audit_log':
        return this.syncAuditLog(change);
      default:
        console.warn(`[SYNC] Unknown entity type: ${change.entity_type}`);
    }
  }

  private async syncTransaction(change: PendingChange): Promise<void> {
    if (change.operation === 'delete') {
      if (change.local_version > 0) {
        await this.transactionRepo.deleteFromCloudVersioned(change.entity_id, change.local_version);
      } else {
        await this.transactionRepo.deleteFromCloud(change.entity_id);
      }
    } else {
      const data = JSON.parse(change.payload) as TransactionRow;
      // For 'create' operations: entity was never on the server, even if local
      // version > 1 (edited before first sync). Normalise to version 1 so the
      // cloud repo inserts instead of misinterpreting as a server-side deletion.
      const toSync = change.operation === 'create' && data.version > 1
        ? { ...data, version: 1 }
        : data;
      const result = await this.transactionRepo.syncToCloud(toSync);
      // Only write back if the user hasn't made further edits during the network call.
      // A newer pending entry means the user's edit would be briefly reverted.
      if (!this.queue.getPendingForEntity(change.entity_id)) {
        this.transactionRepo.saveLocal(result);
      }
    }
  }

  private async syncPlanned(change: PendingChange): Promise<void> {
    if (change.operation === 'delete') {
      if (change.local_version > 0) {
        await this.plannedRepo.deleteFromCloudVersioned(change.entity_id, change.local_version);
      } else {
        await this.plannedRepo.deleteFromCloud(change.entity_id);
      }
    } else {
      const data = JSON.parse(change.payload) as PlannedTemplateRow;
      const toSync = change.operation === 'create' && data.version > 1
        ? { ...data, version: 1 }
        : data;
      const result = await this.plannedRepo.syncToCloud(toSync);
      if (!this.queue.getPendingForEntity(change.entity_id)) {
        this.plannedRepo.saveLocal(result);
      }
    }
  }

  private async syncSheet(change: PendingChange): Promise<void> {
    if (change.operation === 'rename_sheet') {
      const { oldName, newName } = JSON.parse(change.payload) as { oldName: string; newName: string };
      await this.sheetRepo.renameSheetCloud(oldName, newName);
      return;
    }

    if (change.operation === 'merge_sheet') {
      const { sourceId, sourceName, targetName } = JSON.parse(change.payload) as {
        sourceId: string; sourceName: string; targetName: string;
      };
      await this.sheetRepo.mergeAndDeleteCloud(sourceId, sourceName, targetName);
      return;
    }

    if (change.operation === 'delete_sheet_cascade') {
      const { id, name } = JSON.parse(change.payload) as { id: string; name: string };
      await this.sheetRepo.deleteWithTransactionsCloud(id, name);
      return;
    }

    if (change.operation === 'delete') {
      await this.sheetRepo.deleteFromCloud(change.entity_id);
    } else {
      const data = JSON.parse(change.payload) as SheetRow;
      const result = await this.sheetRepo.syncToCloud(data);
      if (!this.queue.getPendingForEntity(change.entity_id)) {
        this.sheetRepo.saveLocal(result);
      }
    }
  }

  private async syncCategory(change: PendingChange): Promise<void> {
    const data = JSON.parse(change.payload) as {
      action: string;
      type: string;
      names?: string[];
    };

    if (data.action === 'set_all' && data.names) {
      await this.categoryRepo.syncCategorySetAll(data.type, data.names);
    }
  }

  private async syncActivityNote(change: PendingChange): Promise<void> {
    if (!this.activityNotesRepo) {
      console.warn('[SYNC] Activity notes repo not available');
      return;
    }

    const data = JSON.parse(change.payload) as {
      action: string;
      activity: string;
      notes?: string;
    };

    if (data.action === 'save') {
      await this.activityNotesRepo.syncActivityNoteSave(data.activity, data.notes ?? '');
    } else if (data.action === 'delete') {
      await this.activityNotesRepo.syncActivityNoteDelete(data.activity);
    }
  }

  private async syncAttachment(change: PendingChange): Promise<void> {
    if (!this.attachmentRepo) {
      console.warn('[SYNC] Attachment repo not available');
      return;
    }

    if (change.operation === 'delete') {
      await this.attachmentRepo.deleteFromCloud(change.entity_id);
    } else {
      const data = JSON.parse(change.payload) as AttachmentRow;
      const result = await this.attachmentRepo.syncToCloud(data);
      if (!this.queue.getPendingForEntity(change.entity_id)) {
        this.attachmentRepo.saveLocal(result);
      }
    }
  }

  private async syncInvoice(change: PendingChange): Promise<void> {
    if (!this.invoiceRepo) {
      console.warn('[SYNC] Invoice repo not available');
      return;
    }

    if (change.operation === 'delete') {
      await this.invoiceRepo.deleteFromCloud(change.entity_id);
    } else {
      const data = JSON.parse(change.payload) as InvoiceRow;
      const result = await this.invoiceRepo.syncToCloud(data);
      if (!this.queue.getPendingForEntity(change.entity_id)) {
        this.invoiceRepo.saveLocal(result);
      }
    }
  }

  private async syncAuditLog(change: PendingChange): Promise<void> {
    if (!this.auditRepo) {
      console.warn('[SYNC] Audit repo not available');
      return;
    }
    // Audit entries are append-only — no deletes
    const data = JSON.parse(change.payload) as AuditLogRow;
    await this.auditRepo.syncToCloud(data);
  }

  // ─── Error Handling ───────────────────────────────────────────────

  private async handleSyncError(change: PendingChange, error: unknown): Promise<void> {
    // Entity deleted on server — accept deletion locally
    if (error instanceof EntityDeletedError) {
      console.log(`[SYNC] Entity ${change.entity_id} deleted on server, removing locally`);
      this.queue.dequeue(change.id);
      if (change.entity_type === 'transaction') {
        this.transactionRepo.removeLocal(change.entity_id);
      } else if (change.entity_type === 'planned_template') {
        this.plannedRepo.removeLocal(change.entity_id);
      } else if (change.entity_type === 'sheet') {
        this.sheetRepo.removeLocal(change.entity_id);
      } else if (change.entity_type === 'invoice') {
        this.invoiceRepo?.removeLocal(change.entity_id);
      }
      return;
    }

    const category = classifyError(error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (category === ErrorCategory.CONFLICT) {
      await this.handleConflict(change, errorMsg);
    } else if (category === ErrorCategory.TRANSIENT) {
      if (change.retry_count >= this._maxRetries) {
        this.queue.markConflict(
          change.id,
          `Max retries (${this._maxRetries}) exceeded: ${errorMsg}`,
        );
        console.error(`[SYNC] Change ${change.entity_id} exceeded max retries, escalated to conflict`);
        return;
      }
      this.queue.markFailed(change.id, errorMsg);
      this.connectionState.reportNetworkError();
    } else {
      // Permanent error
      this.queue.markConflict(change.id, errorMsg);
      console.error(`[SYNC] Permanent error for ${change.entity_id}: ${errorMsg}`);
    }
  }

  private async handleConflict(change: PendingChange, errorMsg: string): Promise<void> {
    console.warn(`[SYNC] Conflict detected for ${change.entity_type} ${change.entity_id}`);

    // Check for phantom conflict (identical content, only version differs)
    const serverEntity = await this.fetchServerEntity(change);
    if (serverEntity && this.isSameContent(change, serverEntity)) {
      console.log(`[SYNC] Phantom conflict for ${change.entity_id} — content identical, auto-resolving`);
      this.queue.dequeue(change.id);
      await this.refreshEntity(change.entity_type);
      return;
    }

    switch (this.conflictStrategy) {
      case 'server_wins':
        this.queue.dequeue(change.id);
        await this.refreshEntity(change.entity_type);
        break;

      case 'client_wins':
        await this.forcePush(change);
        break;

      case 'last_write_wins':
        await this.resolveByTimestamp(change);
        break;

      case 'ask_user':
        this.queue.markConflict(change.id, errorMsg);
        if (!serverEntity) {
          // Can't show comparison without server entity — fall back to server wins
          console.warn(`[SYNC] Cannot fetch server entity for conflict ${change.entity_id}, discarding local`);
          this.queue.dequeue(change.id);
          await this.refreshEntity(change.entity_type);
          return;
        }
        this.onConflictDetected?.(
          change.id,
          JSON.parse(change.payload),
          serverEntity,
        );
        break;
    }
  }

  private async refreshEntity(entityType: string): Promise<void> {
    if (entityType === 'transaction') {
      await this.transactionRepo.refreshFromCloud();
    } else if (entityType === 'planned_template') {
      await this.plannedRepo.refreshFromCloud();
    } else if (entityType === 'sheet') {
      await this.sheetRepo.refreshFromCloud();
    } else if (entityType === 'invoice') {
      await this.invoiceRepo?.refreshFromCloud();
    } else if (entityType === 'audit_log') {
      await this.auditRepo?.refreshFromCloud();
    }
  }

  private async forcePush(change: PendingChange): Promise<void> {
    const data = JSON.parse(change.payload);

    if (change.entity_type === 'transaction') {
      const currentVersion = await this.transactionRepo.getCloudVersion(change.entity_id);
      data.version = (currentVersion ?? 0) + 1;
      const result = await this.transactionRepo.syncToCloud(data as TransactionRow);
      this.transactionRepo.saveLocal(result);
    } else if (change.entity_type === 'planned_template') {
      const server = await this.plannedRepo.getCloudById(change.entity_id);
      data.version = (server?.version ?? 0) + 1;
      const result = await this.plannedRepo.syncToCloud(data as PlannedTemplateRow);
      this.plannedRepo.saveLocal(result);
    } else if (change.entity_type === 'sheet') {
      const result = await this.sheetRepo.syncToCloud(data as SheetRow);
      this.sheetRepo.saveLocal(result);
    } else if (change.entity_type === 'invoice' && this.invoiceRepo) {
      const currentVersion = await this.invoiceRepo.getCloudVersion(change.entity_id);
      data.version = (currentVersion ?? 0) + 1;
      const result = await this.invoiceRepo.syncToCloud(data as InvoiceRow);
      this.invoiceRepo.saveLocal(result);
    }

    this.queue.dequeue(change.id);
  }

  private async resolveByTimestamp(change: PendingChange): Promise<void> {
    const serverEntity = await this.fetchServerEntity(change);
    if (!serverEntity) {
      await this.forcePush(change);
      return;
    }

    const localData = JSON.parse(change.payload);
    const localModified = localData.modified_at || localData.created_at;
    const serverModified = (serverEntity as unknown as Record<string, unknown>).modified_at ||
                           (serverEntity as unknown as Record<string, unknown>).created_at;

    if (localModified && serverModified) {
      const localTime = new Date(localModified as string).getTime();
      const serverTime = new Date(serverModified as string).getTime();

      if (localTime > serverTime) {
        await this.forcePush(change);
      } else {
        this.queue.dequeue(change.id);
        await this.refreshEntity(change.entity_type);
      }
    } else {
      // Can't compare timestamps — use server version
      this.queue.dequeue(change.id);
      await this.refreshEntity(change.entity_type);
    }
  }

  private async fetchServerEntity(change: PendingChange): Promise<TransactionRow | PlannedTemplateRow | SheetRow | InvoiceRow | null> {
    try {
      if (change.entity_type === 'transaction') {
        return await this.transactionRepo.getCloudById(change.entity_id);
      } else if (change.entity_type === 'planned_template') {
        return await this.plannedRepo.getCloudById(change.entity_id);
      } else if (change.entity_type === 'sheet') {
        return await this.sheetRepo.getCloudById(change.entity_id);
      } else if (change.entity_type === 'invoice' && this.invoiceRepo) {
        return await this.invoiceRepo.getCloudById(change.entity_id);
      }
    } catch {
      return null;
    }
    return null;
  }

  private isSameContent(change: PendingChange, serverEntity: TransactionRow | PlannedTemplateRow | SheetRow | InvoiceRow): boolean {
    try {
      const data = JSON.parse(change.payload) as Record<string, unknown>;
      const server = serverEntity as unknown as Record<string, unknown>;

      if (change.entity_type === 'transaction') {
        const fields = [
          'description', 'amount', 'type', 'status', 'sheet',
          'category', 'party', 'notes', 'reference', 'activity',
        ];
        for (const field of fields) {
          const localVal = String(data[field] ?? '');
          const serverVal = String(server[field] ?? '');
          if (field === 'amount') {
            if (parseFloat(localVal) !== parseFloat(serverVal)) return false;
            continue;
          }
          if (localVal !== serverVal) return false;
        }
        // Compare date
        const localDate = String(data.date ?? '').substring(0, 10);
        const serverDate = String(server.date ?? '').substring(0, 10);
        return localDate === serverDate;
      }

      if (change.entity_type === 'planned_template') {
        const fields = [
          'description', 'amount', 'type', 'frequency',
          'target_sheet', 'category', 'party', 'activity',
        ];
        for (const field of fields) {
          const localVal = String(data[field] ?? '');
          const serverVal = String(server[field] ?? '');
          if (field === 'amount') {
            if (parseFloat(localVal) !== parseFloat(serverVal)) return false;
            continue;
          }
          if (localVal !== serverVal) return false;
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  // ─── Conflict Resolution (called by IPC) ─────────────────────────

  async resolveConflictWithChoice(changeId: string, useLocal: boolean): Promise<void> {
    if (useLocal) {
      const change = this.queue.getById(changeId);
      if (change) {
        await this.forcePush(change);
      }
    } else {
      const change = this.queue.getById(changeId);
      this.queue.resolveConflict(changeId, false);
      if (change) {
        await this.refreshEntity(change.entity_type);
      }
    }
  }

  // ─── Pending Count ────────────────────────────────────────────────

  private updatePendingCount(): void {
    const count = this.queue.getPendingCount();
    if (count !== this._lastPendingCount) {
      this._lastPendingCount = count;
      this.onPendingCountChanged?.(count);
    }
  }

  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  getConflicts(): PendingChange[] {
    return this.queue.getConflicts();
  }
}
