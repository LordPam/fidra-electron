import type { SupabaseClient } from '@supabase/supabase-js';
import type { SheetRow } from '../../../shared/ipc-types';
import type { CloudSheetRepo } from './cloud-repo-interfaces';
import { toISOString, fetchAllRows } from './pg-utils';

export class SupabaseSheetRepo implements CloudSheetRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(): Promise<SheetRow[]> {
    const rows = await fetchAllRows(this.client, (c) =>
      c.from('sheets').select('*').eq('is_virtual', false).eq('is_planned', false).order('sort_order').order('name'),
    );
    return rows.map(rowToSheet);
  }

  async getById(id: string): Promise<SheetRow | null> {
    const { data, error } = await this.client
      .from('sheets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToSheet(data) : null;
  }

  async getByName(name: string): Promise<SheetRow | null> {
    const { data, error } = await this.client
      .from('sheets')
      .select('*')
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToSheet(data) : null;
  }

  async create(id: string, name: string): Promise<SheetRow> {
    const now = new Date().toISOString();
    // Get next sort order
    const { data: maxRow } = await this.client
      .from('sheets')
      .select('sort_order')
      .eq('is_virtual', false)
      .eq('is_planned', false)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = maxRow ? (maxRow.sort_order as number) + 1 : 0;

    const { error } = await this.client
      .from('sheets')
      .insert({ id, name, is_virtual: false, is_planned: false, sort_order: sortOrder, created_at: now });
    if (error) throw new Error(error.message);
    return { id, name, is_virtual: 0, is_planned: 0, sort_order: sortOrder, created_at: now };
  }

  async save(sheet: SheetRow): Promise<SheetRow> {
    const { error } = await this.client
      .from('sheets')
      .upsert({
        id: sheet.id,
        name: sheet.name,
        is_virtual: sheet.is_virtual === 1,
        is_planned: sheet.is_planned === 1,
        sort_order: sheet.sort_order ?? 0,
        created_at: sheet.created_at,
      });
    if (error) throw new Error(error.message);
    return sheet;
  }

  async remove(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('sheets')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async renameSheet(oldName: string, newName: string): Promise<void> {
    // PostgREST doesn't support multi-table transactions, so we do them sequentially.
    // RLS ensures only authenticated users can modify these.
    const { error: e1 } = await this.client
      .from('sheets')
      .update({ name: newName })
      .eq('name', oldName);
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await this.client
      .from('transactions')
      .update({ sheet: newName })
      .eq('sheet', oldName);
    if (e2) throw new Error(e2.message);

    const { error: e3 } = await this.client
      .from('planned_templates')
      .update({ target_sheet: newName })
      .eq('target_sheet', oldName);
    if (e3) throw new Error(e3.message);
  }

  async mergeAndDelete(sourceId: string, sourceName: string, targetName: string): Promise<void> {
    const { error: e1 } = await this.client
      .from('transactions')
      .update({ sheet: targetName })
      .eq('sheet', sourceName);
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await this.client
      .from('planned_templates')
      .update({ target_sheet: targetName })
      .eq('target_sheet', sourceName);
    if (e2) throw new Error(e2.message);

    const { error: e3 } = await this.client
      .from('sheets')
      .delete()
      .eq('id', sourceId);
    if (e3) throw new Error(e3.message);
  }

  async deleteWithTransactions(id: string, name: string): Promise<void> {
    // Fetch transaction IDs on this sheet so we can delete their attachments
    // (PostgREST doesn't support subqueries in filters)
    const { data: txRows, error: txErr } = await this.client
      .from('transactions')
      .select('id')
      .eq('sheet', name);
    if (txErr) throw new Error(txErr.message);

    const txIds = (txRows ?? []).map((r) => String(r.id));
    if (txIds.length > 0) {
      const { error: attErr } = await this.client
        .from('attachments')
        .delete()
        .in('transaction_id', txIds);
      if (attErr) throw new Error(attErr.message);
    }

    const { error: e1 } = await this.client
      .from('transactions')
      .delete()
      .eq('sheet', name);
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await this.client
      .from('planned_templates')
      .delete()
      .eq('target_sheet', name);
    if (e2) throw new Error(e2.message);

    const { error: e3 } = await this.client
      .from('sheets')
      .delete()
      .eq('id', id);
    if (e3) throw new Error(e3.message);
  }

  async reorder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await this.client
        .from('sheets')
        .update({ sort_order: i })
        .eq('id', orderedIds[i]);
      if (error) throw new Error(error.message);
    }
  }
}

function rowToSheet(row: Record<string, unknown>): SheetRow {
  return {
    id: String(row.id),
    name: String(row.name),
    is_virtual: row.is_virtual ? 1 : 0,
    is_planned: row.is_planned ? 1 : 0,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    created_at: toISOString(row.created_at),
  };
}
