import type { TransactionRow, PlannedTemplateRow, AttachmentRow, SheetRow, InvoiceRow } from '../../shared/ipc-types';
import { useTransactionStore } from '../stores/transaction-store';
import { usePlannedStore } from '../stores/planned-store';
import { useSheetStore } from '../stores/sheet-store';
import { useCategoryStore } from '../stores/category-store';
import { useInvoiceStore } from '../stores/invoice-store';
import { useAttachmentSignal } from '../stores/attachment-signal';

export interface UndoCommand {
  execute: () => Promise<void>;
  undo: () => Promise<void>;
  description: string;
}

export function createAddTransactionCommand(transaction: TransactionRow): UndoCommand {
  return {
    description: `Add transaction: ${transaction.description}`,
    execute: async () => {
      await useTransactionStore.getState().addTransaction(transaction);
    },
    undo: async () => {
      await useTransactionStore.getState().removeTransaction(transaction.id);
    },
  };
}

export function createEditTransactionCommand(
  oldTransaction: TransactionRow,
  newTransaction: TransactionRow,
): UndoCommand {
  return {
    description: `Edit transaction: ${newTransaction.description}`,
    execute: async () => {
      await useTransactionStore.getState().updateTransaction(newTransaction);
    },
    undo: async () => {
      await useTransactionStore.getState().restoreTransaction(oldTransaction);
    },
  };
}

export function createDeleteTransactionCommand(transaction: TransactionRow): UndoCommand {
  let capturedAttachments: AttachmentRow[] = [];
  return {
    description: `Delete transaction: ${transaction.description}`,
    execute: async () => {
      const result = await useTransactionStore.getState().removeTransaction(transaction.id);
      capturedAttachments = result.deletedAttachments;
    },
    undo: async () => {
      await useTransactionStore.getState().restoreTransaction(transaction);
      if (capturedAttachments.length > 0) {
        await window.api.restoreAttachmentsForTransaction(capturedAttachments);
      }
    },
  };
}

export function createBulkDeleteCommand(transactions: TransactionRow[]): UndoCommand {
  let capturedAttachments: Record<string, AttachmentRow[]> = {};
  return {
    description: `Delete ${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`,
    execute: async () => {
      const result = await useTransactionStore.getState().bulkRemove(transactions.map((t) => t.id));
      capturedAttachments = result.deletedAttachments;
    },
    undo: async () => {
      await useTransactionStore.getState().bulkRestore(transactions);
      const allAttachments = Object.values(capturedAttachments).flat();
      if (allAttachments.length > 0) {
        await window.api.restoreAttachmentsForTransaction(allAttachments);
      }
    },
  };
}

export function createBulkEditCommand(
  oldTransactions: TransactionRow[],
  newTransactions: TransactionRow[],
): UndoCommand {
  return {
    description: `Bulk edit: ${newTransactions.length} transaction${newTransactions.length !== 1 ? 's' : ''}`,
    execute: async () => {
      await useTransactionStore.getState().bulkUpdate(newTransactions);
    },
    undo: async () => {
      await useTransactionStore.getState().bulkUpdate(oldTransactions);
    },
  };
}

// Planned Template commands

export function createAddPlannedCommand(template: PlannedTemplateRow): UndoCommand {
  return {
    description: `Add planned: ${template.description}`,
    execute: async () => {
      await usePlannedStore.getState().addTemplate(template);
    },
    undo: async () => {
      await usePlannedStore.getState().removeTemplate(template.id);
    },
  };
}

export function createEditPlannedCommand(
  oldTemplate: PlannedTemplateRow,
  newTemplate: PlannedTemplateRow,
): UndoCommand {
  return {
    description: `Edit planned: ${newTemplate.description}`,
    execute: async () => {
      await usePlannedStore.getState().updateTemplate(newTemplate);
    },
    undo: async () => {
      await usePlannedStore.getState().restoreTemplate(oldTemplate);
    },
  };
}

export function createDeletePlannedCommand(template: PlannedTemplateRow): UndoCommand {
  return {
    description: `Delete planned: ${template.description}`,
    execute: async () => {
      await usePlannedStore.getState().removeTemplate(template.id);
    },
    undo: async () => {
      await usePlannedStore.getState().restoreTemplate(template);
    },
  };
}

