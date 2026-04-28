import path from 'node:path';
import fs from 'node:fs';
import { shell } from 'electron';
import type { AttachmentRow } from '../../shared/ipc-types';
import type { WindowContext } from '../window/window-context';
import { getAttachmentStoragePath } from '../database/connection';

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

/**
 * Strip path separators from a stored_name before passing to cloud storage.
 * Prevents cloud-side traversal if stored_name contains directory components.
 */
function sanitizeStoredName(storedName: string): string {
  return path.basename(storedName);
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

function buildDescriptiveName(transactionId: string, originalFilename: string, ctx: WindowContext): string {
  const ext = path.extname(originalFilename).toLowerCase();
  const tx = ctx.repos.transactions.getById(transactionId);

  if (!tx) {
    return `${crypto.randomUUID().slice(0, 8)}${ext}`;
  }

  const dateStr = tx.date;
  const typeStr = tx.type;
  const amountStr = parseFloat(tx.amount).toFixed(2);
  const partyCamel = toCamelCase(tx.party);
  const baseName = `${dateStr}_${typeStr}_${amountStr}_${partyCamel}`;

  const storageDir = getStorageDir(ctx);
  let candidate = `${baseName}${ext}`;
  let counter = 0;
  while (fs.existsSync(safePath(storageDir, candidate))) {
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

  if (ctx.supabaseStorage) {
    try {
      await ctx.supabaseStorage.upload(sanitizeStoredName(storedName), destPath, mimeType ?? undefined);
    } catch (e) {
      console.error('[ATTACHMENTS] Cloud upload failed, file saved locally:', e);
    }
  }

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

  if (ctx.supabaseStorage) {
    try {
      await ctx.supabaseStorage.remove(sanitizeStoredName(attachment.stored_name));
    } catch (e) {
      console.error('[ATTACHMENTS] Cloud delete failed:', e);
    }
  }

  return ctx.repos.attachments.remove(id);
}

export async function removeAllForTransaction(transactionId: string, ctx: WindowContext): Promise<AttachmentRow[]> {
  const removed = ctx.repos.attachments.removeForTransaction(transactionId);
  const storageDir = getStorageDir(ctx);
  const trashDir = getTrashDir(ctx);

  for (const attachment of removed) {
    const filePath = safePath(storageDir, attachment.stored_name);
    if (fs.existsSync(filePath)) {
      try {
        fs.renameSync(filePath, safePath(trashDir, attachment.stored_name));
      } catch {
        // Best effort
      }
    }

    if (ctx.supabaseStorage) {
      try {
        await ctx.supabaseStorage.remove(sanitizeStoredName(attachment.stored_name));
      } catch {
        // Best effort
      }
    }
  }

  return removed;
}

export async function restoreAttachment(row: AttachmentRow, ctx: WindowContext): Promise<AttachmentRow> {
  const storageDir = getStorageDir(ctx);
  const trashDir = getTrashDir(ctx);
  const trashPath = safePath(trashDir, row.stored_name);
  const destPath = safePath(storageDir, row.stored_name);

  if (fs.existsSync(trashPath)) {
    fs.renameSync(trashPath, destPath);
  }

  if (ctx.supabaseStorage && fs.existsSync(destPath)) {
    try {
      await ctx.supabaseStorage.upload(sanitizeStoredName(row.stored_name), destPath, row.mime_type ?? undefined);
    } catch (e) {
      console.error('[ATTACHMENTS] Cloud re-upload failed:', e);
    }
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
    if (ctx.supabaseStorage) {
      try {
        await ctx.supabaseStorage.download(sanitizeStoredName(attachment.stored_name), localPath);
      } catch (e) {
        console.error('[ATTACHMENTS] Cloud download failed:', e);
        return false;
      }
    } else {
      return false;
    }
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
