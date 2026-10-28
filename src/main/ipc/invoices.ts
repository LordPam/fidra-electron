import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/invoice-operations';

export function registerInvoiceHandlers(): void {
  ipcMain.handle('invoices:getAll', (event) => {
    return operations.invoicesGetAll(resolveContext(event));
  });

  ipcMain.handle('invoices:getByPlannedTemplate', (event, plannedTemplateId: unknown) => {
    return operations.invoicesGetByPlannedTemplate(resolveContext(event), plannedTemplateId);
  });

  ipcMain.handle('invoices:save', (event, data: unknown) => {
    return operations.invoicesSave(resolveContext(event), data);
  });

  ipcMain.handle('invoices:delete', (event, id: unknown) => {
    return operations.invoicesDelete(resolveContext(event), id);
  });

  ipcMain.handle('invoices:markPaid', (event, invoiceId: unknown, transactionId: unknown) => {
    return operations.invoicesMarkPaid(resolveContext(event), invoiceId, transactionId);
  });

  ipcMain.handle('invoices:revertToDraft', (event, invoiceId: unknown) => {
    return operations.invoicesRevertToDraft(resolveContext(event), invoiceId);
  });
}
