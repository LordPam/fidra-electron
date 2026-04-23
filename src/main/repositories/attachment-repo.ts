import type Database from 'better-sqlite3';
import type { AttachmentRow } from '../../shared/ipc-types';

export class AttachmentRepo {
  constructor(private readonly db: Database.Database) {}

  getForTransaction(transactionId: string): AttachmentRow[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE transaction_id = ? ORDER BY created_at DESC')
      .all(transactionId) as AttachmentRow[];
  }

  getCounts(transactionIds: string[]): Record<string, number> {
    if (transactionIds.length === 0) return {};
    const placeholders = transactionIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT transaction_id, COUNT(*) as count FROM attachments WHERE transaction_id IN (${placeholders}) GROUP BY transaction_id`,
      )
      .all(...transactionIds) as { transaction_id: string; count: number }[];
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.transaction_id] = row.count;
    }
    return result;
  }

  getById(id: string): AttachmentRow | null {
    return (
      (this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow) ?? null
    );
  }

  save(row: AttachmentRow): AttachmentRow {
    // Use INSERT + UPDATE (not INSERT OR REPLACE) so cr-sqlite only bumps
    // col_version for columns whose values actually changed.
    const existing = this.db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(row.id);
    if (existing) {
      this.db.prepare(
        `UPDATE attachments SET transaction_id=?, filename=?, stored_name=?, mime_type=?, file_size=?
         WHERE id=?`,
      ).run(row.transaction_id, row.filename, row.stored_name, row.mime_type, row.file_size, row.id);
    } else {
      this.db.prepare(
        `INSERT INTO attachments (id, transaction_id, filename, stored_name, mime_type, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.transaction_id, row.filename, row.stored_name, row.mime_type, row.file_size, row.created_at);
    }
    return row;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    return result.changes > 0;
  }

  removeForTransaction(transactionId: string): AttachmentRow[] {
    const rows = this.getForTransaction(transactionId);
    if (rows.length > 0) {
      this.db.prepare('DELETE FROM attachments WHERE transaction_id = ?').run(transactionId);
    }
    return rows;
  }
}
