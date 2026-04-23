import fs from 'node:fs';
import path from 'node:path';
import { bundleFileName } from './bundle-format';
import { syncLog, errorMessage } from './sync-log';

const BUNDLE_EXT = '.bundle';
const SYNC_SUBDIR = 'sync';
const SNAPSHOTS_SUBDIR = 'snapshots';
const INVITES_SUBDIR = 'invites';

/** Known sync subdirectory names — used for folder validation. */
const SYNC_SUBDIRS = [SYNC_SUBDIR, SNAPSHOTS_SUBDIR, 'attachments', INVITES_SUBDIR] as const;

// ─── Path safety ─────────────────────────────────────────────────────

function assertWithinFolder(base: string, target: string): void {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path traversal blocked: ${target} resolves outside ${base}`);
  }
}

// ─── Folder structure ────────────────────────────────────────────────

export function ensureSyncFolderStructure(syncFolder: string): void {
  for (const sub of SYNC_SUBDIRS) {
    const dir = path.join(syncFolder, sub);
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Bundle filename helpers ─────────────────────────────────────────

export function isBundleFile(filename: string): boolean {
  return filename.endsWith(BUNDLE_EXT);
}

const BUNDLE_FILENAME_RE = /^(.+)_(\d{10})\.bundle$/;

export function parseBundleFilename(
  filename: string,
): { deviceId: string; sequenceNumber: number } | null {
  const match = BUNDLE_FILENAME_RE.exec(filename);
  if (!match) return null;
  return {
    deviceId: match[1],
    sequenceNumber: Number(match[2]),
  };
}

// ─── Read / Write ────────────────────────────────────────────────────

export function writeBundleAtomically(
  syncFolder: string,
  deviceId: string,
  sequenceNumber: number,
  data: Buffer,
): string {
  if (deviceId.includes('..') || deviceId.includes(path.sep)) {
    throw new Error(`Invalid deviceId: ${deviceId}`);
  }

  const syncDir = path.join(syncFolder, SYNC_SUBDIR);
  fs.mkdirSync(syncDir, { recursive: true });

  const filename = bundleFileName(deviceId, sequenceNumber);
  const finalPath = path.join(syncDir, filename);
  assertWithinFolder(syncDir, finalPath);

  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    syncLog('error', 'writeBundleAtomically failed', { finalPath, error: errorMessage(e) });
    throw e;
  }

  return finalPath;
}

export function readBundleFile(filePath: string): Buffer {
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    syncLog('warn', 'readBundleFile failed', { filePath, code, error: errorMessage(e) });
    throw e;
  }
}

// ─── Snapshot filename helpers ──────────────────────────────────────

const SNAPSHOT_EXT = '.snapshot';

export function isSnapshotFile(filename: string): boolean {
  return filename.endsWith(SNAPSHOT_EXT);
}

// Format: snap_{deviceId}_{sequenceNumber:10d}.snapshot
const SNAPSHOT_FILENAME_RE = /^snap_(.+)_(\d{10})\.snapshot$/;

export function parseSnapshotFilename(
  filename: string,
): { deviceId: string; sequenceNumber: number } | null {
  const match = SNAPSHOT_FILENAME_RE.exec(filename);
  if (!match) return null;
  return {
    deviceId: match[1],
    sequenceNumber: Number(match[2]),
  };
}

export function snapshotFileName(deviceId: string, sequenceNumber: number): string {
  const padded = String(sequenceNumber).padStart(10, '0');
  return `snap_${deviceId}_${padded}${SNAPSHOT_EXT}`;
}

export function writeSnapshotAtomically(
  syncFolder: string,
  deviceId: string,
  sequenceNumber: number,
  data: Buffer,
): string {
  if (deviceId.includes('..') || deviceId.includes(path.sep)) {
    throw new Error(`Invalid deviceId: ${deviceId}`);
  }

  const snapshotsDir = path.join(syncFolder, SNAPSHOTS_SUBDIR);
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const filename = snapshotFileName(deviceId, sequenceNumber);
  const finalPath = path.join(snapshotsDir, filename);
  assertWithinFolder(snapshotsDir, finalPath);

  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    syncLog('error', 'writeSnapshotAtomically failed', { finalPath, error: errorMessage(e) });
    throw e;
  }

  return finalPath;
}

export function readSnapshotFile(filePath: string): Buffer {
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    syncLog('warn', 'readSnapshotFile failed', { filePath, code, error: errorMessage(e) });
    throw e;
  }
}

export function findLatestSnapshot(
  syncFolder: string,
): { filePath: string; deviceId: string; sequenceNumber: number } | null {
  const snapshotsDir = path.join(syncFolder, SNAPSHOTS_SUBDIR);

  let entries: string[];
  try {
    entries = fs.readdirSync(snapshotsDir);
  } catch {
    return null;
  }

  let best: { filePath: string; deviceId: string; sequenceNumber: number } | null = null;

  for (const entry of entries) {
    if (!isSnapshotFile(entry)) continue;
    const parsed = parseSnapshotFilename(entry);
    if (!parsed) continue;
    if (!best || parsed.sequenceNumber > best.sequenceNumber) {
      best = {
        filePath: path.join(snapshotsDir, entry),
        deviceId: parsed.deviceId,
        sequenceNumber: parsed.sequenceNumber,
      };
    }
  }

  return best;
}

// ─── Sync folder validation ──────────────────────────────────────────

/** Check if a sync folder already has bundles or snapshots from other devices. */
export function syncFolderHasExistingPeers(syncFolder: string): boolean {
  for (const sub of [SYNC_SUBDIR, SNAPSHOTS_SUBDIR]) {
    const dir = path.join(syncFolder, sub);
    try {
      const entries = fs.readdirSync(dir);
      const check = sub === SYNC_SUBDIR ? isBundleFile : isSnapshotFile;
      if (entries.some(check)) return true;
    } catch {
      // Directory doesn't exist — no peers there
    }
  }
  return false;
}

export type SyncFolderValidation =
  | { valid: true; warning?: undefined; message?: undefined }
  | { valid: false; reason: string; message: string }
  | { valid: true; warning: string; message: string };

/**
 * Validate a folder path before using it as a sync folder.
 * Catches common mistakes: selecting a subdirectory of an existing sync root,
 * or a parent directory that contains a sync root as a child.
 */
export function validateSyncFolder(folderPath: string): SyncFolderValidation {
  const basename = path.basename(folderPath).toLowerCase();

  // Check 1: folder name is a known sync subdirectory name
  if ((SYNC_SUBDIRS as readonly string[]).includes(basename)) {
    return {
      valid: false,
      reason: 'subdirectory-name',
      message: `"${basename}" looks like a sync subdirectory. Select its parent folder instead.`,
    };
  }

  // Check 2: folder directly contains .bundle or .snapshot files (it IS a subdirectory)
  try {
    const entries = fs.readdirSync(folderPath);
    if (entries.some((e) => isBundleFile(e) || isSnapshotFile(e))) {
      return {
        valid: false,
        reason: 'contains-sync-files',
        message: 'This folder contains sync data files directly. It appears to be a sync subdirectory — select the parent folder instead.',
      };
    }
  } catch {
    // Can't read — folder may not exist yet, which is fine
  }

  // Check 3: folder has sync/snapshots subdirs with data (existing sync root)
  if (syncFolderHasExistingPeers(folderPath)) {
    return {
      valid: true,
      warning: 'existing-sync-root',
      message: 'This folder already contains sync data. Re-attaching is OK if this is intentional.',
    };
  }

  // Check 4: a child directory has sync structure (user selected the parent of a sync root)
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childPath = path.join(folderPath, entry.name);
      if (syncFolderHasExistingPeers(childPath)) {
        return {
          valid: true,
          warning: 'child-is-sync-root',
          message: `Subfolder "${entry.name}" appears to be a sync root. Did you mean to select that folder instead?`,
        };
      }
    }
  } catch {
    // Can't enumerate children — fine
  }

  return { valid: true };
}
