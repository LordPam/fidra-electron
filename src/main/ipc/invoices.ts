import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { invoiceRowSchema } from '../../shared/ipc-schemas';
import { logInvoiceCreated, logInvoiceUpdated, logInvoiceDeleted, logInvoiceMarkedPaid } from '../services/audit-service';

export function registerInvoiceHandlers(): void {
  ipcMain.handle('invoices:getAll', (event) => {
    return resolveContext(event).repos.invoices.getAll();
  });

  ipcMain.handle('invoices:getByPlannedTemplate', (event, plannedTemplateId: unknown) => {
    const validId = z.string().parse(plannedTemplateId);
    return resolveContext(event).repos.invoices.getByPlannedTemplateId(validId);
  });

  ipcMain.handle('invoices:save', (event, data: unknown) => {
    const validated = invoiceRowSchema.parse(data);
    const ctx = resolveContext(event);
    const existing = ctx.invoiceRepo.getById(validated.id);
    const result = ctx.repos.invoices.save(validated);
    if (existing) {
      logInvoiceUpdated(ctx, validated);
    } else {
      logInvoiceCreated(ctx, validated);
    }
    return result;
  });

  ipcMain.handle('invoices:delete', (event, id: unknown) => {
    const validId = z.string().parse(id);
    const ctx = resolveContext(event);
    const result = ctx.repos.invoices.remove(validId);
    logInvoiceDeleted(ctx, validId);
    return result;
  });

  ipcMain.handle('invoices:markPaid', (event, invoiceId: unknown, transactionId: unknown) => {
    const validInvoiceId = z.string().parse(invoiceId);
    const validTxId = z.string().parse(transactionId);
    const ctx = resolveContext(event);
    const result = ctx.repos.invoices.markPaid(validInvoiceId, validTxId);
    if (result) logInvoiceMarkedPaid(ctx, result);
    return result;
  });

  ipcMain.handle('invoices:revertToDraft', (event, invoiceId: unknown) => {
    const validId = z.string().parse(invoiceId);
    return resolveContext(event).repos.invoices.revertToDraft(validId);
  });
}
