import type pg from 'pg';
import type { AttachmentRow } from '../../../shared/ipc-types';
import type { CloudConnection } from '../cloud-connection';
import type { CloudAttachmentRepo } from './cloud-repo-interfaces';
import { toISOString } from './pg-utils';

export class PgAttachmentRepo implements CloudAttachmentRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(): Promise<AttachmentRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM attachments ORDER BY created_at DESC',
    );
    console.log(`[PG-ATTACHMENTS] getAll: ${rows.length} rows from Postgres`);
    if (rows.length > 0) {
      console.log('[PG-ATTACHMENTS] Raw first row:', JSON.stringify(rows[0], (_k, v) => v instanceof Date ? v.toISOString() : v));
    }
    return rows.map(rowToAttachment);
  }

  async getForTransaction(transactionId: string): Promise<AttachmentRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM attachments WHERE transaction_id = $1 ORDER BY created_at DESC',
      [transactionId],
    );
    return rows.map(rowToAttachment);
  }

  async getById(id: string): Promise<AttachmentRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM attachments WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? rowToAttachment(rows[0]) : null;
  }

  async save(data: AttachmentRow): Promise<AttachmentRow> {
    await this.pool.query(
      `INSERT INTO attachments (id, transaction_id, filename, stored_name, mime_type, file_size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         transaction_id = EXCLUDED.transaction_id,
         filename = EXCLUDED.filename,
         stored_name = EXCLUDED.stored_name,
         mime_type = EXCLUDED.mime_type,
         file_size = EXCLUDED.file_size`,
      [
        data.id,
        data.transaction_id,
        data.filename,
        data.stored_name,
        data.mime_type,
        data.file_size,
        data.created_at,
      ],
    );
    return data;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM attachments WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async removeForTransaction(transactionId: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM attachments WHERE transaction_id = $1',
      [transactionId],
    );
    return result.rowCount ?? 0;
  }
}

function rowToAttachment(row: Record<string, unknown>): AttachmentRow {
  return {
    id: String(row.id),
    transaction_id: String(row.transaction_id),
    filename: String(row.filename),
    stored_name: String(row.stored_name),
    mime_type: row.mime_type != null ? String(row.mime_type) : null,
    file_size: Number(row.file_size),
    created_at: toISOString(row.created_at),
  };
}

