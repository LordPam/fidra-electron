import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/planned-operations';

export function registerPlannedHandlers(): void {
  ipcMain.handle('planned:getAll', (event) => {
    return operations.plannedGetAll(resolveContext(event));
  });

  ipcMain.handle('planned:save', (event, data: unknown) => {
    return operations.plannedSave(resolveContext(event), data);
  });

  ipcMain.handle('planned:bulkSave', (event, data: unknown) => {
    return operations.plannedBulkSave(resolveContext(event), data);
  });

  ipcMain.handle('planned:delete', (event, id: unknown) => {
    return operations.plannedDelete(resolveContext(event), id);
  });
}
