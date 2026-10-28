import { z } from 'zod';
import { idSchema, nameSchema, sheetRowSchema } from '../../shared/ipc-schemas';
import { assertSheetNameAvailable } from './referential-integrity';
import { logSheetCreated, logSheetRenamed, logSheetDeleted } from './audit-service';
import type { WindowContext } from '../window/window-context';
import { assertApplicationPermission } from './application-access';

/** Shared desktop/external application operations. Each entry validates before repository access. */
export function sheetsGetAll(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.repos.sheets.getAll();
}

export function sheetsCreate(ctx: WindowContext, id: unknown, name: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const validName = nameSchema.parse(name);
  assertSheetNameAvailable(ctx.sqlite, validName);
  const result = ctx.repos.sheets.create(validId, validName);
  logSheetCreated(ctx, validName, validId);
  return result;
}

export function sheetsRename(ctx: WindowContext, oldName: unknown, newName: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validOld = nameSchema.parse(oldName);
  const validNew = nameSchema.parse(newName);
  const sheet = ctx.sheetRepo.getByName(validOld);
  if (!sheet || sheet.is_virtual || sheet.is_planned) throw new Error('Choose an existing account.');
  assertSheetNameAvailable(ctx.sqlite, validNew, sheet?.id);
  ctx.repos.sheets.renameSheet(validOld, validNew);
  logSheetRenamed(ctx, validOld, validNew, sheet?.id ?? '');
}

export function sheetsDelete(ctx: WindowContext, id: unknown, name: unknown, mergeTarget?: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const validName = nameSchema.parse(name);
  const validMerge = mergeTarget != null ? nameSchema.parse(mergeTarget) : undefined;
  const source = ctx.repos.sheets.getAll().find((sheet) => sheet.id === validId && sheet.name === validName);
  if (!source) throw new Error('The account ID and name no longer match. Refresh before continuing.');
  if (validMerge) {
    const target = ctx.repos.sheets.getAll().find((sheet) => sheet.name === validMerge);
    if (!target || target.id === source.id) throw new Error('Choose a different existing destination account.');
    ctx.repos.sheets.mergeAndDelete(validId, validName, validMerge);
  } else {
    ctx.repos.sheets.deleteWithTransactions(validId, validName);
  }
  logSheetDeleted(ctx, validName, validId, validMerge);
}

export function sheetsReorder(ctx: WindowContext, orderedIds: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = z.array(idSchema).parse(orderedIds);
  const current = ctx.repos.sheets.getAll();
  if (new Set(validated).size !== validated.length || validated.length !== current.length
    || current.some((sheet) => !validated.includes(sheet.id))) {
    throw new Error('Provide every existing account exactly once when reordering.');
  }
  ctx.repos.sheets.reorder(validated);
}

export function sheetsDeleteSimple(ctx: WindowContext, id: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validId = idSchema.parse(id);
  const sheet = ctx.repos.sheets.getAll().find((item) => item.id === validId);
  if (sheet && (ctx.repos.sheets.getTransactionsOnSheet(sheet.name).length || ctx.repos.sheets.getPlannedOnSheet(sheet.name).length)) {
    throw new Error('This account is no longer empty. Use the normal delete or merge workflow.');
  }
  return ctx.repos.sheets.deleteSimple(validId);
}

export function sheetsRestoreWithSort(ctx: WindowContext, sheet: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validated = sheetRowSchema.parse(sheet);
  assertSheetNameAvailable(ctx.sqlite, validated.name);
  return ctx.repos.sheets.restoreWithSort(validated);
}

export function sheetsGetTransactionsOnSheet(ctx: WindowContext, name: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validName = nameSchema.parse(name);
  return ctx.repos.sheets.getTransactionsOnSheet(validName);
}

export function sheetsGetPlannedOnSheet(ctx: WindowContext, name: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validName = nameSchema.parse(name);
  return ctx.repos.sheets.getPlannedOnSheet(validName);
}

export function sheetsGetAttachmentsOnSheet(ctx: WindowContext, name: unknown) {
  assertApplicationPermission(ctx, 'ledgerUse');
  const validName = nameSchema.parse(name);
  return ctx.repos.sheets.getAttachmentsOnSheet(validName);
}
