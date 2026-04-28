import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TransactionRepo } from '../repositories/transaction-repo';
import { PlannedRepo } from '../repositories/planned-repo';
import { SheetRepo } from '../repositories/sheet-repo';
import { CategoryRepo } from '../repositories/category-repo';
import { ActivityNotesRepo } from '../repositories/activity-notes-repo';
import { AttachmentRepo } from '../repositories/attachment-repo';
import { SettingsRepo } from '../database/settings-repo';
import { InvoiceRepo } from '../repositories/invoice-repo';
import { AuditRepo } from '../repositories/audit-repo';
import { PersonnelRepo } from '../repositories/personnel-repo';
import { LocalAuthService } from '../services/local-auth-service';
import { SyncQueue } from '../cloud/sync-queue';
import { RecentDeletes } from '../cloud/recent-deletes';
import {
  CachingTransactionRepo,
  CachingPlannedRepo,
  CachingSheetRepo,
  CachingCategoryRepo,
  CachingActivityNotesRepo,
  CachingAttachmentRepo,
  CachingInvoiceRepo,
  CachingAuditRepo,
} from '../cloud/caching-repos';
import { PgTransactionRepo } from '../cloud/repos/pg-transaction-repo';
import { PgPlannedRepo } from '../cloud/repos/pg-planned-repo';
import { PgSheetRepo } from '../cloud/repos/pg-sheet-repo';
import { PgCategoryRepo } from '../cloud/repos/pg-category-repo';
import { PgActivityNotesRepo } from '../cloud/repos/pg-activity-notes-repo';
import { PgAttachmentRepo } from '../cloud/repos/pg-attachment-repo';
import { PgInvoiceRepo } from '../cloud/repos/pg-invoice-repo';
import { PgAuditRepo } from '../cloud/repos/pg-audit-repo';
import { SupabaseTransactionRepo } from '../cloud/repos/supabase-transaction-repo';
import { SupabasePlannedRepo } from '../cloud/repos/supabase-planned-repo';
import { SupabaseSheetRepo } from '../cloud/repos/supabase-sheet-repo';
import { SupabaseCategoryRepo } from '../cloud/repos/supabase-category-repo';
import { SupabaseActivityNotesRepo } from '../cloud/repos/supabase-activity-notes-repo';
import { SupabaseAttachmentRepo } from '../cloud/repos/supabase-attachment-repo';
import { SupabaseInvoiceRepo } from '../cloud/repos/supabase-invoice-repo';
import { SupabaseAuditRepo } from '../cloud/repos/supabase-audit-repo';
import { SyncService } from '../cloud/sync-service';
import { ConnectionStateService } from '../cloud/connection-state';
import { ChangeListener } from '../cloud/change-listener';
import { SupabaseStorage, isStorageConfigured } from '../cloud/supabase-storage';
import { PgSettingsRepo } from '../cloud/repos/pg-settings-repo';
import { SupabaseSettingsRepo } from '../cloud/repos/supabase-settings-repo';
import type { CloudConnection } from '../cloud/cloud-connection';
import type { RepoSet } from '../cloud/repo-registry';
import type { CloudServerConfig, ImportNotification } from '../../shared/ipc-types';
import type { AuthSession, AuthMode, PersonnelRecord } from '../../shared/auth-types';
import type { SupabaseAuth } from '../cloud/auth/supabase-auth';
import type { SessionManager } from '../cloud/auth/session-manager';
import type { SyncOrchestrator } from '../sync/sync-orchestrator';
import { createBackup, getBackupSettings } from '../services/backup-service';

export class WindowContext {
  readonly dbPath: string;
  readonly databaseId: string;
  readonly sqlite: Database.Database;
  readonly window: BrowserWindow;
  readonly serverId: string | null;
  readonly isCloudWindow: boolean;

  private _closed = false;
  get isClosed(): boolean { return this._closed; }

  // Local repos (always available)
  readonly transactionRepo: TransactionRepo;
  readonly plannedRepo: PlannedRepo;
  readonly sheetRepo: SheetRepo;
  readonly categoryRepo: CategoryRepo;
  readonly activityNotesRepo: ActivityNotesRepo;
  readonly attachmentRepo: AttachmentRepo;
  readonly settingsRepo: SettingsRepo;
  readonly invoiceRepo: InvoiceRepo;
  readonly auditRepo: AuditRepo;
  readonly personnelRepo: PersonnelRepo;
  readonly localAuthService: LocalAuthService;

  // Active repos — either local or caching
  private _repos: RepoSet;

