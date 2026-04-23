import type pg from 'pg';
import type { CloudConnection } from '../cloud-connection';
import type { CloudActivityNotesRepo } from './cloud-repo-interfaces';

export class PgActivityNotesRepo implements CloudActivityNotesRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(): Promise<Record<string, string>> {
    const { rows } = await this.pool.query(
      'SELECT activity, notes FROM activity_notes ORDER BY activity',
    );
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[String(row.activity)] = String(row.notes);
    }
    return result;
  }

  async save(activity: string, notes: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO activity_notes (activity, notes) VALUES ($1, $2)
       ON CONFLICT (activity) DO UPDATE SET notes = EXCLUDED.notes`,
      [activity, notes],
    );
  }

  async remove(activity: string): Promise<void> {
    await this.pool.query('DELETE FROM activity_notes WHERE activity = $1', [activity]);
  }

  async setAll(notes: Record<string, string>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM activity_notes');
      for (const [activity, text] of Object.entries(notes)) {
        await client.query(
          'INSERT INTO activity_notes (activity, notes) VALUES ($1, $2)',
          [activity, text],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}
