import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { UiPreferences } from '../shared/global-settings-types';
import type {
  TransactionRow,
  SheetRow,
  PlannedTemplateRow,
  AttachmentRow,
  InvoiceRow,
  InvoiceDefaults,
  AuditLogRow,
  LocalSyncConfig,
  LocalSyncStatus,
  LocalSyncConflict,
  LocalSyncExportResult,
  LocalSyncImportResult,
  ImportNotification,
  MigrationResult,
  SyncFolderValidation,
  BackupListItem,
  BackupSettings,
} from '../shared/ipc-types';
import type { PersonnelRecord, PersonnelRole, LocalAuthStatus } from '../shared/auth-types';
import type {
  CsvParseRequest,
  CsvParseResponse,
  CsvAnalyzeRequest,
  CsvAnalyzeResponse,
  CsvCommitRequest,
  CsvImportResult,
  CsvImportProfile,
} from '../shared/csv-import-types';

import type { DeviceDataInfo, DeviceActionResult } from '../shared/device-types';
import type { UpdateStatus, UpdatePreparationReply } from '../shared/update-types';

let pendingWork = 0;
let workFailures = 0;
let preparedForUpdate = false;
let lastWorkAt = 0;

// Covers native dialogs, imports, exports, writes, and each link of multi-step commands.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoke(channel: string, ...args: unknown[]): Promise<any> {
  if (channel.startsWith('updates:') || channel.startsWith('device:')) return ipcRenderer.invoke(channel, ...args);
  if (preparedForUpdate) return Promise.reject(new Error('Fidra is preparing an update. Please wait.'));
  pendingWork++;
  lastWorkAt = Date.now();
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    workFailures++;
    throw error;
  }).finally(() => { pendingWork--; lastWorkAt = Date.now(); });
}

