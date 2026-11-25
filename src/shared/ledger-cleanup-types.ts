import { z } from 'zod';
import { sheetNameSchema } from './sheet-name';
import { dateSchema } from './ipc-schemas';

const id = z.string().min(1).max(200);
const entries = z.array(z.object({ id, version: z.number().int().positive() }).strict()).min(1).max(1000);
const reason = z.string().trim().min(1).max(1000);
export const ledgerCleanupActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rename_sheet'), sheetId: id, expectedName: z.string().min(1), name: sheetNameSchema, reason }).strict(),
  z.object({ kind: z.literal('move_entries'), entries, targetSheetId: id, reason }).strict(),
  z.object({ kind: z.literal('fix_income_status'), entries, reason }).strict(),
  z.object({ kind: z.literal('delete_entries'), entries, reason }).strict(),
  z.object({ kind: z.literal('replace_with_transfer'), entries: entries.max(2), fromSheetId: id, toSheetId: id, description: z.string().trim().min(1).max(1000), date: dateSchema.optional(), reason }).strict(),
]);
export const ledgerCleanupRequestSchema = z.object({ requestId: z.string().uuid(), label: z.string().trim().min(1).max(200),
  actions: z.array(ledgerCleanupActionSchema).min(1).max(500) }).strict();
export type LedgerCleanupRequest = z.infer<typeof ledgerCleanupRequestSchema>;
export type LedgerCleanupAction = z.infer<typeof ledgerCleanupActionSchema>;
export const ledgerCleanupIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ledgerCleanupQuerySchema = z.object({ id: ledgerCleanupIdSchema }).strict();
export const ledgerCleanupApplySchema = z.object({ id: ledgerCleanupIdSchema, digest: ledgerCleanupIdSchema }).strict();
export const ledgerCleanupReviewSchema = ledgerCleanupApplySchema.extend({ approve: z.boolean() }).strict();
export const ledgerCleanupHistorySchema = z.object({ id: ledgerCleanupIdSchema, direction: z.enum(['undo', 'redo']) }).strict();
export type LedgerCleanupReview = z.infer<typeof ledgerCleanupReviewSchema>;
export type LedgerCleanupHistory = z.infer<typeof ledgerCleanupHistorySchema>;
export type LedgerCleanupState = 'ready' | 'draft' | 'approved' | 'committed' | 'undone' | 'rejected';
export interface LedgerCleanupEntry {
  id: string; version: number; date: string; amount: string; type: 'income' | 'expense'; status: string;
  accountId: string; account: string; linkedId: string | null; description?: string;
}
export interface LedgerCleanupPreview {
  id: string; digest: string; label: string; createdAt: string; state: LedgerCleanupState; requiresReview: boolean;
  reasons: { kind: string; reason: string }[];
  sheets: { id: string; before: string; after: string }[];
  before: LedgerCleanupEntry[]; after: LedgerCleanupEntry[];
  transferCount: number; backupId: string | null;
  changes?: { resource: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
}
export type LedgerCleanupReceipt = Pick<LedgerCleanupPreview, 'id' | 'label' | 'state'>;
