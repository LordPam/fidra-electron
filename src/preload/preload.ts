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
  UpdateInfo,
  UpdateDownloadProgress,
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

const api = {
  getDbPath: (): Promise<string> => ipcRenderer.invoke('app:getDbPath'),
  getAboutInfo: (): Promise<{ version: string; description: string; logPath: string }> =>
    ipcRenderer.invoke('app:getAboutInfo'),

  // Transactions
  getTransactions: (sheet?: string): Promise<TransactionRow[]> =>
    ipcRenderer.invoke('transactions:getAll', sheet),
  getTransaction: (id: string): Promise<TransactionRow | null> =>
    ipcRenderer.invoke('transactions:getById', id),
  saveTransaction: (data: TransactionRow): Promise<TransactionRow> =>
    ipcRenderer.invoke('transactions:save', data),
  deleteTransaction: (id: string): Promise<{ success: boolean; deletedAttachments: AttachmentRow[]; deletedCounterpart: TransactionRow | null; counterpartAttachments: AttachmentRow[] }> =>
    ipcRenderer.invoke('transactions:delete', id),
  saveTransfer: (expense: TransactionRow, income: TransactionRow): Promise<{ expense: TransactionRow; income: TransactionRow }> =>
    ipcRenderer.invoke('transactions:saveTransfer', expense, income),
  getTransactionsByLinkedId: (linkedId: string): Promise<TransactionRow[]> =>
    ipcRenderer.invoke('transactions:getByLinkedId', linkedId),
  bulkSaveTransactions: (transactions: TransactionRow[]): Promise<TransactionRow[]> =>
    ipcRenderer.invoke('transactions:bulkSave', transactions),
  bulkDeleteTransactions: (ids: string[]): Promise<{ count: number; deletedAttachments: Record<string, AttachmentRow[]> }> =>
    ipcRenderer.invoke('transactions:bulkDelete', ids),

  // Sheets
  getSheets: (): Promise<SheetRow[]> => ipcRenderer.invoke('sheets:getAll'),
  createSheet: (id: string, name: string): Promise<SheetRow> =>
    ipcRenderer.invoke('sheets:create', id, name),
  renameSheet: (oldName: string, newName: string): Promise<void> =>
    ipcRenderer.invoke('sheets:rename', oldName, newName),
  deleteSheet: (id: string, name: string, mergeTarget?: string): Promise<void> =>
    ipcRenderer.invoke('sheets:delete', id, name, mergeTarget),
  reorderSheets: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke('sheets:reorder', orderedIds),
  deleteSheetSimple: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('sheets:deleteSimple', id),
  restoreSheetWithSort: (sheet: SheetRow): Promise<SheetRow> =>
    ipcRenderer.invoke('sheets:restoreWithSort', sheet),
  getTransactionsOnSheet: (name: string): Promise<TransactionRow[]> =>
    ipcRenderer.invoke('sheets:getTransactionsOnSheet', name),
  getPlannedOnSheet: (name: string): Promise<PlannedTemplateRow[]> =>
    ipcRenderer.invoke('sheets:getPlannedOnSheet', name),
  getAttachmentsOnSheet: (name: string): Promise<AttachmentRow[]> =>
    ipcRenderer.invoke('sheets:getAttachmentsOnSheet', name),

  // Categories
  getCategories: (type: string): Promise<string[]> =>
    ipcRenderer.invoke('categories:getAll', type),
  setCategories: (type: string, names: string[]): Promise<void> =>
    ipcRenderer.invoke('categories:setAll', type, names),

  // Planned Templates
  getPlannedTemplates: (): Promise<PlannedTemplateRow[]> =>
    ipcRenderer.invoke('planned:getAll'),
  savePlannedTemplate: (data: PlannedTemplateRow): Promise<PlannedTemplateRow> =>
    ipcRenderer.invoke('planned:save', data),
  bulkSavePlannedTemplates: (templates: PlannedTemplateRow[]): Promise<PlannedTemplateRow[]> =>
    ipcRenderer.invoke('planned:bulkSave', templates),
  deletePlannedTemplate: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('planned:delete', id),

  // Activity Notes
  getActivityNotes: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('activityNotes:getAll'),
  saveActivityNote: (activity: string, notes: string): Promise<void> =>
    ipcRenderer.invoke('activityNotes:save', activity, notes),
  deleteActivityNote: (activity: string): Promise<void> =>
    ipcRenderer.invoke('activityNotes:delete', activity),

  // Attachments
  getAttachments: (transactionId: string): Promise<AttachmentRow[]> =>
    ipcRenderer.invoke('attachments:getForTransaction', transactionId),
  getAttachmentCounts: (transactionIds: string[]): Promise<Record<string, number>> =>
    ipcRenderer.invoke('attachments:getCounts', transactionIds),
  addAttachment: (transactionId: string, filePath: string, filename: string): Promise<AttachmentRow> =>
    ipcRenderer.invoke('attachments:add', transactionId, filePath, filename),
  removeAttachment: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('attachments:remove', id),
  openAttachment: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('attachments:open', id),
  restoreAttachment: (row: AttachmentRow): Promise<AttachmentRow> =>
    ipcRenderer.invoke('attachments:restore', row),
  restoreAttachmentsForTransaction: (rows: AttachmentRow[]): Promise<void> =>
    ipcRenderer.invoke('attachments:restoreForTransaction', rows),

  // File utilities
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // File dialogs
  showOpenDialog: (options: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): Promise<{ filePaths: string[]; canceled: boolean }> =>
    ipcRenderer.invoke('app:showOpenDialog', options),
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ filePath: string | undefined; canceled: boolean }> =>
    ipcRenderer.invoke('app:showSaveDialog', options),
  writeFile: (filePath: string, content: string, encoding?: string): Promise<void> =>
    ipcRenderer.invoke('app:writeFile', filePath, content, encoding),
  writeFileBinary: (filePath: string, data: number[]): Promise<void> =>
    ipcRenderer.invoke('app:writeFileBinary', filePath, data),
  printToPDF: (html: string, options?: { footerText?: string }): Promise<number[]> =>
    ipcRenderer.invoke('app:printToPDF', html, options),

  // Startup
  getStartupMode: (): Promise<{ mode: 'wizard' | 'restore' | 'chooser' }> =>
    ipcRenderer.invoke('app:getStartupMode'),
  markFirstRunComplete: (): Promise<void> =>
    ipcRenderer.invoke('app:markFirstRunComplete'),

  // Window management
  createWindow: (dbPath?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('window:create', dbPath),
  openFileDialog: (): Promise<{ filePath: string | null; canceled: boolean; error?: string }> =>
    ipcRenderer.invoke('window:openFileDialog'),
  createNewDb: (): Promise<{ filePath: string | null; canceled: boolean; error?: string }> =>
    ipcRenderer.invoke('window:createNewDb'),
  getRecentFiles: (): Promise<{ path: string; name: string; lastOpenedAt: string }[]> =>
    ipcRenderer.invoke('window:getRecentFiles'),
  openRecentFile: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('window:openRecent', filePath),
  removeRecentFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('window:removeRecent', filePath),
  getDbInfo: (): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('window:getDbInfo'),
  switchToFile: (dbPath: string): Promise<{ success: boolean; reloading: boolean; error?: string }> =>
    ipcRenderer.invoke('window:switchToFile', dbPath),

  // Invoices
  getInvoices: (): Promise<InvoiceRow[]> =>
    ipcRenderer.invoke('invoices:getAll'),
  getInvoicesByPlannedTemplate: (plannedTemplateId: string): Promise<InvoiceRow[]> =>
    ipcRenderer.invoke('invoices:getByPlannedTemplate', plannedTemplateId),
  saveInvoice: (data: InvoiceRow): Promise<InvoiceRow> =>
    ipcRenderer.invoke('invoices:save', data),
  deleteInvoice: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('invoices:delete', id),
  markInvoicePaid: (invoiceId: string, transactionId: string): Promise<InvoiceRow> =>
    ipcRenderer.invoke('invoices:markPaid', invoiceId, transactionId),
  revertInvoiceToDraft: (invoiceId: string): Promise<InvoiceRow> =>
    ipcRenderer.invoke('invoices:revertToDraft', invoiceId),
  readFileBase64: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('app:readFileBase64', filePath),

  // Per-database profile
  getProfile: (): Promise<{ name: string; initials: string }> =>
    ipcRenderer.invoke('settings:getProfile'),
  saveProfile: (profile: { name: string; initials: string }): Promise<void> =>
    ipcRenderer.invoke('settings:saveProfile', profile),
  getCurrentUser: (): Promise<{ displayName: string; source: 'auth' | 'profile' | 'none' } | null> =>
    ipcRenderer.invoke('settings:getCurrentUser'),
  getTransactionSettings: (): Promise<{ dateOnApprove: boolean; dateOnPlannedConversion: boolean }> =>
    ipcRenderer.invoke('settings:getTransactionSettings'),
  saveTransactionSettings: (settings: { dateOnApprove: boolean; dateOnPlannedConversion: boolean }): Promise<void> =>
    ipcRenderer.invoke('settings:saveTransactionSettings', settings),
  getFYStartMonth: (): Promise<number> =>
    ipcRenderer.invoke('settings:getFYStartMonth'),
  saveFYStartMonth: (month: number): Promise<void> =>
    ipcRenderer.invoke('settings:saveFYStartMonth', month),
  getOrgName: (): Promise<string> =>
    ipcRenderer.invoke('settings:getOrgName'),
  saveOrgName: (name: string): Promise<void> =>
    ipcRenderer.invoke('settings:saveOrgName', name),

  // Current sheet selection (per-database)
  getCurrentSheet: (): Promise<string> =>
    ipcRenderer.invoke('settings:getCurrentSheet'),
  saveCurrentSheet: (name: string): Promise<void> =>
    ipcRenderer.invoke('settings:saveCurrentSheet', name),

  // Invoice defaults (per-database)
  getInvoiceDefaults: (): Promise<InvoiceDefaults> =>
    ipcRenderer.invoke('settings:getInvoiceDefaults'),
  saveInvoiceDefaults: (defaults: InvoiceDefaults): Promise<void> =>
    ipcRenderer.invoke('settings:saveInvoiceDefaults', defaults),

  // UI preferences
  getUiPreferences: (): Promise<UiPreferences> =>
    ipcRenderer.invoke('settings:getUiPreferences'),
  saveUiPreferences: (prefs: UiPreferences): Promise<void> =>
    ipcRenderer.invoke('settings:saveUiPreferences', prefs),

  // Personnel
  getPersonnel: (): Promise<PersonnelRecord[]> =>
    ipcRenderer.invoke('personnel:getAll'),
  removePersonnel: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('personnel:remove', id),
  updatePersonnelRole: (id: string, role: PersonnelRole): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('personnel:updateRole', id, role),

  // Audit Log
  getAuditLog: (entityType?: string, limit?: number): Promise<AuditLogRow[]> =>
    ipcRenderer.invoke('audit:getAll', entityType, limit),
  getAuditForEntity: (entityId: string): Promise<AuditLogRow[]> =>
    ipcRenderer.invoke('audit:getForEntity', entityId),

  // Local Sync
  localSyncConfigure: (config: { syncFolder: string; passphrase: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('localSync:configure', config),
  localSyncGetConfig: (): Promise<LocalSyncConfig | null> =>
    ipcRenderer.invoke('localSync:getConfig'),
  localSyncReconnect: (data: { syncFolder: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('localSync:reconnect', data),
  localSyncDisconnect: (): Promise<void> =>
    ipcRenderer.invoke('localSync:disconnect'),
  localSyncGetStatus: (): Promise<LocalSyncStatus> =>
    ipcRenderer.invoke('localSync:getStatus'),
  localSyncExportNow: (): Promise<LocalSyncExportResult> =>
    ipcRenderer.invoke('localSync:exportNow'),
  localSyncImportNow: (): Promise<LocalSyncImportResult> =>
    ipcRenderer.invoke('localSync:importNow'),
  localSyncGetConflicts: (entityId?: string): Promise<LocalSyncConflict[]> =>
    ipcRenderer.invoke('localSync:getConflicts', entityId),
  localSyncResolveConflict: (conflictId: string, resolution: 'keep-local' | 'accept-remote' | 'manual'): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('localSync:resolveConflict', conflictId, resolution),
  localSyncCreateSnapshot: (): Promise<{ success: boolean; path?: string; changesetCount?: number; error?: string }> =>
    ipcRenderer.invoke('localSync:createSnapshot'),
  localSyncCompact: (): Promise<{ deletedCount: number }> =>
    ipcRenderer.invoke('localSync:compact'),
  localSyncJoinGroup: (opts: { syncFolder: string; passphrase: string; newDbPath: string }): Promise<MigrationResult> =>
    ipcRenderer.invoke('localSync:joinGroup', opts),
  localSyncRecoverAttachments: (): Promise<{ success: boolean; copiedCount?: number; exportedCount?: number; error?: string }> =>
    ipcRenderer.invoke('localSync:recoverAttachments'),
  localSyncJoinViaInvite: (opts: { syncFolder: string; email: string; inviteCode: string; password: string; newDbPath: string }): Promise<MigrationResult> =>
    ipcRenderer.invoke('localSync:joinViaInvite', opts),
  localSyncValidateFolder: (folderPath: string): Promise<SyncFolderValidation> =>
    ipcRenderer.invoke('localSync:validateFolder', folderPath),
  localSyncGetStartupSummary: (): Promise<ImportNotification | null> =>
    ipcRenderer.invoke('localSync:getStartupSummary'),

  // Local Auth
  localAuthSignIn: (data: { email: string; password: string }): Promise<{ success: boolean; isAdmin?: boolean; needsSyncFolder?: boolean; error?: string }> =>
    ipcRenderer.invoke('localAuth:signIn', data),
  localAuthCreateFirstAdmin: (data: { name: string; email: string; password: string; syncPassphrase: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('localAuth:createFirstAdmin', data),
  localAuthInviteMember: (data: { name: string; email: string; role: PersonnelRole }): Promise<{ success: boolean; inviteCode?: string; record?: PersonnelRecord; error?: string }> =>
    ipcRenderer.invoke('localAuth:inviteMember', data),
  localAuthChangePassword: (data: { oldPassword: string; newPassword: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('localAuth:changePassword', data),
  localAuthSignOut: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('localAuth:signOut'),
  localAuthGetStatus: (): Promise<LocalAuthStatus> =>
    ipcRenderer.invoke('localAuth:getAuthStatus'),

  // Backup
  backupCreate: (): Promise<BackupListItem> =>
    ipcRenderer.invoke('backup:create'),
  backupList: (): Promise<BackupListItem[]> =>
    ipcRenderer.invoke('backup:list'),
  backupRestore: (backupPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('backup:restore', backupPath),
  backupDelete: (backupPath: string): Promise<boolean> =>
    ipcRenderer.invoke('backup:delete', backupPath),
  backupGetSettings: (): Promise<BackupSettings> =>
    ipcRenderer.invoke('backup:getSettings'),
  backupSaveSettings: (settings: BackupSettings): Promise<void> =>
    ipcRenderer.invoke('backup:saveSettings', settings),

  // CSV Import
  csvImportParse: (request: CsvParseRequest): Promise<CsvParseResponse> =>
    ipcRenderer.invoke('csvImport:parse', request),
  csvImportAnalyze: (request: CsvAnalyzeRequest): Promise<CsvAnalyzeResponse> =>
    ipcRenderer.invoke('csvImport:analyze', request),
  csvImportCommit: (request: CsvCommitRequest): Promise<CsvImportResult> =>
    ipcRenderer.invoke('csvImport:commit', request),
  csvImportGetProfiles: (): Promise<CsvImportProfile[]> =>
    ipcRenderer.invoke('csvImport:getProfiles'),
  csvImportSaveProfile: (profile: CsvImportProfile): Promise<void> =>
    ipcRenderer.invoke('csvImport:saveProfile', profile),
  csvImportDeleteProfile: (profileId: string): Promise<void> =>
    ipcRenderer.invoke('csvImport:deleteProfile', profileId),
  csvImportTrainModel: (): Promise<void> =>
    ipcRenderer.invoke('csvImport:trainModel'),

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

  // Update
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('app:installUpdate'),
  quitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke('app:quitAndInstall'),
  openReleaseUrl: (): Promise<void> =>
    ipcRenderer.invoke('app:openReleaseUrl'),
  onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_event: unknown, info: UpdateInfo) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateUpToDate: (callback: (version: string) => void): (() => void) => {
    const handler = (_event: unknown, version: string) => callback(version);
    ipcRenderer.on('update:upToDate', handler);
    return () => ipcRenderer.removeListener('update:upToDate', handler);
  },
  onUpdateError: (callback: (message: string) => void): (() => void) => {
    const handler = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: UpdateDownloadProgress) => callback(progress);
    ipcRenderer.on('update:downloadProgress', handler);
    return () => ipcRenderer.removeListener('update:downloadProgress', handler);
  },
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_event: unknown, info: UpdateInfo) => callback(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateInstallFailed: (callback: (releaseUrl: string) => void): (() => void) => {
    const handler = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on('update:installFailed', handler);
    return () => ipcRenderer.removeListener('update:installFailed', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronApi = typeof api;
