import type { SupabaseClient } from '@supabase/supabase-js';

export class SupabaseSettingsRepo {
  constructor(private readonly client: SupabaseClient) {}

  async getSetting(key: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('db_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? String(data.value) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const { error } = await this.client
      .from('db_settings')
      .upsert({ key, value, modified_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }

  async getAll(): Promise<Record<string, string>> {
    const { data, error } = await this.client.from('db_settings').select('key, value');
    if (error) throw new Error(error.message);
    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[String(row.key)] = String(row.value);
    }
    return result;
  }
}
