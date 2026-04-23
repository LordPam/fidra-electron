import type { TransactionRow, PlannedTemplateRow, SheetRow, AttachmentRow, InvoiceRow, AuditLogRow } from '../../../shared/ipc-types';

export interface CloudTransactionRepo {
  getAll(sheet?: string): Promise<TransactionRow[]>;
  getById(id: string): Promise<TransactionRow | null>;
  save(data: TransactionRow): Promise<TransactionRow>;
  remove(id: string): Promise<boolean>;
  removeVersioned(id: string, expectedVersion: number): Promise<boolean>;
  bulkSave(transactions: TransactionRow[]): Promise<TransactionRow[]>;
  bulkRemove(ids: string[]): Promise<number>;
  getVersion(id: string): Promise<number | null>;
}

export interface CloudSheetRepo {
  getAll(): Promise<SheetRow[]>;
  getById(id: string): Promise<SheetRow | null>;
  getByName(name: string): Promise<SheetRow | null>;
  create(id: string, name: string): Promise<SheetRow>;
  save(sheet: SheetRow): Promise<SheetRow>;
  remove(id: string): Promise<boolean>;
  renameSheet(oldName: string, newName: string): Promise<void>;
  mergeAndDelete(sourceId: string, sourceName: string, targetName: string): Promise<void>;
  deleteWithTransactions(id: string, name: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
}

export interface CloudPlannedRepo {
  getAll(): Promise<PlannedTemplateRow[]>;
  getById(id: string): Promise<PlannedTemplateRow | null>;
  save(data: PlannedTemplateRow): Promise<PlannedTemplateRow>;
  remove(id: string): Promise<boolean>;
  removeVersioned(id: string, expectedVersion: number): Promise<boolean>;
  getVersion(id: string): Promise<number | null>;
}

export interface CloudCategoryRepo {
  getAll(type: string): Promise<string[]>;
  setAll(type: string, names: string[]): Promise<void>;
}

export interface CloudActivityNotesRepo {
  getAll(): Promise<Record<string, string>>;
  save(activity: string, notes: string): Promise<void>;
  remove(activity: string): Promise<void>;
  setAll(notes: Record<string, string>): Promise<void>;
}

export interface CloudAttachmentRepo {
  getAll(): Promise<AttachmentRow[]>;
  getForTransaction(transactionId: string): Promise<AttachmentRow[]>;
  getById(id: string): Promise<AttachmentRow | null>;
  save(data: AttachmentRow): Promise<AttachmentRow>;
  remove(id: string): Promise<boolean>;
  removeForTransaction(transactionId: string): Promise<number>;
}

export interface CloudInvoiceRepo {
  getAll(): Promise<InvoiceRow[]>;
  getById(id: string): Promise<InvoiceRow | null>;
  save(data: InvoiceRow): Promise<InvoiceRow>;
  remove(id: string): Promise<boolean>;
  getVersion(id: string): Promise<number | null>;
}

export interface CloudAuditRepo {
  save(entry: AuditLogRow): Promise<AuditLogRow>;
  getAll(): Promise<AuditLogRow[]>;
  purgeOlderThan(cutoff: string): Promise<number>;
}
