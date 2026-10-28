import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import * as operations from '../services/transaction-operations';

export function registerTransactionHandlers(): void {
  ipcMain.handle('transactions:getAll', (event, sheet?: unknown) => {
    return operations.transactionsGetAll(resolveContext(event), sheet);
  });

  ipcMain.handle('transactions:getById', (event, id: unknown) => {
    return operations.transactionsGetById(resolveContext(event), id);
  });

  ipcMain.handle('transactions:save', (event, data: unknown) => {
    return operations.transactionsSave(resolveContext(event), data);
  });

  ipcMain.handle('transactions:delete', (event, id: unknown) => {
    return operations.transactionsDelete(resolveContext(event), id);
  });

  ipcMain.handle('transactions:bulkSave', (event, items: unknown) => {
    return operations.transactionsBulkSave(resolveContext(event), items);
  });

  ipcMain.handle('transactions:bulkDelete', (event, ids: unknown) => {
    return operations.transactionsBulkDelete(resolveContext(event), ids);
  });

  ipcMain.handle('transactions:saveTransfer', (event, expense: unknown, income: unknown) => {
    return operations.transactionsSaveTransfer(resolveContext(event), expense, income);
  });

  ipcMain.handle('transactions:getByLinkedId', (event, linkedId: unknown) => {
    return operations.transactionsGetByLinkedId(resolveContext(event), linkedId);
  });
}
