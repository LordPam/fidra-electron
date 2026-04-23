import type pg from 'pg';
import type { TransactionRow } from '../../../shared/ipc-types';
import { ConcurrencyError, EntityDeletedError } from '../errors';
import type { CloudConnection } from '../cloud-connection';
import type { CloudTransactionRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString } from './pg-utils';

export class PgTransactionRepo implements CloudTransactionRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(sheet?: string): Promise<TransactionRow[]> {
    let query: string;
    let params: string[];

    if (sheet && sheet !== 'All Sheets') {
      query = `SELECT * FROM transactions WHERE sheet = $1 AND status != 'planned' ORDER BY date DESC, created_at DESC`;
      params = [sheet];
    } else {
      query = `SELECT * FROM transactions WHERE status != 'planned' ORDER BY date DESC, created_at DESC`;
      params = [];
    }

    const { rows } = await this.pool.query(query, params);
    return rows.map(rowToTransaction);
  }

  async getById(id: string): Promise<TransactionRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return rows.length > 0 ? rowToTransaction(rows[0]) : null;
  }

  async save(data: TransactionRow): Promise<TransactionRow> {
    const client = await this.pool.connect();
    try {
      const existing = await client.query(
        'SELECT version FROM transactions WHERE id = $1',
        [data.id],
      );

      if (existing.rows.length > 0) {
        const dbVersion = existing.rows[0].version;
        if (dbVersion !== data.version - 1) {
          throw new ConcurrencyError(
            `Version conflict: expected DB version ${data.version - 1}, found ${dbVersion}`,
          );
        }

        const result = await client.query(
          `UPDATE transactions SET
            date = $2, description = $3, amount = $4, type = $5,
            status = $6, sheet = $7, category = $8, party = $9,
            reference = $10, activity = $11, notes = $12,
            version = $13, modified_at = $14, modified_by = $15
          WHERE id = $1 AND version = $16`,
          [
            data.id, data.date, data.description, data.amount,
            data.type, data.status, data.sheet, data.category,
            data.party, data.reference, data.activity, data.notes,
            data.version, data.modified_at, data.modified_by,
            dbVersion,
          ],
        );

        if (result.rowCount === 0) {
          throw new ConcurrencyError(`Concurrent update to transaction ${data.id}`);
        }
      } else if (data.version > 1) {
        throw new EntityDeletedError(
          `Transaction ${data.id} was deleted on server (local version ${data.version})`,
        );
      } else {
        await client.query(
          `INSERT INTO transactions
          (id, date, description, amount, type, status, sheet,
           category, party, reference, activity, notes,
           version, created_at, modified_at, modified_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (id) DO UPDATE SET
            date = EXCLUDED.date, description = EXCLUDED.description,
            amount = EXCLUDED.amount, type = EXCLUDED.type,
            status = EXCLUDED.status, sheet = EXCLUDED.sheet,
            category = EXCLUDED.category, party = EXCLUDED.party,
            reference = EXCLUDED.reference, activity = EXCLUDED.activity,
            notes = EXCLUDED.notes, version = EXCLUDED.version,
            modified_at = EXCLUDED.modified_at, modified_by = EXCLUDED.modified_by`,
          [
            data.id, data.date, data.description, data.amount,
            data.type, data.status, data.sheet, data.category,
            data.party, data.reference, data.activity, data.notes,
            data.version, data.created_at, data.modified_at, data.modified_by,
          ],
        );
      }

      return data;
    } finally {
      client.release();
    }
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeVersioned(id: string, expectedVersion: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM transactions WHERE id = $1 AND version = $2',
        [id, expectedVersion],
      );
      if ((result.rowCount ?? 0) > 0) return true;

      const check = await client.query('SELECT version FROM transactions WHERE id = $1', [id]);
      if (check.rows.length > 0) {
        throw new ConcurrencyError(
          `Delete version conflict: expected ${expectedVersion}, found ${check.rows[0].version}`,
        );
      }
      return true;
    } finally {
      client.release();
    }
  }

  async bulkSave(transactions: TransactionRow[]): Promise<TransactionRow[]> {
    for (const tx of transactions) {
      await this.save(tx);
    }
    return transactions;
  }

  async bulkRemove(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query(
      'DELETE FROM transactions WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return result.rowCount ?? 0;
  }

  async getVersion(id: string): Promise<number | null> {
    const { rows } = await this.pool.query('SELECT version FROM transactions WHERE id = $1', [id]);
    return rows.length > 0 ? rows[0].version : null;
  }
}

function rowToTransaction(row: Record<string, unknown>): TransactionRow {
  return {
    id: String(row.id),
    date: toDateString(row.date),
    description: String(row.description),
    amount: String(row.amount),
    type: row.type as TransactionRow['type'],
    status: row.status as TransactionRow['status'],
    sheet: String(row.sheet),
    category: row.category != null ? String(row.category) : null,
    party: row.party != null ? String(row.party) : null,
    reference: row.reference != null ? String(row.reference) : null,
    activity: row.activity != null ? String(row.activity) : null,
    notes: row.notes != null ? String(row.notes) : null,
    version: Number(row.version),
    created_at: toISOString(row.created_at),
    modified_at: row.modified_at != null ? toISOString(row.modified_at) : null,
    modified_by: row.modified_by != null ? String(row.modified_by) : null,
  };
}

