import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase, getAttachmentStoragePath } from '../../database/connection';
import { initializeCrr } from '../crr-schema';
import { copyChanges, type RecoverySource } from '../recovery-database';
import { currentChanges, sourceFingerprint } from '../recovery-state';
import { prepareRecovery, recoveryDirectory, recoveryPreview, resolveRecoveryChoice, chooseRecoveryAttachment } from '../recovery-session';
import { ConflictQueue } from '../conflict-queue';
import { serializeChangesetRow } from '../bundle-format';
import { publishRecovery } from '../recovery-publication';
import { joinLocalSync } from '../migration';
import { readFolderManifest, assertFolderBinding } from '../folder-binding';
import { verifyAndDecrypt } from '../bundle-crypto';

const secret = 'recovery-session-test-secret';
let root: string; let db: Database.Database; let source: RecoverySource;
const opened: Database.Database[] = [];
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-recovery-session-')));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  const dbPath = path.join(root, 'source.fdra'); const base = openDatabase(dbPath); db = base.db; opened.push(db);
  initializeCrr(db);
  db.prepare("INSERT INTO sync_meta(key,value) VALUES ('device.id',?)").run(crypto.randomUUID());
  db.prepare("INSERT INTO personnel (id,name,email,role,password_hash) VALUES ('owner','Owner','owner@example.test','admin','hash')").run();
  db.prepare("INSERT INTO sheets (id,name) VALUES ('general','General'),('second','Second')").run();
  db.prepare("INSERT INTO transactions(id,date,amount,sheet,type,status) VALUES ('tx','2026-11-28','10.00','General','income','approved')").run();
  db.exec("UPDATE transactions SET created_at='2026-11-28T00:00:00.000Z'; UPDATE sheets SET created_at='2026-11-28T00:00:00.000Z'");
  source = { sqlite: db, databaseId: base.databaseId, dbPath, actorId: 'owner', actorName: 'Owner' };
});
afterEach(() => { for (const handle of opened.splice(0)) if (handle.open) handle.close(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function peer(): { db: Database.Database; file: string } {
  const file = path.join(root, `${crypto.randomUUID()}.fdra`); const handle = openDatabase(file).db; opened.push(handle); initializeCrr(handle);
  copyChanges(handle, currentChanges(db));
  handle.prepare("INSERT INTO sync_meta(key,value) VALUES ('device.id',?)").run(crypto.randomUUID());
  return { db: handle, file };
}

describe('persistent reviewed recovery', { timeout: 30_000 }, () => {
  it('keeps both ledgers untouched and resolves a divergent amount only in the private stage', async () => {
    const other = peer(); other.db.prepare("UPDATE transactions SET amount='99.00' WHERE id='tx'").run();
    const before = sourceFingerprint(db); const otherBefore = sourceFingerprint(other.db);
    let preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [other.file] }, secret);
    expect(preview.issues).toEqual([]);
    const conflict = preview.conflicts.find((item) => item.field === 'amount'); expect(conflict).toBeDefined();
    expect(preview.accounts.find((item) => item.sheet === 'General')?.afterPence).toBe(1000);
    preview = resolveRecoveryChoice(source, preview.id, conflict!.id, 'accept-remote', preview.reviewDigest, secret);
    expect(preview.conflicts).toHaveLength(0); expect(preview.accounts.find((item) => item.sheet === 'General')?.afterPence).toBe(9900);
    expect(sourceFingerprint(db)).toBe(before); expect(sourceFingerprint(other.db)).toBe(otherBefore);
    expect(recoveryPreview(source, preview.id, secret).reviewDigest).toBe(preview.reviewDigest);
  });
  it('rejects a stale review click and any choice after an operational edit', async () => {
    const other = peer(); other.db.prepare("UPDATE transactions SET amount='99.00' WHERE id='tx'").run();
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [other.file] }, secret);
    const id = preview.conflicts.find((item) => item.field === 'amount')!.id;
    expect(() => resolveRecoveryChoice(source, preview.id, id, 'accept-remote', 'stale', secret)).toThrow('changed');
    db.prepare("UPDATE transactions SET amount='11.00' WHERE id='tx'").run();
    expect(() => resolveRecoveryChoice(source, preview.id, id, 'accept-remote', preview.reviewDigest, secret)).toThrow('changed');
    expect(recoveryPreview(source, preview.id, secret).issues.join(' ')).toContain('operational ledger changed');
  });
  it('preserves the source held conflict queue instead of treating its bundle as accepted data', async () => {
    const row = currentChanges(db).find((item) => item.table === 'transactions' && item.cid === 'amount')!;
    const remote = { ...row, val: '42.00', site_id: crypto.randomBytes(16) };
    new ConflictQueue(db).insert({ entity_type: 'transactions', entity_id: 'tx', field_name: 'amount', local_value: '10.00', remote_value: '42.00',
      local_site_id: row.site_id.toString('hex'), remote_site_id: remote.site_id.toString('hex'), local_version: row.col_version, remote_version: remote.col_version,
      bundle_id: crypto.randomUUID(), changeset_json: JSON.stringify(serializeChangesetRow(remote)), local_changeset_json: JSON.stringify([serializeChangesetRow(row)]) });
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [] }, secret);
    expect(preview.conflicts).toHaveLength(1); expect(preview.conflicts[0].remote).toBe('42.00');
    const chosen = resolveRecoveryChoice(source, preview.id, preview.conflicts[0].id, 'accept-remote', preview.reviewDigest, secret);
    expect(chosen.accounts[0].afterPence).toBe(4200); expect(new ConflictQueue(db).count()).toBe(1);
  });
  it('changes both sides of a transfer atomically and records one joint review', async () => {
    db.prepare("UPDATE transactions SET linked_id='partner' WHERE id='tx'").run();
    db.prepare("INSERT INTO transactions(id,date,amount,sheet,type,status,linked_id) VALUES ('partner','2026-11-28','10.00','Second','expense','approved','tx')").run();
    db.prepare("UPDATE transactions SET created_at='2026-11-28T00:00:00.000Z' WHERE id='partner'").run();
    const other = peer(); other.db.prepare("UPDATE transactions SET amount='25.00' WHERE id IN ('tx','partner')").run();
    let preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [other.file] }, secret);
    expect(preview.conflicts).toHaveLength(2); expect(preview.conflicts.every((item) => item.jointTransfer)).toBe(true);
    expect(preview.conflicts[0].transfer?.remoteError).toBeUndefined();
    preview = resolveRecoveryChoice(source, preview.id, preview.conflicts[0].id, 'accept-remote', preview.reviewDigest, secret);
    expect(preview.conflicts).toEqual([]); expect(preview.issues).toEqual([]);
    expect(preview.accounts.map((item) => item.afterPence)).toEqual([2500,-2500]);
  });
  it('seals differing attachment alternatives and requires an explicit content choice', async () => {
    db.prepare("INSERT INTO attachments(id,transaction_id,filename,stored_name,mime_type,file_size) VALUES ('att','tx','Receipt.pdf','receipt.pdf','application/pdf',3)").run();
    const local = getAttachmentStoragePath(source.databaseId); fs.mkdirSync(local, { recursive: true }); fs.writeFileSync(path.join(local, 'receipt.pdf'), 'one');
    const mailbox = path.join(root, 'mailbox'); fs.mkdirSync(path.join(mailbox, 'attachments'), { recursive: true }); fs.writeFileSync(path.join(mailbox, 'attachments', 'receipt.pdf'), 'two');
    let preview = await prepareRecovery(source, { mailboxes: [mailbox], peerLedgers: [] }, secret);
    expect(preview.attachments[0].alternatives).toHaveLength(2); expect(preview.attachments[0].selectedHash).toBeNull();
    const hash = preview.attachments[0].alternatives[1].hash;
    preview = chooseRecoveryAttachment(source, preview.id, 'att', hash, preview.reviewDigest, secret);
    expect(preview.attachments[0].selectedHash).toBe(hash);
    const evidence = path.join(recoveryDirectory(source, preview.id), 'attachment-evidence', `${hash}.sealed`);
    expect(fs.readFileSync(evidence).includes(Buffer.from('two'))).toBe(false);
    expect(verifyAndDecrypt(fs.readFileSync(evidence), secret).toString()).toBe('two');
    expect(fs.readdirSync(path.join(mailbox, 'attachments'))).toEqual(['receipt.pdf']);
  });
  it('publishes an independently joinable new mailbox and preserves the original ledger history', async () => {
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [] }, secret);
    const destination = path.join(root, 'destination'); fs.mkdirSync(destination);
    const input = { id: preview.id, destinationFolder: destination, retiredDevices: [], confirmPausedClients: true, confirmReviewedChanges: true, reviewDigest: preview.reviewDigest };
    const completed = await publishRecovery(source, input, secret);
    expect(completed.phase).toBe('published'); expect(completed.issues).toEqual([]);
    expect(completed.publishedDbPath).not.toBe(source.dbPath);
    expect(db.prepare("SELECT amount FROM transactions WHERE id='tx'").pluck().get()).toBe('10.00');
    expect(() => assertFolderBinding(db, destination)).toThrow('replaced by reviewed recovery');
    const joined = joinLocalSync({ syncFolder: destination, passphrase: secret, newDbPath: path.join(root, 'joined.fdra') });
    expect(joined.success).toBe(true);
    if (joined.success) {
      const handle = openDatabase(joined.newDbPath!).db; opened.push(handle);
      expect(handle.prepare("SELECT amount FROM transactions WHERE id='tx'").pluck().get()).toBe('10.00');
      expect(readFolderManifest(destination, secret).version).toBe(2);
    }
    expect((await publishRecovery(source, input, secret)).publishedDbPath).toBe(completed.publishedDbPath);
  });
  it('blocks publication for unresolved conflicts, missing device baselines and changed mailbox histories', async () => {
    db.prepare("UPDATE personnel SET device_id='absent-device' WHERE id='owner'").run();
    const old = path.join(root, 'old'); fs.mkdirSync(old);
    const preview = await prepareRecovery(source, { mailboxes: [old], peerLedgers: [] }, secret);
    const destination = path.join(root, 'destination'); fs.mkdirSync(destination);
    const input = { id: preview.id, destinationFolder: destination, retiredDevices: [], confirmPausedClients: true, confirmReviewedChanges: true, reviewDigest: preview.reviewDigest };
    await expect(publishRecovery(source, input, secret)).rejects.toThrow('retire each known old device');
    expect(fs.readdirSync(destination)).toEqual([]);
    fs.mkdirSync(path.join(old, 'sync')); fs.writeFileSync(path.join(old,'sync','late.bundle'), 'late');
    await expect(publishRecovery(source, { ...input, retiredDevices: ['absent-device'] }, secret)).rejects.toThrow('refreshed recovery review');
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('requires review even for different values carrying a copied SQLite site identity', async () => {
    const other = peer();
    const local = currentChanges(db).find((row) => row.table === 'transactions' && row.cid === 'amount')!;
    copyChanges(other.db, [{ ...local, val: '88.00', col_version: local.col_version + 2, db_version: local.db_version + 2 }]);
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [other.file] }, secret);
    expect(preview.conflicts.find((item) => item.field === 'amount')?.remote).toBe('88.00');
    expect(preview.accounts[0].afterPence).toBe(1000);
  });
  it('retries an interrupted publication with pinned bytes and publishes the manifest last', async () => {
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [] }, secret);
    const destination = path.join(root, 'destination'); fs.mkdirSync(destination);
    const input = { id: preview.id, destinationFolder: destination, retiredDevices: [], confirmPausedClients: true, confirmReviewedChanges: true, reviewDigest: preview.reviewDigest };
    const originalCopy = fs.copyFileSync;
    const copy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => {
      if (String(to).startsWith(path.join(destination, 'snapshots'))) throw new Error('synthetic disk interruption');
      return originalCopy(from, to, flags);
    });
    await expect(publishRecovery(source, input, secret)).rejects.toThrow('synthetic disk interruption');
    expect(fs.existsSync(path.join(destination, '.fidra-sync'))).toBe(false);
    expect(recoveryPreview(source, preview.id, secret).phase).toBe('publishing');
    copy.mockRestore();
    const completed = await publishRecovery(source, input, secret);
    expect(completed.phase).toBe('published'); expect(fs.existsSync(path.join(destination, '.fidra-sync'))).toBe(true);
  });
  it('rolls back both transfer rows and their reviews if audit persistence fails', async () => {
    db.prepare("UPDATE transactions SET linked_id='partner' WHERE id='tx'").run();
    db.prepare("INSERT INTO transactions(id,date,amount,sheet,type,status,linked_id,created_at) VALUES ('partner','2026-11-28','10.00','Second','expense','approved','tx','2026-11-28T00:00:00.000Z')").run();
    const other = peer(); other.db.prepare("UPDATE transactions SET amount='25.00' WHERE id IN ('tx','partner')").run();
    const preview = await prepareRecovery(source, { mailboxes: [], peerLedgers: [other.file] }, secret);
    const stage = openDatabase(path.join(recoveryDirectory(source, preview.id), 'stage.fdra')).db;
    stage.exec("CREATE TRIGGER reject_review BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END"); stage.close();
    expect(() => resolveRecoveryChoice(source, preview.id, preview.conflicts[0].id, 'accept-remote', preview.reviewDigest, secret)).toThrow('synthetic audit failure');
    const after = recoveryPreview(source, preview.id, secret);
    expect(after.conflicts).toHaveLength(2); expect(after.accounts.map((item) => item.afterPence)).toEqual([1000,-1000]);
  });

});
