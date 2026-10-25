import { z } from 'zod';
import { dateSchema } from './ipc-schemas';
import { parsePence } from './money';

export const contextFieldSchema = z.enum(['description', 'party', 'category', 'activity', 'reference', 'notes']);
export const reconciliationScopeSchema = z.object({
  statementIds: z.array(z.string().uuid()).max(10).optional(),
  sheetIds: z.array(z.string().min(1).max(200)).min(1).max(50),
  from: dateSchema, to: dateSchema,
  fields: z.array(contextFieldSchema).max(6),
}).strict().refine((scope) => scope.from <= scope.to && Date.parse(scope.to) - Date.parse(scope.from) <= 366 * 86400000, 'Choose a date range of up to one year.');
const text = z.string().max(1000);
const amount = z.string().regex(/^\d{1,12}\.\d{2}$/).refine((value) => (parsePence(value) ?? 0) > 0, 'Amount must be positive.');
const direction = z.enum(['income', 'expense']);
export const statementRowSchema = z.object({
  sheetId: z.string().min(1).max(200),
  source: z.object({
    statementHash: z.string().regex(/^[a-f0-9]{64}$/), row: z.number().int().min(0).max(100000),
    bankId: z.string().min(1).max(300).optional(), evidence: text.min(1),
    date: dateSchema, amount, type: direction, description: text.min(1),
  }).strict(),
  description: text.min(1), party: text.nullable(), category: text.nullable(), activity: text.nullable(),
  action: z.enum(['new', 'skip', 'fulfil', 'link']),
  existingId: z.string().min(1).max(200).optional(),
  planned: z.object({ templateId: z.string().min(1).max(200), date: dateSchema }).strict().optional(),
}).strict();
export const reconciliationDraftSchema = z.object({
  label: z.string().min(1).max(200), rows: z.array(statementRowSchema).min(1).max(1000),
}).strict();
export type ReconciliationScope = z.infer<typeof reconciliationScopeSchema>;
export type StatementRow = z.infer<typeof statementRowSchema>;
export type ReconciliationDraft = z.infer<typeof reconciliationDraftSchema>;
export interface RowReview {
  index: number; duplicateIds: string[]; planned: { templateId: string; date: string; description: string; amount: string }[];
  questions: string[]; blockers: string[];
}
export interface ReconciliationProposal {
  id: string; digest: string; label: string; createdAt: string; rows: StatementRow[];
  review: RowReview[]; state: 'draft' | 'committed' | 'undone'; grantId: string;
}
export const reconciliationApprovalSchema = z.object({
  id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), reviewedRows: z.array(z.number().int().min(0).max(999)).max(1000),
}).strict();
export type ReconciliationApproval = z.infer<typeof reconciliationApprovalSchema>;
export interface ReconciliationCommit { id: string; transactionIds: string[]; count: number }
export interface AiImportAttribution {
  client: 'chatgpt' | 'claude';
  resolutions: { rowIndex: number; answer: string }[];
}
