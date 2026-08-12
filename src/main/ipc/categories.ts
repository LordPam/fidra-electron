import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { nameSchema, transactionTypeSchema } from '../../shared/ipc-schemas';

export function registerCategoryHandlers(): void {
  ipcMain.handle('categories:getAll', (event, type: unknown) => {
    const validType = transactionTypeSchema.parse(type);
    return resolveContext(event).repos.categories.getAll(validType);
  });

  ipcMain.handle('categories:setAll', (event, type: unknown, names: unknown) => {
    const validType = transactionTypeSchema.parse(type);
    const validNames = z.array(nameSchema).parse(names);

    // Categories are matched by name and carry no UNIQUE constraint (cr-sqlite
    // forbids one), so a repeated name would produce two indistinguishable entries.
    // Keep the first spelling of each, preserving the caller's ordering.
    const seen = new Set<string>();
    const deduped = validNames.filter((name) => {
      const key = name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    resolveContext(event).repos.categories.setAll(validType, deduped);
  });
}
