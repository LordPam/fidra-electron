import { registerAppHandlers } from './app';
import { registerTransactionHandlers } from './transactions';
import { registerSheetHandlers } from './sheets';
import { registerCategoryHandlers } from './categories';
import { registerPlannedHandlers } from './planned';
import { registerActivityNotesHandlers } from './activity-notes';
import { registerCloudHandlers } from './cloud';
import { registerAttachmentHandlers } from './attachments';
import { registerWindowHandlers } from './window';
import { registerInvoiceHandlers } from './invoices';
import { registerAuditHandlers } from './audit';
import { registerLocalSyncHandlers } from './local-sync';
import { registerLocalAuthHandlers } from './local-auth';
import { registerBackupHandlers } from './backup';

export function registerAllHandlers(): void {
  registerAppHandlers();
  registerTransactionHandlers();
  registerSheetHandlers();
  registerCategoryHandlers();
  registerPlannedHandlers();
  registerActivityNotesHandlers();
  registerCloudHandlers();
  registerAttachmentHandlers();
  registerWindowHandlers();
  registerInvoiceHandlers();
  registerAuditHandlers();
  registerLocalSyncHandlers();
  registerLocalAuthHandlers();
  registerBackupHandlers();
}
