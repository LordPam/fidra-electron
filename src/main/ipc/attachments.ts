import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import * as attachmentService from '../services/attachment-service';
import { attachmentRowSchema } from '../../shared/ipc-schemas';
import { logAttachmentAdded, logAttachmentRemoved } from '../services/audit-service';

export function registerAttachmentHandlers(): void {
  ipcMain.handle('attachments:getForTransaction', (event, transactionId: unknown) => {
    const validId = z.string().parse(transactionId);
    return attachmentService.getForTransaction(validId, resolveContext(event));
  });

  ipcMain.handle('attachments:getCounts', (event, transactionIds: unknown) => {
    const validated = z.array(z.string()).parse(transactionIds);
    return attachmentService.getCounts(validated, resolveContext(event));
  });

  ipcMain.handle(
    'attachments:add',
    async (event, transactionId: unknown, filePath: unknown, filename: unknown) => {
      const validTxId = z.string().parse(transactionId);
      const validPath = z.string().parse(filePath);
      const validName = z.string().parse(filename);
      const ctx = resolveContext(event);
      const result = await attachmentService.addAttachment(validTxId, validPath, validName, ctx);
      logAttachmentAdded(ctx, validTxId, validName);
      return result;
    },
  );

  ipcMain.handle('attachments:remove', async (event, id: unknown) => {
    const validId = z.string().parse(id);
    const ctx = resolveContext(event);
    const attachment = ctx.attachmentRepo.getById(validId);
    const result = await attachmentService.removeAttachment(validId, ctx);
    if (result && attachment) {
      logAttachmentRemoved(ctx, attachment.transaction_id, attachment.filename);
    }
    return result;
  });

  ipcMain.handle('attachments:open', (event, id: unknown) => {
    const validId = z.string().parse(id);
    return attachmentService.openAttachment(validId, resolveContext(event));
  });

  ipcMain.handle('attachments:restore', (event, row: unknown) => {
    const validated = attachmentRowSchema.parse(row);
    return attachmentService.restoreAttachment(validated, resolveContext(event));
  });

  ipcMain.handle('attachments:restoreForTransaction', (event, rows: unknown) => {
    const validated = z.array(attachmentRowSchema).parse(rows);
    return attachmentService.restoreAllForTransaction(validated, resolveContext(event));
  });
}
