import { z } from 'zod';
import { aiEmptyQuerySchema, aiInvoiceQuerySchema, aiPlannedQuerySchema, aiTransactionQuerySchema, aiSettingsQuerySchema } from './ai-ledger-read-types';
import { aiSheetCreateSchema } from './ai-sheet-types';
import { ledgerCleanupRequestSchema, ledgerCleanupQuerySchema, ledgerCleanupApplySchema } from './ledger-cleanup-types';
import { ledgerChangeRequestSchema } from './ledger-change-types';

export function aiLedgerChangeDefinitions() {
  return [
    { name: 'prepare_ledger_changes', schema: ledgerChangeRequestSchema, description: 'Prepare an atomic batch of named Fidra edits: create/edit actuals; change status using native defaults; split one unlinked actual into parts totalling its original amount; create/edit one-off or recurring planned payments and planned transfers; skip/restore/fulfil exact occurrences; create/edit paired internal transfers; create/edit unpaid invoices; set draft/sent invoice status; edit category lists, activities/notes and supported ledger settings. Read current IDs/versions and resolve attribution first. Optional fields require their selected permissions, including clearing fields. Uses original authority and approved capabilities/accounts, never expands old reconciliation-only consent. A one-off future payment is create_planned with frequency once. References/notes are explicit fields; no statement upload is required for ordinary user-requested edits. requestId must be a fresh UUID, reused only for identical input. Preparation rolls back all financial effects and returns exact before/after data. Paid-invoice corrections, attached-transfer edits, global appearance, passwords, permissions, sync setup and device/team administration remain native. No arbitrary SQL/IPC, raw row saves, file paths or access changes.' },
    { name: 'get_ledger_changes', schema: ledgerCleanupQuerySchema, description: 'Read this connection’s prepared change batch or completed receipt. Returns only permitted record/context fields. A ready batch has not changed the ledger. Committed means applied; undone means reversed natively.' },
    { name: 'apply_ledger_changes', schema: ledgerCleanupApplySchema, description: 'Apply the exact ID/digest from prepare_ledger_changes after the user requested the edits and ambiguities are answered. Creates a safety backup, then rechecks live user authority, capabilities, account scope and full ledger state before an atomic commit through shared native operations. Audits the actual user via AI and records guarded native Undo/Redo. Retries return the existing receipt and never repeat a split, payment, plan or transfer, including after native Undo. Does not grant new permissions or initiate a bank payment.' },
  ].map(({ name, schema, description }) => {
    const inputSchema = z.toJSONSchema(schema, { io: 'input' });
    return { name, description: `${description} Removing an activity and its notes requires the returned exact-batch native review in Fidra; never submit an approval flag or click it for the user.`, inputSchema: { ...inputSchema, properties: { ...inputSchema.properties, connectionId: { type: 'string' } } },
      annotations: { readOnlyHint: name === 'get_ledger_changes', destructiveHint: name === 'apply_ledger_changes', idempotentHint: true, openWorldHint: false } };
  });
}

export function aiLedgerCleanupDefinitions() {
  return [
    { name: 'prepare_ledger_cleanup', schema: ledgerCleanupRequestSchema, description: 'Prepare a version-bound cleanup of selected existing ledger entries: rename sheets, move unlinked entries, fix income statuses, delete unlinked entries, or replace one/two unlinked entries with one actual linked transfer pair. Transfer amount/direction come from existing entries; an optional common date must be explicitly agreed if bank posting dates differ. Each action needs its reason and exact current IDs/versions. Requires the applicable read/manage/delete/transfer/sheet capabilities and all affected accounts. Attached, invoiced or already linked entries require their native workflows. No financial rows change during preparation. Transfer replacements and deletions require review inside Fidra before apply. Use a fresh UUID requestId and reuse it only for identical input.' },
    { name: 'get_ledger_cleanup', schema: ledgerCleanupQuerySchema, description: 'Read this connection’s cleanup preview, native review state and completed receipt. Optional descriptions follow the existing field permission. Native review remains in Fidra. A saved or approved preview is not a completed cleanup.' },
    { name: 'apply_ledger_cleanup', schema: ledgerCleanupApplySchema, description: 'Apply the exact prepared cleanup ID/digest, only after the user requested these changes and all source/pocket/date ambiguities are resolved. Destructive actions need approval inside Fidra. Backs up, rechecks current permission and ledger, and applies atomically through native application controls, with audit and native Undo/Redo. Retrying the same receipt cannot repeat transfers or reapply an undone cleanup. Does not expose SQL, raw row saves, arbitrary status approval, attachments, invoices, schedules or access-approval controls.' },
  ].map(({ name, schema, description }) => {
    const inputSchema = z.toJSONSchema(schema, { io: 'input' });
    return { name, description, inputSchema: { ...inputSchema, properties: { ...inputSchema.properties, connectionId: { type: 'string' } } },
      annotations: { readOnlyHint: name === 'get_ledger_cleanup', destructiveHint: name === 'apply_ledger_cleanup', idempotentHint: true, openWorldHint: false } };
  });
}

export const aiRunSyncSchema = z.object({ direction: z.enum(['export', 'import', 'both']) }).strict();
export const aiBackupCreateSchema = z.object({ requestId: z.string().uuid() }).strict();
export const aiSheetCreateDefinition = {
  name: 'create_sheet', description: 'Create one empty Fidra sheet using Manage Sheets rules. Requires sheets.manage and explicit all-current-and-future-account consent. Supply the user-requested name and a fresh UUID requestId; reuse the same ID and name on retry. Retries return the original receipt and never recreate a sheet after Undo or deletion. Native Undo is available only while the created sheet remains empty and unchanged. Does not rename, move money, merge or delete existing sheets.',
  inputSchema: { ...z.toJSONSchema(aiSheetCreateSchema, { io: 'input' }), properties: { ...z.toJSONSchema(aiSheetCreateSchema, { io: 'input' }).properties, connectionId: { type: 'string' } } },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
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
