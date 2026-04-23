import type pg from 'pg';
import type { AuditLogRow } from '../../../shared/ipc-types';
import type { CloudConnection } from '../cloud-connection';
import type { CloudAuditRepo } from './cloud-repo-interfaces';
import { toISOString } from './pg-utils';

export class PgAuditRepo implements CloudAuditRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async save(entry: AuditLogRow): Promise<AuditLogRow> {
    await this.pool.query(
      `INSERT INTO audit_log (id, timestamp, action, entity_type, entity_id, "user", summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id, entry.timestamp, entry.action, entry.entity_type,
        entry.entity_id, entry.user, entry.summary, entry.details,
      ],
    );
    return entry;
  }

  async getAll(): Promise<AuditLogRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_log ORDER BY timestamp DESC',
    );
    return rows.map(rowToAudit);
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM audit_log WHERE timestamp < $1',
      [cutoff],
    );
    return result.rowCount ?? 0;
  }
}

function rowToAudit(row: Record<string, unknown>): AuditLogRow {
  return {
    id: String(row.id),
    timestamp: toISOString(row.timestamp),
    action: String(row.action) as AuditLogRow['action'],
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    user: String(row.user),
    summary: String(row.summary),
    details: row.details != null ? String(row.details) : null,
  };
}
