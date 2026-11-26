import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { ensureSyncSubdirectory, writeSyncFileExclusively } from './bundle-io';
import type { FolderBinding } from './folder-binding';
import type { LocalSyncDelivery } from '../../shared/sync-delivery-types';

const entrySchema = z.object({
  sourceDeviceId: z.string().min(1).max(200), sequenceNumber: z.number().int().positive(),
  bundleId: z.string().uuid(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  conflictsQueued: z.number().int().nonnegative(),
}).strict();
const receiptSchema = z.object({
  version: z.literal(1), groupId: z.string().uuid(), locationId: z.string().uuid(),
  receiverDeviceId: z.string().min(1).max(200), committedAt: z.iso.datetime(),
  entries: z.array(entrySchema).min(1).max(128),
}).strict();
type ReceiptEntry = z.infer<typeof entrySchema>;
type PendingEvidence = ReceiptEntry & { committedAt: string };
function hash(bytes: Buffer): string { return crypto.createHash('sha256').update(bytes).digest('hex'); }

/** Group-key authenticated receipts. They report a named device's historical
 * commit; they are not independently signed device identities or convergence proofs.
 * Only peers present in local personnel are included in user-facing evidence.
 */
export class DeliveryReceipts {
  constructor(private readonly db: Database.Database, private readonly ownDeviceId: string) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_pending_receipts (
        source_device TEXT NOT NULL, sequence_number INTEGER NOT NULL, bundle_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, conflicts_queued INTEGER NOT NULL, committed_at TEXT NOT NULL,
        batch_hash TEXT, PRIMARY KEY(source_device, sequence_number)
      );
      CREATE TABLE IF NOT EXISTS sync_receipt_outbox (hash TEXT PRIMARY KEY, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_seen_receipts (hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sync_peer_receipts (
        peer_device TEXT NOT NULL, sequence_number INTEGER NOT NULL, payload_hash TEXT NOT NULL,
        conflicts_queued INTEGER NOT NULL, observed_at TEXT NOT NULL,
        PRIMARY KEY(peer_device, sequence_number, payload_hash)
      );
    `);
  }

  /** Must run INSIDE the transaction that commits data, conflicts and dedup. */
  recordApplied(entry: ReceiptEntry): void {
    const parsed = entrySchema.parse(entry);
    this.db.prepare(`INSERT INTO sync_pending_receipts
      (source_device, sequence_number, bundle_id, payload_hash, conflicts_queued, committed_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(parsed.sourceDeviceId, parsed.sequenceNumber, parsed.bundleId, parsed.payloadHash, parsed.conflictsQueued, new Date().toISOString());
  }

  publish(folder: string, passphrase: string, binding: FolderBinding): void {
    for (;;) {
      const prepared = this.db.transaction(() => {
        const pending = this.db.prepare(`SELECT source_device AS sourceDeviceId, sequence_number AS sequenceNumber,
          bundle_id AS bundleId, payload_hash AS payloadHash, conflicts_queued AS conflictsQueued, committed_at AS committedAt
          FROM sync_pending_receipts WHERE batch_hash IS NULL ORDER BY committed_at, source_device, sequence_number LIMIT 128`)
          .all() as PendingEvidence[];
        if (pending.length === 0) return false;
        const payload = encryptAndSign(Buffer.from(JSON.stringify({
          version: 1, groupId: binding.groupId, locationId: binding.locationId, receiverDeviceId: this.ownDeviceId,
          committedAt: pending[pending.length - 1].committedAt,
          entries: pending.map((entry) => ({ sourceDeviceId: entry.sourceDeviceId, sequenceNumber: entry.sequenceNumber,
            bundleId: entry.bundleId, payloadHash: entry.payloadHash, conflictsQueued: entry.conflictsQueued })),
        })), passphrase);
        const digest = hash(payload);
        this.db.prepare('INSERT INTO sync_receipt_outbox (hash, payload) VALUES (?, ?)').run(digest, payload);
        for (const entry of pending) this.db.prepare(`UPDATE sync_pending_receipts SET batch_hash = ?
          WHERE source_device = ? AND sequence_number = ?`).run(digest, entry.sourceDeviceId, entry.sequenceNumber);
        return true;
      }).immediate();
      if (!prepared) break;
    }
    for (const row of this.db.prepare('SELECT hash, payload FROM sync_receipt_outbox').all() as { hash: string; payload: Buffer }[]) {
      writeSyncFileExclusively(folder, 'receipts', `${row.hash}.receipt`, row.payload);
    }
  }

  /** Invalid/partial receipts stay retryable and never acknowledge an export. */
  scan(folder: string, passphrase: string, binding: FolderBinding): number {
    const dir = ensureSyncSubdirectory(folder, 'receipts');
    let rejected = 0;
    for (const filename of fs.readdirSync(dir)) {
      const match = /^([a-f0-9]{64})\.receipt$/.exec(filename);
      if (!match) continue;
      const digest = match[1];
      if (this.db.prepare('SELECT 1 FROM sync_seen_receipts WHERE hash = ?').get(digest)) continue;
      try {
        const file = path.join(dir, filename);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw new Error('Invalid receipt file');
        const bytes = fs.readFileSync(file);
        if (hash(bytes) !== digest) throw new Error('Receipt hash mismatch');
        const receipt = receiptSchema.parse(JSON.parse(verifyAndDecrypt(bytes, passphrase).toString('utf8')));
        if (receipt.groupId !== binding.groupId || receipt.locationId !== binding.locationId) throw new Error('Receipt mailbox mismatch');
        this.db.transaction(() => {
          if (receipt.receiverDeviceId !== this.ownDeviceId) {
            for (const entry of receipt.entries) {
              if (entry.sourceDeviceId !== this.ownDeviceId) continue;
              const outbound = this.db.prepare('SELECT payload_hash FROM sync_outbound_bundles WHERE device_id = ? AND sequence_number = ?')
                .get(this.ownDeviceId, entry.sequenceNumber) as { payload_hash: string } | undefined;
              if (!outbound || outbound.payload_hash !== entry.payloadHash) throw new Error('Receipt does not match retained outbound bytes');
              this.db.prepare(`INSERT OR IGNORE INTO sync_peer_receipts
                (peer_device, sequence_number, payload_hash, conflicts_queued, observed_at) VALUES (?, ?, ?, ?, ?)`)
                .run(receipt.receiverDeviceId, entry.sequenceNumber, entry.payloadHash, entry.conflictsQueued, new Date().toISOString());
            }
          }
          this.db.prepare('INSERT INTO sync_seen_receipts (hash) VALUES (?)').run(digest);
        })();
      } catch {
        rejected++;
      }
    }
    return rejected;
  }

  summary(folderBound: boolean): LocalSyncDelivery {
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM sync_outbound_bundles WHERE device_id = ?')
      .get(this.ownDeviceId) as { count: number };
    // Some legacy schemas predate device→person mapping. Absence is unverified.
    const columns = this.db.prepare('PRAGMA table_info(personnel)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'device_id')) return { folderBound, outboundBundles: total.count, peers: [] };
    const peers = this.db.prepare(`SELECT device_id AS deviceId, MIN(name) AS personName FROM personnel
      WHERE device_id IS NOT NULL AND device_id != '' AND device_id != ? GROUP BY device_id`).all(this.ownDeviceId) as { deviceId: string; personName: string }[];
    return { folderBound, outboundBundles: total.count, peers: peers.map((peer) => {
      const received = this.db.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN r.conflicts_queued > 0 THEN 1 ELSE 0 END) AS reviews, MAX(r.observed_at) AS observed
        FROM sync_peer_receipts r JOIN sync_outbound_bundles b
        ON b.device_id = ? AND b.sequence_number = r.sequence_number AND b.payload_hash = r.payload_hash
        WHERE r.peer_device = ?`).get(this.ownDeviceId, peer.deviceId) as { count: number; reviews: number | null; observed: string | null };
      return { ...peer, acknowledgedBundles: received.count, pendingBundles: total.count - received.count,
        reviewRequiredBundles: received.reviews ?? 0, lastReceiptObservedAt: received.observed };
    }) };
  }
}
