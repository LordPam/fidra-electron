import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/category-operations';

export function registerCategoryHandlers(): void {
  ipcMain.handle('categories:getAll', (event, type: unknown) => {
    return operations.categoriesGetAll(resolveContext(event), type);
  });

  ipcMain.handle('categories:setAll', (event, type: unknown, names: unknown) => {
    return operations.categoriesSetAll(resolveContext(event), type, names);
  });
}
