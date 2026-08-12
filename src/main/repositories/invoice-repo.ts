import type Database from 'better-sqlite3';
import type { InvoiceRow } from '../../shared/ipc-types';
import { parsePence, penceToAmount, toAmount } from '../../shared/money';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** The object form `line_items` is stored in today, alongside a legacy bare array. */
interface LineItemsWrapper {
  items: LineItem[];
  taxRate?: number;
  accentMode?: string;
}

/**
 * Read `line_items`, which comes in two shapes: a bare array (legacy) and
 * `{ items, taxRate, accentMode }` (current). Returns null if it is neither.
 *
 * Reading only the array form used to throw `items.reduce is not a function` on
 * every invoice the app writes now, which took `planned:save` down with it.
 */
function parseLineItems(json: string): { items: LineItem[]; wrapper: LineItemsWrapper | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    return { items: parsed as LineItem[], wrapper: null };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as LineItemsWrapper).items)) {
    const wrapper = parsed as LineItemsWrapper;
    return { items: wrapper.items, wrapper };
  }
  return null;
}

export class InvoiceRepo {
  constructor(private readonly db: Database.Database) {}

  getAll(): InvoiceRow[] {
    return this.db
      .prepare('SELECT * FROM invoices ORDER BY created_at DESC')
      .all() as InvoiceRow[];
  }

  getById(id: string): InvoiceRow | null {
    return (this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as InvoiceRow | null) ?? null;
  }

  getByPlannedTemplateId(plannedTemplateId: string): InvoiceRow[] {
    return this.db
      .prepare('SELECT * FROM invoices WHERE planned_template_id = ? ORDER BY created_at DESC')
      .all(plannedTemplateId) as InvoiceRow[];
  }

  save(data: InvoiceRow): InvoiceRow {
    const existing = this.getById(data.id);
    const version = existing ? existing.version + 1 : (data.version ?? 1);
    const modified_at = new Date().toISOString();
    const row = { ...data, version, modified_at, modified_by: data.modified_by ?? null };

    if (existing) {
      this.db.prepare(
        `UPDATE invoices SET invoice_number=?, date=?, due_date=?, from_name=?, from_address=?,
         to_name=?, to_address=?, line_items=?, subtotal=?, notes=?, bank_details=?,
         planned_template_id=?, status=?, transaction_id=?, paid_at=?,
         planned_template_snapshot=?, version=?, modified_at=?, modified_by=?
         WHERE id=?`,
      ).run(
        row.invoice_number, row.date, row.due_date,
        row.from_name, row.from_address, row.to_name, row.to_address,
        row.line_items, row.subtotal, row.notes, row.bank_details,
        row.planned_template_id, row.status ?? 'draft',
        row.transaction_id ?? null, row.paid_at ?? null,
        row.planned_template_snapshot ?? null, row.version,
        row.modified_at, row.modified_by, row.id,
      );
    } else {
      this.db.prepare(
        `INSERT INTO invoices
         (id, invoice_number, date, due_date, from_name, from_address,
          to_name, to_address, line_items, subtotal, notes, bank_details,
          planned_template_id, status, transaction_id, paid_at,
          planned_template_snapshot, version, created_at, modified_at, modified_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.invoice_number, row.date, row.due_date,
        row.from_name, row.from_address, row.to_name, row.to_address,
        row.line_items, row.subtotal, row.notes, row.bank_details,
        row.planned_template_id, row.status ?? 'draft',
        row.transaction_id ?? null, row.paid_at ?? null,
        row.planned_template_snapshot ?? null, row.version,
        row.created_at, row.modified_at, row.modified_by,
      );
    }
    return row;
  }

  markPaid(invoiceId: string, transactionId: string): InvoiceRow | null {
    const now = new Date().toISOString();
    const existing = this.getById(invoiceId);
    const version = existing ? existing.version + 1 : 1;
    this.db.prepare(
      `UPDATE invoices SET status = 'paid', transaction_id = ?, paid_at = ?, version = ?, modified_at = ? WHERE id = ?`,
    ).run(transactionId, now, version, now, invoiceId);
    return this.getById(invoiceId);
  }

  revertToDraft(invoiceId: string): InvoiceRow | null {
    const now = new Date().toISOString();
    const existing = this.getById(invoiceId);
    const version = existing ? existing.version + 1 : 1;
    this.db.prepare(
      `UPDATE invoices SET status = 'draft', transaction_id = NULL, paid_at = NULL, planned_template_snapshot = NULL, version = ?, modified_at = ? WHERE id = ?`,
    ).run(version, now, invoiceId);
    return this.getById(invoiceId);
  }

  updateLinkedFromPlanned(
    plannedTemplateId: string,
    dueDate: string,
    description: string,
    amount: string,
  ): number {
    const linked = this.getByPlannedTemplateId(plannedTemplateId);
    console.log(`[updateLinkedFromPlanned] templateId=${plannedTemplateId} found ${linked.length} linked invoices`);
    if (linked.length === 0) return 0;

    const now = new Date().toISOString();
    let count = 0;
    for (const inv of linked) {
      const parsed = parseLineItems(inv.line_items);
      if (!parsed) continue;
      const { items, wrapper } = parsed;

      if (items.length > 0) {
        items[0].description = description;
        items[0].unitPrice = parsePence(amount) === null ? items[0].unitPrice : toAmount(amount);
      }

      // Totalled in pence: quantity × unit price repeated in pounds drifts.
      let totalPence = 0;
      for (const item of items) {
        totalPence += (parsePence(item.unitPrice) ?? 0) * (item.quantity ?? 0);
      }
      const taxRate = wrapper?.taxRate ?? 0;
      if (taxRate) {
        totalPence = Math.round(totalPence * (1 + taxRate / 100));
      }

      const lineItems = wrapper ? JSON.stringify({ ...wrapper, items }) : JSON.stringify(items);
      const version = inv.version + 1;

      this.db.prepare(
        'UPDATE invoices SET due_date = ?, line_items = ?, subtotal = ?, version = ?, modified_at = ? WHERE id = ?',
      ).run(dueDate, lineItems, penceToAmount(totalPence), version, now, inv.id);
      count++;
    }
    return count;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
