import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import * as attachmentService from '../services/attachment-service';
import { transactionRowSchema } from '../../shared/ipc-schemas';
import { logTransactionCreated, logTransactionUpdated, logTransactionDeleted, logBulkTransactionsSaved, logBulkTransactionsDeleted } from '../services/audit-service';

export function registerTransactionHandlers(): void {
  ipcMain.handle('transactions:getAll', (event, sheet?: unknown) => {
    const validSheet = sheet != null ? z.string().parse(sheet) : undefined;
    return resolveContext(event).repos.transactions.getAll(validSheet);
  });

  ipcMain.handle('transactions:getById', (event, id: unknown) => {
    const validId = z.string().parse(id);
    return resolveContext(event).repos.transactions.getById(validId);
  });

  ipcMain.handle('transactions:save', (event, data: unknown) => {
    const validated = transactionRowSchema.parse(data);
    const ctx = resolveContext(event);
    const existing = ctx.repos.transactions.getById(validated.id);
    const result = ctx.repos.transactions.save(validated);
    if (existing) {
      logTransactionUpdated(ctx, existing, result);
      // Rename attachment files if name-relevant fields changed
      if (
        existing.date !== result.date ||
        existing.type !== result.type ||
        existing.amount !== result.amount ||
        existing.party !== result.party
      ) {
        attachmentService.renameAttachmentsForTransaction(result.id, ctx);
      }
    } else {
      logTransactionCreated(ctx, result);
      // Rename any pre-attached files now that transaction data is available
      attachmentService.renameAttachmentsForTransaction(result.id, ctx);
    }
    return result;
  });

  ipcMain.handle('transactions:delete', async (event, id: unknown) => {
    const validId = z.string().parse(id);
    const ctx = resolveContext(event);
    const existing = ctx.repos.transactions.getById(validId);
    const deletedAttachments = await attachmentService.removeAllForTransaction(validId, ctx);
    const success = ctx.repos.transactions.remove(validId);
    if (success && existing) {
      logTransactionDeleted(ctx, existing);
    }
    return { success, deletedAttachments };
  });

  ipcMain.handle('transactions:bulkSave', (event, items: unknown) => {
    const validated = z.array(transactionRowSchema).parse(items);
    const ctx = resolveContext(event);
    let created = 0;
    let updated = 0;
    for (const tx of validated) {
      if (ctx.repos.transactions.getById(tx.id)) updated++;
      else created++;
    }
    const result = ctx.repos.transactions.bulkSave(validated);
    if (result.length > 0) {
      logBulkTransactionsSaved(ctx, created, updated, result.map((tx) => tx.id));
    }
    return result;
  });

  ipcMain.handle('transactions:bulkDelete', async (event, ids: unknown) => {
    const validIds = z.array(z.string()).parse(ids);
    const ctx = resolveContext(event);
    const deletedAttachments: Record<string, import('../../shared/ipc-types').AttachmentRow[]> = {};
    for (const id of validIds) {
      const removed = await attachmentService.removeAllForTransaction(id, ctx);
      if (removed.length > 0) {
        deletedAttachments[id] = removed;
      }
    }
    const count = ctx.repos.transactions.bulkRemove(validIds);
    if (count > 0) {
      logBulkTransactionsDeleted(ctx, count, validIds);
    }
    return { count, deletedAttachments };
  });
}
