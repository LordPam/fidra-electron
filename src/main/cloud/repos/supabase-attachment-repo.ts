import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttachmentRow } from '../../../shared/ipc-types';
import type { CloudAttachmentRepo } from './cloud-repo-interfaces';
import { toISOString, fetchAllRows } from './pg-utils';

export class SupabaseAttachmentRepo implements CloudAttachmentRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(): Promise<AttachmentRow[]> {
    const rows = await fetchAllRows(this.client, (c) =>
      c.from('attachments').select('*').order('created_at', { ascending: false }),
    );
    return rows.map(rowToAttachment);
  }

  async getForTransaction(transactionId: string): Promise<AttachmentRow[]> {
    const { data, error } = await this.client
      .from('attachments')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToAttachment);
  }

  async getById(id: string): Promise<AttachmentRow | null> {
    const { data, error } = await this.client
      .from('attachments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToAttachment(data) : null;
  }

  async save(data: AttachmentRow): Promise<AttachmentRow> {
    const { error } = await this.client
      .from('attachments')
      .upsert({
        id: data.id,
        transaction_id: data.transaction_id,
        filename: data.filename,
        stored_name: data.stored_name,
        mime_type: data.mime_type,
        file_size: data.file_size,
        created_at: data.created_at,
      });
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('attachments')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async removeForTransaction(transactionId: string): Promise<number> {
    const { error, count } = await this.client
      .from('attachments')
      .delete({ count: 'exact' })
      .eq('transaction_id', transactionId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

function rowToAttachment(row: Record<string, unknown>): AttachmentRow {
  return {
    id: String(row.id),
    transaction_id: String(row.transaction_id),
    filename: String(row.filename),
    stored_name: String(row.stored_name),
    mime_type: row.mime_type != null ? String(row.mime_type) : null,
    file_size: Number(row.file_size),
    created_at: toISOString(row.created_at),
  };
}
