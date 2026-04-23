/**
 * SQLite-backed conflict queue for Local Sync.
 *
 * Stores critical-field conflicts that require manual review before
 * they can be resolved. The `sync_conflicts` table is local-only —
 * it is NOT a CRR and is never synced.
 */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncConflict {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  local_value: string | null;
  remote_value: string | null;
  local_site_id: string;
  remote_site_id: string;
  local_version: number;
  remote_version: number;
  bundle_id: string;
  changeset_json: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export type ConflictResolution = 'keep-local' | 'accept-remote' | 'manual';

export interface InsertConflictParams {
  entity_type: string;
  entity_id: string;
  field_name: string;
  local_value: string | null;
  remote_value: string | null;
  local_site_id: string;
  remote_site_id: string;
  local_version: number;
  remote_version: number;
  bundle_id: string;
  /** JSON-serialized CrChangesetRow — needed to apply "accept remote" resolution. */
  changeset_json: string;
}

// ─── Table DDL ──────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    local_value TEXT,
    remote_value TEXT,
    local_site_id TEXT NOT NULL,
    remote_site_id TEXT NOT NULL,
    local_version INTEGER NOT NULL,
    remote_version INTEGER NOT NULL,
    bundle_id TEXT NOT NULL,
    changeset_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT
  )
`;

// ─── Class ──────────────────────────────────────────────────────────

export class ConflictQueue {
  constructor(private readonly db: Database.Database) {
    this.db.exec(CREATE_TABLE_SQL);
    // Migration: add changeset_json column if missing (added for end-to-end resolution)
    const cols = this.db.pragma('table_info(sync_conflicts)') as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === 'changeset_json')) {
      this.db.exec('ALTER TABLE sync_conflicts ADD COLUMN changeset_json TEXT');
    }
  }

  /** Insert a new conflict into the queue. Returns the generated id. */
  insert(params: InsertConflictParams): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sync_conflicts
         (id, entity_type, entity_id, field_name,
          local_value, remote_value,
          local_site_id, remote_site_id,
          local_version, remote_version,
          bundle_id, changeset_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.entity_type,
        params.entity_id,
        params.field_name,
        params.local_value,
        params.remote_value,
        params.local_site_id,
        params.remote_site_id,
        params.local_version,
        params.remote_version,
        params.bundle_id,
        params.changeset_json,
        now,
      );
    return id;
  }

  /** Get all unresolved conflicts, ordered by creation time. */
  getUnresolved(): SyncConflict[] {
    return this.db
      .prepare(
        `SELECT * FROM sync_conflicts
         WHERE resolved_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all() as SyncConflict[];
  }

  /** Get all conflicts (resolved and unresolved) for a specific entity. */
  getByEntityId(entityId: string): SyncConflict[] {
    return this.db
      .prepare(
        `SELECT * FROM sync_conflicts
         WHERE entity_id = ?
         ORDER BY created_at ASC`,
      )
      .all(entityId) as SyncConflict[];
  }

  /** Resolve a conflict by setting its resolution and timestamp. */
  resolve(id: string, resolution: ConflictResolution): boolean {
    const result = this.db
      .prepare(
        `UPDATE sync_conflicts
         SET resolved_at = ?, resolution = ?
         WHERE id = ? AND resolved_at IS NULL`,
      )
      .run(new Date().toISOString(), resolution, id);
    return result.changes > 0;
  }

  /** Get a single conflict by ID. */
  getById(id: string): SyncConflict | null {
    const row = this.db
      .prepare('SELECT * FROM sync_conflicts WHERE id = ?')
      .get(id) as SyncConflict | undefined;
    return row ?? null;
  }

  /** Count of unresolved conflicts. */
  count(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM sync_conflicts
         WHERE resolved_at IS NULL`,
      )
      .get() as { cnt: number };
    return row.cnt;
  }

  /** Remove all resolved conflicts. */
  clear(): number {
    const result = this.db
      .prepare(`DELETE FROM sync_conflicts WHERE resolved_at IS NOT NULL`)
      .run();
    return result.changes;
  }
}
