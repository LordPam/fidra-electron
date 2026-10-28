import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { loadCrSqlite } from '../../database/crsqlite-lifecycle';
import { createBackup, restoreBackup } from '../backup-service';
import { SettingsRepo } from '../../database/settings-repo';

/**
 * Restore, exercised the way the app actually runs: with the cr-sqlite extension
 * loaded. `openDatabase` loads it on every connection, so the app is never without
 * it — and this failure only appears when it is present, which is why
 * backup-service.test.ts (a bare better-sqlite3 handle) missed it entirely.
 *
 * Two bugs live here, and a fix for either one alone reintroduces the other:
 *
 *   Leave the WAL alone      the pages it holds get replayed over the restored file,
 *                            so the restore silently does nothing.
 *   Delete the WAL files     SQLite's state still refers to them and the next open
 *                            of that path throws "disk I/O error", so the restore
 *                            reports failure and the window is left with no database.
 *
 * The answer is to checkpoint(TRUNCATE) before closing, which empties the WAL without
 * removing anything SQLite is still tracking.
 */

let dir: string;
let dbPath: string;
let db: Database.Database;
let settingsRepo: SettingsRepo;
const databaseId = crypto.randomUUID();

/** Open the way `openDatabase` does — WAL plus the extension. */
function open(): Database.Database {
  const handle = new Database(dbPath);
  loadCrSqlite(handle);
  handle.pragma('journal_mode = WAL');
  return handle;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-backup-crr-'));
  dbPath = path.join(dir, 'ledger.fdra');
  db = open();
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'device'
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT ''
    );
  `);
  settingsRepo = new SettingsRepo(db);
});

afterEach(() => {
  try { db.close(); } catch { /* restore already closed it */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('restore with cr-sqlite loaded', () => {
  it('discards changes made after the backup', async () => {
    db.prepare("INSERT INTO transactions (id, description) VALUES ('keep', 'in backup')").run();
    const backup = await createBackup(db, dbPath, databaseId, 'manual');
    db.prepare("INSERT INTO transactions (id, description) VALUES ('drop', 'after backup')").run();

    const result = await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);
    expect(result).toMatchObject({ success: true, dbClosed: true });

    const reopened = open();
    // 'drop' lived only in the WAL. If the WAL is replayed it survives here, and the
    // restore quietly did nothing.
    expect(reopened.prepare('SELECT id FROM transactions').all()).toEqual([{ id: 'keep' }]);
    reopened.close();
  });

  it('leaves the database openable afterwards', async () => {
    db.prepare("INSERT INTO transactions (id, description) VALUES ('keep', 'in backup')").run();
    const backup = await createBackup(db, dbPath, databaseId, 'manual');
    db.prepare("INSERT INTO transactions (id, description) VALUES ('drop', 'after backup')").run();

    await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);

    // This is what the app does next, via reopenWindowDatabase. Deleting the WAL
    // sidecars rather than truncating them made this throw "disk I/O error", leaving
    // the window with no usable database.
    expect(() => {
      const reopened = open();
      reopened.prepare('SELECT COUNT(*) FROM transactions').get();
      reopened.close();
    }).not.toThrow();
  });

  it('can be restored from twice in a row', async () => {
    const backup = await createBackup(db, dbPath, databaseId, 'manual');

    await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);

    // Reopen the way reopenWindowDatabase does — a new connection *and* new repos.
    // Reusing the old SettingsRepo here fails, because it still holds the closed
    // handle; that is a property of the caller, not of restore.
    db = open();
    settingsRepo = new SettingsRepo(db);

    const second = await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);

    expect(second.error).toBeUndefined();
    expect(second.success).toBe(true);
  });
});
