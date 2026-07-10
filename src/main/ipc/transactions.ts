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

    // Cascade delete: if this was a transfer, delete the counterpart too
    let deletedCounterpart: import('../../shared/ipc-types').TransactionRow | null = null;
    let counterpartAttachments: import('../../shared/ipc-types').AttachmentRow[] = [];
    if (existing?.linked_id) {
      const counterparts = ctx.repos.transactions.getByLinkedId(existing.linked_id)
        .filter((t: import('../../shared/ipc-types').TransactionRow) => t.id !== validId);
      if (counterparts.length > 0) {
        const cp = counterparts[0];
        deletedCounterpart = cp;
        counterpartAttachments = await attachmentService.removeAllForTransaction(cp.id, ctx);
        ctx.repos.transactions.remove(cp.id);
        logTransactionDeleted(ctx, cp);
      }
    }

    return { success, deletedAttachments, deletedCounterpart, counterpartAttachments };
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

    // Expand ID set to include counterparts of any transfers in the batch
    const idSet = new Set(validIds);
    for (const id of validIds) {
      const tx = ctx.repos.transactions.getById(id);
      if (tx?.linked_id) {
        const counterparts = ctx.repos.transactions.getByLinkedId(tx.linked_id);
        for (const cp of counterparts) {
          idSet.add(cp.id);
        }
      }
    }
    const expandedIds = [...idSet];

    const deletedAttachments: Record<string, import('../../shared/ipc-types').AttachmentRow[]> = {};
    for (const id of expandedIds) {
      const removed = await attachmentService.removeAllForTransaction(id, ctx);
      if (removed.length > 0) {
        deletedAttachments[id] = removed;
      }
    }
    const count = ctx.repos.transactions.bulkRemove(expandedIds);
    if (count > 0) {
      logBulkTransactionsDeleted(ctx, count, expandedIds);
    }
    return { count, deletedAttachments };
  });

  ipcMain.handle('transactions:saveTransfer', (event, expense: unknown, income: unknown) => {
    const validExpense = transactionRowSchema.parse(expense);
    const validIncome = transactionRowSchema.parse(income);

    if (!validExpense.linked_id || !validIncome.linked_id || validExpense.linked_id !== validIncome.linked_id) {
      throw new Error('Transfer pair must share the same non-null linked_id');
    }
    if (validExpense.type !== 'expense' || validIncome.type !== 'income') {
      throw new Error('Transfer must have one expense and one income');
    }

    const ctx = resolveContext(event);
    const savedExpense = ctx.repos.transactions.save(validExpense);
    const savedIncome = ctx.repos.transactions.save(validIncome);
    logTransactionCreated(ctx, savedExpense);
    logTransactionCreated(ctx, savedIncome);
    return { expense: savedExpense, income: savedIncome };
  });

  ipcMain.handle('transactions:getByLinkedId', (event, linkedId: unknown) => {
    const validLinkedId = z.string().parse(linkedId);
    return resolveContext(event).repos.transactions.getByLinkedId(validLinkedId);
  });
}