export function createConvertPlannedCommand(
  template: PlannedTemplateRow,
  updatedTemplate: PlannedTemplateRow | null,
  transaction: TransactionRow,
  linkedInvoice?: InvoiceRow,
): UndoCommand {
  return {
    description: `Convert planned: ${template.description}`,
    execute: async () => {
      await useTransactionStore.getState().addTransaction(transaction);
      if (updatedTemplate) {
        await usePlannedStore.getState().updateTemplate(updatedTemplate);
      } else {
        await usePlannedStore.getState().removeTemplate(template.id);
      }
      if (linkedInvoice) {
        await useInvoiceStore.getState().markPaid(linkedInvoice.id, transaction.id);
      }
    },
    undo: async () => {
      if (linkedInvoice) {
        await useInvoiceStore.getState().revertToDraft(linkedInvoice.id);
      }
      await useTransactionStore.getState().removeTransaction(transaction.id);
      await usePlannedStore.getState().restoreTemplate(template);
    },
  };
}

// Attachment commands

export function createAddAttachmentCommand(
  attachment: AttachmentRow,
  onRefresh: () => Promise<void>,
): UndoCommand {
  return {
    description: `Add attachment: ${attachment.filename}`,
    execute: async () => {
      await window.api.restoreAttachment(attachment);
      await onRefresh();
      useAttachmentSignal.getState().bump();
    },
    undo: async () => {
      await window.api.removeAttachment(attachment.id);
      await onRefresh();
      useAttachmentSignal.getState().bump();
    },
  };
}

export function createRemoveAttachmentCommand(
  attachment: AttachmentRow,
  onRefresh: () => Promise<void>,
): UndoCommand {
  return {
    description: `Remove attachment: ${attachment.filename}`,
    execute: async () => {
      await window.api.removeAttachment(attachment.id);
      await onRefresh();
      useAttachmentSignal.getState().bump();
    },
    undo: async () => {
      await window.api.restoreAttachment(attachment);
      await onRefresh();
      useAttachmentSignal.getState().bump();
    },
  };
}

// Sheet commands

export function createAddSheetCommand(sheet: { id: string; name: string }): UndoCommand {
  return {
    description: `Add sheet: ${sheet.name}`,
    execute: async () => {
      await useSheetStore.getState().addSheet(sheet.id, sheet.name);
    },
    undo: async () => {
      await window.api.deleteSheetSimple(sheet.id);
      useSheetStore.setState((state) => ({
        sheets: state.sheets.filter((s) => s.id !== sheet.id),
      }));
    },
  };
}

export function createRenameSheetCommand(oldName: string, newName: string): UndoCommand {
  return {
    description: `Rename sheet: ${oldName} → ${newName}`,
    execute: async () => {
      await useSheetStore.getState().renameSheet(oldName, newName);
      await useTransactionStore.getState().loadAll();
    },
    undo: async () => {
      await useSheetStore.getState().renameSheet(newName, oldName);
      await useTransactionStore.getState().loadAll();
    },
  };
}

export function createReorderSheetsCommand(oldOrder: string[], newOrder: string[]): UndoCommand {
  return {
    description: 'Reorder sheets',
    execute: async () => {
      await useSheetStore.getState().reorderSheets(newOrder);
    },
    undo: async () => {
      await useSheetStore.getState().reorderSheets(oldOrder);
    },
  };
}

export function createMergeSheetCommand(
  sheet: SheetRow,
  mergeTarget: string,
  affectedTxs: TransactionRow[],
  affectedPlanned: PlannedTemplateRow[],
): UndoCommand {
  return {
    description: `Merge sheet: ${sheet.name} → ${mergeTarget}`,
    execute: async () => {
      await useSheetStore.getState().removeSheet(sheet.id, sheet.name, mergeTarget);
      await useTransactionStore.getState().loadAll();
    },
    undo: async () => {
      // Re-create the sheet
      await window.api.restoreSheetWithSort(sheet);
      // Reassign transactions back to original sheet
      if (affectedTxs.length > 0) {
        await window.api.bulkSaveTransactions(affectedTxs);
      }
      // Reassign planned templates back
      for (const p of affectedPlanned) {
        await window.api.savePlannedTemplate(p);
      }
      await useSheetStore.getState().loadAll();
      await useTransactionStore.getState().loadAll();
      await usePlannedStore.getState().loadAll();
    },
  };
}

