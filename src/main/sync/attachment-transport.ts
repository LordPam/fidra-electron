import fs from 'node:fs';
import path from 'node:path';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
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

function encryptedPath(syncFolder: string, storedName: string): string {
  assertSafeStoredName(storedName);
  const p = path.join(attachmentsDir(syncFolder), storedName + ENC_EXT);
  assertWithinFolder(attachmentsDir(syncFolder), p);
  return p;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Encrypt a local attachment file and write it to the shared sync folder.
 * Uses atomic write (tmp → rename) to prevent partial reads.
 */
export function writeAttachmentFile(
  syncFolder: string,
  storedName: string,
  localPath: string,
  passphrase: string,
): void {
  const plaintext = fs.readFileSync(localPath);
  const sealed = encryptAndSign(plaintext, passphrase);

  const dir = attachmentsDir(syncFolder);
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = encryptedPath(syncFolder, storedName);
  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, sealed);
    fs.renameSync(tmpPath, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    syncLog('error', 'writeAttachmentFile failed', { storedName, error: errorMessage(e) });
    throw e;
  }
}

/**
 * Read an encrypted attachment from the sync folder, decrypt it, and write to a local path.
 * Returns false if the encrypted file does not exist.
 */
export function readAttachmentFile(
  syncFolder: string,
  storedName: string,
  localPath: string,
  passphrase: string,
): boolean {
  const encPath = encryptedPath(syncFolder, storedName);
  if (!fs.existsSync(encPath)) return false;

  const sealed = fs.readFileSync(encPath);
  const plaintext = verifyAndDecrypt(sealed, passphrase);

  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localPath, plaintext);
  return true;
}

/** Remove an encrypted attachment file from the sync folder. */
export function removeAttachmentFile(syncFolder: string, storedName: string): void {
  const encPath = encryptedPath(syncFolder, storedName);
  if (fs.existsSync(encPath)) {
    fs.unlinkSync(encPath);
  }
}

/** List all stored names (without .enc extension) in the sync folder's attachments dir. */
export function listRemoteAttachments(syncFolder: string): string[] {
  const dir = attachmentsDir(syncFolder);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ENC_EXT))
    .map((f) => f.slice(0, -ENC_EXT.length));
}
