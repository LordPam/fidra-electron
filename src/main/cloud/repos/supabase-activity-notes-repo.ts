import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudActivityNotesRepo } from './cloud-repo-interfaces';

export class SupabaseActivityNotesRepo implements CloudActivityNotesRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(): Promise<Record<string, string>> {
    const { data, error } = await this.client
      .from('activity_notes')
      .select('activity, notes')
      .order('activity');
    if (error) throw new Error(error.message);
    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[String(row.activity)] = String(row.notes);
    }
    return result;
  }

  async save(activity: string, notes: string): Promise<void> {
    const { error } = await this.client
      .from('activity_notes')
      .upsert({ activity, notes });
    if (error) throw new Error(error.message);
  }

  async remove(activity: string): Promise<void> {
    const { error } = await this.client
      .from('activity_notes')
      .delete()
      .eq('activity', activity);
    if (error) throw new Error(error.message);
  }

  async setAll(notes: Record<string, string>): Promise<void> {
    const { error: delError } = await this.client
      .from('activity_notes')
      .delete()
      .neq('activity', ''); // Delete all rows (PostgREST requires a filter)
    if (delError) throw new Error(delError.message);

    const rows = Object.entries(notes).map(([activity, text]) => ({ activity, notes: text }));
    if (rows.length > 0) {
      const { error: insError } = await this.client
        .from('activity_notes')
        .insert(rows);
      if (insError) throw new Error(insError.message);
    }
  }
}
