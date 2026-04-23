import type Database from 'better-sqlite3';
import type { TransactionRow, PlannedTemplateRow, SheetRow, AttachmentRow, InvoiceRow, AuditLogRow } from '../../shared/ipc-types';
import type { TransactionRepo } from '../repositories/transaction-repo';
import type { PlannedRepo } from '../repositories/planned-repo';
import type { SheetRepo } from '../repositories/sheet-repo';
import type { CategoryRepo } from '../repositories/category-repo';
import type { ActivityNotesRepo } from '../repositories/activity-notes-repo';
import type { AttachmentRepo } from '../repositories/attachment-repo';
import type { InvoiceRepo } from '../repositories/invoice-repo';
import type { AuditRepo } from '../repositories/audit-repo';
import type {
  CloudTransactionRepo,
  CloudPlannedRepo,
  CloudSheetRepo,
  CloudCategoryRepo,
  CloudActivityNotesRepo,
  CloudAttachmentRepo,
  CloudInvoiceRepo,
  CloudAuditRepo,
} from './repos/cloud-repo-interfaces';
import type { SyncQueue } from './sync-queue';
import type { RecentDeletes } from './recent-deletes';

// ─── Transactions ───────────────────────────────────────────────────

export class CachingTransactionRepo {
  constructor(
    private readonly local: TransactionRepo,
    private readonly cloud: CloudTransactionRepo,
    private readonly queue: SyncQueue,
    private readonly recentDeletes: RecentDeletes,
    private readonly getPersonnelId?: () => string | null,
  ) {}

  getAll(sheet?: string): TransactionRow[] {
    return this.local.getAll(sheet);
  }

  getById(id: string): TransactionRow | null {
    return this.local.getById(id);
  }

  save(data: TransactionRow): TransactionRow {
    const personnelId = this.getPersonnelId?.() ?? null;
    // Ensure version is always monotonically increasing — undo/redo may
    // replay stale versions that would conflict with cloud optimistic locking.
    const existing = this.local.getById(data.id);
    const version = existing ? Math.max(data.version, existing.version + 1) : data.version;
    const versioned = version !== data.version ? { ...data, version } : data;
    const withAuthor = personnelId ? { ...versioned, modified_by: personnelId } : versioned;
    const result = this.local.save(withAuthor);
    this.queue.enqueueSave('transaction', withAuthor.id, JSON.stringify(withAuthor), withAuthor.version);
    this.recentDeletes.clear('transaction', withAuthor.id);
    return result;
  }

  remove(id: string): boolean {
    const existing = this.local.getById(id);
    const version = existing?.version ?? 0;
    const result = this.local.remove(id);
    this.queue.enqueueDelete('transaction', id, version);
    this.recentDeletes.mark('transaction', id);
    return result;
  }

  bulkSave(transactions: TransactionRow[]): TransactionRow[] {
    const personnelId = this.getPersonnelId?.() ?? null;
    // Fix versions for any stale entries (undo/redo replays)
    const fixed = transactions.map((tx) => {
      const existing = this.local.getById(tx.id);
      const version = existing ? Math.max(tx.version, existing.version + 1) : tx.version;
      const versioned = version !== tx.version ? { ...tx, version } : tx;
      return personnelId ? { ...versioned, modified_by: personnelId } : versioned;
    });
    const result = this.local.bulkSave(fixed);
    for (const tx of fixed) {
      this.queue.enqueueSave('transaction', tx.id, JSON.stringify(tx), tx.version);
      this.recentDeletes.clear('transaction', tx.id);
    }
    return result;
  }

  bulkRemove(ids: string[]): number {
    const versions: Record<string, number> = {};
    for (const id of ids) {
      const existing = this.local.getById(id);
      versions[id] = existing?.version ?? 0;
    }
    const count = this.local.bulkRemove(ids);
    for (const id of ids) {
      this.queue.enqueueDelete('transaction', id, versions[id]);
    }
    this.recentDeletes.markBulk('transaction', ids);
    return count;
  }

  async syncToCloud(data: TransactionRow): Promise<TransactionRow> {
    return this.cloud.save(data);
  }

