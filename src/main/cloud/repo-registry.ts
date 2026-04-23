import type { TransactionRow, PlannedTemplateRow, SheetRow, AttachmentRow, InvoiceRow } from '../../shared/ipc-types';

// ─── Unified interfaces that IPC handlers call ───────────────────────

export interface TransactionOps {
  getAll(sheet?: string): TransactionRow[];
  getById(id: string): TransactionRow | null;
  save(data: TransactionRow): TransactionRow;
  remove(id: string): boolean;
  bulkSave(transactions: TransactionRow[]): TransactionRow[];
  bulkRemove(ids: string[]): number;
}

export interface PlannedOps {
  getAll(): PlannedTemplateRow[];
  save(data: PlannedTemplateRow): PlannedTemplateRow;
  bulkSave(templates: PlannedTemplateRow[]): PlannedTemplateRow[];
  remove(id: string): boolean;
}

export interface SheetOps {
  getAll(): SheetRow[];
  create(id: string, name: string): SheetRow;
  renameSheet(oldName: string, newName: string): void;
  mergeAndDelete(sourceId: string, sourceName: string, targetName: string): void;
  deleteWithTransactions(id: string, name: string): void;
  reorder(orderedIds: string[]): void;
  deleteSimple(id: string): boolean;
  restoreWithSort(sheet: SheetRow): SheetRow;
  getTransactionsOnSheet(name: string): TransactionRow[];
  getPlannedOnSheet(name: string): PlannedTemplateRow[];
  getAttachmentsOnSheet(name: string): AttachmentRow[];
}

export interface CategoryOps {
  getAll(type: string): string[];
  setAll(type: string, names: string[]): void;
}

export interface ActivityNotesOps {
  getAll(): Record<string, string>;
  save(activity: string, notes: string): void;
  remove(activity: string): void;
}

export interface AttachmentOps {
  getForTransaction(transactionId: string): AttachmentRow[];
  getCounts(transactionIds: string[]): Record<string, number>;
  getById(id: string): AttachmentRow | null;
  save(row: AttachmentRow): AttachmentRow;
  remove(id: string): boolean;
  removeForTransaction(transactionId: string): AttachmentRow[];
}

export interface InvoiceOps {
  getAll(): InvoiceRow[];
  getById(id: string): InvoiceRow | null;
  getByPlannedTemplateId(plannedTemplateId: string): InvoiceRow[];
  save(data: InvoiceRow): InvoiceRow;
  remove(id: string): boolean;
  markPaid(invoiceId: string, transactionId: string): InvoiceRow | null;
  revertToDraft(invoiceId: string): InvoiceRow | null;
  updateLinkedFromPlanned(plannedTemplateId: string, dueDate: string, description: string, amount: string): number;
}

export interface RepoSet {
  transactions: TransactionOps;
  planned: PlannedOps;
  sheets: SheetOps;
  categories: CategoryOps;
  activityNotes: ActivityNotesOps;
  attachments: AttachmentOps;
  invoices: InvoiceOps;
}
