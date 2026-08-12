import { registerAppHandlers } from './app';
import { registerTransactionHandlers } from './transactions';
import { registerSheetHandlers } from './sheets';
import { registerCategoryHandlers } from './categories';
import { registerPlannedHandlers } from './planned';
import { registerActivityNotesHandlers } from './activity-notes';
import { registerAttachmentHandlers } from './attachments';
import { registerWindowHandlers } from './window';
import { registerInvoiceHandlers } from './invoices';
import { registerAuditHandlers } from './audit';
import { registerLocalSyncHandlers } from './local-sync';
import { registerLocalAuthHandlers } from './local-auth';
import { registerPersonnelHandlers } from './personnel';
import { registerBackupHandlers } from './backup';
import { registerUpdateHandlers } from '../services/update-checker';
import { registerCsvImportHandlers } from './csv-import';

export function registerAllHandlers(): void {
  registerAppHandlers();
  registerTransactionHandlers();
  registerSheetHandlers();
  registerCategoryHandlers();
  registerPlannedHandlers();
  registerActivityNotesHandlers();
  registerAttachmentHandlers();
  registerWindowHandlers();
  registerInvoiceHandlers();
  registerAuditHandlers();
  registerLocalSyncHandlers();
  registerLocalAuthHandlers();
  registerPersonnelHandlers();
  registerBackupHandlers();
  registerUpdateHandlers();
  registerCsvImportHandlers();
}