  async deleteFromCloud(id: string): Promise<boolean> {
    const result = await this.cloud.remove(id);
    // Re-mark tombstone to extend TTL past cloud replication / NOTIFY window.
    this.recentDeletes.mark('transaction', id);
    return result;
  }

  async deleteFromCloudVersioned(id: string, version: number): Promise<boolean> {
    const result = await this.cloud.removeVersioned(id, version);
    this.recentDeletes.mark('transaction', id);
    return result;
  }

  async getCloudVersion(id: string): Promise<number | null> {
    return this.cloud.getVersion(id);
  }

  async getCloudById(id: string): Promise<TransactionRow | null> {
    return this.cloud.getById(id);
  }

  saveLocal(data: TransactionRow): void {
    this.local.save(data);
  }

  removeLocal(id: string): void {
    this.local.remove(id);
  }

  async refreshFromCloud(): Promise<number> {
    // Snapshot pending entity IDs BEFORE the async fetch so that items
    // dequeued by SyncService during the network call are still protected.
    const pendingIds = this.queue.getPendingEntityIds();
    this.recentDeletes.prune();
    const cloudRows = await this.cloud.getAll();
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    let refreshed = 0;

    for (const row of cloudRows) {
      if (pendingIds.has(row.id)) continue;
      if (this.recentDeletes.has('transaction', row.id)) continue;
      this.local.save(row);
      refreshed++;
    }

    const localRows = this.local.getAll();
    for (const local of localRows) {
      if (!cloudIds.has(local.id)) {
        if (pendingIds.has(local.id)) continue;
        this.local.remove(local.id);
        refreshed++;
      }
    }

    return refreshed;
  }
}

// ─── Planned Templates ──────────────────────────────────────────────

export class CachingPlannedRepo {
  constructor(
    private readonly local: PlannedRepo,
    private readonly cloud: CloudPlannedRepo,
    private readonly queue: SyncQueue,
    private readonly recentDeletes: RecentDeletes,
  ) {}

  getAll(): PlannedTemplateRow[] {
    return this.local.getAll();
  }

  save(data: PlannedTemplateRow): PlannedTemplateRow {
    const existing = this.local.getById(data.id);
    const version = existing ? Math.max(data.version, existing.version + 1) : data.version;
    const versioned = version !== data.version ? { ...data, version } : data;
    const result = this.local.save(versioned);
    this.queue.enqueueSave('planned_template', versioned.id, JSON.stringify(versioned), versioned.version);
    this.recentDeletes.clear('planned_template', versioned.id);
    return result;
  }

  bulkSave(templates: PlannedTemplateRow[]): PlannedTemplateRow[] {
    const fixed = templates.map((tmpl) => {
      const existing = this.local.getById(tmpl.id);
      const version = existing ? Math.max(tmpl.version, existing.version + 1) : tmpl.version;
      return version !== tmpl.version ? { ...tmpl, version } : tmpl;
    });
    const result = this.local.bulkSave(fixed);
    for (const tmpl of fixed) {
      this.queue.enqueueSave('planned_template', tmpl.id, JSON.stringify(tmpl), tmpl.version);
      this.recentDeletes.clear('planned_template', tmpl.id);
    }
    return result;
  }

  remove(id: string): boolean {
    const existing = this.local.getById(id);
    const version = existing?.version ?? 0;
    const result = this.local.remove(id);
    this.queue.enqueueDelete('planned_template', id, version);
    this.recentDeletes.mark('planned_template', id);
    return result;
  }

  async syncToCloud(data: PlannedTemplateRow): Promise<PlannedTemplateRow> {
    return this.cloud.save(data);
  }

  async deleteFromCloud(id: string): Promise<boolean> {
    const result = await this.cloud.remove(id);
    this.recentDeletes.mark('planned_template', id);
    return result;
  }

  async deleteFromCloudVersioned(id: string, version: number): Promise<boolean> {
    const result = await this.cloud.removeVersioned(id, version);
    this.recentDeletes.mark('planned_template', id);
    return result;
  }

  async getCloudById(id: string): Promise<PlannedTemplateRow | null> {
    return this.cloud.getById(id);
  }