export function createDeleteSheetWithDataCommand(
  sheet: SheetRow,
  deletedTxs: TransactionRow[],
  deletedPlanned: PlannedTemplateRow[],
  deletedAttachments: AttachmentRow[],
): UndoCommand {
  return {
    description: `Delete sheet: ${sheet.name}`,
    execute: async () => {
      await useSheetStore.getState().removeSheet(sheet.id, sheet.name);
      await useTransactionStore.getState().loadAll();
    },
    undo: async () => {
      // Re-create sheet
      await window.api.restoreSheetWithSort(sheet);
      // Restore transactions
      if (deletedTxs.length > 0) {
        await window.api.bulkSaveTransactions(deletedTxs);
      }
      // Restore planned templates
      for (const p of deletedPlanned) {
        await window.api.savePlannedTemplate(p);
      }
      // Restore attachments (files from .trash/)
      if (deletedAttachments.length > 0) {
        await window.api.restoreAttachmentsForTransaction(deletedAttachments);
      }
      await useSheetStore.getState().loadAll();
      await useTransactionStore.getState().loadAll();
      await usePlannedStore.getState().loadAll();
    },
  };
}

// Category commands

export function createSetCategoriesCommand(
  type: 'income' | 'expense',
  oldNames: string[],
  newNames: string[],
): UndoCommand {
  return {
    description: `Update ${type} categories`,
    execute: async () => {
      await useCategoryStore.getState().setCategories(type, newNames);
    },
    undo: async () => {
      await useCategoryStore.getState().setCategories(type, oldNames);
    },
  };
}

// Activity commands

export function createRenameActivityCommand(
  oldName: string,
  newName: string,
  oldTransactions: TransactionRow[],
  newTransactions: TransactionRow[],
  oldTemplates: PlannedTemplateRow[],
  newTemplates: PlannedTemplateRow[],
  oldNoteText: string | undefined,
  onRefreshNotes: () => Promise<void>,
): UndoCommand {
  return {
    description: `Rename activity: ${oldName} → ${newName}`,
    execute: async () => {
      if (newTransactions.length > 0) {
        await useTransactionStore.getState().bulkUpdate(newTransactions);
      }
      if (newTemplates.length > 0) {
        await usePlannedStore.getState().bulkUpdateTemplates(newTemplates);
      }
      if (oldNoteText !== undefined) {
        await window.api.saveActivityNote(newName, oldNoteText);
        await window.api.deleteActivityNote(oldName);
      }
      await onRefreshNotes();
    },
    undo: async () => {
      if (oldTransactions.length > 0) {
        await useTransactionStore.getState().bulkUpdate(oldTransactions);
      }
      if (oldTemplates.length > 0) {
        await usePlannedStore.getState().bulkUpdateTemplates(oldTemplates);
      }
      if (oldNoteText !== undefined) {
        await window.api.saveActivityNote(oldName, oldNoteText);
        await window.api.deleteActivityNote(newName);
      }
      await onRefreshNotes();
    },
  };
}

export function createDeleteActivityCommand(
  activityName: string,
  oldTransactions: TransactionRow[],
  clearedTransactions: TransactionRow[],
  oldTemplates: PlannedTemplateRow[],
  clearedTemplates: PlannedTemplateRow[],
  oldNoteText: string | undefined,
  onRefreshNotes: () => Promise<void>,
): UndoCommand {
  return {
    description: `Delete activity: ${activityName}`,
    execute: async () => {
      if (clearedTransactions.length > 0) {
        await useTransactionStore.getState().bulkUpdate(clearedTransactions);
      }
      if (clearedTemplates.length > 0) {
        await usePlannedStore.getState().bulkUpdateTemplates(clearedTemplates);
      }
      if (oldNoteText !== undefined) {
        await window.api.deleteActivityNote(activityName);
      }
      await onRefreshNotes();
    },
    undo: async () => {
      if (oldTransactions.length > 0) {
        await useTransactionStore.getState().bulkUpdate(oldTransactions);
      }
      if (oldTemplates.length > 0) {
        await usePlannedStore.getState().bulkUpdateTemplates(oldTemplates);
      }
      if (oldNoteText !== undefined) {
        await window.api.saveActivityNote(activityName, oldNoteText);
      }
      await onRefreshNotes();
    },
  };
}