  // Cloud state (null when offline)
  cloudConnection: CloudConnection | null = null;
  syncQueue: SyncQueue | null = null;
  recentDeletes: RecentDeletes | null = null;
  syncService: SyncService | null = null;
  connectionState: ConnectionStateService | null = null;
  changeListener: ChangeListener | null = null;
  supabaseStorage: SupabaseStorage | null = null;

  // Cloud settings repos (for db_settings table sync)
  pgSettingsRepo: PgSettingsRepo | null = null;
  supabaseSettingsRepo: SupabaseSettingsRepo | null = null;

  // Auth state (null when not using auth)
  authMode: AuthMode | null = null;
  authSession: AuthSession | null = null;
  sessionManager: SessionManager | null = null;
  supabaseAuth: SupabaseAuth | null = null;
  supabaseDataClient: SupabaseClient | null = null;
  /** Explicit connectivity flag for member mode (PostgREST has no connection pool to monitor). */
  memberConnected = false;
  /** MemberConnectionState instance (syncs memberConnected to SyncService). */
  memberConnectionState: import('../cloud/connection-state').MemberConnectionState | null = null;
  /** Polling timer for remote changes in member mode (no LISTEN/NOTIFY). */
  memberPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Sentinel for in-flight poll promises — set `.cleared = true` on teardown. */
  _memberPollGeneration: { cleared: boolean } | null = null;

  // Caching repos (null when offline)
  private _cachingTx: CachingTransactionRepo | null = null;
  private _cachingPlanned: CachingPlannedRepo | null = null;
  private _cachingSheet: CachingSheetRepo | null = null;
  private _cachingCategory: CachingCategoryRepo | null = null;
  private _cachingActivityNotes: CachingActivityNotesRepo | null = null;
  private _cachingAttachment: CachingAttachmentRepo | null = null;
  private _cachingInvoice: CachingInvoiceRepo | null = null;
  private _cachingAudit: CachingAuditRepo | null = null;

  // Local Sync state (null when not using Local Sync)
  localSyncOrchestrator: SyncOrchestrator | null = null;

  // Local Sync auth state (set on sign-in, cleared on disconnect)
  localAuthPersonnel: PersonnelRecord | null = null;
  localSyncPassphrase: string | null = null;

  /** Stored startup import summary — held until the renderer retrieves it. */
  pendingStartupSummary: ImportNotification | null = null;

  /** Retention purge timer handle — cleared on close. */
  private _retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(win: BrowserWindow, dbPath: string, databaseId: string, sqlite: Database.Database, serverId?: string) {
    this.window = win;
    this.dbPath = dbPath;
    this.databaseId = databaseId;
    this.sqlite = sqlite;
    this.serverId = serverId ?? null;
    this.isCloudWindow = !!serverId;

    this.transactionRepo = new TransactionRepo(sqlite);
    this.plannedRepo = new PlannedRepo(sqlite);
    this.sheetRepo = new SheetRepo(sqlite);
    this.categoryRepo = new CategoryRepo(sqlite);
    this.activityNotesRepo = new ActivityNotesRepo(sqlite);
    this.attachmentRepo = new AttachmentRepo(sqlite);
    this.settingsRepo = new SettingsRepo(sqlite);
    this.invoiceRepo = new InvoiceRepo(sqlite);
    this.auditRepo = new AuditRepo(sqlite);
    this.personnelRepo = new PersonnelRepo(sqlite);
    this.localAuthService = new LocalAuthService(this.personnelRepo);

    // Purge audit entries older than 30 days on startup
    this.purgeAuditEntries();
    // Re-purge every 24 hours
    this._retentionTimer = setInterval(() => this.purgeAuditEntries(), 24 * 60 * 60 * 1000);

    this._repos = {
      transactions: this.transactionRepo,
      planned: this.plannedRepo,
      sheets: this.sheetRepo,
      categories: this.categoryRepo,
      activityNotes: this.activityNotesRepo,
      attachments: this.attachmentRepo,
      invoices: this.invoiceRepo,
    };
  }

  get repos(): RepoSet {
    return this._repos;
  }

  get activeAuditRepo(): AuditRepo | CachingAuditRepo {
    return this._cachingAudit ?? this.auditRepo;
  }

  get dbName(): string {
    return path.basename(this.dbPath);
  }

