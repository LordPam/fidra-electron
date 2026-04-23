import type { SupabaseClient } from '@supabase/supabase-js';
import type { TransactionRow } from '../../../shared/ipc-types';
import { ConcurrencyError, EntityDeletedError } from '../errors';
import type { CloudTransactionRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString, fetchAllRows } from './pg-utils';

export class SupabaseTransactionRepo implements CloudTransactionRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(sheet?: string): Promise<TransactionRow[]> {
    const rows = await fetchAllRows(this.client, (c) => {
      let q = c
        .from('transactions')
        .select('*')
        .neq('status', 'planned')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (sheet && sheet !== 'All Sheets') {
        q = q.eq('sheet', sheet);
      }
      return q;
    });
    return rows.map(rowToTransaction);
  }

  async getById(id: string): Promise<TransactionRow | null> {
    const { data, error } = await this.client
      .from('transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToTransaction(data) : null;
  }

  async save(data: TransactionRow): Promise<TransactionRow> {
    // Check for existing row to enforce version control
    const existing = await this.getById(data.id);

    if (existing) {
      if (existing.version !== data.version - 1) {
        throw new ConcurrencyError(
          `Version conflict: expected DB version ${data.version - 1}, found ${existing.version}`,
        );
      }

      const { error } = await this.client
        .from('transactions')
        .update({
          date: data.date,
          description: data.description,
          amount: data.amount,
          type: data.type,
          status: data.status,
          sheet: data.sheet,
          category: data.category,
          party: data.party,
          reference: data.reference,
          activity: data.activity,
          notes: data.notes,
          version: data.version,
          modified_at: data.modified_at,
          modified_by: data.modified_by,
        })
        .eq('id', data.id)
        .eq('version', existing.version);
      if (error) throw new Error(error.message);
    } else if (data.version > 1) {
      throw new EntityDeletedError(
        `Transaction ${data.id} was deleted on server (local version ${data.version})`,
      );
    } else {
      const { error } = await this.client
        .from('transactions')
        .upsert({
          id: data.id,
          date: data.date,
          description: data.description,
          amount: data.amount,
          type: data.type,
          status: data.status,
          sheet: data.sheet,
          category: data.category,
          party: data.party,
          reference: data.reference,
          activity: data.activity,
          notes: data.notes,
          version: data.version,
          created_at: data.created_at,
          modified_at: data.modified_at,
          modified_by: data.modified_by,
        });
      if (error) throw new Error(error.message);
    }

    return data;
  }

  async remove(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async removeVersioned(id: string, expectedVersion: number): Promise<boolean> {
    const { count } = await this.client
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('version', expectedVersion);

    if ((count ?? 0) > 0) return true;

    // Check if it still exists with a different version
    const existing = await this.getById(id);
    if (existing) {
      throw new ConcurrencyError(
        `Delete version conflict: expected ${expectedVersion}, found ${existing.version}`,
      );
    }
    return true; // Already deleted
  }

  async bulkSave(transactions: TransactionRow[]): Promise<TransactionRow[]> {
    for (const tx of transactions) {
      await this.save(tx);
    }
    return transactions;
  }

  async bulkRemove(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { error, count } = await this.client
      .from('transactions')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async getVersion(id: string): Promise<number | null> {
    const { data, error } = await this.client
      .from('transactions')
      .select('version')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Number(data.version) : null;
  }
}

function rowToTransaction(row: Record<string, unknown>): TransactionRow {
  return {
    id: String(row.id),
    date: toDateString(row.date),
    description: String(row.description),
    amount: String(row.amount),
    type: row.type as TransactionRow['type'],
    status: row.status as TransactionRow['status'],
    sheet: String(row.sheet),
    category: row.category != null ? String(row.category) : null,
    party: row.party != null ? String(row.party) : null,
    reference: row.reference != null ? String(row.reference) : null,
    activity: row.activity != null ? String(row.activity) : null,
    notes: row.notes != null ? String(row.notes) : null,
    version: Number(row.version),
    created_at: toISOString(row.created_at),
    modified_at: row.modified_at != null ? toISOString(row.modified_at) : null,
    modified_by: row.modified_by != null ? String(row.modified_by) : null,
  };
}
