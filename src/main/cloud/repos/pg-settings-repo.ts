import type { CloudConnection } from '../cloud-connection';

export class PgSettingsRepo {
  constructor(private readonly conn: CloudConnection) {}

  async getSetting(key: string): Promise<string | null> {
    const { rows } = await this.conn.pool.query(
      'SELECT value FROM db_settings WHERE key = $1',
      [key],
    );
    return rows.length > 0 ? String(rows[0].value) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.conn.pool.query(
      `INSERT INTO db_settings (key, value, modified_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = NOW()`,
      [key, value],
    );
  }

  async getAll(): Promise<Record<string, string>> {
    const { rows } = await this.conn.pool.query('SELECT key, value FROM db_settings');
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[String(row.key)] = String(row.value);
    }
    return result;
  }
}