  activateCachingLayer(conn: CloudConnection, cloudConfig?: CloudServerConfig): SyncQueue {
    const queue = new SyncQueue(this.sqlite);
    queue.ensureTable();
    queue.recoverStuckProcessing();

    this.syncQueue = queue;
    const recentDeletes = new RecentDeletes();
    this.recentDeletes = recentDeletes;
    const getPersonnelId = () => this.getAuthenticatedPersonnelId();
    this._cachingTx = new CachingTransactionRepo(this.transactionRepo, new PgTransactionRepo(conn), queue, recentDeletes, getPersonnelId);
    this._cachingPlanned = new CachingPlannedRepo(this.plannedRepo, new PgPlannedRepo(conn), queue, recentDeletes);
    this._cachingSheet = new CachingSheetRepo(this.sheetRepo, new PgSheetRepo(conn), queue, this.sqlite, recentDeletes);
    this._cachingCategory = new CachingCategoryRepo(this.categoryRepo, new PgCategoryRepo(conn), queue);
    this._cachingActivityNotes = new CachingActivityNotesRepo(this.activityNotesRepo, new PgActivityNotesRepo(conn), queue, this.sqlite);
    this._cachingAttachment = new CachingAttachmentRepo(this.attachmentRepo, new PgAttachmentRepo(conn), queue, this.sqlite, recentDeletes);
    this._cachingInvoice = new CachingInvoiceRepo(this.invoiceRepo, new PgInvoiceRepo(conn), queue, recentDeletes);
    this._cachingAudit = new CachingAuditRepo(this.auditRepo, new PgAuditRepo(conn), queue);

    this._repos = {
      transactions: this._cachingTx,
      planned: this._cachingPlanned,
      sheets: this._cachingSheet,
      categories: this._cachingCategory,
      activityNotes: this._cachingActivityNotes,
      attachments: this._cachingAttachment,
      invoices: this._cachingInvoice,
    };

    this.pgSettingsRepo = new PgSettingsRepo(conn);

    // Initialize Supabase Storage if configured
    const config = cloudConfig ?? conn.config;
    if (config && isStorageConfigured(config)) {
      this.supabaseStorage = new SupabaseStorage(config);
    }

    console.log(`[WINDOW ${this.dbName}] Caching layer activated`);
    return queue;
  }

  activateCachingLayerMember(supabaseClient: SupabaseClient, cloudConfig?: CloudServerConfig): SyncQueue {
    const queue = new SyncQueue(this.sqlite);
    queue.ensureTable();
    queue.recoverStuckProcessing();

    this.syncQueue = queue;
    const recentDeletes = new RecentDeletes();
    this.recentDeletes = recentDeletes;
    this.supabaseDataClient = supabaseClient;

    const getPersonnelId = () => this.getAuthenticatedPersonnelId();
    this._cachingTx = new CachingTransactionRepo(this.transactionRepo, new SupabaseTransactionRepo(supabaseClient), queue, recentDeletes, getPersonnelId);
    this._cachingPlanned = new CachingPlannedRepo(this.plannedRepo, new SupabasePlannedRepo(supabaseClient), queue, recentDeletes);
    this._cachingSheet = new CachingSheetRepo(this.sheetRepo, new SupabaseSheetRepo(supabaseClient), queue, this.sqlite, recentDeletes);
    this._cachingCategory = new CachingCategoryRepo(this.categoryRepo, new SupabaseCategoryRepo(supabaseClient), queue);
    this._cachingActivityNotes = new CachingActivityNotesRepo(this.activityNotesRepo, new SupabaseActivityNotesRepo(supabaseClient), queue, this.sqlite);
    this._cachingAttachment = new CachingAttachmentRepo(this.attachmentRepo, new SupabaseAttachmentRepo(supabaseClient), queue, this.sqlite, recentDeletes);
    this._cachingInvoice = new CachingInvoiceRepo(this.invoiceRepo, new SupabaseInvoiceRepo(supabaseClient), queue, recentDeletes);
    this._cachingAudit = new CachingAuditRepo(this.auditRepo, new SupabaseAuditRepo(supabaseClient), queue);

    this._repos = {
      transactions: this._cachingTx,
      planned: this._cachingPlanned,
      sheets: this._cachingSheet,
      categories: this._cachingCategory,
      activityNotes: this._cachingActivityNotes,
      attachments: this._cachingAttachment,
      invoices: this._cachingInvoice,
    };

    this.supabaseSettingsRepo = new SupabaseSettingsRepo(supabaseClient);

    // Initialize Supabase Storage if configured
    if (cloudConfig && isStorageConfigured(cloudConfig)) {
      this.supabaseStorage = new SupabaseStorage(cloudConfig);
    }

    console.log(`[WINDOW ${this.dbName}] Member caching layer activated (Supabase PostgREST)`);
    return queue;
  }

