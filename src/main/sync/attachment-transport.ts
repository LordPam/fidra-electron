import fs from 'node:fs';
import path from 'node:path';
import { verifyAndDecrypt } from './bundle-crypto';
import { syncLog, errorMessage } from './sync-log';

const ATTACHMENTS_SUBDIR = 'attachments';
const ENC_EXT = '.enc';

// ─── Path safety ─────────────────────────────────────────────────────

function assertSafeStoredName(storedName: string): void {
  if (
    storedName.includes('..') ||
    storedName.includes(path.sep) ||
    storedName.includes('/') ||
    storedName.includes('\\') ||
    storedName.includes('\0')
  ) {
    throw new Error(`Path traversal blocked: unsafe stored name "${storedName}"`);
  }
}

function assertWithinFolder(base: string, target: string): void {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path traversal blocked: ${target} resolves outside ${base}`);
  }
}

function attachmentsDir(syncFolder: string): string {
  return path.join(syncFolder, ATTACHMENTS_SUBDIR);
}

function plainPath(syncFolder: string, storedName: string): string {
  assertSafeStoredName(storedName);
  const p = path.join(attachmentsDir(syncFolder), storedName);
  assertWithinFolder(attachmentsDir(syncFolder), p);
  return p;
}

function legacyEncPath(syncFolder: string, storedName: string): string {
  assertSafeStoredName(storedName);
  const p = path.join(attachmentsDir(syncFolder), storedName + ENC_EXT);
  assertWithinFolder(attachmentsDir(syncFolder), p);
  return p;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Copy a local attachment file to the shared sync folder as a plain file.
 * Uses atomic write (tmp → rename) to prevent partial reads.
 */
export function writeAttachmentFile(
  syncFolder: string,
  storedName: string,
  localPath: string,
): void {
  const content = fs.readFileSync(localPath);

  const dir = attachmentsDir(syncFolder);
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = plainPath(syncFolder, storedName);
  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    syncLog('error', 'writeAttachmentFile failed', { storedName, error: errorMessage(e) });
    throw e;
  }
}

/**
 * Read a plain attachment from the sync folder and write to a local path.
 * Also handles legacy .enc files (decrypts if passphrase provided).
 * Returns false if the file does not exist in either format.
 */
export function readAttachmentFile(
  syncFolder: string,
  storedName: string,
  localPath: string,
  passphrase?: string,
): boolean {
  // Try plain file first (new format)
  const plain = plainPath(syncFolder, storedName);
  if (fs.existsSync(plain)) {
    const content = fs.readFileSync(plain);
    const dir = path.dirname(localPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localPath, content);
    return true;
  }

  // Fall back to legacy .enc file
  const enc = legacyEncPath(syncFolder, storedName);
  if (fs.existsSync(enc) && passphrase) {
    const sealed = fs.readFileSync(enc);
    const plaintext = verifyAndDecrypt(sealed, passphrase);
    const dir = path.dirname(localPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localPath, plaintext);
    return true;
  }

  return false;
}

/** Remove an attachment file from the sync folder (both plain and legacy .enc). */
export function removeAttachmentFile(syncFolder: string, storedName: string): void {
  const plain = plainPath(syncFolder, storedName);
  if (fs.existsSync(plain)) {
    fs.unlinkSync(plain);
  }
  const enc = legacyEncPath(syncFolder, storedName);
  if (fs.existsSync(enc)) {
    fs.unlinkSync(enc);
  }
}

/** List all stored names in the sync folder's attachments dir (both plain and legacy .enc). */
export function listRemoteAttachments(syncFolder: string): string[] {
  const dir = attachmentsDir(syncFolder);
  if (!fs.existsSync(dir)) return [];

  const names = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    // Skip temp files
    if (f.endsWith('.tmp')) continue;
    // Legacy encrypted files
    if (f.endsWith(ENC_EXT)) {
      names.add(f.slice(0, -ENC_EXT.length));
    } else {
      // Plain files
      names.add(f);
    }
  }
  return [...names];
}

/**
 * Migrate legacy .enc attachment files to plain files.
 * Decrypts each .enc file and writes the plain version alongside it,
 * then removes the .enc file. Idempotent — safe to call multiple times.
 * Returns the number of files migrated.
 */
export function migrateEncryptedAttachments(syncFolder: string, passphrase: string): number {
  const dir = attachmentsDir(syncFolder);
  if (!fs.existsSync(dir)) return 0;

  let count = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(ENC_EXT) && !f.endsWith('.tmp'));

  for (const encFile of files) {
    const storedName = encFile.slice(0, -ENC_EXT.length);
    const encFilePath = path.join(dir, encFile);
    const plainFilePath = path.join(dir, storedName);

    // Skip if plain file already exists (already migrated)
    if (fs.existsSync(plainFilePath)) {
      // Remove the leftover .enc file
      try { fs.unlinkSync(encFilePath); } catch { /* non-fatal */ }
      count++;
      continue;
    }

    try {
      const sealed = fs.readFileSync(encFilePath);
      const plaintext = verifyAndDecrypt(sealed, passphrase);

      // Atomic write
      const tmpPath = plainFilePath + '.tmp';
      fs.writeFileSync(tmpPath, plaintext);
      fs.renameSync(tmpPath, plainFilePath);

      // Remove old .enc file
      fs.unlinkSync(encFilePath);
      count++;
    } catch (e) {
      syncLog('warn', 'Failed to migrate encrypted attachment (non-fatal)', {
        storedName,
        error: errorMessage(e),
      });
    }
  }

  if (count > 0) {
    syncLog('info', `Migrated ${count} encrypted attachment(s) to plain files`);
  }
  return count;
}

/**
 * Export all local attachment files to the sync folder as plain files.
 * Used to ensure all existing local attachments are available to peers.
 * Skips files that already exist in the sync folder.
 * Returns the count of newly exported files.
 */
export function exportAllLocalAttachments(
  syncFolder: string,
  attachmentDir: string,
  storedNames: string[],
): number {
  let count = 0;
  for (const storedName of storedNames) {
    const localPath = path.join(attachmentDir, storedName);
    if (!fs.existsSync(localPath)) continue;

    const remotePlain = plainPath(syncFolder, storedName);
    if (fs.existsSync(remotePlain)) continue;

    try {
      writeAttachmentFile(syncFolder, storedName, localPath);
      count++;
    } catch (e) {
      syncLog('warn', 'Failed to export local attachment (non-fatal)', {
        storedName,
        error: errorMessage(e),
      });
    }
  }
  return count;
}
