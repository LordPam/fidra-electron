import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvoiceRow } from '../../../shared/ipc-types';
import type { CloudInvoiceRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString, toJsonString, fetchAllRows } from './pg-utils';

export class SupabaseInvoiceRepo implements CloudInvoiceRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(): Promise<InvoiceRow[]> {
    const rows = await fetchAllRows(this.client, (c) =>
      c.from('invoices').select('*').order('created_at', { ascending: false }),
    );
    return rows.map(rowToInvoice);
  }

  async getById(id: string): Promise<InvoiceRow | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToInvoice(data) : null;
  }

  async save(data: InvoiceRow): Promise<InvoiceRow> {
    const { error } = await this.client
      .from('invoices')
      .upsert({
        id: data.id,
        invoice_number: data.invoice_number,
        date: data.date,
        due_date: data.due_date,
        from_name: data.from_name,
        from_address: data.from_address,
        to_name: data.to_name,
        to_address: data.to_address,
        line_items: data.line_items,
        subtotal: data.subtotal,
        notes: data.notes,
        bank_details: data.bank_details,
        planned_template_id: data.planned_template_id,
        status: data.status ?? 'draft',
        transaction_id: data.transaction_id,
        paid_at: data.paid_at,
        planned_template_snapshot: data.planned_template_snapshot,
        version: data.version,
        created_at: data.created_at,
        modified_at: data.modified_at,
        modified_by: data.modified_by,
      });
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('invoices')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async getVersion(id: string): Promise<number | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select('version')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Number(data.version) : null;
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
