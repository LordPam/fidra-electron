import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { transactionTypeSchema } from '../../shared/ipc-schemas';

export function registerCategoryHandlers(): void {
  ipcMain.handle('categories:getAll', (event, type: unknown) => {
    const validType = transactionTypeSchema.parse(type);
    return resolveContext(event).repos.categories.getAll(validType);
  });

  ipcMain.handle('categories:setAll', (event, type: unknown, names: unknown) => {
    const validType = transactionTypeSchema.parse(type);
    const validNames = z.array(z.string()).parse(names);
    resolveContext(event).repos.categories.setAll(validType, validNames);
  });
}
