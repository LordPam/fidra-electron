import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { setImmediate as yieldToRunner } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { initializeCrr } from '../crr-schema';
import { SyncOrchestrator } from '../sync-orchestrator';
import { initializeOrBindSyncFolder, getFolderBinding } from '../folder-binding';
import { getDeviceIdentity } from '../device-identity';
import { applySnapshot } from '../compaction';
import { findLatestSnapshot, writeSnapshotAtomically } from '../bundle-io';
import { joinLocalSync } from '../migration';
import { unpackBundle, packBundle } from '../bundle-format';

const secret = 'snapshot-safety-test-secret';
let root: string;
let folder: string;
let dbs: Database.Database[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-snapshot-safety-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  folder = path.join(root, 'shared');
  fs.mkdirSync(folder);
  dbs = [];
});
afterEach(async () => {
  for (const db of dbs) if (db.open) db.close();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  await yieldToRunner();
});

function database(name: string): Database.Database {
  const { db } = openDatabase(path.join(root, `${name}.fdra`));
  initializeCrr(db);
  dbs.push(db);
  return db;
}
function source() {
  const db = database('source');
  initializeOrBindSyncFolder(db, folder, secret);
  db.prepare("INSERT INTO transactions (id, amount, date, description, type, status, sheet) VALUES (?, '10.00', '2026-11-25', 'Initial', 'income', '--', 'Main')")
    .run('long-key-' + 'transaction-'.repeat(30));
  const sync = new SyncOrchestrator({ db, syncFolder: folder, passphrase: secret, deviceId: crypto.randomUUID() });
  sync.exportNow();
  const first = sync.createSnapshot();
  return { db, sync, first, group: getFolderBinding(db)!.groupId };
}
function join(name: string) {
  const destination = path.join(root, `${name}.fdra`);
  expect(joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination })).toMatchObject({ success: true });
  const { db } = openDatabase(destination);
  dbs.push(db);
  const sync = new SyncOrchestrator({ db, syncFolder: folder, passphrase: secret, deviceId: getDeviceIdentity(db)!.deviceId });
  return { db, sync };
}

describe('snapshot safety', () => {
  it('retains immutable snapshots and carries ancestry into the first edit on a new device', () => {
    const a = source();
    const original = fs.readFileSync(a.first.path);
    const b = join('peer');
    expect(b.db.prepare('SELECT amount FROM transactions').pluck().get()).toBe('10.00');
    b.db.prepare("UPDATE transactions SET amount = '12.00'").run();
    b.sync.exportNow();
    a.sync.importAll();
    expect(a.db.prepare('SELECT amount FROM transactions').pluck().get()).toBe('12.00');
    expect(a.sync.getStatus().pendingConflicts).toBe(0);
    const second = a.sync.createSnapshot();
    expect(second.path).not.toBe(a.first.path);
    expect(fs.readFileSync(a.first.path)).toEqual(original);
    expect(findLatestSnapshot(folder, secret, a.group)?.filePath).toBe(second.path);
  });

  it('requires a dominating observed history rather than comparing devices’ sequence numbers', () => {
    const a = source();
    const b = join('peer');
    a.db.prepare("INSERT INTO activity_notes (activity, notes) VALUES ('a', 'offline A')").run();
    a.sync.exportNow();
    a.sync.createSnapshot();
    b.db.prepare("INSERT INTO activity_notes (activity, notes) VALUES ('b', 'offline B')").run();
    b.sync.exportNow();
    b.sync.createSnapshot();
    expect(() => findLatestSnapshot(folder, secret, a.group)).toThrow('concurrent histories');
    a.sync.importAll();
    const reconciled = a.sync.createSnapshot();
    expect(findLatestSnapshot(folder, secret, a.group)?.filePath).toBe(reconciled.path);
  // This case seals, imports and verifies several complete histories with the
  // production key derivation cost. Hosted Windows needs more than five seconds.
  }, 15_000);

  it('rejects equal causal coverage with differing financial state', () => {
    const a = source();
    const original = unpackBundle(fs.readFileSync(a.first.path), secret);
    const changed = original.changesets.map((row) => row.cid === 'amount' ? { ...row, val: '900.00' } : row);
    const contradictory = packBundle({ ...original, siteId: Buffer.from(original.siteId, 'hex'), changesets: changed,
      snapshotGeneration: original.snapshotGeneration! + 1, passphrase: secret });
    writeSnapshotAtomically(folder, original.deviceId, original.snapshotGeneration! + 1, contradictory);
    expect(() => findLatestSnapshot(folder, secret, a.group)).toThrow('same observed history disagree');
    const destination = path.join(root, 'contradictory.fdra');
    expect(joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination }).success).toBe(false);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('never overwrites an existing ledger, and rejects unproved snapshot revisions in a fresh one', () => {
    const a = source();
    const existing = database('existing');
    existing.prepare("INSERT INTO activity_notes (activity, notes) VALUES ('keep', 'valuable')").run();
    expect(() => applySnapshot(existing, a.first.path, secret, { bootstrap: true, expectedGroupId: a.group })).toThrow('existing ledger');
    expect(existing.prepare('SELECT notes FROM activity_notes').pluck().get()).toBe('valuable');
    const original = unpackBundle(fs.readFileSync(a.first.path), secret);
    const unproved = packBundle({ ...original, siteId: Buffer.from(original.siteId, 'hex'), passphrase: secret,
      causalState: { bundles: original.causalState!.bundles, revisions: [] } });
    const invalid = path.join(root, 'unproved.snapshot');
    fs.writeFileSync(invalid, unproved);
    const fresh = database('fresh');
    expect(() => applySnapshot(fresh, invalid, secret, { bootstrap: true, expectedGroupId: a.group })).toThrow('without accepted causal history');
    expect(fresh.prepare('SELECT COUNT(*) FROM transactions').pluck().get()).toBe(0);
    expect(fresh.prepare('SELECT COUNT(*) FROM sync_causal_bundles').pluck().get()).toBe(0);
  });

  it('blocks onboarding if a present snapshot or bundle cannot be verified', () => {
    const a = source();
    const original = fs.readFileSync(a.first.path);
    fs.writeFileSync(a.first.path, original.subarray(0, 20));
    const destination = path.join(root, 'incomplete.fdra');
    expect(joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination }).success).toBe(false);
    expect(fs.existsSync(destination)).toBe(false);
    fs.writeFileSync(a.first.path, original);
    fs.writeFileSync(path.join(folder, 'sync', 'offline-peer_0000000009.bundle'), 'incomplete');
    expect(joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination }).success).toBe(false);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.fidra-join-'))).toEqual([]);
  });
});
