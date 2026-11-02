import { z } from 'zod';
import { sheetNameSchema } from './sheet-name';

export const aiSheetCreateSchema = z.object({ requestId: z.string().uuid(), name: sheetNameSchema }).strict();
export const aiSheetReceiptIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const aiSheetHistorySchema = z.object({ receiptId: aiSheetReceiptIdSchema, direction: z.enum(['undo', 'redo']) }).strict();
export type AiSheetHistory = z.infer<typeof aiSheetHistorySchema>;

export interface AiSheetCreation {
  receiptId: string;
  state: 'applied' | 'undone';
  sheet: { id: string; name: string };
  currentSheet: { id: string; name: string } | null;
}
