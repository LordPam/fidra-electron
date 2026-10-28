import { z } from 'zod';
import { aiEmptyQuerySchema, aiInvoiceQuerySchema, aiPlannedQuerySchema, aiTransactionQuerySchema, aiSettingsQuerySchema } from './ai-ledger-read-types';

export const aiRunSyncSchema = z.object({ direction: z.enum(['export', 'import', 'both']) }).strict();
export const aiBackupCreateSchema = z.object({ requestId: z.string().uuid() }).strict();
export const aiLedgerReadSpecs = {
  read_transactions: { schema: aiTransactionQuerySchema, description: 'Read transactions in approved accounts and the requested date range. Only approved context fields are returned. Pages contain at most 200 rows.' },
  read_planned: { schema: aiPlannedQuerySchema, description: 'Read schedules in approved accounts. A planned transfer is returned only when both accounts are permitted. Only approved context fields are returned.' },
  read_invoices: { schema: aiInvoiceQuerySchema, description: 'Read invoices in the requested date range. Requires explicit ledger-wide invoice permission; optional billing and text fields remain restricted by consent.' },
  read_categories: { schema: aiEmptyQuerySchema, description: 'Read category lists with explicit ledger-wide category-management permission.' },
  read_activities: { schema: aiEmptyQuerySchema, description: 'Read ledger-wide activity names and approved notes with activity-management permission.' },
  read_settings: { schema: aiSettingsQuerySchema, description: 'Read named, supported settings groups. Requires ledger-wide settings-read permission. Never returns passwords, sync secrets, local file paths, logos or arbitrary settings keys.' },
  read_personnel: { schema: aiEmptyQuerySchema, description: 'Read team names, emails, IDs and live roles. Requires personnel-read permission and a current team administrator. Never returns credentials, invitation codes or encrypted key material.' },
  read_sync_status: { schema: aiEmptyQuerySchema, description: 'Read sync state, last-sync times and unresolved-conflict count with sync-read permission. Never returns local folder paths, keys, passwords or conflict contents. Critical conflicts stay in native human review.' },
};
export function aiLedgerReadDefinitions() {
  return Object.entries(aiLedgerReadSpecs).map(([name, operation]) => {
    const schema = z.toJSONSchema(operation.schema, { io: 'input' });
    return { name, description: operation.description, inputSchema: { ...schema, properties: { ...schema.properties, connectionId: { type: 'string', description: 'Approved connection ID from list_connections.' } } }, annotations: { readOnlyHint: true, openWorldHint: false } };
  });
}
export const aiRunSyncDefinition = {
  name: 'run_sync', description: 'Run the existing Fidra export/import sync controls. Requires explicit ledger-wide sync-run permission. Does not configure sync, change credentials or resolve conflicts. CRDT import/export retries are idempotent.',
  inputSchema: { ...z.toJSONSchema(aiRunSyncSchema), properties: { ...z.toJSONSchema(aiRunSyncSchema).properties, connectionId: { type: 'string' } } },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
export const aiBackupDefinitions = [
  { name: 'read_backups', description: 'List opaque backup IDs and basic metadata for this ledger only. Requires ledger-wide backup-read permission. Does not return paths, file contents or settings secrets.', inputSchema: { ...z.toJSONSchema(aiEmptyQuerySchema), properties: { connectionId: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'create_backup', description: 'Create a backup using Fidra’s existing backup control and retention settings. Requires ledger-wide backup-create permission. Use a fresh UUID requestId for each requested backup; reuse it on retry. The same retained backup is returned on retry. Does not return a database file or local path.', inputSchema: { ...z.toJSONSchema(aiBackupCreateSchema), properties: { ...z.toJSONSchema(aiBackupCreateSchema).properties, connectionId: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
