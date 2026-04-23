import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { sheetRowSchema } from '../../shared/ipc-schemas';
import { logSheetCreated, logSheetRenamed, logSheetDeleted } from '../services/audit-service';

export function registerSheetHandlers(): void {
  ipcMain.handle('sheets:getAll', (event) => {
    return resolveContext(event).repos.sheets.getAll();
  });

  ipcMain.handle('sheets:create', (event, id: unknown, name: unknown) => {
    const validId = z.string().parse(id);
    const validName = z.string().parse(name);
    const ctx = resolveContext(event);
    const result = ctx.repos.sheets.create(validId, validName);
    logSheetCreated(ctx, validName, validId);
    return result;
  });

  ipcMain.handle('sheets:rename', (event, oldName: unknown, newName: unknown) => {
    const validOld = z.string().parse(oldName);
    const validNew = z.string().parse(newName);
    const ctx = resolveContext(event);
    const sheet = ctx.sheetRepo.getByName(validOld);
    ctx.repos.sheets.renameSheet(validOld, validNew);
    logSheetRenamed(ctx, validOld, validNew, sheet?.id ?? '');
  });

  ipcMain.handle(
    'sheets:delete',
    (event, id: unknown, name: unknown, mergeTarget?: unknown) => {
      const validId = z.string().parse(id);
      const validName = z.string().parse(name);
      const validMerge = mergeTarget != null ? z.string().parse(mergeTarget) : undefined;
      const ctx = resolveContext(event);
      if (validMerge) {
        ctx.repos.sheets.mergeAndDelete(validId, validName, validMerge);
      } else {
        ctx.repos.sheets.deleteWithTransactions(validId, validName);
      }
      logSheetDeleted(ctx, validName, validId, validMerge);
    },
  );

  ipcMain.handle('sheets:reorder', (event, orderedIds: unknown) => {
    const validated = z.array(z.string()).parse(orderedIds);
    resolveContext(event).repos.sheets.reorder(validated);
  });

  ipcMain.handle('sheets:deleteSimple', (event, id: unknown) => {
    const validId = z.string().parse(id);
    return resolveContext(event).repos.sheets.deleteSimple(validId);
  });

  ipcMain.handle('sheets:restoreWithSort', (event, sheet: unknown) => {
    const validated = sheetRowSchema.parse(sheet);
    return resolveContext(event).repos.sheets.restoreWithSort(validated);
  });

  ipcMain.handle('sheets:getTransactionsOnSheet', (event, name: unknown) => {
    const validName = z.string().parse(name);
    return resolveContext(event).repos.sheets.getTransactionsOnSheet(validName);
  });

  ipcMain.handle('sheets:getPlannedOnSheet', (event, name: unknown) => {
    const validName = z.string().parse(name);
    return resolveContext(event).repos.sheets.getPlannedOnSheet(validName);
  });

  ipcMain.handle('sheets:getAttachmentsOnSheet', (event, name: unknown) => {
    const validName = z.string().parse(name);
    return resolveContext(event).repos.sheets.getAttachmentsOnSheet(validName);
  });
}
