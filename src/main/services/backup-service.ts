import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SettingsRepo } from '../database/settings-repo';
import type { BackupMetadata, BackupListItem, BackupSettings } from '../../shared/ipc-types';
import { getAttachmentStoragePath } from '../database/connection';

const DEFAULT_RETENTION = 10;
const ATTACHMENTS_FOLDER = 'fidra_attachments';

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '_',
    pad(now.getMilliseconds(), 3),
  ].join('');
}

function resolveBackupDir(dbPath: string, settings: BackupSettings): string {
  if (settings.backupDir) return settings.backupDir;
  const dbDir = path.dirname(dbPath);
  const dbStem = path.basename(dbPath, path.extname(dbPath));
  return path.join(dbDir, `${dbStem}_backups`);
}

function dirSize(dir: string): { count: number; size: number } {
  let count = 0;
  let size = 0;
  if (!fs.existsSync(dir)) return { count, size };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) {
      count++;
      size += fs.statSync(fullPath).size;
    } else if (entry.isDirectory()) {
      const sub = dirSize(fullPath);
      count += sub.count;
      size += sub.size;
    }
  }
  return { count, size };
}

export function getBackupSettings(settingsRepo: SettingsRepo): BackupSettings {
  const dir = settingsRepo.getSetting('backup.dir');
  const retention = settingsRepo.getSetting('backup.retentionCount');
  const autoClose = settingsRepo.getSetting('backup.autoBackupOnClose');
  return {
    backupDir: dir,
    retentionCount: retention ? parseInt(retention, 10) : DEFAULT_RETENTION,
    autoBackupOnClose: autoClose !== 'false',
  };
}

export function saveBackupSettings(settingsRepo: SettingsRepo, settings: BackupSettings): void {
  if (settings.backupDir) {
    settingsRepo.setSetting('backup.dir', settings.backupDir, 'device');
  } else {
    settingsRepo.deleteSetting('backup.dir');
  }
  settingsRepo.setSetting('backup.retentionCount', String(settings.retentionCount), 'device');
  settingsRepo.setSetting('backup.autoBackupOnClose', String(settings.autoBackupOnClose), 'device');
}

