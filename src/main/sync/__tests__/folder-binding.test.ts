import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertFolderBinding, bindExistingSyncFolder, getFolderBinding, initializeOrBindSyncFolder, readFolderManifest } from '../folder-binding';
import { encryptAndSign } from '../bundle-crypto';

let root: string;
let folder: string;
let db: Database.Database;
const secret = 'test-only-folder-secret';
function open(file: string): Database.Database {
  const result = new Database(file);
  result.exec(`CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, scope TEXT DEFAULT 'device');`);
  return result;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-folder-binding-'));
  folder = path.join(root, 'shared');
  fs.mkdirSync(folder);
  db = open(path.join(root, 'local.sqlite'));
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('persistent sync-folder binding', () => {
  test('pins encrypted team identity and survives a real SQLite close/reopen', () => {
    const initial = initializeOrBindSyncFolder(db, folder, secret);
    expect(fs.readFileSync(path.join(folder, '.fidra-sync'), 'utf8')).not.toContain(initial.groupId);
    db.close();
    db = open(path.join(root, 'local.sqlite'));
    expect(assertFolderBinding(db, folder)).toEqual(initial);
  });

  test('refuses a copied root after restart until an explicit matching reconnect', () => {
    const original = initializeOrBindSyncFolder(db, folder, secret);
    const old = path.join(root, 'old');
    fs.renameSync(folder, old);
    fs.cpSync(old, folder, { recursive: true });
    db.close();
    db = open(path.join(root, 'local.sqlite'));
    expect(() => assertFolderBinding(db, folder)).toThrow('replaced or moved');
    expect(bindExistingSyncFolder(db, folder, secret).groupId).toBe(original.groupId);
    expect(assertFolderBinding(db, folder).locationId).toBe(original.locationId);
  });

  test('never recreates missing roots or missing identity files', () => {
    initializeOrBindSyncFolder(db, folder, secret);
    fs.unlinkSync(path.join(folder, '.fidra-sync'));
    expect(() => initializeOrBindSyncFolder(db, folder, secret)).toThrow('missing');
    expect(fs.readdirSync(folder)).toEqual([]);
    fs.rmdirSync(folder);
    expect(() => assertFolderBinding(db, folder)).toThrow();
    expect(fs.existsSync(folder)).toBe(false);
  });

  test('preserves existing binding on wrong team, wrong key or another mailbox', () => {
    const original = initializeOrBindSyncFolder(db, folder, secret);
    const manifestFile = path.join(folder, '.fidra-sync');
    const originalBytes = fs.readFileSync(manifestFile);
    const manifest = readFolderManifest(folder, secret);
    expect(() => bindExistingSyncFolder(db, folder, 'wrong')).toThrow();
    fs.writeFileSync(manifestFile, encryptAndSign(Buffer.from(JSON.stringify({ ...manifest, groupId: crypto.randomUUID() })), secret));
    expect(() => bindExistingSyncFolder(db, folder, secret)).toThrow('does not match');
    fs.writeFileSync(manifestFile, encryptAndSign(Buffer.from(JSON.stringify({ ...manifest, locationId: crypto.randomUUID() })), secret));
    expect(() => bindExistingSyncFolder(db, folder, secret)).toThrow('different team mailbox');
    expect(getFolderBinding(db)).toEqual(original);
    fs.writeFileSync(manifestFile, originalBytes);
    expect(assertFolderBinding(db, folder)).toEqual(original);
  });

  test('does not adopt legacy history based only on knowledge of the passphrase', () => {
    fs.mkdirSync(path.join(folder, 'sync'));
    const history = path.join(folder, 'sync', 'old.bundle');
    fs.writeFileSync(history, 'keep this history');
    expect(() => initializeOrBindSyncFolder(db, folder, secret)).toThrow('reviewed identity upgrade');
    expect(fs.readFileSync(history, 'utf8')).toBe('keep this history');
    expect(getFolderBinding(db)).toBeNull();
  });

  test('does not fork an existing team into a new empty mailbox', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('localSync.groupId', ?)").run(crypto.randomUUID());
    expect(() => initializeOrBindSyncFolder(db, folder, secret)).toThrow('existing team');
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  test('retries a failed first setup with the original staged identity', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('provider unavailable'); });
    expect(() => initializeOrBindSyncFolder(db, folder, secret)).toThrow('provider unavailable');
    const originalGroup = db.prepare("SELECT value FROM settings WHERE key = 'localSync.groupId'").pluck().get();
    write.mockRestore();
    expect(initializeOrBindSyncFolder(db, folder, secret).groupId).toBe(originalGroup);
  });
});