  saveLocal(data: PlannedTemplateRow): void {
    this.local.save(data);
  }

  removeLocal(id: string): void {
    this.local.remove(id);
  }

  async refreshFromCloud(): Promise<number> {
    const pendingIds = this.queue.getPendingEntityIds();
    this.recentDeletes.prune();
    const cloudRows = await this.cloud.getAll();
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    let refreshed = 0;

    for (const row of cloudRows) {
      if (pendingIds.has(row.id)) continue;
      if (this.recentDeletes.has('planned_template', row.id)) continue;
      this.local.save(row);
      refreshed++;
    }

    const localRows = this.local.getAll();
    for (const local of localRows) {
      if (!cloudIds.has(local.id)) {
        if (pendingIds.has(local.id)) continue;
        this.local.remove(local.id);
        refreshed++;
      }
    }

    return refreshed;
  }
}

// ─── Sheets ─────────────────────────────────────────────────────────

export class CachingSheetRepo {
  constructor(
    private readonly local: SheetRepo,
    private readonly cloud: CloudSheetRepo,
    private readonly queue: SyncQueue,
    private readonly db: Database.Database,
    private readonly recentDeletes: RecentDeletes,
  ) {}

  getAll(): SheetRow[] {
    return this.local.getAll();
  }

  create(id: string, name: string): SheetRow {
    const result = this.local.create(id, name);
    this.queue.enqueueSave('sheet', result.id, JSON.stringify(result), 1);
    return result;
  }

  renameSheet(oldName: string, newName: string): void {
    this.local.renameSheet(oldName, newName);
    const sheet = this.local.getByName(newName);
    if (sheet) {
      this.queue.enqueueRenameSheet(sheet.id, oldName, newName);
    }
  }

  mergeAndDelete(sourceId: string, sourceName: string, targetName: string): void {
    this.local.mergeAndDelete(sourceId, sourceName, targetName);
    this.queue.enqueueMergeSheet(sourceId, sourceName, targetName);
    this.recentDeletes.mark('sheet', sourceId);
  }

  deleteWithTransactions(id: string, name: string): void {
    this.local.deleteWithTransactions(id, name);
    this.queue.enqueueDeleteSheetCascade(id, name);
    this.recentDeletes.mark('sheet', id);
  }

  reorder(orderedIds: string[]): void {
    this.local.reorder(orderedIds);
    // Enqueue each sheet for sync so cloud gets the updated sort_order
    const allSheets = this.local.getAll();
    for (const sheet of allSheets) {
      this.queue.enqueueSave('sheet', sheet.id, JSON.stringify(sheet), 1);
    }
  }

  deleteSimple(id: string): boolean {
    const result = this.local.deleteSimple(id);
    if (result) {
      this.queue.enqueueDelete('sheet', id);
      this.recentDeletes.mark('sheet', id);
    }
    return result;
  }

  restoreWithSort(sheet: SheetRow): SheetRow {
    const result = this.local.restoreWithSort(sheet);
    this.queue.enqueueSave('sheet', result.id, JSON.stringify(result), 1);
    this.recentDeletes.clear('sheet', result.id);
    return result;
  }

  getTransactionsOnSheet(name: string): import('../../shared/ipc-types').TransactionRow[] {
    return this.local.getTransactionsOnSheet(name);
  }

  getPlannedOnSheet(name: string): import('../../shared/ipc-types').PlannedTemplateRow[] {
    return this.local.getPlannedOnSheet(name);
  }

  getAttachmentsOnSheet(name: string): import('../../shared/ipc-types').AttachmentRow[] {
    return this.local.getAttachmentsOnSheet(name);
  }

  async syncToCloud(sheet: SheetRow): Promise<SheetRow> {
    return this.cloud.save(sheet);
  }

  async renameSheetCloud(oldName: string, newName: string): Promise<void> {
    return this.cloud.renameSheet(oldName, newName);
  }

  async mergeAndDeleteCloud(sourceId: string, sourceName: string, targetName: string): Promise<void> {
    return this.cloud.mergeAndDelete(sourceId, sourceName, targetName);
  }

