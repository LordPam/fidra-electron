import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { bundleFileName, unpackBundle, serializeChangesetRow } from './bundle-format';
import { contextCovers, contextIncludes, assertSnapshotCausalContext } from './causal-context';
import { syncLog, errorMessage } from './sync-log';

const BUNDLE_EXT = '.bundle';
const SYNC_SUBDIR = 'sync';
const SNAPSHOTS_SUBDIR = 'snapshots';
const INVITES_SUBDIR = 'invites';

/** Known sync subdirectory names — used for folder validation. */
const SYNC_SUBDIRS = [SYNC_SUBDIR, SNAPSHOTS_SUBDIR, 'attachments', INVITES_SUBDIR, 'receipts'] as const;

// ─── Path safety ─────────────────────────────────────────────────────

function assertWithinFolder(base: string, target: string): void {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path traversal blocked: ${target} resolves outside ${base}`);
  }
}

// ─── Folder structure ────────────────────────────────────────────────

/** Normal sync must never recreate a vanished cloud-provider root. */
export function assertSyncRootExists(syncFolder: string): void {
  const stat = fs.lstatSync(syncFolder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('The sync folder must be an existing directory. Reconnect Local Sync to its current location.');
  }
}

/** Create only a direct child, never missing provider ancestors. */
export function ensureSyncSubdirectory(syncFolder: string, subdirectory: typeof SYNC_SUBDIRS[number]): string {
  assertSyncRootExists(syncFolder);
  const dir = path.join(syncFolder, subdirectory);
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`The sync ${subdirectory} directory was replaced. Reconnect Local Sync before continuing.`);
  }
  return dir;
}

export function ensureSyncFolderStructure(syncFolder: string): void {
  for (const sub of SYNC_SUBDIRS) {
    ensureSyncSubdirectory(syncFolder, sub);
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
  if (deviceId.includes('..') || /[\\/]/.test(deviceId)) {
    throw new Error(`Invalid deviceId: ${deviceId}`);
  }

  const filename = bundleFileName(deviceId, sequenceNumber);
  return writeSyncFileExclusively(syncFolder, SYNC_SUBDIR, filename, data);
}

/** Publish immutable authenticated files without overwriting a competing history. */
export function writeSyncFileExclusively(
  syncFolder: string,
  subdirectory: typeof SYNC_SUBDIRS[number],
  filename: string,
  data: Buffer,
): string {
  if (filename.includes('..') || /[\\/\0]/.test(filename)) throw new Error('Invalid sync filename');
  const syncDir = ensureSyncSubdirectory(syncFolder, subdirectory);
  const finalPath = path.join(syncDir, filename);
  assertWithinFolder(syncDir, finalPath);

  // Bundle identities are immutable. A retry may find the exact same bytes;
  // different bytes under the same name require review, never replacement.
  if (fs.existsSync(finalPath)) {
    if (fs.readFileSync(finalPath).equals(data)) return finalPath;
    throw new Error(`Sync bundle collision: ${filename}. Existing history was preserved.`);
  }

  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, data, { flag: 'wx', flush: true });
    // COPYFILE_EXCL prevents a competing window/device from replacing history.
    // Readers authenticate the entire bundle and retry any incomplete copy.
    try {
      fs.copyFileSync(tmpPath, finalPath, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
        || !fs.readFileSync(finalPath).equals(data)) throw error;
    }
    if (!fs.readFileSync(finalPath).equals(data)) throw new Error(`Sync bundle verification failed: ${filename}`);
    fs.unlinkSync(tmpPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    syncLog('error', 'writeBundleAtomically failed', { finalPath, error: errorMessage(e) });
    throw e;
  }

  return finalPath;
}

export function readBundleFile(filePath: string): Buffer {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150 * 1024 * 1024) throw new Error('Invalid or oversized sync bundle file.');
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
const SNAPSHOT_FILENAME_RE = /^snap_(.+)_(\d{10})(?:_([a-f0-9]{64}))?\.snapshot$/;

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
  if (deviceId.includes('..') || /[\\/]/.test(deviceId)) {
    throw new Error(`Invalid deviceId: ${deviceId}`);
  }

  const digest = createHash('sha256').update(data).digest('hex');
  const legacyName = snapshotFileName(deviceId, sequenceNumber);
  const filename = `${legacyName.slice(0, -SNAPSHOT_EXT.length)}_${digest}${SNAPSHOT_EXT}`;
  return writeSyncFileExclusively(syncFolder, SNAPSHOTS_SUBDIR, filename, data);
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
  passphrase: string,
  expectedGroupId: string,
): { filePath: string; deviceId: string; sequenceNumber: number } | null {
  const snapshotsDir = path.join(syncFolder, SNAPSHOTS_SUBDIR);

  let entries: string[];
  try {
    entries = fs.readdirSync(snapshotsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const candidates: { filePath: string; deviceId: string; sequenceNumber: number; bundle: ReturnType<typeof unpackBundle>; stateHash: string }[] = [];
  for (const entry of entries) {
    if (!isSnapshotFile(entry)) continue;
    const parsed = parseSnapshotFilename(entry);
    if (!parsed) throw new Error('An unrecognised snapshot filename needs review. It may be a provider conflict copy.');
    const filePath = path.join(snapshotsDir, entry);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150 * 1024 * 1024) throw new Error('Invalid snapshot file. Review is required.');
    const bytes = readSnapshotFile(filePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!entry.endsWith(`_${digest}${SNAPSHOT_EXT}`)) throw new Error('Legacy or incomplete snapshot needs reviewed recovery.');
    const bundle = unpackBundle(bytes, passphrase);
    if (bundle.version !== 2 || bundle.groupId !== expectedGroupId || bundle.deviceId !== parsed.deviceId
      || bundle.snapshotGeneration !== parsed.sequenceNumber || !bundle.causalState || !bundle.observedBundles
      || (bundle.sequenceNumber > 0 && !contextIncludes(bundle.observedBundles, bundle.deviceId, bundle.sequenceNumber))) {
      throw new Error('Snapshot identity or causal coverage is incomplete. Review its history before joining.');
    }
    assertSnapshotCausalContext(bundle.causalState, bundle.observedBundles);
    const state = bundle.changesets.map((row) => {
      const serialized = serializeChangesetRow(row);
      return JSON.stringify({ ...serialized, db_version: 0 });
    }).sort();
    candidates.push({ filePath, ...parsed, bundle, stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex') });
  }
  if (candidates.length === 0) return null;
  const dominating = candidates.filter((candidate) => candidates.every((other) =>
    contextCovers(candidate.bundle.observedBundles ?? {}, other.bundle.observedBundles ?? {})));
  if (dominating.length === 0) throw new Error('Snapshots describe concurrent histories. Sync and review on an existing device, then create a fresh snapshot.');
  if (new Set(dominating.map((candidate) => candidate.stateHash)).size > 1) throw new Error('Snapshots with the same observed history disagree. Reviewed recovery is required.');
  // Only causally equivalent states reach this tie-break; never compare one
  // device's sequence as if it were a global clock.
  dominating.sort((a, b) => a.deviceId.localeCompare(b.deviceId) || b.sequenceNumber - a.sequenceNumber);
  const chosen = dominating[0];
  return { filePath: chosen.filePath, deviceId: chosen.deviceId, sequenceNumber: chosen.sequenceNumber };
}

// ─── Sync folder validation ──────────────────────────────────────────

/** Check if a sync folder has any .invite files in the invites/ subdirectory. */
export function syncFolderHasInvites(syncFolder: string): boolean {
  const invitesDir = path.join(syncFolder, INVITES_SUBDIR);
  try {
    return fs.readdirSync(invitesDir).some((f) => f.endsWith('.invite'));
  } catch {
    return false;
  }
}

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
