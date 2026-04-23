import type pg from 'pg';
import type { SheetRow } from '../../../shared/ipc-types';
import type { CloudConnection } from '../cloud-connection';
import type { CloudSheetRepo } from './cloud-repo-interfaces';

export class PgSheetRepo implements CloudSheetRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(): Promise<SheetRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM sheets WHERE is_virtual = false AND is_planned = false ORDER BY sort_order, name',
    );
    return rows.map(rowToSheet);
  }

  async getById(id: string): Promise<SheetRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM sheets WHERE id = $1', [id]);
    return rows.length > 0 ? rowToSheet(rows[0]) : null;
  }

  async getByName(name: string): Promise<SheetRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM sheets WHERE name = $1', [name]);
    return rows.length > 0 ? rowToSheet(rows[0]) : null;
  }

  async create(id: string, name: string): Promise<SheetRow> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM sheets WHERE is_virtual = false AND is_planned = false',
    );
    const sortOrder = (rows[0]?.next_order as number) ?? 0;
    await this.pool.query(
      'INSERT INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at) VALUES ($1, $2, false, false, $3, $4)',
      [id, name, sortOrder, now],
    );
    return { id, name, is_virtual: 0, is_planned: 0, sort_order: sortOrder, created_at: now };
  }

  async reorder(orderedIds: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query('UPDATE sheets SET sort_order = $1 WHERE id = $2', [i, orderedIds[i]]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async save(sheet: SheetRow): Promise<SheetRow> {
    await this.pool.query(
      `INSERT INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         is_virtual = EXCLUDED.is_virtual,
         is_planned = EXCLUDED.is_planned,
         sort_order = EXCLUDED.sort_order`,
      [
        sheet.id, sheet.name,
        sheet.is_virtual === 1, sheet.is_planned === 1,
        sheet.sort_order ?? 0,
        sheet.created_at,
      ],
    );
    return sheet;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM sheets WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async renameSheet(oldName: string, newName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE sheets SET name = $1 WHERE name = $2', [newName, oldName]);
      await client.query('UPDATE transactions SET sheet = $1 WHERE sheet = $2', [newName, oldName]);
      await client.query('UPDATE planned_templates SET target_sheet = $1 WHERE target_sheet = $2', [newName, oldName]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async mergeAndDelete(sourceId: string, sourceName: string, targetName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE transactions SET sheet = $1 WHERE sheet = $2', [targetName, sourceName]);
      await client.query('UPDATE planned_templates SET target_sheet = $1 WHERE target_sheet = $2', [targetName, sourceName]);
      await client.query('DELETE FROM sheets WHERE id = $1', [sourceId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteWithTransactions(id: string, name: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM attachments WHERE transaction_id IN (SELECT id FROM transactions WHERE sheet = $1)',
        [name],
      );
      await client.query('DELETE FROM transactions WHERE sheet = $1', [name]);
      await client.query('DELETE FROM planned_templates WHERE target_sheet = $1', [name]);
      await client.query('DELETE FROM sheets WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

function rowToSheet(row: Record<string, unknown>): SheetRow {
  return {
    id: String(row.id),
    name: String(row.name),
    is_virtual: row.is_virtual ? 1 : 0,
    is_planned: row.is_planned ? 1 : 0,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}
