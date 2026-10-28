import { z } from 'zod';
import * as attachmentService from './attachment-service';
import { idSchema, nameSchema, transactionRowSchema } from '../../shared/ipc-schemas';
import type { AttachmentRow, TransactionRow } from '../../shared/ipc-types';
import { assertSheetsExist } from './referential-integrity';
import { logTransactionCreated, logTransactionUpdated, logTransactionDeleted, logBulkTransactionsSaved, logBulkTransactionsDeleted } from './audit-service';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';
import { parsePence } from '../../shared/money';

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function transactionsGetAll(ctx: WindowContext, sheet?: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validSheet = sheet != null ? nameSchema.parse(sheet) : undefined;
  return ctx.repos.transactions.getAll(validSheet);
}

export function transactionsGetById(ctx: WindowContext, id: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  return ctx.repos.transactions.getById(validId);
}

export function transactionsSave(ctx: WindowContext, data: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = transactionRowSchema.parse(data);
  assertSheetsExist(ctx.sqlite, [{ label: 'sheet', sheet: validated.sheet }]);
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
}

export function transactionsDelete(ctx: WindowContext, id: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const existing = ctx.repos.transactions.getById(validId);
  if (!existing) {
    return { success: false, deletedAttachments: [], deletedCounterpart: null, counterpartAttachments: [] };
  }

  // Cascade delete: if this was a transfer, the counterpart goes with it
  const deletedCounterpart = existing.linked_id
    ? ctx.repos.transactions.getByLinkedId(existing.linked_id)
      .find((t: TransactionRow) => t.id !== validId) ?? null
    : null;

  // Row deletions commit as one unit; files move only afterwards, so a failure
  // can't leave attachment rows deleted for a transaction that survived.
  let deletedAttachments: AttachmentRow[] = [];
  let counterpartAttachments: AttachmentRow[] = [];
  const success = ctx.sqlite.transaction(() => {
    deletedAttachments = ctx.repos.attachments.removeForTransaction(validId);
    const removed = ctx.repos.transactions.remove(validId);
    if (deletedCounterpart) {
      counterpartAttachments = ctx.repos.attachments.removeForTransaction(deletedCounterpart.id);
      ctx.repos.transactions.remove(deletedCounterpart.id);
    }
    return removed;
  })();

  attachmentService.moveAttachmentFilesToTrash([...deletedAttachments, ...counterpartAttachments], ctx);

  if (success) {
    logTransactionDeleted(ctx, existing);
  }
  if (deletedCounterpart) {
    logTransactionDeleted(ctx, deletedCounterpart);
  }

  return { success, deletedAttachments, deletedCounterpart, counterpartAttachments };
}

export function transactionsBulkSave(ctx: WindowContext, items: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = z.array(transactionRowSchema).parse(items);
  assertSheetsExist(ctx.sqlite, validated.map((t) => ({ label: 'sheet', sheet: t.sheet })));
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
}

export function transactionsBulkDelete(ctx: WindowContext, ids: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validIds = z.array(idSchema).parse(ids);
  if (validIds.length === 0) {
    return { count: 0, deletedAttachments: {} };
  }

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

  // As in the single delete: rows first, as one unit, then the files.
  const deletedAttachments: Record<string, AttachmentRow[]> = {};
  const count = ctx.sqlite.transaction(() => {
    for (const id of expandedIds) {
      const removed = ctx.repos.attachments.removeForTransaction(id);
      if (removed.length > 0) {
        deletedAttachments[id] = removed;
      }
    }
    return ctx.repos.transactions.bulkRemove(expandedIds);
  })();

  attachmentService.moveAttachmentFilesToTrash(Object.values(deletedAttachments).flat(), ctx);

  if (count > 0) {
    logBulkTransactionsDeleted(ctx, count, expandedIds);
  }
  return { count, deletedAttachments };
}

export function transactionsSaveTransfer(ctx: WindowContext, expense: unknown, income: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validExpense = transactionRowSchema.parse(expense);
  const validIncome = transactionRowSchema.parse(income);

  if (!validExpense.linked_id || !validIncome.linked_id || validExpense.linked_id !== validIncome.linked_id) {
    throw new Error('Transfer pair must share the same non-null linked_id');
  }
  if (validExpense.type !== 'expense' || validIncome.type !== 'income') {
    throw new Error('Transfer must have one expense and one income');
  }
  if (validExpense.id === validIncome.id || validExpense.sheet === validIncome.sheet) {
    throw new Error('A transfer needs distinct entries on two different accounts.');
  }
  if (validExpense.date !== validIncome.date || parsePence(validExpense.amount) !== parsePence(validIncome.amount)
    || (parsePence(validExpense.amount) ?? 0) <= 0) {
    throw new Error('Both sides of a transfer must have the same date and positive amount.');
  }
  assertSheetsExist(ctx.sqlite, [
    { label: 'sheet', sheet: validExpense.sheet },
    { label: 'sheet', sheet: validIncome.sheet },
  ]);
  const previousExpense = ctx.repos.transactions.getById(validExpense.id);
  const previousIncome = ctx.repos.transactions.getById(validIncome.id);
  const pair = ctx.repos.transactions.getByLinkedId(validExpense.linked_id);
  if (pair.some((row) => row.id !== validExpense.id && row.id !== validIncome.id)
    || (previousExpense && previousExpense.linked_id !== validExpense.linked_id)
    || (previousIncome && previousIncome.linked_id !== validIncome.linked_id)) {
    throw new Error('These entries do not belong to the selected transfer.');
  }
  const { expense: savedExpense, income: savedIncome } =
    ctx.repos.transactions.saveTransfer(validExpense, validIncome);
  if (previousExpense) logTransactionUpdated(ctx, previousExpense, savedExpense);
  else logTransactionCreated(ctx, savedExpense);
  if (previousIncome) logTransactionUpdated(ctx, previousIncome, savedIncome);
  else logTransactionCreated(ctx, savedIncome);
  if (previousExpense) attachmentService.renameAttachmentsForTransaction(savedExpense.id, ctx);
  if (previousIncome) attachmentService.renameAttachmentsForTransaction(savedIncome.id, ctx);
  return { expense: savedExpense, income: savedIncome };
}

export function transactionsGetByLinkedId(ctx: WindowContext, linkedId: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validLinkedId = idSchema.parse(linkedId);
  return ctx.repos.transactions.getByLinkedId(validLinkedId);
}
