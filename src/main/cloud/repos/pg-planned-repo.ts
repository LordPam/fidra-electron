import type pg from 'pg';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';
import { ConcurrencyError, EntityDeletedError } from '../errors';
import type { CloudConnection } from '../cloud-connection';
import type { CloudPlannedRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString, toJsonString } from './pg-utils';

export class PgPlannedRepo implements CloudPlannedRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(): Promise<PlannedTemplateRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM planned_templates ORDER BY start_date ASC',
    );
    return rows.map(rowToPlanned);
  }

  async getById(id: string): Promise<PlannedTemplateRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM planned_templates WHERE id = $1', [id]);
    return rows.length > 0 ? rowToPlanned(rows[0]) : null;
  }

  async save(data: PlannedTemplateRow): Promise<PlannedTemplateRow> {
    const skippedJson = typeof data.skipped_dates === 'string'
      ? data.skipped_dates
      : JSON.stringify(data.skipped_dates);
    const fulfilledJson = typeof data.fulfilled_dates === 'string'
      ? data.fulfilled_dates
      : JSON.stringify(data.fulfilled_dates);

    const client = await this.pool.connect();
    try {
      const existing = await client.query(
        'SELECT version FROM planned_templates WHERE id = $1',
        [data.id],
      );

      if (existing.rows.length > 0) {
        const dbVersion = existing.rows[0].version;
        if (dbVersion !== data.version - 1) {
          throw new ConcurrencyError(
            `PlannedTemplate version conflict: expected DB version ${data.version - 1}, found ${dbVersion}`,
          );
        }

        const result = await client.query(
          `UPDATE planned_templates SET
            start_date = $2, description = $3, amount = $4, type = $5,
            frequency = $6, target_sheet = $7, category = $8, party = $9,
            activity = $10, notes = $11, end_date = $12, occurrence_count = $13,
            skipped_dates = $14, fulfilled_dates = $15, version = $16
          WHERE id = $1 AND version = $17`,
          [
            data.id, data.start_date, data.description, data.amount,
            data.type, data.frequency, data.target_sheet, data.category,
            data.party, data.activity, data.notes, data.end_date, data.occurrence_count,
            skippedJson, fulfilledJson, data.version,
            dbVersion,
          ],
        );

        if (result.rowCount === 0) {
          throw new ConcurrencyError(`Concurrent update to planned template ${data.id}`);
        }
      } else if (data.version > 1) {
        throw new EntityDeletedError(
          `PlannedTemplate ${data.id} was deleted on server (local version ${data.version})`,
        );
      } else {
        await client.query(
          `INSERT INTO planned_templates
          (id, start_date, description, amount, type, frequency, target_sheet,
           category, party, activity, notes, end_date, occurrence_count,
           skipped_dates, fulfilled_dates, version, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            start_date = EXCLUDED.start_date, description = EXCLUDED.description,
            amount = EXCLUDED.amount, type = EXCLUDED.type,
            frequency = EXCLUDED.frequency, target_sheet = EXCLUDED.target_sheet,
            category = EXCLUDED.category, party = EXCLUDED.party,
            activity = EXCLUDED.activity, notes = EXCLUDED.notes,
            end_date = EXCLUDED.end_date,
            occurrence_count = EXCLUDED.occurrence_count,
            skipped_dates = EXCLUDED.skipped_dates, fulfilled_dates = EXCLUDED.fulfilled_dates,
            version = EXCLUDED.version`,
          [
            data.id, data.start_date, data.description, data.amount,
            data.type, data.frequency, data.target_sheet, data.category,
            data.party, data.activity, data.notes, data.end_date, data.occurrence_count,
            skippedJson, fulfilledJson, data.version, data.created_at,
          ],
        );
      }

      return data;
    } finally {
      client.release();
    }
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM planned_templates WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeVersioned(id: string, expectedVersion: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM planned_templates WHERE id = $1 AND version = $2',
        [id, expectedVersion],
      );
      if ((result.rowCount ?? 0) > 0) return true;

      const check = await client.query('SELECT version FROM planned_templates WHERE id = $1', [id]);
      if (check.rows.length > 0) {
        throw new ConcurrencyError(
          `PlannedTemplate delete version conflict: expected ${expectedVersion}, found ${check.rows[0].version}`,
        );
      }
      return true;
    } finally {
      client.release();
    }
  }

  async getVersion(id: string): Promise<number | null> {
    const { rows } = await this.pool.query('SELECT version FROM planned_templates WHERE id = $1', [id]);
    return rows.length > 0 ? rows[0].version : null;
  }
}

function rowToPlanned(row: Record<string, unknown>): PlannedTemplateRow {
  // JSONB columns come back as parsed JS objects from pg; SQLite stores them as strings
  const skipped = row.skipped_dates;
  const fulfilled = row.fulfilled_dates;

  return {
    id: String(row.id),
    start_date: toDateString(row.start_date),
    description: String(row.description),
    amount: String(row.amount),
    type: row.type as PlannedTemplateRow['type'],
    frequency: row.frequency as PlannedTemplateRow['frequency'],
    target_sheet: String(row.target_sheet),
    category: row.category != null ? String(row.category) : null,
    party: row.party != null ? String(row.party) : null,
    activity: row.activity != null ? String(row.activity) : null,
    notes: row.notes != null ? String(row.notes) : null,
    end_date: row.end_date != null ? toDateString(row.end_date) : null,
    occurrence_count: row.occurrence_count != null ? Number(row.occurrence_count) : null,
    skipped_dates: toJsonString(skipped ?? []),
    fulfilled_dates: toJsonString(fulfilled ?? []),
    version: Number(row.version),
    created_at: toISOString(row.created_at),
  };
}

