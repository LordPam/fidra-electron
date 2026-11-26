import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface OutboundBundle {
  device_id: string;
  sequence_number: number;
  payload: Buffer;
  payload_hash: string;
}

/** Device-local encrypted journal. Folder writes are never the only copy.
 * Retain entries until a future receipt/retention protocol can prove safe pruning.
 */
export class OutboundBundles {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS sync_outbound_bundles (
      device_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      payload BLOB NOT NULL,
      payload_hash TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (device_id, sequence_number)
    )`);
    const columns = db.prepare('PRAGMA table_info(sync_outbound_bundles)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'payload_hash')) db.exec('ALTER TABLE sync_outbound_bundles ADD COLUMN payload_hash TEXT');
    db.transaction(() => {
      for (const row of db.prepare('SELECT device_id, sequence_number, payload FROM sync_outbound_bundles WHERE payload_hash IS NULL').all() as OutboundBundle[]) {
        db.prepare('UPDATE sync_outbound_bundles SET payload_hash = ? WHERE device_id = ? AND sequence_number = ?')
          .run(crypto.createHash('sha256').update(row.payload).digest('hex'), row.device_id, row.sequence_number);
      }
    })();
  }

  insert(deviceId: string, sequenceNumber: number, payload: Buffer): void {
    this.db.prepare(`INSERT INTO sync_outbound_bundles
      (device_id, sequence_number, payload, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(deviceId, sequenceNumber, payload, crypto.createHash('sha256').update(payload).digest('hex'), new Date().toISOString());
  }

  all(deviceId: string): OutboundBundle[] {
    return this.db.prepare(`SELECT device_id, sequence_number, payload, payload_hash
      FROM sync_outbound_bundles WHERE device_id = ? ORDER BY sequence_number`)
      .all(deviceId) as OutboundBundle[];
  }
}