const api = {
  /**
   * Host platform, so the renderer can lay out around macOS's inset traffic
   * lights. `'browser'` in the gh-pages demo, which has no native chrome.
   */
  platform: process.platform as string,

  getDbPath: (): Promise<string> => invoke('app:getDbPath'),
  getAboutInfo: (): Promise<{ version: string; description: string; logPath: string }> =>
    invoke('app:getAboutInfo'),

  // Transactions
  getTransactions: (sheet?: string): Promise<TransactionRow[]> =>
    invoke('transactions:getAll', sheet),
  getTransaction: (id: string): Promise<TransactionRow | null> =>
    invoke('transactions:getById', id),
  saveTransaction: (data: TransactionRow): Promise<TransactionRow> =>
    invoke('transactions:save', data),
  deleteTransaction: (id: string): Promise<{ success: boolean; deletedAttachments: AttachmentRow[]; deletedCounterpart: TransactionRow | null; counterpartAttachments: AttachmentRow[] }> =>
    invoke('transactions:delete', id),
  saveTransfer: (expense: TransactionRow, income: TransactionRow): Promise<{ expense: TransactionRow; income: TransactionRow }> =>
    invoke('transactions:saveTransfer', expense, income),
  getTransactionsByLinkedId: (linkedId: string): Promise<TransactionRow[]> =>
    invoke('transactions:getByLinkedId', linkedId),
  bulkSaveTransactions: (transactions: TransactionRow[]): Promise<TransactionRow[]> =>
    invoke('transactions:bulkSave', transactions),
  bulkDeleteTransactions: (ids: string[]): Promise<{ count: number; deletedAttachments: Record<string, AttachmentRow[]> }> =>
    invoke('transactions:bulkDelete', ids),

  // Sheets
  getSheets: (): Promise<SheetRow[]> => invoke('sheets:getAll'),
  createSheet: (id: string, name: string): Promise<SheetRow> =>
    invoke('sheets:create', id, name),
  renameSheet: (oldName: string, newName: string): Promise<void> =>
    invoke('sheets:rename', oldName, newName),
  deleteSheet: (id: string, name: string, mergeTarget?: string): Promise<void> =>
    invoke('sheets:delete', id, name, mergeTarget),
  reorderSheets: (orderedIds: string[]): Promise<void> =>
    invoke('sheets:reorder', orderedIds),
  deleteSheetSimple: (id: string): Promise<boolean> =>
    invoke('sheets:deleteSimple', id),
  restoreSheetWithSort: (sheet: SheetRow): Promise<SheetRow> =>
    invoke('sheets:restoreWithSort', sheet),
  getTransactionsOnSheet: (name: string): Promise<TransactionRow[]> =>
    invoke('sheets:getTransactionsOnSheet', name),
  getPlannedOnSheet: (name: string): Promise<PlannedTemplateRow[]> =>
    invoke('sheets:getPlannedOnSheet', name),
  getAttachmentsOnSheet: (name: string): Promise<AttachmentRow[]> =>
    invoke('sheets:getAttachmentsOnSheet', name),

  // Categories
  getCategories: (type: string): Promise<string[]> =>
    invoke('categories:getAll', type),
  setCategories: (type: string, names: string[]): Promise<void> =>
    invoke('categories:setAll', type, names),

  // Planned Templates
  getPlannedTemplates: (): Promise<PlannedTemplateRow[]> =>
    invoke('planned:getAll'),
  savePlannedTemplate: (data: PlannedTemplateRow): Promise<PlannedTemplateRow> =>
    invoke('planned:save', data),
  bulkSavePlannedTemplates: (templates: PlannedTemplateRow[]): Promise<PlannedTemplateRow[]> =>
    invoke('planned:bulkSave', templates),
  deletePlannedTemplate: (id: string): Promise<boolean> =>
    invoke('planned:delete', id),

  // Activity Notes
  getActivityNotes: (): Promise<Record<string, string>> =>
    invoke('activityNotes:getAll'),
  saveActivityNote: (activity: string, notes: string): Promise<void> =>
    invoke('activityNotes:save', activity, notes),
  deleteActivityNote: (activity: string): Promise<void> =>
    invoke('activityNotes:delete', activity),

  // Attachments
  getAttachments: (transactionId: string): Promise<AttachmentRow[]> =>
    invoke('attachments:getForTransaction', transactionId),
  getAttachmentCounts: (transactionIds: string[]): Promise<Record<string, number>> =>
    invoke('attachments:getCounts', transactionIds),
  addAttachment: (transactionId: string, filePath: string, filename: string): Promise<AttachmentRow> =>
    invoke('attachments:add', transactionId, filePath, filename),
  removeAttachment: (id: string): Promise<boolean> =>
    invoke('attachments:remove', id),
  openAttachment: (id: string): Promise<boolean> =>
    invoke('attachments:open', id),
  restoreAttachment: (row: AttachmentRow): Promise<AttachmentRow> =>
    invoke('attachments:restore', row),
  restoreAttachmentsForTransaction: (rows: AttachmentRow[]): Promise<void> =>
    invoke('attachments:restoreForTransaction', rows),

  // File utilities
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // File dialogs
  showOpenDialog: (options: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): Promise<{ filePaths: string[]; canceled: boolean }> =>
    invoke('app:showOpenDialog', options),
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ filePath: string | undefined; canceled: boolean }> =>
    invoke('app:showSaveDialog', options),
  writeFile: (filePath: string, content: string, encoding?: string): Promise<void> =>
    invoke('app:writeFile', filePath, content, encoding),
  writeFileBinary: (filePath: string, data: number[]): Promise<void> =>
    invoke('app:writeFileBinary', filePath, data),
  printToPDF: (html: string, options?: { footerText?: string }): Promise<number[]> =>
    invoke('app:printToPDF', html, options),

  // Startup
  getStartupMode: (): Promise<{ mode: 'wizard' | 'restore' | 'chooser' }> =>
    invoke('app:getStartupMode'),
  markFirstRunComplete: (): Promise<void> =>
    invoke('app:markFirstRunComplete'),

  // Window management
  createWindow: (dbPath?: string): Promise<{ success: boolean; error?: string }> =>
    invoke('window:create', dbPath),
  openFileDialog: (): Promise<{ filePath: string | null; canceled: boolean; error?: string }> =>
    invoke('window:openFileDialog'),
  createNewDb: (options?: { chooseLocation: boolean }): Promise<{ filePath: string | null; canceled: boolean; error?: string }> =>
    invoke('window:createNewDb', options),
  getRecentFiles: (): Promise<{ path: string; name: string; lastOpenedAt: string }[]> =>
    invoke('window:getRecentFiles'),
  openRecentFile: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    invoke('window:openRecent', filePath),
  removeRecentFile: (filePath: string): Promise<void> =>
    invoke('window:removeRecent', filePath),
  getDbInfo: (): Promise<{ path: string; name: string }> =>
    invoke('window:getDbInfo'),
  switchToFile: (dbPath: string): Promise<{ success: boolean; reloading: boolean; error?: string }> =>
    invoke('window:switchToFile', dbPath),

  // Invoices
  getInvoices: (): Promise<InvoiceRow[]> =>
    invoke('invoices:getAll'),
  getInvoicesByPlannedTemplate: (plannedTemplateId: string): Promise<InvoiceRow[]> =>
    invoke('invoices:getByPlannedTemplate', plannedTemplateId),
  saveInvoice: (data: InvoiceRow): Promise<InvoiceRow> =>
    invoke('invoices:save', data),
  deleteInvoice: (id: string): Promise<boolean> =>
    invoke('invoices:delete', id),
  markInvoicePaid: (invoiceId: string, transactionId: string): Promise<InvoiceRow> =>
    invoke('invoices:markPaid', invoiceId, transactionId),
  revertInvoiceToDraft: (invoiceId: string): Promise<InvoiceRow> =>
    invoke('invoices:revertToDraft', invoiceId),
  readFileBase64: (filePath: string): Promise<string> =>
    invoke('app:readFileBase64', filePath),

  // Per-database profile
  getProfile: (): Promise<{ name: string; initials: string }> =>
    invoke('settings:getProfile'),
  saveProfile: (profile: { name: string; initials: string }): Promise<void> =>
    invoke('settings:saveProfile', profile),
  getCurrentUser: (): Promise<{ displayName: string; source: 'auth' | 'profile' | 'none' } | null> =>
    invoke('settings:getCurrentUser'),
  getTransactionSettings: (): Promise<{ dateOnApprove: boolean; dateOnPlannedConversion: boolean }> =>
    invoke('settings:getTransactionSettings'),
  saveTransactionSettings: (settings: { dateOnApprove: boolean; dateOnPlannedConversion: boolean }): Promise<void> =>
    invoke('settings:saveTransactionSettings', settings),
  getFYStartMonth: (): Promise<number> =>
    invoke('settings:getFYStartMonth'),
  saveFYStartMonth: (month: number): Promise<void> =>
    invoke('settings:saveFYStartMonth', month),
  getOrgName: (): Promise<string> =>
    invoke('settings:getOrgName'),
  saveOrgName: (name: string): Promise<void> =>
    invoke('settings:saveOrgName', name),

  // Current sheet selection (per-database)
  getCurrentSheet: (): Promise<string> =>
    invoke('settings:getCurrentSheet'),
  saveCurrentSheet: (name: string): Promise<void> =>
    invoke('settings:saveCurrentSheet', name),

  // Invoice defaults (per-database)
  getInvoiceDefaults: (): Promise<InvoiceDefaults> =>
    invoke('settings:getInvoiceDefaults'),
  saveInvoiceDefaults: (defaults: InvoiceDefaults): Promise<void> =>
    invoke('settings:saveInvoiceDefaults', defaults),

  // UI preferences
  getUiPreferences: (): Promise<UiPreferences> =>
    invoke('settings:getUiPreferences'),
  saveUiPreferences: (prefs: UiPreferences): Promise<void> =>
    invoke('settings:saveUiPreferences', prefs),

  // Personnel
  getPersonnel: (): Promise<PersonnelRecord[]> =>
    invoke('personnel:getAll'),
  removePersonnel: (id: string): Promise<{ success: boolean; error?: string }> =>
    invoke('personnel:remove', id),
  updatePersonnelRole: (id: string, role: PersonnelRole): Promise<{ success: boolean; error?: string }> =>
    invoke('personnel:updateRole', id, role),

  // Audit Log
  getAuditLog: (entityType?: string, limit?: number): Promise<AuditLogRow[]> =>
    invoke('audit:getAll', entityType, limit),
  getAuditForEntity: (entityId: string): Promise<AuditLogRow[]> =>
    invoke('audit:getForEntity', entityId),

  // Local Sync
  localSyncConfigure: (config: { syncFolder: string; passphrase: string }): Promise<{ success: boolean; error?: string }> =>
    invoke('localSync:configure', config),
  localSyncGetConfig: (): Promise<LocalSyncConfig | null> =>
    invoke('localSync:getConfig'),
  localSyncReconnect: (data: { syncFolder: string }): Promise<{ success: boolean; error?: string }> =>
    invoke('localSync:reconnect', data),
  localSyncDisconnect: (): Promise<void> =>
    invoke('localSync:disconnect'),
  localSyncGetStatus: (): Promise<LocalSyncStatus> =>
    invoke('localSync:getStatus'),
  localSyncExportNow: (): Promise<LocalSyncExportResult> =>
    invoke('localSync:exportNow'),
  localSyncImportNow: (): Promise<LocalSyncImportResult> =>
    invoke('localSync:importNow'),
  localSyncGetConflicts: (entityId?: string): Promise<LocalSyncConflict[]> =>
    invoke('localSync:getConflicts', entityId),
  localSyncResolveConflict: (conflictId: string, resolution: 'keep-local' | 'accept-remote' | 'manual'): Promise<{ success: boolean }> =>
    invoke('localSync:resolveConflict', conflictId, resolution),
  localSyncCreateSnapshot: (): Promise<{ success: boolean; path?: string; changesetCount?: number; error?: string }> =>
    invoke('localSync:createSnapshot'),
  localSyncCompact: (): Promise<{ deletedCount: number }> =>
    invoke('localSync:compact'),
  localSyncJoinGroup: (opts: { syncFolder: string; passphrase: string; newDbPath?: string }): Promise<MigrationResult> =>
    invoke('localSync:joinGroup', opts),
  localSyncRecoverAttachments: (): Promise<{ success: boolean; copiedCount?: number; exportedCount?: number; error?: string }> =>
    invoke('localSync:recoverAttachments'),
  localSyncJoinViaInvite: (opts: { syncFolder: string; email: string; inviteCode: string; password: string; newDbPath?: string }): Promise<MigrationResult> =>
    invoke('localSync:joinViaInvite', opts),
  localSyncValidateFolder: (folderPath: string): Promise<SyncFolderValidation> =>
    invoke('localSync:validateFolder', folderPath),
  localSyncGetStartupSummary: (): Promise<ImportNotification | null> =>
    invoke('localSync:getStartupSummary'),

  // Local Auth
  localAuthSignIn: (data: { email: string; password: string }): Promise<{ success: boolean; isAdmin?: boolean; needsSyncFolder?: boolean; error?: string }> =>
    invoke('localAuth:signIn', data),
  localAuthCreateFirstAdmin: (data: { name: string; email: string; password: string; syncPassphrase: string }): Promise<{ success: boolean; error?: string }> =>
    invoke('localAuth:createFirstAdmin', data),
  localAuthInviteMember: (data: { name: string; email: string; role: PersonnelRole }): Promise<{ success: boolean; invitation?: import('../shared/invitation-types').FidraInvitation; inviteCode?: string; record?: PersonnelRecord; error?: string }> =>
    invoke('localAuth:inviteMember', data),
  localAuthChangePassword: (data: { oldPassword: string; newPassword: string }): Promise<{ success: boolean; error?: string }> =>
    invoke('localAuth:changePassword', data),
  localAuthSignOut: (): Promise<{ success: boolean }> =>
    invoke('localAuth:signOut'),
  localAuthGetStatus: (): Promise<LocalAuthStatus> =>
    invoke('localAuth:getAuthStatus'),

  // Backup
  backupCreate: (): Promise<BackupListItem> =>
    invoke('backup:create'),
  backupList: (): Promise<BackupListItem[]> =>
    invoke('backup:list'),
  backupRestore: (backupPath: string): Promise<{ success: boolean; error?: string }> =>
    invoke('backup:restore', backupPath),
  backupDelete: (backupPath: string): Promise<boolean> =>
    invoke('backup:delete', backupPath),
  backupGetSettings: (): Promise<BackupSettings> =>
    invoke('backup:getSettings'),
  backupSaveSettings: (settings: BackupSettings): Promise<void> =>
    invoke('backup:saveSettings', settings),

  // CSV Import
  csvImportParse: (request: CsvParseRequest): Promise<CsvParseResponse> =>
    invoke('csvImport:parse', request),
  csvImportAnalyze: (request: CsvAnalyzeRequest): Promise<CsvAnalyzeResponse> =>
    invoke('csvImport:analyze', request),
  csvImportCommit: (request: CsvCommitRequest): Promise<CsvImportResult> =>
    invoke('csvImport:commit', request),
  csvImportGetProfiles: (): Promise<CsvImportProfile[]> =>
    invoke('csvImport:getProfiles'),
  csvImportSaveProfile: (profile: CsvImportProfile): Promise<void> =>
    invoke('csvImport:saveProfile', profile),
  csvImportDeleteProfile: (profileId: string): Promise<void> =>
    invoke('csvImport:deleteProfile', profileId),
  csvImportTrainModel: (): Promise<void> =>
    invoke('csvImport:trainModel'),

  // Local Sync event listeners (main → renderer push)
  onLocalSyncStatusChanged: (callback: (status: LocalSyncStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: LocalSyncStatus) => callback(status);
    ipcRenderer.on('localSync:statusChanged', handler);
    return () => ipcRenderer.removeListener('localSync:statusChanged', handler);
  },
  onLocalSyncDataChanged: (callback: (data: { tables: string[] }) => void): (() => void) => {
    const handler = (_event: unknown, data: { tables: string[] }) => callback(data);
    ipcRenderer.on('localSync:dataChanged', handler);
    return () => ipcRenderer.removeListener('localSync:dataChanged', handler);
  },
  onLocalSyncForceSignOut: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('localSync:forceSignOut', handler);
    return () => ipcRenderer.removeListener('localSync:forceSignOut', handler);
  },
  onLocalSyncConflictsDetected: (callback: (data: { count: number }) => void): (() => void) => {
    const handler = (_event: unknown, data: { count: number }) => callback(data);
    ipcRenderer.on('localSync:conflictsDetected', handler);
    return () => ipcRenderer.removeListener('localSync:conflictsDetected', handler);
  },
  onLocalSyncError: (callback: (data: { message: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { message: string }) => callback(data);
    ipcRenderer.on('localSync:error', handler);
    return () => ipcRenderer.removeListener('localSync:error', handler);
  },
  onLocalSyncImportSummary: (callback: (notification: ImportNotification) => void): (() => void) => {
    const handler = (_event: unknown, notification: ImportNotification) => callback(notification);
    ipcRenderer.on('localSync:importSummary', handler);
    return () => ipcRenderer.removeListener('localSync:importSummary', handler);
  },

  // Menu events
  onMenuImportCsv: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:importCsv', handler);
    return () => ipcRenderer.removeListener('menu:importCsv', handler);
  },

  openInvitation: (): Promise<{ invitation: import('../shared/invitation-types').FidraInvitation; syncFolder: string | null } | null> => invoke('invitation:open'),
  saveInvitation: (invitation: import('../shared/invitation-types').FidraInvitation): Promise<boolean> => invoke('invitation:save', invitation),
  getAiBridgeState: (): Promise<import('../shared/ai-bridge-types').AiBridgeState> => invoke('ai:getState'),
  approveAiAccess: (requestId: string, policy: import('../shared/ai-access-types').AiAccessPolicy): Promise<void> => invoke('ai:approveAccess', { requestId, policy }),
  denyAiAccess: (id: string): Promise<void> => invoke('ai:denyAccess', id),
  revokeAiAccess: (id: string): Promise<void> => invoke('ai:revokeAccess', id),
  unlockAiOwner: (name: string, password: string): Promise<void> => invoke('ai:unlockOwner', { name, password }),
  discardAiProposal: (id: string): Promise<void> => invoke('ai:discard', id),
  approveAiProposal: (approval: import('../shared/reconciliation-types').ReconciliationApproval): Promise<import('../shared/reconciliation-types').ReconciliationCommit> => invoke('ai:approve', approval),
  undoAiImport: (id: string): Promise<void> => invoke('ai:undo', id),
  onAiProposalReady: (callback: () => void): (() => void) => {
    const handler = () => callback(); ipcRenderer.on('ai:proposalReady', handler);
    return () => ipcRenderer.removeListener('ai:proposalReady', handler);
  },
  onAiChanged: (callback: () => void): (() => void) => {
    const handler = () => callback(); ipcRenderer.on('ai:changed', handler);
    return () => ipcRenderer.removeListener('ai:changed', handler);
  },
  onAiImportCommitted: (callback: (approval: import('../shared/reconciliation-types').ReconciliationApproval) => void): (() => void) => {
    const handler = (_event: unknown, approval: import('../shared/reconciliation-types').ReconciliationApproval) => callback(approval);
    ipcRenderer.on('ai:importCommitted', handler);
    return () => ipcRenderer.removeListener('ai:importCommitted', handler);
  },
  getDeviceDataInfo: (): Promise<DeviceDataInfo> => invoke('device:getInfo'),
  showFinancialFiles: (): Promise<void> => invoke('device:showFinancialFiles'),
  resetDevice: (action: 'reset' | 'uninstall' = 'reset'): Promise<DeviceActionResult> => invoke('device:reset', { confirmed: true, action }),
  replyDevicePreparation: (reply: UpdatePreparationReply): Promise<void> => invoke('device:prepared', reply),
  onPrepareDevice: (callback: (requestId: string) => void): (() => void) => {
    const handler = (_event: unknown, requestId: string) => { preparedForUpdate = false; callback(requestId); };
    ipcRenderer.on('device:prepare', handler);
    return () => ipcRenderer.removeListener('device:prepare', handler);
  },
  onCancelDevicePreparation: (callback: () => void): (() => void) => {
    const handler = () => { preparedForUpdate = false; callback(); };
    ipcRenderer.on('device:cancelPreparation', handler);
    return () => ipcRenderer.removeListener('device:cancelPreparation', handler);
  },
  // Application updates
  getUpdateStatus: (): Promise<UpdateStatus> => invoke('updates:getStatus'),
  checkUpdates: (): Promise<UpdateStatus> => invoke('updates:check'),
  downloadUpdate: (): Promise<UpdateStatus> => invoke('updates:download'),
  setAutomaticUpdates: (automatic: boolean): Promise<UpdateStatus> => invoke('updates:setAutomatic', automatic),
  remindUpdateLater: (): Promise<UpdateStatus> => invoke('updates:remindLater'),
  openUpdateInstaller: (): Promise<UpdateStatus> => invoke('updates:openInstaller'),
  openUpdateReleasePage: (): Promise<void> => invoke('updates:openReleasePage'),
  replyUpdatePreparation: (reply: UpdatePreparationReply): Promise<void> => invoke('updates:prepared', reply),
  waitForPendingWork: async (lock = true): Promise<string | null> => {
    const failures = workFailures;
    const startedAt = Date.now();
    // Existing view autosaves debounce for at most 800ms. Require a further
    // quiet period after the last IPC reply before locking new operations.
    while (Date.now() - startedAt < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (workFailures !== failures) return 'A save did not complete. Review your changes before updating.';
      if (Date.now() - startedAt >= 1600 && pendingWork === 0 && Date.now() - lastWorkAt >= 1000) {
        preparedForUpdate = lock;
        return null;
      }
    }
    return 'A task is still running. Let it finish, then try opening the installer again.';
  },
  onShowUpdateSettings: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('updates:showSettings', handler);
    return () => ipcRenderer.removeListener('updates:showSettings', handler);
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: UpdateStatus) => callback(status);
    ipcRenderer.on('updates:status', handler);
    return () => ipcRenderer.removeListener('updates:status', handler);
  },
  onPrepareUpdate: (callback: (requestId: string) => void): (() => void) => {
    const handler = (_event: unknown, requestId: string) => { preparedForUpdate = false; callback(requestId); };
    ipcRenderer.on('updates:prepare', handler);
    return () => ipcRenderer.removeListener('updates:prepare', handler);
  },
  onCancelUpdatePreparation: (callback: () => void): (() => void) => {
    const handler = () => { preparedForUpdate = false; callback(); };
    ipcRenderer.on('updates:cancelPreparation', handler);
    return () => ipcRenderer.removeListener('updates:cancelPreparation', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronApi = typeof api;
