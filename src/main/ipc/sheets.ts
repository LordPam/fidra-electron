import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/sheet-operations';

export function registerSheetHandlers(): void {
  ipcMain.handle('sheets:getAll', (event) => {
    return operations.sheetsGetAll(resolveContext(event));
  });

  ipcMain.handle('sheets:create', (event, id: unknown, name: unknown) => {
    return operations.sheetsCreate(resolveContext(event), id, name);
  });

  ipcMain.handle('sheets:rename', (event, oldName: unknown, newName: unknown) => {
    return operations.sheetsRename(resolveContext(event), oldName, newName);
  });

  ipcMain.handle('sheets:delete', (event, id: unknown, name: unknown, mergeTarget?: unknown) => {
    return operations.sheetsDelete(resolveContext(event), id, name, mergeTarget);
  });

  ipcMain.handle('sheets:reorder', (event, orderedIds: unknown) => {
    return operations.sheetsReorder(resolveContext(event), orderedIds);
  });

  ipcMain.handle('sheets:deleteSimple', (event, id: unknown) => {
    return operations.sheetsDeleteSimple(resolveContext(event), id);
  });

  ipcMain.handle('sheets:restoreWithSort', (event, sheet: unknown) => {
    return operations.sheetsRestoreWithSort(resolveContext(event), sheet);
  });

  ipcMain.handle('sheets:getTransactionsOnSheet', (event, name: unknown) => {
    return operations.sheetsGetTransactionsOnSheet(resolveContext(event), name);
  });

  ipcMain.handle('sheets:getPlannedOnSheet', (event, name: unknown) => {
    return operations.sheetsGetPlannedOnSheet(resolveContext(event), name);
  });

  ipcMain.handle('sheets:getAttachmentsOnSheet', (event, name: unknown) => {
    return operations.sheetsGetAttachmentsOnSheet(resolveContext(event), name);
  });
}
