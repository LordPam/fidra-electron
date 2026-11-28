import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase } from '../../database/connection';
import { loadCrSqlite } from '../../database/crsqlite-lifecycle';
import { initializeCrr } from '../crr-schema';
import { ensureOrganisationAuthority, signOrganisationDecision, verifyOrganisationDecision } from '../organisation-authority';
import { captureCurrentLedger, capturePeerLedger, assertPeerLineage } from '../recovery-database';
import { sourceFingerprint, ledgerDigest, readLedgerState } from '../recovery-state';
import { inventoryMailboxes, verifyInventory } from '../recovery-inventory';
import { packBundle, type CrChangesetRow } from '../bundle-format';

const secret = 'recovery-foundation-test-key';
let root: string;
let db: Database.Database;
let databaseId: string;
let sourcePath: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-recovery-foundations-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  sourcePath = path.join(root, 'source.fdra');
  const opened = openDatabase(sourcePath); db = opened.db; databaseId = opened.databaseId;
  initializeCrr(db);
  db.prepare("INSERT INTO sync_meta (key,value) VALUES ('device.id',?)").run(crypto.randomUUID());
  db.prepare("INSERT INTO personnel (id,name,email,role) VALUES ('owner','Owner','owner@example.test','admin')").run();
});
afterEach(() => { if (db.open) db.close(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const context = () => ({ sqlite: db, databaseId, dbPath: sourcePath, actorId: 'owner', actorName: 'Owner' });

describe('recovery foundations', { timeout: 15_000 }, () => {
  it('separates administrator decision signatures from the shared transport secret', () => {
    const key = ensureOrganisationAuthority(db, secret);
    const decision = { group: 'one', from: 'old', to: 'new', generation: 2 };
    const signature = signOrganisationDecision(db, key, secret, decision);
    expect(verifyOrganisationDecision(key, decision, signature)).toBe(true);
    expect(verifyOrganisationDecision(key, { ...decision, to: 'attacker' }, signature)).toBe(false);
    const peer = openDatabase(path.join(root, 'peer.fdra')).db;
    try {
      const peerKey = ensureOrganisationAuthority(peer, secret);
      expect(verifyOrganisationDecision(key, decision, signOrganisationDecision(peer, peerKey, secret, decision))).toBe(false);
      expect(() => signOrganisationDecision(peer, key, secret, decision)).toThrow('does not match');
    } finally { peer.close(); }
    expect(ensureOrganisationAuthority(db, secret)).toBe(key);
    expect(db.prepare("SELECT 1 FROM crsql_changes WHERE \"table\"='sync_meta'").get()).toBeUndefined();
  });

  it('captures committed WAL data without changing the source and never replaces a backup', () => {
    db.prepare("INSERT INTO transactions (id,date,amount,sheet) VALUES ('tx','2026-11-28','12.34','General')").run();
    const fingerprint = sourceFingerprint(db);
    const backup = path.join(root, 'preserved.fdra');
    const captured = captureCurrentLedger(context(), backup);
    expect(captured.state.transactions[0].amount).toBe('12.34');
    expect(sourceFingerprint(db)).toBe(fingerprint);
    const reader = new Database(backup, { readonly: true });
    try { loadCrSqlite(reader); expect(reader.prepare("SELECT amount FROM transactions WHERE id='tx'").pluck().get()).toBe('12.34'); }
    finally { reader.close(); }
    const bytes = fs.readFileSync(backup);
    expect(() => captureCurrentLedger(context(), backup)).toThrow();
    expect(fs.readFileSync(backup)).toEqual(bytes);
  });

  it('reads peer originals without migrations or attachment relocation and checks personnel lineage', () => {
    const captured = captureCurrentLedger(context(), path.join(root, 'base.fdra'));
    db.close();
    const original = fs.readFileSync(sourcePath);
    const peer = capturePeerLedger(sourcePath, path.join(root, 'peer-preserved.fdra'));
    expect(fs.readFileSync(sourcePath)).toEqual(original);
    expect(() => assertPeerLineage(captured, peer)).not.toThrow();
    expect(() => assertPeerLineage(captured, { ...peer, state: { ...peer.state, personnel: [{ id: 'foreign', email: 'owner@example.test' }] } }))
      .toThrow('matching trusted personnel');
  });

  it('excludes device preferences from stale-review and financial convergence checks', () => {
    const before = sourceFingerprint(db);
    const digest = ledgerDigest(readLedgerState(db));
    db.prepare("INSERT INTO settings (key,value,scope) VALUES ('theme','dark','device')").run();
    expect(sourceFingerprint(db)).toBe(before);
    expect(ledgerDigest(readLedgerState(db))).toBe(digest);
    db.prepare("UPDATE personnel SET name='A different name' WHERE id='owner'").run();
    expect(sourceFingerprint(db)).not.toBe(before);
    expect(ledgerDigest(readLedgerState(db))).not.toBe(digest);
  });

  function bundle(amount = '10.00'): Buffer {
    const row: CrChangesetRow = { table: 'transactions', pk: 'test', cid: 'amount', val: amount,
      col_version: 1, db_version: 1, site_id: Buffer.alloc(16, 1), cl: 1, seq: 0 };
    return packBundle({ deviceId: 'peer', siteId: row.site_id, sequenceNumber: 1, schemaVersion: 1,
      changesets: [row], passphrase: secret });
  }
  function mailbox(name: string, content: Buffer): string {
    const folder = path.join(root, name); fs.mkdirSync(path.join(folder, 'sync'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'sync', 'peer_0000000001.bundle'), content);
    return folder;
  }

  it('deduplicates exact histories across roots and preserves differing identities as blocking evidence', async () => {
    const bytes = bundle();
    const a = mailbox('a', bytes); const b = mailbox('b', bytes);
    const original = fs.readFileSync(path.join(a, 'sync', 'peer_0000000001.bundle'));
    const same = await inventoryMailboxes([a, b], secret, path.join(root, 'evidence'));
    expect(same.bundles).toHaveLength(1); expect(same.duplicates).toBe(1); expect(same.issues).toEqual([]);
    fs.writeFileSync(path.join(b, 'sync', 'peer_0000000001.bundle'), bundle('99.00'));
    const collision = await inventoryMailboxes([a, b], secret, path.join(root, 'more-evidence'));
    expect(collision.issues.join(' ')).toContain('different ciphertext');
    expect(fs.readFileSync(path.join(a, 'sync', 'peer_0000000001.bundle'))).toEqual(original);
  });

  it('refuses new or changed history after review and never recreates a missing source', async () => {
    const a = mailbox('a', bundle());
    const inventory = await inventoryMailboxes([a], secret, path.join(root, 'evidence'));
    await expect(verifyInventory(inventory)).resolves.toBeUndefined();
    fs.writeFileSync(path.join(a, 'sync', 'new_0000000002.bundle'), 'new arrival');
    await expect(verifyInventory(inventory)).rejects.toThrow('refreshed recovery review');
    const missing = path.join(root, 'missing');
    await expect(inventoryMailboxes([missing], secret, path.join(root, 'other-evidence'))).rejects.toThrow();
    expect(fs.existsSync(missing)).toBe(false);
  });
});
