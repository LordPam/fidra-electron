import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldToApplication } from 'node:timers/promises';
import { getAttachmentStoragePath } from '../database/connection';
import { attachmentFileName, decodeAttachmentBytes } from './attachment-transport';
import { encryptAndSign, verifyAndDecrypt } from './bundle-crypto';
import { sha256, type DomainRow } from './recovery-state';
import type { RecoveryInventory } from './recovery-inventory';
import type { RecoveryAttachment } from '../../shared/sync-recovery-types';

export interface AttachmentEvidence {
  storedName: string;
  alternatives: { hash: string; size: number; source: string; sealedFile: string; originalPath?: string; originalHash?: string }[];
}
function safeName(value: string): void { if (!value || /[\\/\0]/.test(value) || value.includes('..')) throw new Error('Unsafe attachment name requires review.'); }
function readLocal(file: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024) throw new Error('Attachment must be a regular file under 100 MiB.');
  // Reject a symlinked ancestor too; this stage must never adopt arbitrary data.
  if (fs.realpathSync(file) !== path.resolve(file)) throw new Error('Attachment path traverses a symbolic link.');
  return fs.readFileSync(file);
}

/** Plain and legacy encrypted originals are read only. All privately retained
 * alternatives are sealed; no plaintext is ever added to the old shared root. */
export async function captureRecoveryAttachments(
  rows: DomainRow[], sources: { databaseId: string; originalPath: string }[], inventory: RecoveryInventory,
  oldGroupId: string | null, directory: string, passphrase: string,
): Promise<AttachmentEvidence[]> {
  const target = path.join(directory, 'attachment-evidence'); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const result: AttachmentEvidence[] = [];
  for (const storedName of new Set(rows.map((row) => String(row.stored_name)))) {
    await yieldToApplication(); safeName(storedName);
    const evidence: AttachmentEvidence = { storedName, alternatives: [] };
    const retain = (bytes: Buffer, source: string, originalPath?: string, originalHash?: string) => {
      if (bytes.length > 100 * 1024 * 1024) throw new Error('Attachment exceeds 100 MiB.');
      const hash = sha256(bytes); const sealedFile = `${hash}.sealed`; const file = path.join(target, sealedFile);
      if (!fs.existsSync(file)) fs.writeFileSync(file, encryptAndSign(bytes, passphrase), { flag: 'wx', flush: true, mode: 0o600 });
      else if (sha256(verifyAndDecrypt(fs.readFileSync(file), passphrase)) !== hash) throw new Error('Preserved attachment evidence changed.');
      evidence.alternatives.push({ hash, size: bytes.length, source, sealedFile, originalPath, originalHash });
    };
    for (const source of sources) {
      const candidates = [path.join(getAttachmentStoragePath(source.databaseId), storedName), path.join(path.dirname(source.originalPath), 'fidra_attachments', storedName)];
      for (const file of candidates) if (fs.existsSync(file)) { const bytes = readLocal(file); retain(bytes, file, file, sha256(bytes)); }
    }
    for (const file of inventory.files.filter((entry) => entry.kind === 'attachment')) {
      const name = path.basename(file.relativePath);
      const bytes = fs.readFileSync(file.evidencePath);
      if (name === storedName) retain(bytes, file.originalPath);
      else if (name === `${storedName}.enc`) retain(verifyAndDecrypt(bytes, passphrase), file.originalPath);
      else if (oldGroupId && name === attachmentFileName(oldGroupId, storedName)) retain(decodeAttachmentBytes(bytes, storedName, passphrase, oldGroupId), file.originalPath);
    }
    result.push(evidence);
  }
  return result;
}

export function attachmentReview(rows: DomainRow[], evidence: AttachmentEvidence[], selections: Record<string, string>): RecoveryAttachment[] {
  return rows.map((row) => {
    const item = evidence.find((entry) => entry.storedName === row.stored_name);
    const distinct = [...new Map((item?.alternatives ?? []).map((entry) => [entry.hash, { hash: entry.hash, size: entry.size, source: entry.source }])).values()];
    return { id: String(row.id), name: String(row.filename), alternatives: distinct,
      selectedHash: selections[String(row.stored_name)] ?? (distinct.length === 1 ? distinct[0].hash : null) };
  });
}

export function readRecoveryAttachment(directory: string, item: AttachmentEvidence, hash: string, passphrase: string): Buffer {
  const selected = item.alternatives.find((entry) => entry.hash === hash);
  if (!selected || path.basename(selected.sealedFile) !== selected.sealedFile) throw new Error('Choose an attachment alternative from this review.');
  const bytes = verifyAndDecrypt(fs.readFileSync(path.join(directory, 'attachment-evidence', selected.sealedFile)), passphrase);
  if (sha256(bytes) !== hash) throw new Error('Attachment evidence changed.');
  return bytes;
}

export async function verifyLocalAttachmentEvidence(evidence: AttachmentEvidence[]): Promise<void> {
  for (const alternative of evidence.flatMap((item) => item.alternatives)) if (alternative.originalPath) {
    await yieldToApplication();
    if (sha256(readLocal(alternative.originalPath)) !== alternative.originalHash) throw new Error('A local attachment changed after review. Start a fresh recovery stage.');
  }
}
