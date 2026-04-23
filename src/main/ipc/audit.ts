import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';

export function registerAuditHandlers(): void {
  ipcMain.handle('audit:getAll', (event, entityType?: unknown, limit?: unknown) => {
    const validType = entityType != null ? z.string().parse(entityType) : undefined;
    const validLimit = limit != null ? z.number().int().positive().parse(limit) : undefined;
    return resolveContext(event).activeAuditRepo.getAll(validType, validLimit);
  });

  ipcMain.handle('audit:getForEntity', (event, entityId: unknown) => {
    const validId = z.string().parse(entityId);
    return resolveContext(event).activeAuditRepo.getForEntity(validId);
  });
}