  async deleteWithTransactionsCloud(id: string, name: string): Promise<void> {
    await this.cloud.deleteWithTransactions(id, name);
    this.recentDeletes.mark('sheet', id);
  }

  async deleteFromCloud(id: string): Promise<boolean> {
    const result = await this.cloud.remove(id);
    this.recentDeletes.mark('sheet', id);
    return result;
  }

  async getCloudById(id: string): Promise<SheetRow | null> {
    return this.cloud.getById(id);
  }

  saveLocal(sheet: SheetRow): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sheet.id, sheet.name, sheet.is_virtual, sheet.is_planned, sheet.sort_order ?? 0, sheet.created_at);
  }

  removeLocal(id: string): void {
    this.local.remove(id);
  }

  async refreshFromCloud(): Promise<number> {
    const pendingIds = this.queue.getPendingEntityIds();
    this.recentDeletes.prune();
    const cloudRows = await this.cloud.getAll();
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    let refreshed = 0;

    for (const row of cloudRows) {
      if (pendingIds.has(row.id)) continue;
      if (this.recentDeletes.has('sheet', row.id)) continue;
      this.db.prepare(
        'INSERT OR REPLACE INTO sheets (id, name, is_virtual, is_planned, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(row.id, row.name, row.is_virtual, row.is_planned, row.sort_order ?? 0, row.created_at);
      refreshed++;
    }

    const localRows = this.local.getAll();
    for (const local of localRows) {
      if (!cloudIds.has(local.id)) {
        if (pendingIds.has(local.id)) continue;
        this.local.remove(local.id);
        refreshed++;
      }
    }

    return refreshed;
  }
}

// ─── Categories ─────────────────────────────────────────────────────

export class CachingCategoryRepo {
  constructor(
    private readonly local: CategoryRepo,
    private readonly cloud: CloudCategoryRepo,
    private readonly queue: SyncQueue,
  ) {}

  getAll(type: string): string[] {
    return this.local.getAll(type);
  }

  setAll(type: string, names: string[]): void {
    this.local.setAll(type, names);
    this.queue.enqueueCategorySetAll(type, names);
  }

  async syncCategorySetAll(type: string, names: string[]): Promise<void> {
    await this.cloud.setAll(type, names);
  }

  async refreshFromCloud(): Promise<number> {
    if (this.queue.hasPendingForType('category')) {
      return 0;
    }
    const income = await this.cloud.getAll('income');
    const expense = await this.cloud.getAll('expense');
    this.local.setAll('income', income);
    this.local.setAll('expense', expense);
    return income.length + expense.length;
  }
}

// ─── Activity Notes ─────────────────────────────────────────────────

export class CachingActivityNotesRepo {
  constructor(
    private readonly local: ActivityNotesRepo,
    private readonly cloud: CloudActivityNotesRepo,
    private readonly queue: SyncQueue,
    private readonly db: Database.Database,
  ) {}

  getAll(): Record<string, string> {
    return this.local.getAll();
  }

  save(activity: string, notes: string): void {
    const existing = this.local.getAll()[activity];
    this.local.save(activity, notes);
    if (existing !== notes) {
      this.queue.enqueueActivityNoteSave(activity, notes);
    }
  }

  remove(activity: string): void {
    this.local.remove(activity);
    this.queue.enqueueActivityNoteDelete(activity);
  }

  async syncActivityNoteSave(activity: string, notes: string): Promise<void> {
    await this.cloud.save(activity, notes);
  }

  async syncActivityNoteDelete(activity: string): Promise<void> {
    await this.cloud.remove(activity);
  }

  async refreshFromCloud(): Promise<number> {
    if (this.queue.hasPendingForType('activity_note')) {
      return 0;
    }
    const cloudNotes = await this.cloud.getAll();
    this.db.prepare('DELETE FROM activity_notes').run();
    const stmt = this.db.prepare('INSERT INTO activity_notes (activity, notes) VALUES (?, ?)');
    for (const [activity, notes] of Object.entries(cloudNotes)) {
      stmt.run(activity, notes);
    }
    return Object.keys(cloudNotes).length;
  }
}

// ─── Attachments ───────────────────────────────────────────────────

