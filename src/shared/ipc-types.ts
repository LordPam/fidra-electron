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

export interface CloudServerConfig {
  id: string;
  name: string;
  connectionString: string;
  poolMin: number;
  poolMax: number;
  storageUrl?: string;
  storageKey?: string;
  storageBucket?: string;
  createdAt: string;
  authMode?: import('./auth-types').AuthMode;
  projectUrl?: string;
  anonKey?: string;
}

export interface CloudStatus {
  connected: boolean;
  serverName?: string;
  connectionStatus?: 'connected' | 'reconnecting' | 'offline' | 'offline-authenticated';
  isSyncing?: boolean;
  pendingCount?: number;
  authSession?: import('./auth-types').AuthSession | null;
  authMode?: import('./auth-types').AuthMode | null;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localPayload: string;
  error: string;
}

// ─── Local Sync types ────────────────────────────────────────────────

export interface MigrationResult {
  success: boolean;
  newDbPath?: string;
  error?: string;
}

export interface LocalSyncConfig {
  syncFolder: string;
  deviceId: string;
  deviceName: string;
}

export type LocalSyncState = 'idle' | 'exporting' | 'importing' | 'error' | 'stopped';

export interface LocalSyncStatus {
  enabled: boolean;
  state: LocalSyncState;
  lastExportAt: string | null;
  lastImportAt: string | null;
  pendingConflicts: number;
  lastError: string | null;
  syncFolder: string | null;
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

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  releaseNotes: string | null;
  downloadUrl: string | null;
}

export interface UpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

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
    result: { success: boolean; deletedAttachments: AttachmentRow[] };
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

  // Cloud
  'cloud:getConfig': {
    args: [];
    result: CloudServerConfig | null;
  };
  'cloud:saveConfig': {
    args: [config: CloudServerConfig];
    result: void;
  };
  'cloud:deleteConfig': {
    args: [];
    result: void;
  };
  'cloud:testConnection': {
    args: [connectionString: string];
    result: { success: boolean; error?: string };
  };
  'cloud:connect': {
    args: [];
    result: { success: boolean; error?: string; authenticated?: boolean };
  };
  'cloud:disconnect': {
    args: [];
    result: void;
  };
  'cloud:getStatus': {
    args: [];
    result: CloudStatus;
  };

  // Sync
  'sync:now': {
    args: [];
    result: number;
  };
  'sync:getStatus': {
    args: [];
    result: { isSyncing: boolean; pendingCount: number; conflicts: SyncConflict[] };
  };
  'sync:resolveConflict': {
    args: [changeId: string, useLocal: boolean];
    result: void;
  };

  // Connection
  'connection:getStatus': {
    args: [];
    result: { status: 'connected' | 'reconnecting' | 'offline' };
  };
  'connection:reconnect': {
    args: [];
    result: { success: boolean };
  };

  // Startup
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
    args: [];
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
  'window:isCloudWindow': {
    args: [];
    result: boolean;
  };
  'window:getCloudServers': {
    args: [];
    result: CloudServerConfig[];
  };
  'window:saveCloudServer': {
    args: [config: CloudServerConfig];
    result: void;
  };
  'window:removeCloudServer': {
    args: [id: string];
    result: void;
  };
  'window:openCloudServer': {
    args: [serverId: string];
    result: { success: boolean; error?: string };
  };
  'window:switchToFile': {
    args: [dbPath: string];
    result: { success: boolean; reloading: boolean; error?: string };
  };
  'window:switchToCloudServer': {
    args: [serverId: string];
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

  // Per-database profile (local identity when not using cloud auth)
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

  // Invoice defaults (per-database, syncs to cloud)
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

  // Auth
  'auth:signIn': {
    args: [email: string, password: string];
    result: { success: boolean; error?: string };
  };
  'auth:signUp': {
    args: [email: string, password: string];
    result: { success: boolean; error?: string };
  };
  'auth:signOut': {
    args: [];
    result: void;
  };
  'auth:getSession': {
    args: [];
    result: import('./auth-types').AuthSession | null;
  };
  'auth:getOAuthUrl': {
    args: [provider: 'google' | 'azure'];
    result: { url: string } | { error: string };
  };
  'auth:oauthCallback': {
    args: [code: string];
    result: { success: boolean; error?: string };
  };
  'auth:adminFirstSetup': {
    args: [name: string, email: string, password: string];
    result: { success: boolean; error?: string };
  };

  // Personnel
  'personnel:getAll': {
    args: [];
    result: import('./auth-types').PersonnelRecord[];
  };
  'personnel:invite': {
    args: [name: string, email: string, role: import('./auth-types').PersonnelRole];
    result: import('./auth-types').PersonnelRecord;
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
    result: { success: boolean; inviteCode?: string; record?: import('./auth-types').PersonnelRecord; error?: string };
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
    args: [opts: { syncFolder: string; passphrase: string; newDbPath: string }];
    result: MigrationResult;
  };
  'localSync:joinViaInvite': {
    args: [opts: { syncFolder: string; email: string; inviteCode: string; password: string; newDbPath: string }];
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
  'localSync:migrateFromCloud': {
    args: [opts: { syncFolder: string; passphrase: string; newDbPath: string }];
    result: MigrationResult;
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

  // Update
  'app:installUpdate': {
    args: [];
    result: void;
  };
  'app:quitAndInstall': {
    args: [];
    result: void;
  };
}

export type IpcChannel = keyof IpcChannels;
