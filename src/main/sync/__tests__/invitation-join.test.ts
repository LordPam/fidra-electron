import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase } from '../../database/connection';
import { initializeCrr } from '../crr-schema';
import { createSnapshot } from '../compaction';
import { createInvitation, writeInvitationToken, readInvitationIdentity } from '../invitation';
import { readInviteToken, hashEmail } from '../invite-token';
import { joinLocalSync } from '../migration';

let root: string;
let folder: string;
const secret = 'test-only-team-secret';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-invitation-test-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  folder = path.join(root, 'shared'); fs.mkdirSync(folder);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function snapshot(): void {
  const { db } = openDatabase(path.join(root, 'source.fdra'));
  initializeCrr(db);
  createSnapshot(db, folder, crypto.randomUUID(), db.prepare('SELECT crsql_site_id()').pluck().get() as Buffer, 1, secret);
  db.close();
}

describe('invitation authentication', () => {
  it('wraps the group key with strong access material and authenticates the recipient', () => {
    const invite = createInvitation({ name: 'Sam', email: 'sam@example.test', role: 'member', team: 'Test club', groupId: crypto.randomUUID() });
    writeInvitationToken(folder, invite, secret);
    expect(readInviteToken(folder, invite.email, invite.code)).toBe(secret);
    expect(readInvitationIdentity(folder, invite.email, invite.code)).toEqual(invite);
    expect(invite.code).toHaveLength(64);
    const raw = fs.readFileSync(path.join(folder, 'invites', `${hashEmail(invite.email)}.invite`), 'utf8');
    expect(raw).not.toContain(secret);
    expect(() => readInviteToken(folder, invite.email, 'wrong')).toThrow();
    fs.copyFileSync(path.join(folder, 'invites', `${hashEmail(invite.email)}.invite`), path.join(folder, 'invites', `${hashEmail('other@example.test')}.invite`));
    expect(() => readInviteToken(folder, 'other@example.test', invite.code)).toThrow('does not match');
  });
  it('rejects an expired invitation even if the copied descriptor was edited', () => {
    const invite = createInvitation({ name: 'Sam', email: 'sam@example.test', role: 'member', team: 'Test club', groupId: crypto.randomUUID() });
    writeInvitationToken(folder, invite, secret);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    try { expect(() => readInviteToken(folder, invite.email, invite.code)).toThrow('expired'); }
    finally { vi.useRealTimers(); }
  });
});

describe('staged join', () => {
  it('never opens or deletes an existing target, even when the shared folder is missing', () => {
    const destination = path.join(root, 'existing.fdra'); fs.writeFileSync(destination, 'valuable');
    expect(joinLocalSync({ syncFolder: 'missing', passphrase: secret, newDbPath: destination }).success).toBe(false);
    expect(fs.readFileSync(destination, 'utf8')).toBe('valuable');
  });
  it('publishes only after activation succeeds, with a fresh site identity', () => {
    snapshot();
    const destination = path.join(root, 'joined.fdra');
    const result = joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination, afterImport: (db) => {
      expect(fs.existsSync(destination)).toBe(false);
      db.prepare("INSERT INTO settings (key, value) VALUES ('activation-test', 'finished')").run();
    } });
    expect(result).toMatchObject({ success: true, newDbPath: destination });
    const joined = openDatabase(destination).db;
    expect(joined.prepare("SELECT value FROM settings WHERE key='activation-test'").pluck().get()).toBe('finished');
    const source = openDatabase(path.join(root, 'source.fdra')).db;
    expect(joined.prepare('SELECT hex(crsql_site_id())').pluck().get()).not.toBe(source.prepare('SELECT hex(crsql_site_id())').pluck().get());
    source.close(); joined.close();
  });
  it('does not publish a database when account activation fails', () => {
    snapshot(); const destination = path.join(root, 'failed.fdra');
    const result = joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination, afterImport: () => { throw new Error('Activation failed'); } });
    expect(result).toMatchObject({ success: false, error: 'Activation failed' });
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.fidra-join-'))).toEqual([]);
  });
  it('preserves a destination that appears while the snapshot is being imported', () => {
    snapshot(); const destination = path.join(root, 'racing.fdra');
    const result = joinLocalSync({ syncFolder: folder, passphrase: secret, newDbPath: destination, afterImport: () => { fs.writeFileSync(destination, 'another file'); } });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(destination, 'utf8')).toBe('another file');
  });
});
