import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudCategoryRepo } from './cloud-repo-interfaces';

export class SupabaseCategoryRepo implements CloudCategoryRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getAll(type: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('categories')
      .select('name')
      .eq('type', type)
      .order('sort_order')
      .order('name');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => String(r.name));
  }

  async setAll(type: string, names: string[]): Promise<void> {
    // Delete existing categories for this type
    const { error: delError } = await this.client
      .from('categories')
      .delete()
      .eq('type', type);
    if (delError) throw new Error(delError.message);

    // Insert new categories
    if (names.length > 0) {
      const rows = names.map((name, i) => ({ type, name, sort_order: i }));
      const { error: insError } = await this.client
        .from('categories')
        .insert(rows);
      if (insError) throw new Error(insError.message);
    }
  }
}