  deactivateCachingLayer(): void {
    this.syncQueue = null;
    this.recentDeletes = null;
    this._cachingTx = null;
    this._cachingPlanned = null;
    this._cachingSheet = null;
    this._cachingCategory = null;
    this._cachingActivityNotes = null;
    this._cachingAttachment = null;
    this._cachingInvoice = null;
    this._cachingAudit = null;
    this.supabaseStorage = null;
    this.supabaseDataClient = null;
    this.pgSettingsRepo = null;
    this.supabaseSettingsRepo = null;

    this._repos = {
      transactions: this.transactionRepo,
      planned: this.plannedRepo,
      sheets: this.sheetRepo,
      categories: this.categoryRepo,
      activityNotes: this.activityNotesRepo,
      attachments: this.attachmentRepo,
      invoices: this.invoiceRepo,
    };

    console.log(`[WINDOW ${this.dbName}] Caching layer deactivated`);
  }

  getCachingRepos() {
    return {
      transactions: this._cachingTx,
      planned: this._cachingPlanned,
      sheets: this._cachingSheet,
      categories: this._cachingCategory,
      activityNotes: this._cachingActivityNotes,
      attachments: this._cachingAttachment,
      invoices: this._cachingInvoice,
      audit: this._cachingAudit,
    };
  }

  getAuthenticatedPersonnelId(): string | null {
    return this.authSession?.user?.personnelId ?? null;
  }

  private purgeAuditEntries(): void {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const localPurged = this.auditRepo.purgeOlderThan(cutoff);
      if (localPurged > 0) {
        console.log(`[WINDOW ${this.dbName}] Purged ${localPurged} old audit entries`);
      }
      // Also purge cloud if caching layer is active
      this._cachingAudit?.purgeCloud(cutoff).catch((e) => {
        console.warn('[audit] Failed to purge cloud audit entries:', e);
      });
    } catch (e) {
      console.warn('[audit] Failed to purge local audit entries:', e);
    }
  }

  sendToRenderer(channel: string, ...args: unknown[]): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }

  get isLocalSyncAuthEnabled(): boolean {
    // Auth is only relevant when Local Sync is actually configured.
    // Personnel records may linger after disconnect — don't show the auth gate
    // if there's no sync folder.
    return this.localAuthService.hasAuthPersonnel()
      && this.settingsRepo.getSetting('localSync.syncFolder') != null;
  }

  stopLocalSyncServices(): void {
    if (this.localSyncOrchestrator) {
      this.localSyncOrchestrator.stop();
      this.localSyncOrchestrator = null;
      console.log(`[WINDOW ${this.dbName}] Local Sync services stopped`);
    }
    this.localAuthPersonnel = null;
    this.localSyncPassphrase = null;
  }

  async stopCloudServices(): Promise<void> {
    if (this.sessionManager) {
      this.sessionManager.stop();
      this.sessionManager = null;
    }
    if (this.changeListener) {
      await this.changeListener.stop().catch(() => {});
      this.changeListener = null;
    }
    if (this.syncService) {
      this.syncService.stop();
      this.syncService = null;
    }
    if (this.connectionState) {
      this.connectionState.stopMonitoring();
      this.connectionState = null;
    }
    if (this.memberPollTimer) {
      clearInterval(this.memberPollTimer);
      this.memberPollTimer = null;
    }
    if (this._memberPollGeneration) {
      this._memberPollGeneration.cleared = true;
      this._memberPollGeneration = null;
    }
    this.memberConnectionState = null;
    this.supabaseAuth = null;
    this.authSession = null;
    this.authMode = null;
    this.memberConnected = false;
    console.log(`[WINDOW ${this.dbName}] Cloud services stopped`);
  }

  async close(): Promise<void> {
    this._closed = true;
    if (this._retentionTimer) {
      clearInterval(this._retentionTimer);
      this._retentionTimer = null;
    }
    this.stopLocalSyncServices();
    await this.stopCloudServices();
    this.deactivateCachingLayer();
    if (this.cloudConnection) {
      await this.cloudConnection.close();
      this.cloudConnection = null;
    }
    // Auto-backup before closing the database
    try {
      const backupSettings = getBackupSettings(this.settingsRepo);
      if (backupSettings.autoBackupOnClose) {
        await createBackup(this.sqlite, this.dbPath, this.databaseId, 'auto-close', backupSettings);
      }
    } catch { /* never block shutdown */ }
    this.sqlite.close();
    console.log(`[WINDOW ${this.dbName}] Closed`);
  }
}
