import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { createBackup, restoreBackup, listBackups } from '../backup-service';
import { SettingsRepo } from '../../database/settings-repo';

let dir: string;
let dbPath: string;
let db: Database.Database;
let settingsRepo: SettingsRepo;
const databaseId = crypto.randomUUID();

function openDb(): Database.Database {
  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  return handle;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-backup-'));
  dbPath = path.join(dir, 'ledger.fdra');
  db = openDb();
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'device'
    );
    CREATE TABLE transactions (id TEXT PRIMARY KEY NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '');
  `);
  settingsRepo = new SettingsRepo(db);
  settingsRepo.setSetting('backup.dir', path.join(dir, 'backups'), 'device');
});

afterEach(() => {
  try {
    db.close();
  } catch { /* already closed by a restore */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('restoreBackup', () => {
  it('restores the backed-up contents over later changes', async () => {
    db.prepare("INSERT INTO transactions (id, description) VALUES ('t1', 'in backup')").run();
    const backup = await createBackup(db, dbPath, databaseId, 'manual');
    db.prepare("INSERT INTO transactions (id, description) VALUES ('t2', 'added after backup')").run();

    const result = await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);
    expect(result).toMatchObject({ success: true, dbClosed: true });

    const reopened = openDb();
    expect(reopened.prepare('SELECT id FROM transactions').all()).toEqual([{ id: 't1' }]);
    reopened.close();
  });

  it('removes -wal/-shm left behind by another holder of the file', async () => {
    // A second connection keeps the WAL alive across our close(), which is what
    // happens when something else still has the database open. Without removing the
    // sidecars, SQLite replays that WAL over the restored file on the next open.
    const holder = openDb();
    try {
      db.prepare("INSERT INTO transactions (id, description) VALUES ('t1', 'in backup')").run();
      const backup = await createBackup(db, dbPath, databaseId, 'manual');
      db.prepare("INSERT INTO transactions (id, description) VALUES ('t2', 'lives in the WAL')").run();
      expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);

      const result = await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);
      expect(result.success).toBe(true);

      expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    } finally {
      try {
        holder.close();
      } catch { /* its view of the file is gone */ }
    }

    // Deliberately not asserting the restored contents here: a second connection
    // that is still alive checkpoints its own stale pages back over the file when it
    // closes, whatever the sidecars do. Removing them is necessary but not
    // sufficient — that is why backup:restore refuses to run at all while another
    // window holds the same file.
  });

  it('reports the connection still open when validation fails', async () => {
    const empty = path.join(dir, 'not-a-backup');
    fs.mkdirSync(empty);

    const result = await restoreBackup(db, dbPath, databaseId, empty, settingsRepo);

    expect(result.success).toBe(false);
    expect(result.dbClosed).toBe(false);
    // Caller must not tear down a connection that is still usable
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get()).toEqual({ c: 0 });
  });

  it('takes a pre-restore safety backup', async () => {
    const backup = await createBackup(db, dbPath, databaseId, 'manual');
    db.prepare("INSERT INTO transactions (id, description) VALUES ('t2', 'only in safety backup')").run();

    await restoreBackup(db, dbPath, databaseId, backup.path, settingsRepo);

    const folders = fs.readdirSync(path.join(dir, 'backups'));
    const safety = folders.filter((name) => {
      const meta = path.join(dir, 'backups', name, 'metadata.json');
      return fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, 'utf-8')).trigger === 'pre-restore';
    });
    expect(safety).toHaveLength(1);

    // It captured the state being replaced, not the state being restored
    const safetyDb = new Database(path.join(dir, 'backups', safety[0], 'ledger.fdra'));
    expect(safetyDb.prepare('SELECT id FROM transactions').all()).toEqual([{ id: 't2' }]);
    safetyDb.close();
  });
});

describe('backup identity and retention', () => {
  it('protects the chosen restore target and the safety backup even with retention one', async () => {
    settingsRepo.setSetting('backup.retentionCount', '1');
    const target = await createBackup(db, dbPath, databaseId, 'manual', { backupDir: path.join(dir, 'backups'), retentionCount: 1, autoBackupOnClose: true });
    expect((await restoreBackup(db, dbPath, databaseId, target.path, settingsRepo)).success).toBe(true);
    const backups = listBackups(dbPath, { backupDir: path.join(dir, 'backups'), retentionCount: 1, autoBackupOnClose: true });
    expect(backups.map((backup) => backup.metadata.trigger).sort()).toEqual(['manual', 'pre-restore']);
  });
  it('never removes another ledger’s backup from a shared backup folder', async () => {
    const settings = { backupDir: path.join(dir, 'shared'), retentionCount: 1, autoBackupOnClose: true };
    const other = await createBackup(db, dbPath, 'different-ledger', 'manual', settings);
    await createBackup(db, dbPath, databaseId, 'manual', settings);
    await createBackup(db, dbPath, databaseId, 'manual', settings);
    expect(fs.existsSync(other.path)).toBe(true);
    expect(listBackups(dbPath, settings)).toHaveLength(2);
  });
  it('does not replace or close the live database when post-backup authority changes', async () => {
    const target = await createBackup(db, dbPath, databaseId, 'manual');
    const result = await restoreBackup(db, dbPath, databaseId, target.path, settingsRepo, () => { throw new Error('Permission revoked'); });
    expect(result).toMatchObject({ success: false, dbClosed: false, error: expect.stringContaining('Permission revoked') });
    expect(db.open).toBe(true);
  });
});
