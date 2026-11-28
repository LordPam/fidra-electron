import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { loadCrSqlite } from '../database/crsqlite-lifecycle';
import { currentChanges, readLedgerState, sourceFingerprint, sha256, type LedgerState } from './recovery-state';
import { isOrgChangeset } from './settings-filter';
import type { CrChangesetRow } from './bundle-format';
import type { SyncConflict } from './conflict-queue';

export interface RecoverySource {
  sqlite: Database.Database;
  databaseId: string;
  dbPath: string;
  actorId: string;
  actorName: string;
  verifyAccess?: () => void;
}
export interface LedgerCapture {
  deviceId: string;
  siteId: string;
  databaseId: string;
  groupId: string | null;
  fingerprint: string;
  state: LedgerState;
  rows: CrChangesetRow[];
  applied: string[];
  exportedSequence: number;
  backupHash: string;
  conflicts: SyncConflict[];
  historyPins: { bundleId?: string; deviceId: string; sequence: number; hash: string }[];
}

function capture(db: Database.Database, destination?: string): LedgerCapture {
  return db.transaction(() => {
    const meta = (key: string) => db.prepare('SELECT value FROM sync_meta WHERE key = ?').pluck().get(key) as string | undefined;
    const deviceId = z.string().min(1).parse(meta('device.id'));
    const databaseId = z.string().uuid().parse(meta('database.id'));
    const siteId = (db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer).toString('hex');
    const group = db.prepare("SELECT value FROM settings WHERE key='localSync.groupId'").pluck().get() as string | undefined;
    const state = readLedgerState(db);
    const rows = currentChanges(db).filter(isOrgChangeset);
    const applied = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='applied_bundles'").get()
      ? (db.prepare("SELECT bundle_id FROM applied_bundles WHERE bundle_id NOT LIKE 'snapshot:%' AND bundle_id NOT LIKE 'snapshot-coverage:%'").pluck().all() as string[]) : [];
    const bytes = db.serialize();
    const conflicts = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_conflicts'").get()
      ? db.prepare('SELECT * FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY id').all() as SyncConflict[] : [];
    const historyPins: LedgerCapture['historyPins'] = [];
    const appliedColumns = db.prepare('PRAGMA table_info(applied_bundles)').all() as { name: string }[];
    if (appliedColumns.some((column) => column.name === 'payload_hash')) {
      historyPins.push(...db.prepare('SELECT bundle_id AS bundleId,device_id AS deviceId,sequence_number AS sequence,payload_hash AS hash FROM applied_bundles WHERE payload_hash IS NOT NULL').all() as LedgerCapture['historyPins']);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_outbound_bundles'").get()) {
      for (const row of db.prepare('SELECT device_id,sequence_number,payload FROM sync_outbound_bundles').all() as { device_id: string; sequence_number: number; payload: Buffer }[]) historyPins.push({ deviceId: row.device_id, sequence: row.sequence_number, hash: sha256(row.payload) });
    }
    if (destination) fs.writeFileSync(destination, bytes, { flag: 'wx', flush: true, mode: 0o600 });
    return { deviceId, databaseId, siteId, groupId: group ?? null, fingerprint: sourceFingerprint(db), state, rows, applied,
      exportedSequence: Number(meta('sync.sequenceNumber') ?? 0), backupHash: sha256(bytes), conflicts, historyPins };
  })();
}

export function captureCurrentLedger(source: RecoverySource, destination: string): LedgerCapture {
  return capture(source.sqlite, destination);
}

/** External peer ledgers are opened read-only, without migrations or attachment
 * relocation. The same extension finalization used by production close paths runs.
 */
export function capturePeerLedger(file: string, destination?: string): LedgerCapture {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw new Error('Choose a regular, closed Fidra ledger backup under 512 MiB.');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    loadCrSqlite(db);
    return capture(db, destination);
  } finally { db.close(); }
}

export function assertPeerLineage(base: LedgerCapture, peer: LedgerCapture): void {
  if (base.groupId && peer.groupId && base.groupId !== peer.groupId) throw new Error('A selected peer ledger belongs to another team.');
  const identities = new Set((base.state.personnel ?? []).map((row) => JSON.stringify([row.id, row.email])));
  if (!(peer.state.personnel ?? []).some((row) => identities.has(JSON.stringify([row.id, row.email])))) {
    throw new Error('The peer backup has no matching trusted personnel identity. Its relationship needs separate review.');
  }
}

export function copyChanges(db: Database.Database, rows: CrChangesetRow[]): void {
  const insert = db.prepare('INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of rows) insert.run(row.table, Buffer.isBuffer(row.pk) ? row.pk : Buffer.from(row.pk), row.cid,
    row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