export function createEditActivityNoteCommand(
  activityName: string,
  oldText: string,
  newText: string,
  onRefreshNotes: () => Promise<void>,
): UndoCommand {
  return {
    description: `Edit note: ${activityName}`,
    execute: async () => {
      if (newText) {
        await window.api.saveActivityNote(activityName, newText);
      } else {
        await window.api.deleteActivityNote(activityName);
      }
      await onRefreshNotes();
    },
    undo: async () => {
      if (oldText) {
        await window.api.saveActivityNote(activityName, oldText);
      } else {
        await window.api.deleteActivityNote(activityName);
      }
      await onRefreshNotes();
    },
  };
}

// Invoice commands

export function createDeleteInvoiceCommand(invoice: InvoiceRow): UndoCommand {
  return {
    description: `Delete invoice: ${invoice.invoice_number}`,
    execute: async () => {
      await useInvoiceStore.getState().remove(invoice.id);
    },
    undo: async () => {
      await useInvoiceStore.getState().save(invoice);
    },
  };
}

export interface MarkAsPaidContext {
  invoice: InvoiceRow;
  transaction: TransactionRow;
  /** For 'once' templates: the full template that was deleted. For recurring: the template before fulfilled_dates was modified. */
  templateBefore?: PlannedTemplateRow;
  /** For recurring templates: the template after fulfilled_dates was modified. */
  templateAfter?: PlannedTemplateRow;
  /** The invoice row after being marked paid (with snapshot set). */
  invoiceAfterPaid: InvoiceRow;
}

export function createMarkAsPaidCommand(ctx: MarkAsPaidContext): UndoCommand {
  return {
    description: `Mark paid: ${ctx.invoice.invoice_number}`,
    execute: async () => {
      await useTransactionStore.getState().addTransaction(ctx.transaction);
      await useInvoiceStore.getState().markPaid(ctx.invoice.id, ctx.transaction.id);

      if (ctx.templateBefore) {
        if (ctx.templateAfter) {
          // Recurring: update fulfilled_dates
          await usePlannedStore.getState().updateTemplate(ctx.templateAfter);
        } else {
          // Once: delete template
          await usePlannedStore.getState().removeTemplate(ctx.templateBefore.id);
        }
        // Save snapshot on invoice
        await useInvoiceStore.getState().save(ctx.invoiceAfterPaid);
      }
    },
    undo: async () => {
      // Revert invoice to draft (clears snapshot)
      await useInvoiceStore.getState().revertToDraft(ctx.invoice.id);

      // Delete the created transaction
      await useTransactionStore.getState().removeTransaction(ctx.transaction.id);

      // Restore planned template
      if (ctx.templateBefore) {
        if (ctx.templateAfter) {
          // Recurring: restore original fulfilled_dates
          await usePlannedStore.getState().restoreTemplate(ctx.templateBefore);
        } else {
          // Once: recreate deleted template
          await usePlannedStore.getState().restoreTemplate(ctx.templateBefore);
        }
      }
    },
  };
}

export function createRevertToDraftCommand(
  paidInvoice: InvoiceRow,
  linkedTransaction: TransactionRow | null,
  /** The template state before revert modified it (i.e. after mark-as-paid had changed it). */
  templateBeforeRevert?: PlannedTemplateRow,
  /** The template state after revert restored it. */
  templateAfterRevert?: PlannedTemplateRow,
): UndoCommand {
  return {
    description: `Revert to draft: ${paidInvoice.invoice_number}`,
    execute: async () => {
      await useInvoiceStore.getState().revertToDraft(paidInvoice.id);

      if (linkedTransaction) {
        await useTransactionStore.getState().removeTransaction(linkedTransaction.id);
      }

      // Restore template
      if (templateAfterRevert) {
        if (templateBeforeRevert) {
          await usePlannedStore.getState().updateTemplate(templateAfterRevert);
        } else {
          await usePlannedStore.getState().restoreTemplate(templateAfterRevert);
        }
      }
    },
    undo: async () => {
      // Re-mark as paid
      if (linkedTransaction) {
        await useTransactionStore.getState().addTransaction(linkedTransaction);
      }
      // Restore the paid invoice state (includes snapshot)
      await useInvoiceStore.getState().save(paidInvoice);

      // Restore template to its pre-revert state
      if (templateBeforeRevert) {
        await usePlannedStore.getState().updateTemplate(templateBeforeRevert);
      } else if (templateAfterRevert) {
        // Once template was recreated by revert, undo means re-delete it
        await usePlannedStore.getState().removeTemplate(templateAfterRevert.id);
      }
    },
  };
}
