import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';
import { ConcurrencyError, EntityDeletedError } from '../errors';
import type { CloudPlannedRepo } from './cloud-repo-interfaces';
import { toDateString, toISOString, toJsonString, fetchAllRows } from './pg-utils';

export class SupabasePlannedRepo implements CloudPlannedRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(): Promise<PlannedTemplateRow[]> {
    const rows = await fetchAllRows(this.client, (c) =>
      c.from('planned_templates').select('*').order('start_date', { ascending: true }),
    );
    return rows.map(rowToPlanned);
  }

  async getById(id: string): Promise<PlannedTemplateRow | null> {
    const { data, error } = await this.client
      .from('planned_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToPlanned(data) : null;
  }

  async save(data: PlannedTemplateRow): Promise<PlannedTemplateRow> {
    const skippedJson = typeof data.skipped_dates === 'string'
      ? JSON.parse(data.skipped_dates)
      : data.skipped_dates;
    const fulfilledJson = typeof data.fulfilled_dates === 'string'
      ? JSON.parse(data.fulfilled_dates)
      : data.fulfilled_dates;

    const existing = await this.getById(data.id);

    if (existing) {
      if (existing.version !== data.version - 1) {
        throw new ConcurrencyError(
          `PlannedTemplate version conflict: expected DB version ${data.version - 1}, found ${existing.version}`,
        );
      }

      const { error } = await this.client
        .from('planned_templates')
        .update({
          start_date: data.start_date,
          description: data.description,
          amount: data.amount,
          type: data.type,
          frequency: data.frequency,
          target_sheet: data.target_sheet,
          category: data.category,
          party: data.party,
          activity: data.activity,
          notes: data.notes,
          end_date: data.end_date,
          occurrence_count: data.occurrence_count,
          skipped_dates: skippedJson,
          fulfilled_dates: fulfilledJson,
          version: data.version,
        })
        .eq('id', data.id)
        .eq('version', existing.version);
      if (error) throw new Error(error.message);
    } else if (data.version > 1) {
      throw new EntityDeletedError(
        `PlannedTemplate ${data.id} was deleted on server (local version ${data.version})`,
      );
    } else {
      const { error } = await this.client
        .from('planned_templates')
        .upsert({
          id: data.id,
          start_date: data.start_date,
          description: data.description,
          amount: data.amount,
          type: data.type,
          frequency: data.frequency,
          target_sheet: data.target_sheet,
          category: data.category,
          party: data.party,
          activity: data.activity,
          notes: data.notes,
          end_date: data.end_date,
          occurrence_count: data.occurrence_count,
          skipped_dates: skippedJson,
          fulfilled_dates: fulfilledJson,
          version: data.version,
          created_at: data.created_at,
        });
      if (error) throw new Error(error.message);
    }

    return data;
  }

  async remove(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('planned_templates')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async removeVersioned(id: string, expectedVersion: number): Promise<boolean> {
    const { count } = await this.client
      .from('planned_templates')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('version', expectedVersion);

    if ((count ?? 0) > 0) return true;

    const existing = await this.getById(id);
    if (existing) {
      throw new ConcurrencyError(
        `PlannedTemplate delete version conflict: expected ${expectedVersion}, found ${existing.version}`,
      );
    }
    return true;
  }

  async getVersion(id: string): Promise<number | null> {
    const { data, error } = await this.client
      .from('planned_templates')
      .select('version')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Number(data.version) : null;
  }
}

function rowToPlanned(row: Record<string, unknown>): PlannedTemplateRow {
  return {
    id: String(row.id),
    start_date: toDateString(row.start_date),
    description: String(row.description),
    amount: String(row.amount),
    type: row.type as PlannedTemplateRow['type'],
    frequency: row.frequency as PlannedTemplateRow['frequency'],
    target_sheet: String(row.target_sheet),
    category: row.category != null ? String(row.category) : null,
    party: row.party != null ? String(row.party) : null,
    activity: row.activity != null ? String(row.activity) : null,
    notes: row.notes != null ? String(row.notes) : null,
    end_date: row.end_date != null ? toDateString(row.end_date) : null,
    occurrence_count: row.occurrence_count != null ? Number(row.occurrence_count) : null,
    skipped_dates: toJsonString(row.skipped_dates ?? []),
    fulfilled_dates: toJsonString(row.fulfilled_dates ?? []),
    version: Number(row.version),
    created_at: toISOString(row.created_at),
  };
}
