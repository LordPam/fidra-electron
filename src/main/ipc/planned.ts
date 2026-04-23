import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { plannedTemplateRowSchema, plannedTemplateBulkSaveSchema } from '../../shared/ipc-schemas';
import { logPlannedCreated, logPlannedUpdated, logPlannedDeleted, logBulkPlannedSaved } from '../services/audit-service';

export function registerPlannedHandlers(): void {
  ipcMain.handle('planned:getAll', (event) => {
    return resolveContext(event).repos.planned.getAll();
  });

  ipcMain.handle('planned:save', async (event, data: unknown) => {
    const validated = plannedTemplateRowSchema.parse(data);
    const ctx = resolveContext(event);
    const existing = ctx.plannedRepo.getById(validated.id);
    const result = await ctx.repos.planned.save(validated);
    if (existing) {
      logPlannedUpdated(ctx, existing, validated);
    } else {
      logPlannedCreated(ctx, validated);
    }
    // Sync linked invoices: update due_date, description, and amount
    const updated = ctx.invoiceRepo.updateLinkedFromPlanned(
      validated.id, validated.start_date, validated.description, validated.amount,
    );
    console.log(`[planned:save] id=${validated.id} start_date=${validated.start_date} desc=${validated.description} amount=${validated.amount} → updated ${updated} invoices`);
    return result;
  });

  ipcMain.handle('planned:bulkSave', async (event, data: unknown) => {
    const validated = plannedTemplateBulkSaveSchema.parse(data);
    const ctx = resolveContext(event);
    const existingMap = new Map(
      validated.map((tmpl) => [tmpl.id, ctx.plannedRepo.getById(tmpl.id)]),
    );
    const results = ctx.repos.planned.bulkSave(validated);
    if (validated.length > 0) {
      let created = 0;
      let updated = 0;
      for (const tmpl of validated) {
        if (existingMap.get(tmpl.id)) updated++;
        else created++;
      }
      logBulkPlannedSaved(ctx, created, updated, validated.map((t) => t.id));
    }
    return results;
  });

  ipcMain.handle('planned:delete', (event, id: unknown) => {
    const validId = z.string().parse(id);
    const ctx = resolveContext(event);
    const result = ctx.repos.planned.remove(validId);
    logPlannedDeleted(ctx, validId);
    return result;
  });
}
