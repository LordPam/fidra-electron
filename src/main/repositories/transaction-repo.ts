import type Database from 'better-sqlite3';
import type { TransactionRow } from '../../shared/ipc-types';

export class TransactionRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(sheet?: string): TransactionRow[] {
    if (sheet && sheet !== 'All Sheets') {
      return this.db
        .prepare(
          'SELECT * FROM transactions WHERE sheet = ? AND status != ? ORDER BY date DESC, created_at DESC',
        )
        .all(sheet, 'planned') as TransactionRow[];
    }
    return this.db
      .prepare('SELECT * FROM transactions WHERE status != ? ORDER BY date DESC, created_at DESC')
      .all('planned') as TransactionRow[];
  }

  getById(id: string): TransactionRow | null {
    return (this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow) ?? null;
  }

  save(data: TransactionRow): TransactionRow {
    // Use INSERT + UPDATE instead of INSERT OR REPLACE so cr-sqlite only bumps
    // col_version for columns whose values actually changed. INSERT OR REPLACE
    // is a DELETE+INSERT under the hood, bumping ALL col_versions and causing
    // false conflicts when different fields are edited concurrently.
    const existing = this.db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(data.id);
    if (existing) {
      this.db.prepare(
        `UPDATE transactions SET date=?, description=?, amount=?, type=?, status=?,
         sheet=?, category=?, party=?, reference=?, activity=?, notes=?,
         version=?, modified_at=?, modified_by=?
         WHERE id=?`,
      ).run(
        data.date, data.description, data.amount, data.type, data.status,
        data.sheet, data.category, data.party, data.reference, data.activity, data.notes,
        data.version, data.modified_at, data.modified_by,
        data.id,
      );
    } else {
      this.db.prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet, category, party, reference, activity, notes, version, created_at, modified_at, modified_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        data.id, data.date, data.description, data.amount, data.type, data.status,
        data.sheet, data.category, data.party, data.reference, data.activity, data.notes,
        data.version, data.created_at, data.modified_at, data.modified_by,
      );
    }
    return data;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  bulkSave(transactions: TransactionRow[]): TransactionRow[] {
    // Use INSERT + UPDATE (not INSERT OR REPLACE) so cr-sqlite only bumps
    // col_version for columns whose values actually changed.
    const insertStmt = this.db.prepare(
      `INSERT INTO transactions (id, date, description, amount, type, status, sheet, category, party, reference, activity, notes, version, created_at, modified_at, modified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = this.db.prepare(
      `UPDATE transactions SET date=?, description=?, amount=?, type=?, status=?,
       sheet=?, category=?, party=?, reference=?, activity=?, notes=?,
       version=?, modified_at=?, modified_by=? WHERE id=?`,
    );
    const existsStmt = this.db.prepare('SELECT 1 FROM transactions WHERE id = ?');

    const tx = this.db.transaction((items: TransactionRow[]) => {
      for (const data of items) {
        if (existsStmt.get(data.id)) {
          updateStmt.run(
            data.date, data.description, data.amount, data.type, data.status,
            data.sheet, data.category, data.party, data.reference, data.activity, data.notes,
            data.version, data.modified_at, data.modified_by, data.id,
          );
        } else {
          insertStmt.run(
            data.id, data.date, data.description, data.amount, data.type, data.status,
            data.sheet, data.category, data.party, data.reference, data.activity, data.notes,
            data.version, data.created_at, data.modified_at, data.modified_by,
          );
        }
      }
      return items;
    });

    return tx(transactions);
  }

  bulkRemove(ids: string[]): number {
    const placeholders = ids.map(() => '?').join(',');
    const result = this.db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  }
}