export class CachingAttachmentRepo {
  constructor(
    private readonly local: AttachmentRepo,
    private readonly cloud: CloudAttachmentRepo,
    private readonly queue: SyncQueue,
    private readonly db: Database.Database,
    private readonly recentDeletes: RecentDeletes,
  ) {}

  getForTransaction(transactionId: string): AttachmentRow[] {
    return this.local.getForTransaction(transactionId);
  }

  getCounts(transactionIds: string[]): Record<string, number> {
    return this.local.getCounts(transactionIds);
  }

  getById(id: string): AttachmentRow | null {
    return this.local.getById(id);
  }

  save(row: AttachmentRow): AttachmentRow {
    const result = this.local.save(row);
    this.queue.enqueueSave('attachment', row.id, JSON.stringify(row), 1);
    this.recentDeletes.clear('attachment', row.id);
    return result;
  }

  remove(id: string): boolean {
    const result = this.local.remove(id);
    this.queue.enqueueDelete('attachment', id);
    this.recentDeletes.mark('attachment', id);
    return result;
  }

  removeForTransaction(transactionId: string): AttachmentRow[] {
    const rows = this.local.removeForTransaction(transactionId);
    for (const row of rows) {
      this.queue.enqueueDelete('attachment', row.id);
      this.recentDeletes.mark('attachment', row.id);
    }
    return rows;
  }

  async syncToCloud(data: AttachmentRow): Promise<AttachmentRow> {
    return this.cloud.save(data);
  }

  async deleteFromCloud(id: string): Promise<boolean> {
    const result = await this.cloud.remove(id);
    this.recentDeletes.mark('attachment', id);
    return result;
  }

  saveLocal(data: AttachmentRow): void {
    this.local.save(data);
  }

  removeLocal(id: string): void {
    this.local.remove(id);
  }

  async refreshFromCloud(): Promise<number> {
    const pendingIds = this.queue.getPendingEntityIds();
    this.recentDeletes.prune();
    const cloudRows = await this.cloud.getAll();
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    let refreshed = 0;

    for (const row of cloudRows) {
      if (pendingIds.has(row.id)) continue;
      if (this.recentDeletes.has('attachment', row.id)) continue;
      this.local.save(row);
      refreshed++;
    }

    const localRows = this.db.prepare('SELECT * FROM attachments').all() as AttachmentRow[];
    for (const local of localRows) {
      if (!cloudIds.has(local.id)) {
        if (pendingIds.has(local.id)) continue;
        this.local.remove(local.id);
        refreshed++;
      }
    }

    return refreshed;
  }
}

// ─── Invoices ─────────────────────────────────────────────────────

export class CachingInvoiceRepo {
  constructor(
    private readonly local: InvoiceRepo,
    private readonly cloud: CloudInvoiceRepo,
    private readonly queue: SyncQueue,
    private readonly recentDeletes: RecentDeletes,
  ) {}

  getAll(): InvoiceRow[] {
    return this.local.getAll();
  }

  getById(id: string): InvoiceRow | null {
    return this.local.getById(id);
  }

  getByPlannedTemplateId(plannedTemplateId: string): InvoiceRow[] {
    return this.local.getByPlannedTemplateId(plannedTemplateId);
  }

  save(data: InvoiceRow): InvoiceRow {
    const existing = this.local.getById(data.id);
    const version = existing ? Math.max(data.version, existing.version + 1) : data.version;
    const versioned = version !== data.version ? { ...data, version } : data;
    const result = this.local.save(versioned);
    this.queue.enqueueSave('invoice', result.id, JSON.stringify(result), result.version);
    this.recentDeletes.clear('invoice', result.id);
    return result;
  }

  remove(id: string): boolean {
    const existing = this.local.getById(id);
    const version = existing?.version ?? 0;
    const result = this.local.remove(id);
    this.queue.enqueueDelete('invoice', id, version);
    this.recentDeletes.mark('invoice', id);
    return result;
  }

  markPaid(invoiceId: string, transactionId: string): InvoiceRow | null {
    const result = this.local.markPaid(invoiceId, transactionId);
    if (result) {
      this.queue.enqueueSave('invoice', result.id, JSON.stringify(result), result.version);
    }
    return result;
  }

