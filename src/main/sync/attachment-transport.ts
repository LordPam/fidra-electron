import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { ensureSyncSubdirectory, writeSyncFileExclusively } from './bundle-io';

const EXTENSION = '.attachment';
const envelopeSchema = z.object({
  version: z.literal(1), groupId: z.string().uuid(), storedName: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string(),
}).strict();

function assertSafeName(name: string): void {
  if (!name || name.includes('..') || /[\\/\0]/.test(name)) throw new Error('Path traversal blocked: unsafe attachment name');
}
function hash(bytes: Buffer): string { return crypto.createHash('sha256').update(bytes).digest('hex'); }

/** Opaque filenames do not disclose dates, amounts, parties or original names. */
export function attachmentFileName(groupId: string, storedName: string): string {
  assertSafeName(storedName);
  z.string().uuid().parse(groupId);
  return `${hash(Buffer.from(`${groupId}\0${storedName}`))}${EXTENSION}`;
}

function readSealed(file: string, storedName: string, passphrase: string, groupId: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150 * 1024 * 1024) throw new Error('Invalid encrypted attachment file');
  const envelope = envelopeSchema.parse(JSON.parse(verifyAndDecrypt(fs.readFileSync(file), passphrase).toString('utf8')));
  if (envelope.groupId !== groupId || envelope.storedName !== storedName) throw new Error('Attachment identity mismatch');
  const bytes = Buffer.from(envelope.content, 'base64');
  if (bytes.toString('base64') !== envelope.content || hash(bytes) !== envelope.sha256) throw new Error('Attachment content hash mismatch');
  return bytes;
}

/** Creates a local file without replacing existing data; callers retain originals. */
function writeLocalExclusively(file: string, bytes: Buffer): void {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(bytes)) throw new Error('Attachment collision: existing local bytes were preserved');
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', flush: true, mode: 0o600 });
    try {
      fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !fs.readFileSync(file).equals(bytes)) throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** New transport is always encrypted. A retained local sealed copy makes a
 * later retry use the same ciphertext. Existing differing files require review.
 */
export function writeAttachmentFile(
  syncFolder: string, storedName: string, localPath: string, passphrase: string, groupId: string,
): boolean {
  const filename = attachmentFileName(groupId, storedName);
  ensureSyncSubdirectory(syncFolder, 'attachments');
  if (fs.statSync(localPath).size > 100 * 1024 * 1024) throw new Error('Attachment exceeds the encrypted transport size limit of 100 MiB.');
  const content = fs.readFileSync(localPath);
  if (content.length > 100 * 1024 * 1024) throw new Error('Attachment exceeds the encrypted transport size limit of 100 MiB.');
  const remote = path.join(syncFolder, 'attachments', filename);

  const journal = path.join(path.dirname(localPath), '.sync-export', filename);
  if (!fs.existsSync(journal)) {
    const sealed = encryptAndSign(Buffer.from(JSON.stringify({
      version: 1, groupId, storedName, sha256: hash(content), content: content.toString('base64'),
    })), passphrase);
    try {
      writeLocalExclusively(journal, sealed);
    } catch (error) {
      // Another window may have sealed the same content with a different nonce.
      if (!fs.existsSync(journal) || !readSealed(journal, storedName, passphrase, groupId).equals(content)) throw error;
    }
  }
  if (!readSealed(journal, storedName, passphrase, groupId).equals(content)) throw new Error('Attachment journal differs from the local file. Review is required.');
  if (fs.existsSync(remote)) {
    if (!readSealed(remote, storedName, passphrase, groupId).equals(content)) throw new Error('Attachment collision: shared history was preserved');
    return false;
  }
  try {
    writeSyncFileExclusively(syncFolder, 'attachments', filename, fs.readFileSync(journal));
  } catch (error) {
    if (!fs.existsSync(remote) || !readSealed(remote, storedName, passphrase, groupId).equals(content)) throw error;
    return false;
  }
  return true;
}

/** Authenticates identity and content before writing any local destination. */
export function readAttachmentFile(
  syncFolder: string, storedName: string, localPath: string, passphrase: string, groupId: string,
): boolean {
  const filename = attachmentFileName(groupId, storedName);
  ensureSyncSubdirectory(syncFolder, 'attachments');
  const file = path.join(syncFolder, 'attachments', filename);
  if (!fs.existsSync(file)) {
    const journal = path.join(path.dirname(localPath), '.sync-export', filename);
    if (fs.existsSync(journal)) {
      writeLocalExclusively(localPath, readSealed(journal, storedName, passphrase, groupId));
      return true;
    }
    // Legacy data is preserved, never silently adopted or decrypted in the mailbox.
    if (fs.existsSync(path.join(syncFolder, 'attachments', storedName))
      || fs.existsSync(path.join(syncFolder, 'attachments', `${storedName}.enc`))) {
      throw new Error('This attachment uses legacy transport and needs reviewed migration. Original files were preserved.');
    }
    return false;
  }
  const content = readSealed(file, storedName, passphrase, groupId);
  writeLocalExclusively(localPath, content);
  return true;
}