export async function createBackup(
  db: Database.Database,
  dbPath: string,
  databaseId: string,
  trigger: BackupMetadata['trigger'],
  settings?: BackupSettings,
  protectedPaths: readonly string[] = [],
  requestKey?: string,
): Promise<BackupListItem> {
  const resolvedSettings = settings ?? {
    backupDir: null,
    retentionCount: DEFAULT_RETENTION,
    autoBackupOnClose: true,
  };
  const backupDir = resolveBackupDir(dbPath, resolvedSettings);
  const folderName = `backup_${formatTimestamp()}_${crypto.randomUUID().slice(0, 8)}`;
  const backupFolder = path.join(backupDir, folderName);

  fs.mkdirSync(backupFolder, { recursive: true });

  // Atomic backup of SQLite database
  const dbFileName = path.basename(dbPath);
  const destDb = path.join(backupFolder, dbFileName);
  await db.backup(destDb);

  const dbSize = fs.statSync(destDb).size;

  // Copy attachments folder if it exists (new location: ~/.fidra/attachments/<databaseId>/)
  const attachmentsSrc = getAttachmentStoragePath(databaseId);
  let attachmentsCount = 0;
  let attachmentsSize = 0;
  if (fs.existsSync(attachmentsSrc)) {
    const attachmentsDest = path.join(backupFolder, ATTACHMENTS_FOLDER);
    fs.cpSync(attachmentsSrc, attachmentsDest, { recursive: true });
    const stats = dirSize(attachmentsDest);
    attachmentsCount = stats.count;
    attachmentsSize = stats.size;
  }

  // Write metadata
  const metadata: BackupMetadata = {
    id: crypto.randomUUID(),
    databaseId,
    ...(requestKey ? { requestKey } : {}),
    createdAt: new Date().toISOString(),
    dbName: dbFileName,
    dbSize,
    attachmentsCount,
    attachmentsSize,
    trigger,
  };
  fs.writeFileSync(path.join(backupFolder, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Enforce retention
  enforceRetention(backupDir, resolvedSettings.retentionCount, databaseId, protectedPaths);

  return { path: backupFolder, metadata };
}

export function listBackups(dbPath: string, settings?: BackupSettings): BackupListItem[] {
  const resolvedSettings = settings ?? {
    backupDir: null,
    retentionCount: DEFAULT_RETENTION,
    autoBackupOnClose: true,
  };
  const backupDir = resolveBackupDir(dbPath, resolvedSettings);

  if (!fs.existsSync(backupDir)) return [];

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const backups: BackupListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;
    const backupFolder = path.join(backupDir, entry.name);
    const metadataPath = path.join(backupFolder, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;
    try {
      const raw = fs.readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(raw) as BackupMetadata;
      backups.push({ path: backupFolder, metadata });
    } catch {
      // Skip corrupt metadata
    }
  }

  // Sort newest first
  backups.sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
  return backups;
}

/**
 * Replace the live database with a backup copy.
 *
 * The caller must stop anything holding the connection (Local Sync) first, and must
 * rebuild the window's context afterwards — `dbClosed` says whether the connection
 * was closed, which happens whether or not the restore itself succeeded.
 */
export async function restoreBackup(
  db: Database.Database,
  dbPath: string,
  databaseId: string,
  backupPath: string,
  settingsRepo: SettingsRepo,
  beforeReplace?: () => void,
): Promise<{ success: boolean; error?: string; dbClosed: boolean }> {
  // Validate backup folder
  const dbFileName = path.basename(dbPath);
  const backupDbFile = path.join(backupPath, dbFileName);
  if (!fs.existsSync(backupDbFile)) {
    return { success: false, error: `Backup does not contain ${dbFileName}`, dbClosed: false };
  }

  // Create pre-restore safety backup
  try {
    const settings = getBackupSettings(settingsRepo);
    await createBackup(db, dbPath, databaseId, 'pre-restore', settings, [backupPath]);
    // The safety backup yields: authority and same-file window checks may have changed.
    beforeReplace?.();
  } catch (e) {
    return {
      success: false,
      error: `Failed to create safety backup: ${e instanceof Error ? e.message : String(e)}`,
      dbClosed: false,
    };
  }

  // Fold the WAL into the main database and empty it before closing.
  //
  // The WAL holds committed pages that are not yet in the main file. Replace the
  // main file while those are outstanding and SQLite replays them over the restored
  // data on the next open — the restore appears to succeed and silently does nothing.
  //
  // Truncating is what makes that safe. Deleting the sidecars instead, which is what
  // this did first, leaves SQLite's own state referring to files that no longer
  // exist, and the next open of that path fails with "disk I/O error" — verified in
  // backup-with-crsqlite.test.ts, and it only reproduces with the cr-sqlite extension
  // loaded, which the app always does.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // A checkpoint can be blocked by another reader. Carry on: the removal below is
    // the fallback, and the caller has already refused to run with a second window open.
  }
  db.close();

  try {
    // Belt and braces for a WAL left behind by a holder we could not checkpoint.
    // Safe now only because the checkpoint above has already emptied ours.
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });

    // Replace the database file
    fs.copyFileSync(backupDbFile, dbPath);

    // Replace attachments if backup has them
    const backupAttachments = path.join(backupPath, ATTACHMENTS_FOLDER);
    const localAttachments = getAttachmentStoragePath(databaseId);
    if (fs.existsSync(backupAttachments)) {
      if (fs.existsSync(localAttachments)) {
        fs.rmSync(localAttachments, { recursive: true, force: true });
      }
      fs.mkdirSync(path.dirname(localAttachments), { recursive: true });
      fs.cpSync(backupAttachments, localAttachments, { recursive: true });
    }

    return { success: true, dbClosed: true };
  } catch (e) {
    return {
      success: false,
      error: `Restore failed: ${e instanceof Error ? e.message : String(e)}`,
      dbClosed: true,
    };
  }
}

export function deleteBackup(backupPath: string): boolean {
  try {
    if (!fs.existsSync(backupPath)) return false;
    fs.rmSync(backupPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function enforceRetention(backupDir: string, retentionCount: number, databaseId: string, protectedPaths: readonly string[]): void {
  if (!fs.existsSync(backupDir)) return;

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const backupFolders: { name: string; createdAt: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;
    const metadataPath = path.join(backupDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;
    try {
      const raw = fs.readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(raw) as BackupMetadata;
      // Legacy metadata cannot distinguish two same-named ledgers in a shared
      // backup folder. Keep those backups for explicit native removal.
      if (metadata.databaseId !== databaseId) continue;
      if (protectedPaths.some((protectedPath) => path.resolve(protectedPath) === path.resolve(backupDir, entry.name))) continue;
      backupFolders.push({ name: entry.name, createdAt: metadata.createdAt });
    } catch {
      // Skip corrupt entries
    }
  }

  // Sort oldest first
  backupFolders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Remove oldest backups exceeding retention
  while (backupFolders.length > retentionCount) {
    const oldest = backupFolders.shift();
    if (!oldest) break;
    const folderPath = path.join(backupDir, oldest.name);
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
