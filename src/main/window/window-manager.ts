import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { openDatabase } from '../database/connection';
import { WindowContext } from './window-context';
import { CloudConnection } from '../cloud/cloud-connection';
import { runMigrations } from '../cloud/migration-runner';
import { startMemberServices, setupMemberSessionHandler } from '../cloud/member-services';
import { SupabaseAuth } from '../cloud/auth/supabase-auth';
import { SessionStore, dbPathToSessionId } from '../cloud/auth/session-store';
import { SessionManager } from '../cloud/auth/session-manager';
import { createClient } from '@supabase/supabase-js';
import { addRecentFile, getCloudServer, getCloudCachePath, ensureCloudCacheDir } from './global-settings';
import { Notification } from 'electron';
import { initializeCrr } from '../sync/crr-schema';
import { initializeDeviceIdentity } from '../sync/device-identity';
import { SyncOrchestrator } from '../sync/sync-orchestrator';
import type { LocalSyncStatus, ImportNotification } from '../../shared/ipc-types';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export class WindowManager {
  private readonly contexts = new Map<number, WindowContext>();
  private readonly dbPathIndex = new Map<string, number>();
  private readonly serverIdIndex = new Map<string, number>();
  private readonly startupCompleted = new Set<number>();

  /** Mark a webContents ID as having completed startup (skip file chooser on reload). */
  markStartupComplete(wcId: number): void {
    this.startupCompleted.add(wcId);
  }

  isStartupComplete(wcId: number): boolean {
    return this.startupCompleted.has(wcId);
  }

  getContext(webContentsId: number): WindowContext | undefined {
    return this.contexts.get(webContentsId);
  }

  isFileOpen(dbPath: string): boolean {
    const normalized = path.resolve(dbPath);
    return this.dbPathIndex.has(normalized);
  }

  isServerOpen(serverId: string): boolean {
    return this.serverIdIndex.has(serverId);
  }

  focusWindowForServer(serverId: string): boolean {
    const wcId = this.serverIdIndex.get(serverId);
    if (wcId === undefined) return false;
    const ctx = this.contexts.get(wcId);
    if (!ctx || ctx.window.isDestroyed()) return false;
    ctx.window.focus();
    return true;
  }

  focusWindowForFile(dbPath: string): boolean {
    const normalized = path.resolve(dbPath);
    const wcId = this.dbPathIndex.get(normalized);
    if (wcId === undefined) return false;
    const ctx = this.contexts.get(wcId);
    if (!ctx || ctx.window.isDestroyed()) return false;
    ctx.window.focus();
    return true;
  }

  async createWindow(dbPath: string): Promise<WindowContext> {
    const normalized = path.resolve(dbPath);

    // If already open, focus and return existing context
    if (this.focusWindowForFile(normalized)) {
      const wcId = this.dbPathIndex.get(normalized)!;
      return this.contexts.get(wcId)!;
    }

    const sqlite = openDatabase(normalized);

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: `Fidra — ${path.basename(normalized)}`,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Show window once renderer has painted, with a fallback timeout
    // in case ready-to-show never fires (e.g. loadFile fails silently).
    let shown = false;
    const showOnce = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
      win.focus();
    };
    win.once('ready-to-show', showOnce);
    const showTimeout = setTimeout(showOnce, 5000);

    // Prevent Shift+Enter (or links) from opening blank windows
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const ctx = new WindowContext(win, normalized, sqlite);
    const wcId = win.webContents.id;

    this.contexts.set(wcId, ctx);
    this.dbPathIndex.set(normalized, wcId);

    // Track in recent files
    addRecentFile(normalized);

    // Clean up on close
    win.on('closed', () => {
      clearTimeout(showTimeout);
      ctx.close().catch((e) => console.error('[WINDOW] Close cleanup error:', e));
      this.contexts.delete(wcId);
      this.dbPathIndex.delete(normalized);
      this.startupCompleted.delete(wcId);
    });

    // Auto-start Local Sync BEFORE loading the renderer so that
    // ctx.localAuthPersonnel is set when the renderer's initialize()
    // calls localAuth:getAuthStatus via IPC.
    this.autoStartLocalSync(ctx);

    try {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      } else {
        const indexPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        console.log('[WINDOW] Loading renderer from:', indexPath);
        await win.loadFile(indexPath);
      }
    } catch (e) {
      console.error('[WINDOW] Failed to load renderer:', e);
      showOnce(); // Show the window anyway so user sees something
    }

    return ctx;
  }

  async createCloudWindow(serverId: string): Promise<WindowContext> {
    // If already open, focus and return existing context
    if (this.focusWindowForServer(serverId)) {
      const wcId = this.serverIdIndex.get(serverId)!;
      return this.contexts.get(wcId)!;
    }

    const config = getCloudServer(serverId);
    if (!config) {
      throw new Error(`Cloud server not found: ${serverId}`);
    }

    ensureCloudCacheDir();
    const cachePath = getCloudCachePath(serverId);
    const sqlite = openDatabase(cachePath);

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: `Fidra — ${config.name} (Cloud)`,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Show window once renderer has painted, with a fallback timeout
    let shown = false;
    const showOnce = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
      win.focus();
    };
    win.once('ready-to-show', showOnce);
    const showTimeout = setTimeout(showOnce, 5000);

    // Prevent Shift+Enter (or links) from opening blank windows
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const ctx = new WindowContext(win, cachePath, sqlite, serverId);
    const wcId = win.webContents.id;

    this.contexts.set(wcId, ctx);
    this.dbPathIndex.set(cachePath, wcId);
    this.serverIdIndex.set(serverId, wcId);

    // Clean up on close
    win.on('closed', () => {
      clearTimeout(showTimeout);
      ctx.close().catch((e) => console.error('[WINDOW] Close cleanup error:', e));
      this.contexts.delete(wcId);
      this.dbPathIndex.delete(cachePath);
      this.serverIdIndex.delete(serverId);
      this.startupCompleted.delete(wcId);
    });

    // Auto-start Local Sync BEFORE loading the renderer (same reason as createWindow)
    this.autoStartLocalSync(ctx);

    try {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      } else {
        const indexPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        console.log('[WINDOW] Loading renderer from:', indexPath);
        await win.loadFile(indexPath);
      }
    } catch (e) {
      console.error('[WINDOW] Failed to load renderer:', e);
      showOnce();
    }

    // Auto-connect to cloud after window loads
    this.autoConnectCloud(ctx, config).catch((e) => {
      console.error(`[CLOUD] Auto-connect failed for ${config.name}:`, e);
    });

    return ctx;
  }

  private async autoConnectCloud(
    ctx: WindowContext,
    config: import('../../shared/ipc-types').CloudServerConfig,
  ): Promise<void> {
    // Normalise: old configs stored Supabase creds under storageUrl/storageKey
    const projectUrl = config.projectUrl ?? config.storageUrl;
    const anonKey = config.anonKey ?? config.storageKey;
    const isAdminMode = !!config.connectionString;

    // Mutual exclusion: if Local Sync is configured, only initialize auth (for
    // password-protected databases) but skip Cloud sync/caching layer.
    const localSyncFolder = ctx.settingsRepo.getSetting('localSync.syncFolder');
    if (localSyncFolder) {
      console.log(`[CLOUD] Local Sync active — skipping Cloud Connect sync layer`);
      if (!isAdminMode && projectUrl && anonKey) {
        // Member mode: still need auth so user can access the database
        await this.initMemberAuthOnly(ctx, config, projectUrl, anonKey);
      }
      return;
    }

    if (isAdminMode) {
      await this.autoConnectAdmin(ctx, config, projectUrl, anonKey);
    } else if (projectUrl && anonKey) {
      await this.autoConnectMember(ctx, config, projectUrl, anonKey);
    } else {
      // No connection string and no Supabase creds — nothing we can do
      ctx.sendToRenderer('cloud:authRequired');
    }
  }

  /** Admin mode: connect via pg.Pool, run migrations, set up caching + auth */
  private async autoConnectAdmin(
    ctx: WindowContext,
    config: import('../../shared/ipc-types').CloudServerConfig,
    projectUrl: string | undefined,
    anonKey: string | undefined,
  ): Promise<void> {
    const conn = new CloudConnection(config);
    await conn.connect();
    if (ctx.isClosed) { await conn.close(); return; }

    await runMigrations(conn.pool);
    if (ctx.isClosed) { await conn.close(); return; }

    ctx.cloudConnection = conn;
    ctx.activateCachingLayer(conn, config);

    const repos = ctx.getCachingRepos();
    await Promise.all([
      repos.transactions?.refreshFromCloud(),
      repos.planned?.refreshFromCloud(),
      repos.sheets?.refreshFromCloud(),
      repos.categories?.refreshFromCloud(),
      repos.activityNotes?.refreshFromCloud(),
      repos.attachments?.refreshFromCloud(),
      repos.invoices?.refreshFromCloud(),
      repos.audit?.refreshFromCloud(),
    ]);
    if (ctx.isClosed) return;

    // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
    if (ctx.pgSettingsRepo) {
      const cloudSettings = await ctx.pgSettingsRepo.getAll().catch(() => ({}));
      if (Object.keys(cloudSettings).length === 0) {
        const localSettings = ctx.settingsRepo.getAll();
        for (const [key, value] of Object.entries(localSettings)) {
          await ctx.pgSettingsRepo.setSetting(key, value).catch(() => {});
        }
      } else {
        for (const [key, value] of Object.entries(cloudSettings)) {
          ctx.settingsRepo.setSetting(key, value);
        }
      }
    }
    if (ctx.isClosed) return;

    await this.startCloudServices(ctx, conn, repos);

    console.log(`[WINDOW ${ctx.dbName}] Cloud auto-connect (admin) complete for ${config.name}`);

    // Admin mode: no auth infrastructure. Supabase credentials (if present)
    // are used only for storage buckets — handled by the caching layer config.
    ctx.authMode = 'admin';

    // Notify renderer — connection is live, data is ready
    ctx.sendToRenderer('connection:statusChanged', 'connected');
    ctx.sendToRenderer('cloud:dataChanged', [
      'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings',
    ]);
  }

  /** Member mode: authenticate first via Supabase Auth, then use PostgREST for data */
  private async autoConnectMember(
    ctx: WindowContext,
    config: import('../../shared/ipc-types').CloudServerConfig,
    projectUrl: string,
    anonKey: string,
  ): Promise<void> {
    ctx.authMode = 'member';
    ctx.supabaseAuth = new SupabaseAuth(projectUrl, anonKey);
    const store = new SessionStore();
    ctx.sessionManager = new SessionManager(ctx.serverId!, ctx.supabaseAuth, store);

    // Try to restore a saved session BEFORE setting up the session-change handler.
    // Otherwise restoreSession() fires onSessionChanged, which rebuilds the caching
    // layer and starts services — duplicating the work autoConnectMember does below.
    const session = await ctx.sessionManager.restoreSession();
    if (ctx.isClosed) return;

    // Now register the handler for future token refreshes / sign-ins
    setupMemberSessionHandler(ctx, config);

    if (!session) {
      // No saved session — renderer must show auth gate
      ctx.sendToRenderer('cloud:authRequired');
      return;
    }

    ctx.authSession = session;

    // Create authenticated Supabase client for data access
    const supabaseClient = createClient(projectUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    ctx.activateCachingLayerMember(supabaseClient, config);

    const repos = ctx.getCachingRepos();
    await Promise.all([
      repos.transactions?.refreshFromCloud(),
      repos.planned?.refreshFromCloud(),
      repos.sheets?.refreshFromCloud(),
      repos.categories?.refreshFromCloud(),
      repos.activityNotes?.refreshFromCloud(),
      repos.attachments?.refreshFromCloud(),
      repos.invoices?.refreshFromCloud(),
      repos.audit?.refreshFromCloud(),
    ]);
    if (ctx.isClosed) return;

    // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
    if (ctx.supabaseSettingsRepo) {
      const cloudSettings = await ctx.supabaseSettingsRepo.getAll().catch(() => ({}));
      if (Object.keys(cloudSettings).length === 0) {
        const localSettings = ctx.settingsRepo.getAll();
        for (const [key, value] of Object.entries(localSettings)) {
          await ctx.supabaseSettingsRepo.setSetting(key, value).catch(() => {});
        }
      } else {
        for (const [key, value] of Object.entries(cloudSettings)) {
          ctx.settingsRepo.setSetting(key, value);
        }
      }
    }
    if (ctx.isClosed) return;

    ctx.memberConnected = true;
    startMemberServices(ctx);

    console.log(`[WINDOW ${ctx.dbName}] Cloud auto-connect (member) complete for ${config.name}`);

    ctx.sendToRenderer('connection:statusChanged', 'connected');
    ctx.sendToRenderer('cloud:dataChanged', [
      'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings',
    ]);
    ctx.sendToRenderer('auth:sessionRestored', session);
  }

  /**
   * Initialize auth infrastructure only (no sync/caching layer).
   * Used when Local Sync is active on a member-mode database — the user still
   * needs to authenticate, but Cloud data sync is skipped.
   */
  private async initMemberAuthOnly(
    ctx: WindowContext,
    config: import('../../shared/ipc-types').CloudServerConfig,
    projectUrl: string,
    anonKey: string,
  ): Promise<void> {
    ctx.authMode = 'member';
    ctx.supabaseAuth = new SupabaseAuth(projectUrl, anonKey);
    const store = new SessionStore();
    ctx.sessionManager = new SessionManager(ctx.serverId!, ctx.supabaseAuth, store);

    const session = await ctx.sessionManager.restoreSession();
    if (ctx.isClosed) return;

    setupMemberSessionHandler(ctx, config);

    if (!session) {
      ctx.sendToRenderer('cloud:authRequired');
      return;
    }

    ctx.authSession = session;
    console.log(`[WINDOW ${ctx.dbName}] Auth restored (Local Sync mode, no Cloud data sync)`);
    ctx.sendToRenderer('auth:sessionRestored', session);
  }

  /**
   * Auto-start Local Sync orchestrator if configured on this database.
   * Reads syncFolder + passphrase from per-db settings; if present, initializes
   * CRRs, device identity, and starts the orchestrator.
   */
  private autoStartLocalSync(ctx: WindowContext): void {
    const syncFolder = ctx.settingsRepo.getSetting('localSync.syncFolder');
    if (!syncFolder) return;

    // If local auth is configured, try to restore a persisted session.
    // If no saved session, wait for manual sign-in.
    if (ctx.isLocalSyncAuthEnabled) {
      const sessionId = dbPathToSessionId(ctx.dbPath);
      const store = new SessionStore();
      const saved = store.loadSession(sessionId);
      if (saved && saved.accessToken) {
        // Verify the personnel record still exists
        const person = ctx.personnelRepo.getByEmail(saved.user.email);
        if (person && person.password_hash) {
          ctx.localAuthPersonnel = person;
          ctx.localSyncPassphrase = saved.accessToken;
          ctx.authMode = 'localSync';
          ctx.authSession = {
            user: { id: person.id, email: person.email, personnelId: person.id },
            accessToken: '',
            refreshToken: '',
            expiresAt: 0,
          };
          console.log(`[WINDOW ${ctx.dbName}] Local Sync auth restored from saved session`);
          // Fall through to start the orchestrator below
        } else {
          // Personnel deleted or no password — invalidate saved session
          store.deleteSession(sessionId);
          console.log(`[WINDOW ${ctx.dbName}] Local Sync saved session invalid — waiting for sign-in`);
          return;
        }
      } else {
        console.log(`[WINDOW ${ctx.dbName}] Local Sync auth enabled — waiting for sign-in (no saved session for ${sessionId})`);
        return;
      }
    }

    // Passphrase: from restored auth session, or legacy settings (no auth configured)
    const passphrase = ctx.localSyncPassphrase ?? ctx.settingsRepo.getSetting('localSync.passphrase');
    if (!passphrase) return;

    try {
      initializeCrr(ctx.sqlite);
      const identity = initializeDeviceIdentity(ctx.sqlite, os.hostname());

      // Map this device to the signed-in person (after CRR init so triggers are ready)
      if (ctx.localAuthPersonnel) {
        try {
          ctx.personnelRepo.updateDeviceId(ctx.localAuthPersonnel.id, identity.deviceId);
        } catch { /* non-fatal */ }
      }

      const orchestrator = new SyncOrchestrator({
        db: ctx.sqlite,
        syncFolder,
        passphrase,
        deviceId: identity.deviceId,
        dbPath: ctx.dbPath,
        personName: ctx.localAuthPersonnel?.name ?? undefined,
        onDataChanged: (tables) => {
          ctx.sendToRenderer('localSync:dataChanged', { tables });
        },
        onConflictsDetected: (count) => {
          ctx.sendToRenderer('localSync:conflictsDetected', { count });
        },
        onStatusChanged: (status) => {
          const fullStatus: LocalSyncStatus = {
            enabled: true,
            state: status.state,
            lastExportAt: status.lastExportAt,
            lastImportAt: status.lastImportAt,
            pendingConflicts: status.pendingConflicts,
            lastError: status.lastError,
            syncFolder,
          };
          ctx.sendToRenderer('localSync:statusChanged', fullStatus);
        },
        onError: (message) => {
          ctx.sendToRenderer('localSync:error', { message });
        },
        onImportSummary: (notification) => {
          handleImportSummary(ctx, notification);
        },
      });

      ctx.localSyncOrchestrator = orchestrator;
      orchestrator.start();
      console.log(`[WINDOW ${ctx.dbName}] Local Sync auto-started (folder: ${syncFolder})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WINDOW ${ctx.dbName}] Local Sync auto-start failed:`, e);
      ctx.sendToRenderer('localSync:error', { message: `Auto-start failed: ${msg}` });
      const failedStatus: LocalSyncStatus = {
        enabled: true,
        state: 'error',
        lastExportAt: null,
        lastImportAt: null,
        pendingConflicts: 0,
        lastError: `Auto-start failed: ${msg}`,
        syncFolder,
      };
      ctx.sendToRenderer('localSync:statusChanged', failedStatus);
    }
  }

  /** Wire up SyncService, ConnectionStateService, ChangeListener for a pg.Pool connection */
  private async startCloudServices(
    ctx: WindowContext,
    conn: CloudConnection,
    repos: ReturnType<WindowContext['getCachingRepos']>,
  ): Promise<void> {
    const { SyncService } = await import('../cloud/sync-service');
    const { ConnectionStateService } = await import('../cloud/connection-state');
    const { ChangeListener } = await import('../cloud/change-listener');

    const queue = ctx.syncQueue!;

    ctx.connectionState = new ConnectionStateService(conn);
    ctx.connectionState.onStatusChanged = (status) => {
      ctx.sendToRenderer('connection:statusChanged', status);
    };
    ctx.connectionState.startMonitoring();

    ctx.syncService = new SyncService(
      queue,
      repos.transactions!,
      repos.planned!,
      repos.sheets!,
      repos.categories!,
      ctx.connectionState,
      repos.activityNotes ?? null,
      repos.attachments ?? null,
      repos.invoices ?? null,
      repos.audit ?? null,
      'ask_user',
    );

    ctx.syncService.onSyncStarted = () => {
      ctx.sendToRenderer('sync:statusChanged', {
        isSyncing: true,
        pendingCount: ctx.syncService?.getPendingCount() ?? 0,
      });
    };
    ctx.syncService.onSyncCompleted = (count) => {
      ctx.sendToRenderer('sync:statusChanged', {
        isSyncing: false,
        pendingCount: ctx.syncService?.getPendingCount() ?? 0,
        lastSyncedCount: count,
      });
    };
    ctx.syncService.onSyncFailed = (error) => {
      ctx.sendToRenderer('sync:statusChanged', {
        isSyncing: false,
        pendingCount: ctx.syncService?.getPendingCount() ?? 0,
        error,
      });
    };
    ctx.syncService.onPendingCountChanged = (count) => {
      ctx.sendToRenderer('sync:statusChanged', {
        isSyncing: ctx.syncService?.isSyncing ?? false,
        pendingCount: count,
      });
    };
    ctx.syncService.onConflictDetected = (changeId, local, server) => {
      ctx.sendToRenderer('sync:conflictDetected', { changeId, local, server });
    };

    ctx.syncService.start();

    ctx.changeListener = new ChangeListener(conn);
    ctx.changeListener.onTablesChanged = (tables) => {
      const refreshPromises: Promise<unknown>[] = [];
      if (tables.has('transactions') && repos.transactions) {
        refreshPromises.push(repos.transactions.refreshFromCloud());
      }
      if (tables.has('planned_templates') && repos.planned) {
        refreshPromises.push(repos.planned.refreshFromCloud());
      }
      if (tables.has('sheets') && repos.sheets) {
        refreshPromises.push(repos.sheets.refreshFromCloud());
      }
      if (tables.has('categories') && repos.categories) {
        refreshPromises.push(repos.categories.refreshFromCloud());
      }
      if (tables.has('activity_notes') && repos.activityNotes) {
        refreshPromises.push(repos.activityNotes.refreshFromCloud());
      }
      if (tables.has('attachments') && repos.attachments) {
        refreshPromises.push(repos.attachments.refreshFromCloud());
      }
      if (tables.has('audit_log') && repos.audit) {
        refreshPromises.push(repos.audit.refreshFromCloud());
      }
      if (tables.has('db_settings') && ctx.pgSettingsRepo) {
        refreshPromises.push(
          ctx.pgSettingsRepo.getAll().then((settings) => {
            for (const [key, value] of Object.entries(settings)) {
              ctx.settingsRepo.setSetting(key, value);
            }
          }),
        );
      }

      Promise.all(refreshPromises)
        .then(() => {
          if (!ctx.changeListener) return; // Torn down while refreshing
          ctx.sendToRenderer('cloud:dataChanged', [...tables]);
        })
        .catch((e) => console.error('[CLOUD] Refresh after remote changes failed:', e));
    };
    ctx.changeListener.start().catch((e) => {
      console.error('[CLOUD] Failed to start change listener:', e);
    });
  }

  /** Returns true if the window will reload (caller's JS context will be destroyed). */
  async switchWindowToFile(webContentsId: number, dbPath: string): Promise<boolean> {
    const normalized = path.resolve(dbPath);
    const ctx = this.contexts.get(webContentsId);
    if (!ctx) throw new Error('No context for this window');

    // Already showing this file — no switch needed
    if (ctx.dbPath === normalized) return false;

    // If this file is open in another window, focus that one instead
    if (this.isFileOpen(normalized)) {
      this.focusWindowForFile(normalized);
      return false;
    }

    const win = ctx.window;
    const oldDbPath = ctx.dbPath;
    const oldServerId = ctx.serverId;

    // Tear down old context (but NOT the window)
    ctx.stopLocalSyncServices();
    await ctx.stopCloudServices();
    ctx.deactivateCachingLayer();
    if (ctx.cloudConnection) {
      await ctx.cloudConnection.close();
      ctx.cloudConnection = null;
    }
    ctx.sqlite.close();

    // Clean up indexes
    this.contexts.delete(webContentsId);
    this.dbPathIndex.delete(oldDbPath);
    if (oldServerId) this.serverIdIndex.delete(oldServerId);

    // Create new context for the same window
    const sqlite = openDatabase(normalized);
    const newCtx = new WindowContext(win, normalized, sqlite);

    this.contexts.set(webContentsId, newCtx);
    this.dbPathIndex.set(normalized, webContentsId);

    addRecentFile(normalized);
    win.setTitle(`Fidra — ${path.basename(normalized)}`);

    // Re-register cleanup
    win.removeAllListeners('closed');
    win.on('closed', () => {
      newCtx.close().catch((e) => console.error('[WINDOW] Close cleanup error:', e));
      this.contexts.delete(webContentsId);
      this.dbPathIndex.delete(normalized);
    });

    // Auto-start Local Sync if configured on this database
    this.autoStartLocalSync(newCtx);

    // Reload renderer so stores re-fetch from new DB
    win.webContents.reload();
    return true;
  }

  /** Returns true if the window will reload (caller's JS context will be destroyed). */
  async switchWindowToCloud(webContentsId: number, serverId: string): Promise<boolean> {
    const ctx = this.contexts.get(webContentsId);
    if (!ctx) throw new Error('No context for this window');

    // Already showing this server AND still connected — no-op
    if (ctx.serverId === serverId && ctx.cloudConnection?.isConnected) return false;

    // Same server but disconnected (e.g. after sign-out) — reconnect
    if (ctx.serverId === serverId && !ctx.cloudConnection?.isConnected) {
      const config = getCloudServer(serverId);
      if (!config) throw new Error(`Cloud server not found: ${serverId}`);

      ctx.stopLocalSyncServices();
      await ctx.stopCloudServices();
      ctx.deactivateCachingLayer();

      const win = ctx.window;
      this.autoStartLocalSync(ctx);
      win.webContents.reload();
      this.autoConnectCloud(ctx, config).catch((e) => {
        console.error(`[CLOUD] Auto-reconnect failed for ${config.name}:`, e);
      });
      return true;
    }

    // If this server is open in another window, focus it
    if (this.isServerOpen(serverId)) {
      this.focusWindowForServer(serverId);
      return false;
    }

    const config = getCloudServer(serverId);
    if (!config) throw new Error(`Cloud server not found: ${serverId}`);

    const win = ctx.window;
    const oldDbPath = ctx.dbPath;
    const oldServerId = ctx.serverId;

    // Tear down old context
    ctx.stopLocalSyncServices();
    await ctx.stopCloudServices();
    ctx.deactivateCachingLayer();
    if (ctx.cloudConnection) {
      await ctx.cloudConnection.close();
      ctx.cloudConnection = null;
    }
    ctx.sqlite.close();

    this.contexts.delete(webContentsId);
    this.dbPathIndex.delete(oldDbPath);
    if (oldServerId) this.serverIdIndex.delete(oldServerId);

    // Create new context for cloud
    ensureCloudCacheDir();
    const cachePath = getCloudCachePath(serverId);
    const sqlite = openDatabase(cachePath);
    const newCtx = new WindowContext(win, cachePath, sqlite, serverId);

    this.contexts.set(webContentsId, newCtx);
    this.dbPathIndex.set(cachePath, webContentsId);
    this.serverIdIndex.set(serverId, webContentsId);

    win.setTitle(`Fidra — ${config.name} (Cloud)`);

    win.removeAllListeners('closed');
    win.on('closed', () => {
      newCtx.close().catch((e) => console.error('[WINDOW] Close cleanup error:', e));
      this.contexts.delete(webContentsId);
      this.dbPathIndex.delete(cachePath);
      this.serverIdIndex.delete(serverId);
    });

    // Auto-start Local Sync before reload so auth state is ready for renderer
    this.autoStartLocalSync(newCtx);
    win.webContents.reload();

    this.autoConnectCloud(newCtx, config).catch((e) => {
      console.error(`[CLOUD] Auto-connect failed for ${config.name}:`, e);
    });

    return true;
  }

  async closeAll(): Promise<void> {
    const closeTasks: Promise<void>[] = [];
    for (const ctx of this.contexts.values()) {
      closeTasks.push(ctx.close());
    }
    await Promise.all(closeTasks);
    this.contexts.clear();
    this.dbPathIndex.clear();
    this.serverIdIndex.clear();
  }

  getContextByServerId(serverId: string): WindowContext | undefined {
    const wcId = this.serverIdIndex.get(serverId);
    if (wcId === undefined) return undefined;
    return this.contexts.get(wcId);
  }

  getAllContexts(): WindowContext[] {
    return [...this.contexts.values()];
  }

  get windowCount(): number {
    return this.contexts.size;
  }
}

