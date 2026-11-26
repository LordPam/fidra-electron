import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS applied_bundles (
    bundle_id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    applied_at TEXT NOT NULL,
    payload_hash TEXT
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
    const columns = this.db.prepare('PRAGMA table_info(applied_bundles)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'payload_hash')) this.db.exec('ALTER TABLE applied_bundles ADD COLUMN payload_hash TEXT');
    this.db.exec(CREATE_INDEX);
  }

  insert(bundleId: string, deviceId: string, sequenceNumber: number, payload?: Buffer): void {
    if (payload) this.assertAppliedPayload(deviceId, sequenceNumber, payload);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO applied_bundles (bundle_id, device_id, sequence_number, applied_at, payload_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(bundleId, deviceId, sequenceNumber, new Date().toISOString(), payload ? crypto.createHash('sha256').update(payload).digest('hex') : null);
  }

  /** A filename previously received must still contain the exact committed bytes. */
  assertAppliedPayload(deviceId: string, sequenceNumber: number, payload: Buffer): void {
    const hashes = this.db.prepare(`SELECT payload_hash FROM applied_bundles
      WHERE device_id = ? AND sequence_number = ? AND payload_hash IS NOT NULL`).all(deviceId, sequenceNumber) as { payload_hash: string }[];
    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    if (hashes.some((row) => row.payload_hash !== digest)) throw new Error('A previously received bundle changed. Sync is paused for reviewed recovery.');
  }

  hasApplied(bundleId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM applied_bundles WHERE bundle_id = ?')
      .get(bundleId);
    return row !== undefined;
  }

  /** Exact identity only: receiving sequence 9 proves nothing about sequence 8. */
  hasAppliedSequence(deviceId: string, sequenceNumber: number): boolean {
    return this.db.prepare(`SELECT 1 FROM applied_bundles
      WHERE device_id = ? AND sequence_number = ?
        AND bundle_id NOT LIKE 'snapshot:%'
        AND bundle_id NOT LIKE 'snapshot-coverage:%'`)
      .get(deviceId, sequenceNumber) !== undefined;
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
