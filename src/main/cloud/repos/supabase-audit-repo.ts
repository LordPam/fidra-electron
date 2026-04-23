import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLogRow } from '../../../shared/ipc-types';
import type { CloudAuditRepo } from './cloud-repo-interfaces';
import { toISOString, fetchAllRows } from './pg-utils';

export class SupabaseAuditRepo implements CloudAuditRepo {
  constructor(private readonly client: SupabaseClient) {}

  async save(entry: AuditLogRow): Promise<AuditLogRow> {
    const { error } = await this.client
      .from('audit_log')
      .upsert({
        id: entry.id,
        timestamp: entry.timestamp,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        user: entry.user,
        summary: entry.summary,
        details: entry.details,
      }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return entry;
  }

  async getAll(): Promise<AuditLogRow[]> {
    const rows = await fetchAllRows(this.client, (c) =>
      c.from('audit_log').select('*').order('timestamp', { ascending: false }),
    );
    return rows.map(rowToAudit);
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    const { error, count } = await this.client
      .from('audit_log')
      .delete({ count: 'exact' })
      .lt('timestamp', cutoff);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

function rowToAudit(row: Record<string, unknown>): AuditLogRow {
  return {
    id: String(row.id),
    timestamp: toISOString(row.timestamp),
    action: String(row.action) as AuditLogRow['action'],
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    user: String(row.user),
    summary: String(row.summary),
    details: row.details != null ? String(row.details) : null,
  };
}