// ─── Import summary handler ─────────────────────────────────────────

/**
 * Handle import summary from the sync orchestrator.
 * Deferred to next tick — the orchestrator calls this synchronously during
 * start(), which runs before win.loadURL(). Firing Notifications or IPC
 * before the renderer has loaded crashes Chromium's network service.
 *
 * Startup catch-up summaries are stored on the WindowContext so the renderer
 * can retrieve them via IPC (solves the race where the event fires before the
 * renderer mounts its listener).
 */
function handleImportSummary(
  ctx: WindowContext,
  notification: ImportNotification,
): void {
  setTimeout(() => {
    if (ctx.window.isDestroyed()) return;

    if (notification.isStartupCatchup && notification.summaries.length > 0) {
      // Store for retrieval — the renderer will fetch this when it mounts
      ctx.pendingStartupSummary = notification;
    }

    // Send to renderer for toasts / "while you were away" dialog
    ctx.sendToRenderer('localSync:importSummary', notification);

    // OS notification only for live changes (not startup catch-up) and only when backgrounded
    if (!notification.isStartupCatchup && !ctx.window.isFocused()) {
      for (const summary of notification.summaries) {
        const totalChanges = Object.values(summary.changes).reduce(
          (sum, c) => sum + c.created + c.updated + c.deleted,
          0,
        );
        if (totalChanges > 0) {
          new Notification({
            title: 'Fidra',
            body: `${summary.personName} synced ${totalChanges} change${totalChanges === 1 ? '' : 's'}`,
          }).show();
        }
      }
    }
  }, 0);
}

// ─── Singleton access ───────────────────────────────────────────────

let _windowManager: WindowManager | null = null;

export function getWindowManager(): WindowManager {
  if (!_windowManager) {
    throw new Error('WindowManager not initialized. Call setWindowManager() first.');
  }
  return _windowManager;
}

export function setWindowManager(wm: WindowManager): void {
  _windowManager = wm;
}
