import path from 'node:path';
import fs from 'node:fs';
import { shell } from 'electron';
import type { AttachmentRow } from '../../shared/ipc-types';
import type { WindowContext } from '../window/window-context';
import { getAttachmentStoragePath } from '../database/connection';
import { writeAttachmentFile, readAttachmentFile, removeAttachmentFile } from '../sync/attachment-transport';
import { toAmountString } from '../../shared/money';

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

/**
 * Validate that a resolved path stays within the expected base directory.
 * Prevents path traversal attacks via malicious filenames like `../../etc/passwd`.
 */
function safePath(baseDir: string, filename: string): string {
  const resolved = path.resolve(baseDir, filename);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error(`Path traversal blocked: ${filename}`);
  }
  return resolved;
}

function getStorageDir(ctx: WindowContext): string {
  const dir = getAttachmentStoragePath(ctx.databaseId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function toCamelCase(text: string | null): string {
  if (!text || !text.trim()) return 'unknown';
  const words = text.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) return 'unknown';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function buildDescriptiveName(
  transactionId: string,
  originalFilename: string,
  ctx: WindowContext,
  excludeStoredName?: string,
): string {
  const ext = path.extname(originalFilename).toLowerCase();
  const tx = ctx.repos.transactions.getById(transactionId);

  if (!tx) {
    return `${crypto.randomUUID().slice(0, 8)}${ext}`;
  }

  const dateStr = tx.date;
  const typeStr = tx.type;
  const amountStr = toAmountString(tx.amount) ?? '0.00';
  const partyCamel = toCamelCase(tx.party);
  const baseName = `${dateStr}_${typeStr}_${amountStr}_${partyCamel}`;

  const storageDir = getStorageDir(ctx);
  let candidate = `${baseName}${ext}`;
  let counter = 0;
  while (fs.existsSync(safePath(storageDir, candidate)) && candidate !== excludeStoredName) {
    counter++;
    candidate = `${baseName}_${counter}${ext}`;
  }

  return candidate;
}

function detectMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? null;
}

export async function addAttachment(
  transactionId: string,
  sourcePath: string,
  originalFilename: string,
  ctx: WindowContext,
): Promise<AttachmentRow> {
  const storageDir = getStorageDir(ctx);
  const storedName = buildDescriptiveName(transactionId, originalFilename, ctx);
  const destPath = safePath(storageDir, storedName);

  fs.copyFileSync(sourcePath, destPath);

  const stats = fs.statSync(destPath);
  const mimeType = detectMimeType(originalFilename);
  const row: AttachmentRow = {
    id: crypto.randomUUID(),
    transaction_id: transactionId,
    filename: originalFilename,
    stored_name: storedName,
    mime_type: mimeType,
    file_size: stats.size,
    created_at: new Date().toISOString(),
  };

  return ctx.repos.attachments.save(row);
}

function getTrashDir(ctx: WindowContext): string {
  const dir = path.join(getStorageDir(ctx), '.trash');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function removeAttachment(id: string, ctx: WindowContext): Promise<boolean> {
  const attachment = ctx.repos.attachments.getById(id);
  if (!attachment) return false;

  const storageDir = getStorageDir(ctx);
  const filePath = safePath(storageDir, attachment.stored_name);
  if (fs.existsSync(filePath)) {
    const trashDir = getTrashDir(ctx);
    fs.renameSync(filePath, safePath(trashDir, attachment.stored_name));
  }

  return ctx.repos.attachments.remove(id);
}

/**
 * Move attachment files into the per-database `.trash` folder.
 *
 * Deliberately separate from deleting the rows: callers commit the database side
 * first and only then move files. A file left on disk after a failed delete is
 * recoverable; a row deleted for a transaction that survived is not.
 */
export function moveAttachmentFilesToTrash(rows: AttachmentRow[], ctx: WindowContext): void {
  if (rows.length === 0) return;
  const storageDir = getStorageDir(ctx);
  const trashDir = getTrashDir(ctx);

  for (const attachment of rows) {
    const filePath = safePath(storageDir, attachment.stored_name);
    if (fs.existsSync(filePath)) {
      try {
        fs.renameSync(filePath, safePath(trashDir, attachment.stored_name));
      } catch {
        // Best effort
      }
    }
  }
}

export async function restoreAttachment(row: AttachmentRow, ctx: WindowContext): Promise<AttachmentRow> {
  const storageDir = getStorageDir(ctx);
  const trashDir = getTrashDir(ctx);
  const trashPath = safePath(trashDir, row.stored_name);
  const destPath = safePath(storageDir, row.stored_name);

  if (fs.existsSync(trashPath)) {
    fs.renameSync(trashPath, destPath);
  }

  return ctx.repos.attachments.save(row);
}

export async function restoreAllForTransaction(rows: AttachmentRow[], ctx: WindowContext): Promise<void> {
  for (const row of rows) {
    await restoreAttachment(row, ctx);
  }
}

export async function openAttachment(id: string, ctx: WindowContext): Promise<boolean> {
  const attachment = ctx.repos.attachments.getById(id);
  if (!attachment) return false;

  const storageDir = getStorageDir(ctx);
  const localPath = safePath(storageDir, attachment.stored_name);

  if (!fs.existsSync(localPath)) {
    // Try Local Sync shared folder (plain or legacy .enc)
    const syncFolder = ctx.localSyncOrchestrator
      ? ctx.settingsRepo.getSetting('localSync.syncFolder')
      : null;
    if (syncFolder) {
      try {
        const pulled = readAttachmentFile(
          syncFolder, attachment.stored_name, localPath, ctx.localSyncPassphrase ?? undefined,
        );
        if (pulled) {
          shell.openPath(localPath);
          return true;
        }
      } catch { /* fall through to other sources */ }
    }

    return false;
  }

  shell.openPath(localPath);
  return true;
}

export function getForTransaction(transactionId: string, ctx: WindowContext): AttachmentRow[] {
  return ctx.repos.attachments.getForTransaction(transactionId);
}

export function getCounts(transactionIds: string[], ctx: WindowContext): Record<string, number> {
  return ctx.repos.attachments.getCounts(transactionIds);
}

/**
 * Rename attachment files when transaction fields (date, type, amount, party) change.
 * Updates stored_name in the DB and renames the physical file on disk.
 * If Local Sync is active, exports the renamed file to the sync shared folder.
 */
export function renameAttachmentsForTransaction(transactionId: string, ctx: WindowContext): void {
  const attachments = ctx.repos.attachments.getForTransaction(transactionId);
  if (attachments.length === 0) return;

  const storageDir = getStorageDir(ctx);

  const syncFolder = ctx.localSyncOrchestrator
    ? ctx.settingsRepo.getSetting('localSync.syncFolder')
    : null;

  for (const attachment of attachments) {
    const newStoredName = buildDescriptiveName(
      transactionId,
      attachment.filename,
      ctx,
      attachment.stored_name,
    );

    if (newStoredName === attachment.stored_name) continue;

    const oldPath = safePath(storageDir, attachment.stored_name);
    const newPath = safePath(storageDir, newStoredName);

    // If local file is missing but available in sync folder, pull it first
    if (!fs.existsSync(oldPath) && syncFolder) {
      try {
        readAttachmentFile(syncFolder, attachment.stored_name, oldPath, ctx.localSyncPassphrase ?? undefined);
      } catch { /* non-fatal — file may just be gone */ }
    }

    // Rename physical file
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }

    // Update DB row
    ctx.repos.attachments.save({ ...attachment, stored_name: newStoredName });

    // Sync folder maintenance: remove old name, export new name
    if (syncFolder && fs.existsSync(newPath)) {
      try {
        removeAttachmentFile(syncFolder, attachment.stored_name);
      } catch { /* non-fatal */ }
      try {
        writeAttachmentFile(syncFolder, newStoredName, newPath);
      } catch {
        // Best-effort — the orchestrator's normal export cycle will also pick this up
      }
    }
  }
}
