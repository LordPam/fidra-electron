import type Database from 'better-sqlite3';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS applied_bundles (
    bundle_id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  )
`;

const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_applied_bundles_device_seq
    ON applied_bundles (device_id, sequence_number)
`;

export class AppliedBundles {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX);
  }

  insert(bundleId: string, deviceId: string, sequenceNumber: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(bundleId, deviceId, sequenceNumber, new Date().toISOString());
  }

  hasApplied(bundleId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM applied_bundles WHERE bundle_id = ?')
      .get(bundleId);
    return row !== undefined;
  }

  getLatestSequence(deviceId: string): number | null {
    const row = this.db
      .prepare(
        'SELECT MAX(sequence_number) AS max_seq FROM applied_bundles WHERE device_id = ?',
      )
      .get(deviceId) as { max_seq: number | null } | undefined;
    return row?.max_seq ?? null;
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM applied_bundles')
      .get() as { cnt: number };
    return row.cnt;
  }
}
