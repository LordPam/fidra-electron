import type pg from 'pg';
import type { InvoiceRow } from '../../../shared/ipc-types';
import type { CloudConnection } from '../cloud-connection';
import type { CloudInvoiceRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString, toJsonString } from './pg-utils';

export class PgInvoiceRepo implements CloudInvoiceRepo {
  constructor(private readonly conn: CloudConnection) {}

  private get pool(): pg.Pool {
    return this.conn.pool;
  }

  async getAll(): Promise<InvoiceRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM invoices ORDER BY created_at DESC',
    );
    return rows.map(rowToInvoice);
  }

  async getById(id: string): Promise<InvoiceRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM invoices WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? rowToInvoice(rows[0]) : null;
  }

  async save(data: InvoiceRow): Promise<InvoiceRow> {
    await this.pool.query(
      `INSERT INTO invoices (id, invoice_number, date, due_date, from_name, from_address,
        to_name, to_address, line_items, subtotal, notes, bank_details,
        planned_template_id, status, transaction_id, paid_at,
        planned_template_snapshot, version, created_at, modified_at, modified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (id) DO UPDATE SET
         invoice_number = EXCLUDED.invoice_number,
         date = EXCLUDED.date,
         due_date = EXCLUDED.due_date,
         from_name = EXCLUDED.from_name,
         from_address = EXCLUDED.from_address,
         to_name = EXCLUDED.to_name,
         to_address = EXCLUDED.to_address,
         line_items = EXCLUDED.line_items,
         subtotal = EXCLUDED.subtotal,
         notes = EXCLUDED.notes,
         bank_details = EXCLUDED.bank_details,
         planned_template_id = EXCLUDED.planned_template_id,
         status = EXCLUDED.status,
         transaction_id = EXCLUDED.transaction_id,
         paid_at = EXCLUDED.paid_at,
         planned_template_snapshot = EXCLUDED.planned_template_snapshot,
         version = EXCLUDED.version,
         modified_at = EXCLUDED.modified_at,
         modified_by = EXCLUDED.modified_by`,
      [
        data.id, data.invoice_number, data.date, data.due_date,
        data.from_name, data.from_address, data.to_name, data.to_address,
        data.line_items, data.subtotal, data.notes, data.bank_details,
        data.planned_template_id, data.status ?? 'draft',
        data.transaction_id, data.paid_at,
        data.planned_template_snapshot, data.version,
        data.created_at, data.modified_at, data.modified_by,
      ],
    );
    return data;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM invoices WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getVersion(id: string): Promise<number | null> {
    const { rows } = await this.pool.query(
      'SELECT version FROM invoices WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? Number(rows[0].version) : null;
  }
}

function rowToInvoice(row: Record<string, unknown>): InvoiceRow {
  return {
    id: String(row.id),
    invoice_number: String(row.invoice_number),
    date: toDateString(row.date),
    due_date: toDateString(row.due_date),
    from_name: String(row.from_name),
    from_address: row.from_address != null ? String(row.from_address) : null,
    to_name: String(row.to_name),
    to_address: row.to_address != null ? String(row.to_address) : null,
    line_items: toJsonString(row.line_items),
    subtotal: String(row.subtotal),
    notes: row.notes != null ? String(row.notes) : null,
    bank_details: row.bank_details != null ? String(row.bank_details) : null,
    planned_template_id: row.planned_template_id != null ? String(row.planned_template_id) : null,
    status: (String(row.status ?? 'draft')) as 'draft' | 'paid',
    transaction_id: row.transaction_id != null ? String(row.transaction_id) : null,
    paid_at: row.paid_at != null ? toISOString(row.paid_at) : null,
    planned_template_snapshot: row.planned_template_snapshot != null ? toJsonString(row.planned_template_snapshot) : null,
    version: Number(row.version ?? 1),
    created_at: toISOString(row.created_at),
    modified_at: row.modified_at != null ? toISOString(row.modified_at) : null,
    modified_by: row.modified_by != null ? String(row.modified_by) : null,
  };
}