  revertToDraft(invoiceId: string): InvoiceRow | null {
    const result = this.local.revertToDraft(invoiceId);
    if (result) {
      this.queue.enqueueSave('invoice', result.id, JSON.stringify(result), result.version);
    }
    return result;
  }

  updateLinkedFromPlanned(
    plannedTemplateId: string,
    dueDate: string,
    description: string,
    amount: string,
  ): number {
    const count = this.local.updateLinkedFromPlanned(plannedTemplateId, dueDate, description, amount);
    // Enqueue each updated invoice for sync
    if (count > 0) {
      const linked = this.local.getByPlannedTemplateId(plannedTemplateId);
      for (const inv of linked) {
        this.queue.enqueueSave('invoice', inv.id, JSON.stringify(inv), inv.version);
      }
    }
    return count;
  }

  async syncToCloud(data: InvoiceRow): Promise<InvoiceRow> {
    return this.cloud.save(data);
  }

  async deleteFromCloud(id: string): Promise<boolean> {
    const result = await this.cloud.remove(id);
    this.recentDeletes.mark('invoice', id);
    return result;
  }

  async getCloudVersion(id: string): Promise<number | null> {
    return this.cloud.getVersion(id);
  }

  async getCloudById(id: string): Promise<InvoiceRow | null> {
    return this.cloud.getById(id);
  }

  saveLocal(data: InvoiceRow): void {
    this.local.save(data);
  }

  removeLocal(id: string): void {
    this.local.remove(id);
  }

  async refreshFromCloud(): Promise<number> {
    const pendingIds = this.queue.getPendingEntityIds();
    this.recentDeletes.prune();
    const cloudRows = await this.cloud.getAll();
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    let refreshed = 0;

    for (const row of cloudRows) {
      if (pendingIds.has(row.id)) continue;
      if (this.recentDeletes.has('invoice', row.id)) continue;
      this.local.save(row);
      refreshed++;
    }

    // Invoices may pre-date cloud sync — local-only invoices should be
    // pushed to the cloud rather than deleted. Enqueue them for upload.
    const localRows = this.local.getAll();
    for (const local of localRows) {
      if (!cloudIds.has(local.id)) {
        if (pendingIds.has(local.id)) continue;
        this.queue.enqueueSave('invoice', local.id, JSON.stringify(local), local.version);
        refreshed++;
      }
    }

    return refreshed;
  }
}

// ─── Audit Log ─────────────────────────────────────────────────────

export class CachingAuditRepo {
  constructor(
    private readonly local: AuditRepo,
    private readonly cloud: CloudAuditRepo,
    private readonly queue: SyncQueue,
  ) {}

  log(entry: AuditLogRow): void {
    this.local.log(entry);
    this.queue.enqueueSave('audit_log', entry.id, JSON.stringify(entry), 0);
  }

  getAll(entityType?: string, limit?: number): AuditLogRow[] {
    return this.local.getAll(entityType, limit);
  }

  getForEntity(entityId: string): AuditLogRow[] {
    return this.local.getForEntity(entityId);
  }

  async syncToCloud(entry: AuditLogRow): Promise<AuditLogRow> {
    return this.cloud.save(entry);
  }

  async refreshFromCloud(): Promise<number> {
    const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cloudRows = await this.cloud.getAll();
    let added = 0;

    // Pull cloud → local (additive), but only entries within retention window.
    // Without this filter, purged local entries get resurrected from cloud.
    for (const row of cloudRows) {
      if (row.timestamp < retentionCutoff) continue;
      try {
        this.local.log(row);
        added++;
      } catch {
        // Ignore duplicate ID constraint errors (entry already exists locally)
      }
    }

    // Purge old entries from cloud too
    this.cloud.purgeOlderThan(retentionCutoff).catch((e) => {
      console.warn('[audit] Failed to purge cloud audit entries:', e);
    });

    return added;
  }

  purgeLocal(cutoff: string): number {
    return this.local.purgeOlderThan(cutoff);
  }

  async purgeCloud(cutoff: string): Promise<number> {
    return this.cloud.purgeOlderThan(cutoff);
  }
}
