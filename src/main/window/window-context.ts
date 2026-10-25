import path from 'node:path';
import { ReconciliationService } from '../services/reconciliation';
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
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
import { SessionStore, dbPathToSessionId } from '../services/session-store';
import type { RepoSet } from '../repositories/repo-set';
import type { ImportNotification } from '../../shared/ipc-types';
import type { AuthSession, AuthMode, PersonnelRecord } from '../../shared/auth-types';
import type { SyncOrchestrator } from '../sync/sync-orchestrator';
import { createBackup, getBackupSettings } from '../services/backup-service';
import { releaseDbLock } from '../database/db-lock';
import { describeOrphans, findOrphans, isEmptyOrphanReport } from '../services/referential-integrity';

export class WindowContext {
  readonly dbPath: string;
  readonly databaseId: string;
  readonly sqlite: Database.Database;
  readonly reconciliation: ReconciliationService;
  readonly window: BrowserWindow;

  temporaryDirectory: string | null = null;
  startupMode: 'wizard' | 'chooser' | 'restore' = 'restore';
  private _closed = false;
  get isClosed(): boolean { return this._closed; }

  // Local repos
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

  private readonly _repos: RepoSet;

  // Auth state (null when not using auth)
  authMode: AuthMode | null = null;
  authSession: AuthSession | null = null;

  // Local Sync state (null when not using Local Sync)
  localSyncOrchestrator: SyncOrchestrator | null = null;

  // Local Sync auth state (set on sign-in, cleared on disconnect)
  localAuthPersonnel: PersonnelRecord | null = null;
  localSyncPassphrase: string | null = null;

  /** Stored startup import summary — held until the renderer retrieves it. */
  pendingStartupSummary: ImportNotification | null = null;

  /** Retention purge timer handle — cleared on close. */
  private _retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(win: BrowserWindow, dbPath: string, databaseId: string, sqlite: Database.Database) {
    this.window = win;
    this.dbPath = dbPath;
    this.databaseId = databaseId;
    this.sqlite = sqlite;
    this.reconciliation = new ReconciliationService(sqlite);

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
    this.reportOrphans();
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

  get dbName(): string {
    return path.basename(this.dbPath);
  }

  getAuthenticatedPersonnelId(): string | null {
    return this.authSession?.user?.personnelId ?? null;
  }

  private purgeAuditEntries(): void {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const purged = this.auditRepo.purgeOlderThan(cutoff);
      if (purged > 0) {
        console.log(`[WINDOW ${this.dbName}] Purged ${purged} old audit entries`);
      }
    } catch (e) {
      console.warn('[audit] Failed to purge local audit entries:', e);
    }
  }

  /**
   * Log rows left pointing at something that no longer exists.
   *
   * Reporting only. Sweeping them would be a CRDT delete that propagates to every
   * peer, and on a synced database an "orphan" may just be a row whose parent has
   * not arrived yet — see `findOrphans`.
   */
  private reportOrphans(): void {
    try {
      const report = findOrphans(this.sqlite);
      if (isEmptyOrphanReport(report)) return;
      for (const line of describeOrphans(report)) {
        console.warn(`[integrity ${this.dbName}] ${line}`);
      }
    } catch (e) {
      console.warn('[integrity] Failed to check for orphaned rows:', e);
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

  /**
   * After a sync import that touches the `personnel` table, verify the
   * signed-in user's record still exists. If the admin deleted this user,
   * force sign-out so the member doesn't remain in a ghost state.
   */
  checkPersonnelSurvival(changedTables: string[]): void {
    if (!this.localAuthPersonnel) return;
    if (!changedTables.includes('personnel')) return;

    const person = this.personnelRepo.getByEmail(this.localAuthPersonnel.email);
    if (person && person.password_hash) return; // still valid

    console.log(`[WINDOW ${this.dbName}] Signed-in personnel deleted by sync — forcing sign-out`);
    this.stopLocalSyncServices();
    this.authMode = null;
    this.authSession = null;

    // Delete persisted session so restart also shows sign-in
    try {
      const store = new SessionStore();
      store.deleteSession(dbPathToSessionId(this.dbPath));
    } catch { /* non-fatal */ }

    this.sendToRenderer('localSync:forceSignOut', {});
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

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    if (this._retentionTimer) {
      clearInterval(this._retentionTimer);
      this._retentionTimer = null;
    }
    this.stopLocalSyncServices();
    this.authMode = null;
    this.authSession = null;
    // Release advisory lock before closing the database
    releaseDbLock(this.dbPath);
    // Auto-backup before closing the database
    try {
      const backupSettings = getBackupSettings(this.settingsRepo);
      if (backupSettings.autoBackupOnClose) {
        await createBackup(this.sqlite, this.dbPath, this.databaseId, 'auto-close', backupSettings);
      }
    } catch { /* never block shutdown */ }
    this.sqlite.close();
    if (this.temporaryDirectory) fs.rmSync(this.temporaryDirectory, { recursive: true, force: true });
    console.log(`[WINDOW ${this.dbName}] Closed`);
  }
}
