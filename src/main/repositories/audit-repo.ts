import type Database from 'better-sqlite3';
import type { AuditLogRow } from '../../shared/ipc-types';

export class AuditRepo {
  constructor(private readonly db: Database.Database) {}

  log(entry: AuditLogRow): void {
    this.db.prepare(
      `INSERT INTO audit_log (id, timestamp, action, entity_type, entity_id, user, summary, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id, entry.timestamp, entry.action, entry.entity_type,
      entry.entity_id, entry.user, entry.summary, entry.details,
    );
  }

  getAll(entityType?: string, limit = 500): AuditLogRow[] {
    if (entityType) {
      return this.db
        .prepare('SELECT * FROM audit_log WHERE entity_type = ? ORDER BY timestamp DESC LIMIT ?')
        .all(entityType, limit) as AuditLogRow[];
    }
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as AuditLogRow[];
  }

  getForEntity(entityId: string): AuditLogRow[] {
    return this.db
      .prepare('SELECT * FROM audit_log WHERE entity_id = ? ORDER BY timestamp DESC')
      .all(entityId) as AuditLogRow[];
  }

  purgeOlderThan(cutoff: string): number {
    const result = this.db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
    return result.changes;
  }
}
