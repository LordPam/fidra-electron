import type pg from 'pg';
import type { CloudConnection } from '../cloud-connection';
import type { CloudCategoryRepo } from './cloud-repo-interfaces';

export class PgCategoryRepo implements CloudCategoryRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(type: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      'SELECT name FROM categories WHERE type = $1 ORDER BY sort_order, name',
      [type],
    );
    return rows.map((r) => String(r.name));
  }

  async setAll(type: string, names: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM categories WHERE type = $1', [type]);
      for (let i = 0; i < names.length; i++) {
        await client.query(
          'INSERT INTO categories (type, name, sort_order) VALUES ($1, $2, $3)',
          [type, names[i], i],
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
