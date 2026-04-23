import type Database from 'better-sqlite3';

export type SettingScope = 'org' | 'device';

/** Keys that are organisation-scoped and should be synced via Local Sync. */
export const ORG_KEYS: ReadonlySet<string> = new Set([
  'profile.name',
  'profile.initials',
  'fy_start_month',
  'tx.dateOnApprove',
  'tx.dateOnPlannedConversion',
  'invoice.defaults',
]);

export function isOrgKey(key: string): boolean {
  return ORG_KEYS.has(key);
}

export class SettingsRepo {
  constructor(private readonly db: Database.Database) {}

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string, scope?: SettingScope): void {
    const resolvedScope = scope ?? (isOrgKey(key) ? 'org' : 'device');
    this.db.prepare(
      'INSERT INTO settings (key, value, scope) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, scope = excluded.scope',
    ).run(key, value, resolvedScope);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  getOrgSettings(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT key, value FROM settings WHERE scope = 'org'")
      .all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
}
