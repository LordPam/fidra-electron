export interface TransactionRow {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: 'income' | 'expense';
  status: '--' | 'pending' | 'approved' | 'rejected' | 'planned';
  sheet: string;
  category: string | null;
  party: string | null;
  reference: string | null;
  activity: string | null;
  notes: string | null;
  linked_id: string | null;
  version: number;
  created_at: string;
  modified_at: string | null;
  modified_by: string | null;
}

export interface SheetRow {
  id: string;
  name: string;
  is_virtual: number;
  is_planned: number;
  sort_order: number;
  created_at: string;
}

export interface PlannedTemplateRow {
  id: string;
  start_date: string;
  description: string;
  amount: string;
  type: 'income' | 'expense';
  frequency: 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  target_sheet: string;
  category: string | null;
  party: string | null;
  activity: string | null;
  notes: string | null;
  end_date: string | null;
  occurrence_count: number | null;
  skipped_dates: string;
  fulfilled_dates: string;
  transfer_target_sheet: string | null;
  version: number;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  transaction_id: string;
  filename: string;
  stored_name: string;
  mime_type: string | null;
  file_size: number;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  date: string;
  due_date: string;
  from_name: string;
  from_address: string | null;
  to_name: string;
  to_address: string | null;
  line_items: string;            // JSON array of {description, quantity, unitPrice}
  subtotal: string;              // decimal as string
  notes: string | null;
  bank_details: string | null;
  planned_template_id: string | null;
  status: 'draft' | 'sent' | 'paid';
  transaction_id: string | null;
  paid_at: string | null;
  planned_template_snapshot: string | null;
  version: number;
  created_at: string;
  modified_at: string | null;
  modified_by: string | null;
}

export interface InvoiceDefaults {
  fromName: string;
  fromAddress: string;
  bankDetails: string;
  notes: string;
  logoPath: string;            // device-local file path (not synced)
  logoData: string;            // base64 data URI (synced via Local Sync)
  counter: string;             // JSON: { date: "YYYYMMDD", count: number }
  accentMode: 'fidra' | 'black' | 'logo';
}

export interface InvoicePrefill {
  toName: string;
  description: string;
  amount: number;
  date?: string;
  plannedTemplateId?: string;
}

// ─── Local Sync types ────────────────────────────────────────────────

export interface MigrationResult {
  success: boolean;
  newDbPath?: string;
  error?: string;
  retryable?: boolean;
}

export interface LocalSyncConfig {
  syncFolder: string;
  deviceId: string;
  deviceName: string;
}

export type LocalSyncState = 'idle' | 'exporting' | 'importing' | 'error' | 'stopped' | 'stale';

export interface LocalSyncStatus {
  enabled: boolean;
  state: LocalSyncState;
  lastExportAt: string | null;
  lastImportAt: string | null;
  pendingConflicts: number;
  lastError: string | null;
  syncFolder: string | null;
  staleReason: string | null;
}

