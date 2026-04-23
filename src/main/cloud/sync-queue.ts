import type Database from 'better-sqlite3';

export type SyncStatus = 'pending' | 'processing' | 'conflict' | 'failed';
export type SyncOperation = 'create' | 'update' | 'delete' | 'rename_sheet' | 'merge_sheet' | 'delete_sheet_cascade';

export interface PendingChange {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  payload: string;
  local_version: number;
  created_at: string;
  retry_count: number;
  last_error: string | null;
  status: SyncStatus;
}

type ChangeCallback = () => void;

export class SyncQueue {
  onChange: ChangeCallback | null = null;

  constructor(private readonly db: Database.Database) {}

  private get isOpen(): boolean {
    return this.db.open;
  }

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        local_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        status TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
    `);
  }

  recoverStuckProcessing(): number {
    const result = this.db.prepare(
      "UPDATE sync_queue SET status = 'pending' WHERE status = 'processing'",
    ).run();
    if (result.changes > 0) {
      console.log(`Recovered ${result.changes} stuck processing sync items`);
    }
    return result.changes;
  }

  enqueue(change: PendingChange): void {
    this.db.prepare(
      `INSERT INTO sync_queue
       (id, entity_type, entity_id, operation, payload, local_version,
        created_at, retry_count, last_error, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      change.id, change.entity_type, change.entity_id, change.operation,
      change.payload, change.local_version, change.created_at,
      change.retry_count, change.last_error, change.status,
    );
    this.onChange?.();
  }

  enqueueSave(entityType: string, entityId: string, payload: string, version: number): void {
    const existing = this.getPendingForEntity(entityId);

    if (existing) {
      // If a 'delete' entry exists and we're now saving (e.g. undo restore),
      // transition the operation to 'create' since the entity needs to exist
      // on the server again. Using 'create' works for both cases:
      //  - Entity still on server: INSERT ON CONFLICT DO UPDATE handles it
      //  - Entity already deleted from server: INSERT creates it fresh
      const operation = existing.operation === 'delete' ? 'create' : existing.operation;
      this.db.prepare(
        `UPDATE sync_queue
         SET payload = ?, local_version = ?, status = 'pending',
             retry_count = 0, last_error = NULL, operation = ?
         WHERE entity_id = ? AND entity_type = ?`,
      ).run(payload, version, operation, entityId, entityType);
      this.onChange?.();
    } else {
      const operation: SyncOperation = version === 1 ? 'create' : 'update';
      this.enqueue({
        id: crypto.randomUUID(),
        entity_type: entityType,
        entity_id: entityId,
        operation,
        payload,
        local_version: version,
        created_at: new Date().toISOString(),
        retry_count: 0,
        last_error: null,
        status: 'pending',
      });
    }
  }

  enqueueDelete(entityType: string, entityId: string, version: number = 0): void {
    const existing = this.getPendingForEntity(entityId);
    const wasOnlyLocal = existing?.operation === 'create';

    this.db.prepare(
      "DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = ? AND operation != 'delete'",
    ).run(entityId, entityType);

    if (wasOnlyLocal) {
      this.onChange?.();
      return;
    }

    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: entityType,
      entity_id: entityId,
      operation: 'delete',
      payload: '{}',
      local_version: version,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueCategorySetAll(type: string, names: string[]): void {
    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'category',
      entity_id: crypto.randomUUID(),
      operation: 'update',
      payload: JSON.stringify({ names, type, action: 'set_all' }),
      local_version: 1,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueActivityNoteSave(activity: string, notes: string): void {
    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'activity_note',
      entity_id: crypto.randomUUID(),
      operation: 'update',
      payload: JSON.stringify({ activity, notes, action: 'save' }),
      local_version: 1,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueRenameSheet(sheetId: string, oldName: string, newName: string): void {
    // Remove any pending simple save for this sheet — the rename supersedes it
    this.db.prepare(
      "DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'sheet'",
    ).run(sheetId);

    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'sheet',
      entity_id: sheetId,
      operation: 'rename_sheet',
      payload: JSON.stringify({ oldName, newName }),
      local_version: 0,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueMergeSheet(sourceId: string, sourceName: string, targetName: string): void {
    this.db.prepare(
      "DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'sheet'",
    ).run(sourceId);

    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'sheet',
      entity_id: sourceId,
      operation: 'merge_sheet',
      payload: JSON.stringify({ sourceId, sourceName, targetName }),
      local_version: 0,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueDeleteSheetCascade(sheetId: string, sheetName: string): void {
    this.db.prepare(
      "DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'sheet'",
    ).run(sheetId);

    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'sheet',
      entity_id: sheetId,
      operation: 'delete_sheet_cascade',
      payload: JSON.stringify({ id: sheetId, name: sheetName }),
      local_version: 0,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  enqueueActivityNoteDelete(activity: string): void {
    this.enqueue({
      id: crypto.randomUUID(),
      entity_type: 'activity_note',
      entity_id: crypto.randomUUID(),
      operation: 'delete',
      payload: JSON.stringify({ activity, action: 'delete' }),
      local_version: 1,
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      status: 'pending',
    });
  }

  dequeue(id: string): void {
    this.db.prepare('DELETE FROM sync_queue WHERE id = ?').run(id);
  }

  getPending(limit: number = 100): PendingChange[] {
    if (!this.isOpen) return [];
    return this.db.prepare(
      `SELECT * FROM sync_queue WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT ?`,
    ).all(limit) as PendingChange[];
  }

  getPendingCount(): number {
    if (!this.isOpen) return 0;
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'",
    ).get() as { count: number };
    return row.count;
  }

  /** Snapshot all entity IDs with pending/processing entries. Used by refreshFromCloud to
   *  protect local records from deletion even if the sync service dequeues them mid-flight. */
  getPendingEntityIds(): Set<string> {
    const rows = this.db.prepare(
      "SELECT DISTINCT entity_id FROM sync_queue WHERE status IN ('pending', 'processing')",
    ).all() as { entity_id: string }[];
    return new Set(rows.map((r) => r.entity_id));
  }

  getPendingForEntity(entityId: string): PendingChange | null {
    const row = this.db.prepare(
      `SELECT * FROM sync_queue WHERE entity_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(entityId) as PendingChange | undefined;
    return row ?? null;
  }

  hasPendingForType(entityType: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM sync_queue WHERE entity_type = ? AND status IN ('pending', 'processing') LIMIT 1",
    ).get(entityType);
    return row != null;
  }

  getById(changeId: string): PendingChange | null {
    const row = this.db.prepare('SELECT * FROM sync_queue WHERE id = ?').get(changeId) as PendingChange | undefined;
    return row ?? null;
  }

  markProcessing(id: string): void {
    this.db.prepare("UPDATE sync_queue SET status = 'processing' WHERE id = ?").run(id);
  }

  markConflict(id: string, error: string): void {
    this.db.prepare(
      "UPDATE sync_queue SET status = 'conflict', last_error = ? WHERE id = ?",
    ).run(error, id);
  }

  markFailed(id: string, error: string): void {
    this.db.prepare(
      "UPDATE sync_queue SET status = 'pending', retry_count = retry_count + 1, last_error = ? WHERE id = ?",
    ).run(error, id);
  }

  getConflicts(): PendingChange[] {
    return this.db.prepare(
      "SELECT * FROM sync_queue WHERE status = 'conflict' ORDER BY created_at ASC",
    ).all() as PendingChange[];
  }

  resolveConflict(id: string, useLocal: boolean): void {
    if (useLocal) {
      this.db.prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE id = ?",
      ).run(id);
    } else {
      this.dequeue(id);
    }
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM sync_queue').run();
  }
}
