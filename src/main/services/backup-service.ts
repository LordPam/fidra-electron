import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SettingsRepo } from '../database/settings-repo';
import type { BackupMetadata, BackupListItem, BackupSettings } from '../../shared/ipc-types';

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
  trigger: BackupMetadata['trigger'],
  settings?: BackupSettings,
): Promise<BackupListItem> {
  const resolvedSettings = settings ?? {
    backupDir: null,
    retentionCount: DEFAULT_RETENTION,
    autoBackupOnClose: true,
  };
  const backupDir = resolveBackupDir(dbPath, resolvedSettings);
  const folderName = `backup_${formatTimestamp()}`;
  const backupFolder = path.join(backupDir, folderName);

  fs.mkdirSync(backupFolder, { recursive: true });

  // Atomic backup of SQLite database
  const dbFileName = path.basename(dbPath);
  const destDb = path.join(backupFolder, dbFileName);
  await db.backup(destDb);

  const dbSize = fs.statSync(destDb).size;

  // Copy attachments folder if it exists
  const attachmentsSrc = path.join(path.dirname(dbPath), ATTACHMENTS_FOLDER);
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
    createdAt: new Date().toISOString(),
    dbName: dbFileName,
    dbSize,
    attachmentsCount,
    attachmentsSize,
    trigger,
  };
  fs.writeFileSync(path.join(backupFolder, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Enforce retention
  enforceRetention(backupDir, resolvedSettings.retentionCount);

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

export async function restoreBackup(
  db: Database.Database,
  dbPath: string,
  backupPath: string,
  settingsRepo: SettingsRepo,
): Promise<{ success: boolean; error?: string }> {
  // Validate backup folder
  const dbFileName = path.basename(dbPath);
  const backupDbFile = path.join(backupPath, dbFileName);
  if (!fs.existsSync(backupDbFile)) {
    return { success: false, error: `Backup does not contain ${dbFileName}` };
  }

  // Create pre-restore safety backup
  try {
    const settings = getBackupSettings(settingsRepo);
    await createBackup(db, dbPath, 'pre-restore', settings);
  } catch (e) {
    return { success: false, error: `Failed to create safety backup: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Close the database before replacing
  db.close();

  try {
    // Replace the database file
    fs.copyFileSync(backupDbFile, dbPath);

    // Replace attachments if backup has them
    const backupAttachments = path.join(backupPath, ATTACHMENTS_FOLDER);
    const localAttachments = path.join(path.dirname(dbPath), ATTACHMENTS_FOLDER);
    if (fs.existsSync(backupAttachments)) {
      if (fs.existsSync(localAttachments)) {
        fs.rmSync(localAttachments, { recursive: true, force: true });
      }
      fs.cpSync(backupAttachments, localAttachments, { recursive: true });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: `Restore failed: ${e instanceof Error ? e.message : String(e)}` };
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

function enforceRetention(backupDir: string, retentionCount: number): void {
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
      backupFolders.push({ name: entry.name, createdAt: metadata.createdAt });
    } catch {
      // Skip corrupt entries
    }
  }

  // Sort oldest first
  backupFolders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Remove oldest backups exceeding retention
  while (backupFolders.length > retentionCount) {
    const oldest = backupFolders.shift()!;
    const folderPath = path.join(backupDir, oldest.name);
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
