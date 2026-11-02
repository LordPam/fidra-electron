import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WindowContext } from '../window/window-context';
import { aiSheetCreateSchema, aiSheetHistorySchema, type AiSheetCreation } from '../../shared/ai-sheet-types';
import { sheetRowSchema } from '../../shared/ipc-schemas';
import { assertAiOperationAccess, type AiOperationAccess } from './ai-operation-access';
import { assertApplicationPermission } from './application-access';
import { sheetsCreate, sheetsDeleteSimple, sheetsGetAll, sheetsRestoreWithSort } from './sheet-operations';

const receiptSchema = z.object({ name: z.string(), sheet: sheetRowSchema, state: z.enum(['applied', 'undone']) }).strict();
type Receipt = z.infer<typeof receiptSchema>;
const receiptKey = (id: string) => `ai.sheetCreation.${id}`;

function readReceipt(ctx: WindowContext, id: string): Receipt | null {
  const raw = ctx.settingsRepo.getSetting(receiptKey(id));
  return raw === null ? null : receiptSchema.parse(JSON.parse(raw));
}

function result(ctx: WindowContext, receiptId: string, receipt: Receipt): AiSheetCreation {
  const current = sheetsGetAll(ctx).find((sheet) => sheet.id === receipt.sheet.id);
  return { receiptId, state: receipt.state, sheet: { id: receipt.sheet.id, name: receipt.sheet.name },
    currentSheet: current ? { id: current.id, name: current.name } : null };
}

function audit(ctx: WindowContext, receiptId: string, receipt: Receipt, actor: string, action: 'create' | 'undo' | 'redo') {
  // The receipt, sheet and mandatory external attribution commit together.
  ctx.auditRepo.log({ id: randomUUID(), timestamp: new Date().toISOString(), action: action === 'undo' ? 'delete' : 'create',
    entity_type: 'ai_sheet_creation', entity_id: receipt.sheet.id, user: actor,
    summary: `${action === 'undo' ? 'Undid' : action === 'redo' ? 'Redid' : 'AI created'} sheet '${receipt.sheet.name}'`,
    details: JSON.stringify({ origin: 'personal-ai', receiptId, action }) });
}

/** Named operation, never a caller-selected row save. Existing grants stay narrow. */
export function aiCreateSheet(ctx: WindowContext, access: AiOperationAccess, connectionId: string, actor: string, raw: unknown) {
  assertAiOperationAccess(ctx, access, 'sheets.manage');
  const input = aiSheetCreateSchema.parse(raw);
  const receiptId = createHash('sha256').update(JSON.stringify([connectionId, input.requestId])).digest('hex');
  return ctx.sqlite.transaction(() => {
    assertAiOperationAccess(ctx, access, 'sheets.manage');
    const saved = readReceipt(ctx, receiptId);
    if (saved) {
      if (saved.name !== input.name) throw new Error('This requestId was already used for a different sheet name.');
      // Retrying an undone/deleted/renamed operation never silently recreates it.
      return { creation: result(ctx, receiptId, saved), changed: false };
    }
    const receipt: Receipt = { name: input.name, sheet: sheetRowSchema.parse(sheetsCreate(ctx, randomUUID(), input.name)), state: 'applied' };
    ctx.settingsRepo.setSetting(receiptKey(receiptId), JSON.stringify(receipt), 'device');
    audit(ctx, receiptId, receipt, actor, 'create');
    return { creation: result(ctx, receiptId, receipt), changed: true };
  }).immediate();
}

/** Native Undo/Redo only: exact receipt, empty unchanged sheet, no replayed raw rows. */
export function changeAiSheetCreation(ctx: WindowContext, raw: unknown): AiSheetCreation {
  const actor = assertApplicationPermission(ctx, 'ledgerUse');
  const input = aiSheetHistorySchema.parse(raw);
  return ctx.sqlite.transaction(() => {
    const receipt = readReceipt(ctx, input.receiptId);
    if (!receipt) throw new Error('This sheet creation is no longer available.');
    const target = input.direction === 'undo' ? 'undone' : 'applied';
    if (receipt.state === target) return result(ctx, input.receiptId, receipt);
    if (input.direction === 'undo') {
      const current = sheetsGetAll(ctx).find((sheet) => sheet.id === receipt.sheet.id);
      if (!current || JSON.stringify(sheetRowSchema.parse(current)) !== JSON.stringify(receipt.sheet)) {
        throw new Error('The sheet changed after creation. Review it in Manage Sheets.');
      }
      sheetsDeleteSimple(ctx, receipt.sheet.id); // Refuses any actual or planned entries, including transfer destinations.
    } else {
      if (sheetsGetAll(ctx).some((sheet) => sheet.id === receipt.sheet.id)) throw new Error('The sheet ID is already in use.');
      sheetsRestoreWithSort(ctx, receipt.sheet); // Shared duplicate-name rule, including native edits since Undo.
    }
    receipt.state = target;
    ctx.settingsRepo.setSetting(receiptKey(input.receiptId), JSON.stringify(receipt), 'device');
    audit(ctx, input.receiptId, receipt, actor.kind === 'team' ? actor.name : 'Local user', input.direction);
    return result(ctx, input.receiptId, receipt);
  }).immediate();
}
