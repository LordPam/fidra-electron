import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeliveryReceipts } from '../delivery-receipts';
import { OutboundBundles } from '../outbound-bundles';
import { encryptAndSign } from '../bundle-crypto';
import { writeSyncFileExclusively } from '../bundle-io';
import type { FolderBinding } from '../folder-binding';

let folder: string;
let dbA: Database.Database;
let dbB: Database.Database;
let sender: DeliveryReceipts;
let receiver: DeliveryReceipts;
let binding: FolderBinding;
const passphrase = 'test-receipt-passphrase';
const bytes = Buffer.from('exact encrypted bundle bytes in a fixture');
const payloadHash = crypto.createHash('sha256').update(bytes).digest('hex');
const bundleId = crypto.randomUUID();
const entry = { sourceDeviceId: 'sender', sequenceNumber: 1, bundleId, payloadHash, conflictsQueued: 0 };

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE personnel (name TEXT, device_id TEXT)');
  new OutboundBundles(db);
  return db;
}
function publish(overrides: Record<string, unknown> = {}, entries: unknown[] = [entry]): string {
  const sealed = encryptAndSign(Buffer.from(JSON.stringify({
    version: 1, groupId: binding.groupId, locationId: binding.locationId,
    receiverDeviceId: 'receiver', committedAt: new Date().toISOString(), entries, ...overrides,
  })), passphrase);
  const hash = crypto.createHash('sha256').update(sealed).digest('hex');
  return writeSyncFileExclusively(folder, 'receipts', `${hash}.receipt`, sealed);
}
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-receipts-'));
  dbA = createDb();
  dbB = createDb();
  dbA.prepare('INSERT INTO personnel (name, device_id) VALUES (?, ?)').run('Sam', 'receiver');
  new OutboundBundles(dbA).insert('sender', 1, bytes);
  sender = new DeliveryReceipts(dbA, 'sender');
  receiver = new DeliveryReceipts(dbB, 'receiver');
  binding = { version: 1, groupId: crypto.randomUUID(), locationId: crypto.randomUUID(), root: { realPath: folder, dev: '1', ino: '1' }, manifestHash: 'a'.repeat(64) };
});
afterEach(() => {
  vi.restoreAllMocks();
  dbA.close();
  dbB.close();
  fs.rmSync(folder, { recursive: true, force: true });
});

describe('exact bundle delivery evidence', () => {
  test('reports pending until another known device publishes a matching receipt', () => {
    expect(sender.summary(true).peers[0]).toMatchObject({ acknowledgedBundles: 0, pendingBundles: 1 });
    dbB.transaction(() => receiver.recordApplied(entry))();
    receiver.publish(folder, passphrase, binding);
    expect(sender.summary(true).peers[0].pendingBundles).toBe(1);
    expect(sender.scan(folder, passphrase, binding)).toBe(0);
    expect(sender.summary(true).peers[0]).toMatchObject({ acknowledgedBundles: 1, pendingBundles: 0, reviewRequiredBundles: 0 });
    sender.scan(folder, passphrase, binding);
    expect(sender.summary(true).peers[0].acknowledgedBundles).toBe(1);
  });

  test('keeps review-required receipt evidence separate from clean receipt', () => {
    receiver.recordApplied({ ...entry, conflictsQueued: 2 });
    receiver.publish(folder, passphrase, binding);
    sender.scan(folder, passphrase, binding);
    expect(sender.summary(true).peers[0]).toMatchObject({ acknowledgedBundles: 1, reviewRequiredBundles: 1 });
  });

  test.each(['groupId', 'locationId'])('rejects receipts from another %s', (key) => {
    publish({ [key]: crypto.randomUUID() });
    expect(sender.scan(folder, passphrase, binding)).toBe(1);
    expect(sender.summary(true).peers[0].acknowledgedBundles).toBe(0);
  });

  test('ignores self acknowledgements and does not present unknown devices as verified peers', () => {
    publish({ receiverDeviceId: 'sender' });
    publish({ receiverDeviceId: 'unknown' });
    expect(sender.scan(folder, passphrase, binding)).toBe(0);
    expect(sender.summary(true).peers).toHaveLength(1);
    expect(sender.summary(true).peers[0].acknowledgedBundles).toBe(0);
  });

  test('rejects a wrong payload hash and rolls back an entire mixed receipt batch', () => {
    publish({}, [entry, { ...entry, payloadHash: 'f'.repeat(64) }]);
    expect(sender.scan(folder, passphrase, binding)).toBe(1);
    expect(sender.summary(true).peers[0].acknowledgedBundles).toBe(0);
  });

  test('partial or tampered receipts stay pending and can be retried after repair', () => {
    const file = publish();
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, 'partial download');
    expect(sender.scan(folder, passphrase, binding)).toBe(1);
    expect(sender.summary(true).peers[0].pendingBundles).toBe(1);
    fs.writeFileSync(file, original);
    expect(sender.scan(folder, passphrase, binding)).toBe(0);
    expect(sender.summary(true).peers[0].pendingBundles).toBe(0);
  });

  test('a rolled back data transaction never produces a receipt', () => {
    expect(() => dbB.transaction(() => {
      receiver.recordApplied(entry);
      throw new Error('commit failed');
    })()).toThrow('commit failed');
    receiver.publish(folder, passphrase, binding);
    expect(fs.existsSync(path.join(folder, 'receipts'))).toBe(false);
  });

  test('failed publication retains exact ciphertext for retry', () => {
    receiver.recordApplied(entry);
    const copy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('offline'); });
    expect(() => receiver.publish(folder, passphrase, binding)).toThrow('offline');
    const pending = dbB.prepare('SELECT hash, payload FROM sync_receipt_outbox').get() as { hash: string; payload: Buffer };
    copy.mockRestore();
    receiver.publish(folder, passphrase, binding);
    expect(fs.readFileSync(path.join(folder, 'receipts', `${pending.hash}.receipt`))).toEqual(pending.payload);
    expect(dbB.prepare('SELECT COUNT(*) FROM sync_receipt_outbox').pluck().get()).toBe(1);
  });

  test('supports an outbox created by the previous safety milestone', () => {
    const old = new Database(':memory:');
    try {
      old.exec(`CREATE TABLE sync_outbound_bundles (device_id TEXT, sequence_number INTEGER, payload BLOB, created_at TEXT, PRIMARY KEY(device_id, sequence_number))`);
      old.prepare('INSERT INTO sync_outbound_bundles VALUES (?, ?, ?, ?)').run('sender', 1, bytes, new Date().toISOString());
      const upgraded = new OutboundBundles(old);
      expect(upgraded.all('sender')[0].payload_hash).toBe(payloadHash);
    } finally {
      old.close();
    }
  });
});