export interface LocalSyncConflict {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  local_value: string | null;
  remote_value: string | null;
  local_site_id: string;
  remote_site_id: string;
  local_version: number;
  remote_version: number;
  bundle_id: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export type SyncFolderValidation =
  | { valid: true; warning?: undefined; message?: undefined }
  | { valid: false; reason: string; message: string }
  | { valid: true; warning: string; message: string };

export interface LocalSyncExportResult {
  bundleId: string | null;
  changesetCount: number;
  attachmentCount: number;
}

export interface LocalSyncImportResult {
  bundlesProcessed: number;
  changesetsApplied: number;
  conflictsQueued: number;
  bundlesSkipped: number;
  attachmentsImported: number;
}

// ─── Sync notification types ─────────────────────────────────────────

export interface ImportChangeDetail {
  action: 'created' | 'updated' | 'deleted';
  label: string;
}

export interface ImportChangeSummary {
  created: number;
  updated: number;
  deleted: number;
  details?: ImportChangeDetail[];
}

export interface ImportPersonSummary {
  personName: string;
  deviceId: string;
  changes: Record<string, ImportChangeSummary>;
}

export interface ImportNotification {
  summaries: ImportPersonSummary[];
  isStartupCatchup: boolean;
}

// ─── Update types ───────────────────────────────────────────────────

// ─── Backup types ───────────────────────────────────────────────────

export interface BackupMetadata {
  id: string;
  createdAt: string;
  dbName: string;
  dbSize: number;
  attachmentsCount: number;
  attachmentsSize: number;
  trigger: 'manual' | 'auto-close' | 'pre-restore';
}

export interface BackupListItem {
  path: string;
  metadata: BackupMetadata;
}

export interface BackupSettings {
  backupDir: string | null;
  retentionCount: number;
  autoBackupOnClose: boolean;
}

export interface AuditLogRow {
  id: string;
  timestamp: string;
  action: 'create' | 'update' | 'delete';
  entity_type: string;
  entity_id: string;
  user: string;
  summary: string;
  details: string | null;
}

export interface IpcChannels {
  'app:getDbPath': {
    args: [];
    result: string;
  };
  'app:getAboutInfo': {
    args: [];
    result: { version: string; description: string; logPath: string };
  };

  // Transactions
  'transactions:getAll': {
    args: [sheet?: string];
    result: TransactionRow[];
  };
  'transactions:getById': {
    args: [id: string];
    result: TransactionRow | null;
  };
  'transactions:save': {
    args: [data: TransactionRow];
    result: TransactionRow;
  };
  'transactions:delete': {
    args: [id: string];
    result: { success: boolean; deletedAttachments: AttachmentRow[]; deletedCounterpart: TransactionRow | null; counterpartAttachments: AttachmentRow[] };
  };
  'transactions:saveTransfer': {
    args: [expense: TransactionRow, income: TransactionRow];
    result: { expense: TransactionRow; income: TransactionRow };
  };
  'transactions:getByLinkedId': {
    args: [linkedId: string];
    result: TransactionRow[];
  };
  'transactions:bulkSave': {
    args: [transactions: TransactionRow[]];
    result: TransactionRow[];
  };
  'transactions:bulkDelete': {
    args: [ids: string[]];
    result: { count: number; deletedAttachments: Record<string, AttachmentRow[]> };
  };

  // Sheets
  'sheets:getAll': {
    args: [];
    result: SheetRow[];
  };
  'sheets:create': {
    args: [id: string, name: string];
    result: SheetRow;
  };
  'sheets:rename': {
    args: [oldName: string, newName: string];
    result: void;
  };
  'sheets:delete': {
    args: [id: string, name: string, mergeTarget?: string];
    result: void;
  };
  'sheets:reorder': {
    args: [orderedIds: string[]];
    result: void;
  };
  'sheets:deleteSimple': {
    args: [id: string];
    result: boolean;
  };
  'sheets:restoreWithSort': {
    args: [sheet: SheetRow];
    result: SheetRow;
  };
  'sheets:getTransactionsOnSheet': {
    args: [name: string];
    result: TransactionRow[];
  };
  'sheets:getPlannedOnSheet': {
    args: [name: string];
    result: PlannedTemplateRow[];
  };
  'sheets:getAttachmentsOnSheet': {
    args: [name: string];
    result: AttachmentRow[];
  };

  // Categories
  'categories:getAll': {
    args: [type: string];
    result: string[];
  };
  'categories:setAll': {
    args: [type: string, names: string[]];
    result: void;
  };

  // Planned Templates
  'planned:getAll': {
    args: [];
    result: PlannedTemplateRow[];
  };
  'planned:save': {
    args: [data: PlannedTemplateRow];
    result: PlannedTemplateRow;
  };
  'planned:bulkSave': {
    args: [templates: PlannedTemplateRow[]];
    result: PlannedTemplateRow[];
  };
  'planned:delete': {
    args: [id: string];
    result: boolean;
  };

  // Activity Notes
  'activityNotes:getAll': {
    args: [];
    result: Record<string, string>;
  };
  'activityNotes:save': {
    args: [activity: string, notes: string];
    result: void;
  };
  'activityNotes:delete': {
    args: [activity: string];
    result: void;
  };

  // Attachments
  'attachments:getForTransaction': {
    args: [transactionId: string];
    result: AttachmentRow[];
  };
  'attachments:getCounts': {
    args: [transactionIds: string[]];
    result: Record<string, number>;
  };
  'attachments:add': {
    args: [transactionId: string, filePath: string, filename: string];
    result: AttachmentRow;
  };
  'attachments:remove': {
    args: [id: string];
    result: boolean;
  };
  'attachments:open': {
    args: [id: string];
    result: boolean;
  };
  'attachments:restore': {
    args: [row: AttachmentRow];
    result: AttachmentRow;
  };
  'attachments:restoreForTransaction': {
    args: [rows: AttachmentRow[]];
    result: void;
  };

  // PDF generation
  'app:printToPDF': {
    args: [html: string, options?: { footerText?: string }];
    result: number[];
  };

  // App - File dialogs (OS-level operations, not per-database)
  'app:showOpenDialog': {
    args: [options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }];
    result: { filePaths: string[]; canceled: boolean };
  };
  'app:showSaveDialog': {
    args: [options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }];
    result: { filePath: string | undefined; canceled: boolean };
  };
  'app:writeFile': {
    args: [filePath: string, content: string, encoding?: string];
    result: void;
  };
  'app:writeFileBinary': {
    args: [filePath: string, data: number[]];
    result: void;
  };

  // Startup
  'ai:getState': { args: []; result: import('./ai-bridge-types').AiBridgeState };
  'ai:approveAccess': { args: [{ requestId: string; policy: import('./ai-access-types').AiAccessPolicy }]; result: void };
  'ai:denyAccess': { args: [string]; result: void };
  'ai:revokeAccess': { args: [string]; result: void };
  'ai:unlockOwner': { args: [{ name: string; password: string }]; result: void };
  'ai:discard': { args: [string]; result: void };
  'ai:approve': { args: [import('./reconciliation-types').ReconciliationApproval]; result: import('./reconciliation-types').ReconciliationCommit };
  'ai:undo': { args: [string]; result: void };
  'invitation:open': { args: []; result: { invitation: import('./invitation-types').FidraInvitation; syncFolder: string | null } | null };
  'invitation:save': { args: [import('./invitation-types').FidraInvitation]; result: boolean };
  'device:getInfo': { args: []; result: import('./device-types').DeviceDataInfo };
  'device:showFinancialFiles': { args: []; result: void };
  'device:reset': { args: [{ confirmed: true; action?: 'reset' | 'uninstall' }]; result: import('./device-types').DeviceActionResult };
  'device:prepared': { args: [import('./update-types').UpdatePreparationReply]; result: void };
  'app:getStartupMode': {
    args: [];
    result: { mode: 'wizard' | 'restore' | 'chooser' };
  };
  'app:markFirstRunComplete': {
    args: [];
    result: void;
  };

  // Window management
  'window:create': {
    args: [dbPath?: string];
    result: { success: boolean; error?: string };
  };
  'window:openFileDialog': {
    args: [];
    result: { filePath: string | null; canceled: boolean; error?: string };
  };
  'window:createNewDb': {
    args: [options?: { chooseLocation: boolean }];
    result: { filePath: string | null; canceled: boolean; error?: string };
  };
  'window:getRecentFiles': {
    args: [];
    result: import('./global-settings-types').RecentFileEntry[];
  };
  'window:openRecent': {
    args: [path: string];
    result: { success: boolean; error?: string };
  };
  'window:removeRecent': {
    args: [path: string];
    result: void;
  };
  'window:getDbInfo': {
    args: [];
    result: { path: string; name: string };
  };
  'window:switchToFile': {
    args: [dbPath: string];
    result: { success: boolean; reloading: boolean; error?: string };
  };

  // Invoices
  'invoices:getAll': {
    args: [];
    result: InvoiceRow[];
  };
  'invoices:getByPlannedTemplate': {
    args: [plannedTemplateId: string];
    result: InvoiceRow[];
  };
  'invoices:save': {
    args: [data: InvoiceRow];
    result: InvoiceRow;
  };
  'invoices:delete': {
    args: [id: string];
    result: boolean;
  };
  'invoices:markPaid': {
    args: [invoiceId: string, transactionId: string];
    result: InvoiceRow;
  };
  'invoices:revertToDraft': {
    args: [invoiceId: string];
    result: InvoiceRow;
  };

  // File reading (for custom logo)
  'app:readFileBase64': {
    args: [filePath: string];
    result: string;
  };

  // Per-database profile (local identity when Local Sync auth is not in use)
  'settings:getProfile': {
    args: [];
    result: { name: string; initials: string };
  };
  'settings:saveProfile': {
    args: [profile: { name: string; initials: string }];
    result: void;
  };
  'settings:getTransactionSettings': {
    args: [];
    result: { dateOnApprove: boolean; dateOnPlannedConversion: boolean };
  };
  'settings:saveTransactionSettings': {
    args: [settings: { dateOnApprove: boolean; dateOnPlannedConversion: boolean }];
    result: void;
  };
  'settings:getCurrentUser': {
    args: [];
    result: { displayName: string; source: 'auth' | 'profile' | 'none' } | null;
  };
  'settings:getFYStartMonth': {
    args: [];
    result: number;
  };
  'settings:saveFYStartMonth': {
    args: [month: number];
    result: void;
  };

  // Organisation name (per-database, org-scoped — syncs via Local Sync)
  'settings:getOrgName': {
    args: [];
    result: string;
  };
  'settings:saveOrgName': {
    args: [name: string];
    result: void;
  };

  // Invoice defaults (per-database)
  'settings:getInvoiceDefaults': {
    args: [];
    result: InvoiceDefaults;
  };
  'settings:saveInvoiceDefaults': {
    args: [defaults: InvoiceDefaults];
    result: void;
  };

  // UI preferences
  'settings:getUiPreferences': {
    args: [];
    result: import('./global-settings-types').UiPreferences;
  };
  'settings:saveUiPreferences': {
    args: [prefs: import('./global-settings-types').UiPreferences];
    result: void;
  };

  // Personnel
  'personnel:getAll': {
    args: [];
    result: import('./auth-types').PersonnelRecord[];
  };
  'personnel:remove': {
    args: [id: string];
    result: { success: boolean; error?: string };
  };
  'personnel:updateRole': {
    args: [id: string, role: import('./auth-types').PersonnelRole];
    result: { success: boolean; error?: string };
  };

  // Audit Log
  'audit:getAll': {
    args: [entityType?: string, limit?: number];
    result: AuditLogRow[];
  };
  'audit:getForEntity': {
    args: [entityId: string];
    result: AuditLogRow[];
  };

  // Local Sync
  'localSync:configure': {
    args: [config: { syncFolder: string; passphrase: string }];
    result: { success: boolean; error?: string };
  };
  'localSync:getConfig': {
    args: [];
    result: LocalSyncConfig | null;
  };
  'localSync:disconnect': {
    args: [];
    result: void;
  };
  'localSync:getStatus': {
    args: [];
    result: LocalSyncStatus;
  };
  'localSync:exportNow': {
    args: [];
    result: LocalSyncExportResult;
  };
  'localSync:importNow': {
    args: [];
    result: LocalSyncImportResult;
  };
  'localSync:getConflicts': {
    args: [entityId?: string];
    result: LocalSyncConflict[];
  };
  'localSync:resolveConflict': {
    args: [conflictId: string, resolution: 'keep-local' | 'accept-remote' | 'manual'];
    result: { success: boolean };
  };
  'localSync:createSnapshot': {
    args: [];
    result: { success: boolean; path?: string; changesetCount?: number; error?: string };
  };
  'localSync:compact': {
    args: [];
    result: { deletedCount: number };
  };
  // Backup
  'backup:create': {
    args: [];
    result: BackupListItem;
  };
  'backup:list': {
    args: [];
    result: BackupListItem[];
  };
  'backup:restore': {
    args: [backupPath: string];
    result: { success: boolean; error?: string };
  };
  'backup:delete': {
    args: [backupPath: string];
    result: boolean;
  };
  'backup:getSettings': {
    args: [];
    result: BackupSettings;
  };
  'backup:saveSettings': {
    args: [settings: BackupSettings];
    result: void;
  };

  // Local Auth
  'localAuth:signIn': {
    args: [data: { email: string; password: string }];
    result: { success: boolean; isAdmin?: boolean; error?: string };
  };
  'localAuth:createFirstAdmin': {
    args: [data: { name: string; email: string; password: string; syncPassphrase: string }];
    result: { success: boolean; error?: string };
  };
  'localAuth:inviteMember': {
    args: [data: { name: string; email: string; role: import('./auth-types').PersonnelRole }];
    result: { success: boolean; invitation?: import('./invitation-types').FidraInvitation; inviteCode?: string; record?: import('./auth-types').PersonnelRecord; error?: string };
  };
  'localAuth:changePassword': {
    args: [data: { oldPassword: string; newPassword: string }];
    result: { success: boolean; error?: string };
  };
  'localAuth:getAuthStatus': {
    args: [];
    result: import('./auth-types').LocalAuthStatus;
  };
  'localAuth:signOut': {
    args: [];
    result: { success: boolean };
  };

  'localSync:joinGroup': {
    args: [opts: { syncFolder: string; passphrase: string; newDbPath?: string }];
    result: MigrationResult;
  };
  'localSync:joinViaInvite': {
    args: [opts: { syncFolder: string; email: string; inviteCode: string; password: string; newDbPath?: string }];
    result: MigrationResult;
  };
  'localSync:validateFolder': {
    args: [folderPath: string];
    result: SyncFolderValidation;
  };
  'localSync:recoverAttachments': {
    args: [];
    result: { success: boolean; copiedCount?: number; exportedCount?: number; error?: string };
  };
  // CSV Import
  'csvImport:parse': {
    args: [request: import('./csv-import-types').CsvParseRequest];
    result: import('./csv-import-types').CsvParseResponse;
  };
  'csvImport:analyze': {
    args: [request: import('./csv-import-types').CsvAnalyzeRequest];
    result: import('./csv-import-types').CsvAnalyzeResponse;
  };
  'csvImport:commit': {
    args: [request: import('./csv-import-types').CsvCommitRequest];
    result: import('./csv-import-types').CsvImportResult;
  };
  'csvImport:getProfiles': {
    args: [];
    result: import('./csv-import-types').CsvImportProfile[];
  };
  'csvImport:saveProfile': {
    args: [profile: import('./csv-import-types').CsvImportProfile];
    result: void;
  };
  'csvImport:deleteProfile': {
    args: [profileId: string];
    result: void;
  };
  'csvImport:trainModel': {
    args: [];
    result: void;
  };

  // Application updates are process-wide and never access ledger rows.
  'updates:getStatus': { args: []; result: import('./update-types').UpdateStatus };
  'updates:check': { args: []; result: import('./update-types').UpdateStatus };
  'updates:download': { args: []; result: import('./update-types').UpdateStatus };
  'updates:setAutomatic': { args: [automatic: boolean]; result: import('./update-types').UpdateStatus };
  'updates:remindLater': { args: []; result: import('./update-types').UpdateStatus };
  'updates:openInstaller': { args: []; result: import('./update-types').UpdateStatus };
  'updates:openReleasePage': { args: []; result: void };
  'updates:prepared': { args: [reply: import('./update-types').UpdatePreparationReply]; result: void };
}

export type IpcChannel = keyof IpcChannels;
