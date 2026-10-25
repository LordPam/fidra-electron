import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { openDatabase } from '../database/connection';
import { acquireDbLock, releaseDbLock } from '../database/db-lock';
import { WindowContext } from './window-context';
import { rememberAccount } from '../services/account-catalog';
import { SessionStore, dbPathToSessionId } from '../services/session-store';
import { addRecentFile, loadGlobalSettings, saveGlobalSettings } from './global-settings';
import { isCloudSyncedPath } from '../../shared/cloud-folder-detect';
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
  private readonly startupCompleted = new Set<number>();
  private updatePreparing = false;

  get isPreparingOperation(): boolean { return this.updatePreparing; }

  /** Keep the set of ledgers fixed while all windows prepare an installer handoff. */
  setUpdatePreparing(value: boolean): void { this.updatePreparing = value; }

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

  /**
   * Other windows pointing at the same file on disk.
   *
   * `dbPathIndex` is keyed on the resolved path, which is not the same thing:
   * on a case-insensitive volume `/x/Ledger.fdra` and `/x/ledger.fdra` are two keys
   * for one file, as are a symlink and its target. Callers that are about to replace
   * the file (backup restore) need the stricter answer.
   */
  otherWindowsWithFile(webContentsId: number, dbPath: string): WindowContext[] {
    const realPath = (p: string): string => {
      try {
        return fs.realpathSync.native(p);
      } catch {
        return path.resolve(p);
      }
    };
    const target = realPath(dbPath);
    return [...this.contexts.entries()]
      .filter(([wcId, ctx]) => wcId !== webContentsId && realPath(ctx.dbPath) === target)
      .map(([, ctx]) => ctx);
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

  async createWindow(dbPath: string, options: { startupMode?: 'wizard' | 'chooser' | 'restore'; temporaryDirectory?: string } = {}): Promise<WindowContext | null> {
    if (this.updatePreparing) throw new Error('Fidra is preparing an update. Try opening the ledger again afterwards.');
    const normalized = path.resolve(dbPath);

    // If already open, focus and return existing context
    if (this.focusWindowForFile(normalized)) {
      const wcId = this.dbPathIndex.get(normalized)!;
      return this.contexts.get(wcId)!;
    }

    const { db: sqlite, databaseId } = openDatabase(normalized);

    // Advisory lock: warn if another device may have this file open
    const lockConflict = acquireDbLock(normalized);
    if (lockConflict) {
      const openedAt = new Date(lockConflict.openedAt);
      const timeStr = isNaN(openedAt.getTime()) ? lockConflict.openedAt : openedAt.toLocaleString();
      const response = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Database may be open elsewhere',
        message: 'This database appears to be open on another device.',
        detail:
          `According to the lock file, it was opened on ${lockConflict.deviceName} (${lockConflict.hostname}) at ${timeStr}. ` +
          'Opening it here simultaneously could corrupt the database.\n\n' +
          'If the other device has since closed Fidra, this is a stale lock and you can safely continue.',
        buttons: ['Cancel', 'Open Anyway'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 0) {
        releaseDbLock(normalized);
        sqlite.close();
        return null;
      }
    }

    // Warn if the database is in a cloud-synced folder (OneDrive, iCloud, Dropbox, etc.)
    warnIfCloudSyncedPath(normalized);

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: `Fidra — ${path.basename(normalized)}`,
      // macOS: drop the title bar strip and let the content run to the top,
      // keeping the traffic lights floating over the sidebar. Drag regions are
      // supplied by the renderer (`.app-drag`), so the window stays movable.
      // Left framed on Windows/Linux, where `hidden` would also remove the
      // minimise/maximise/close controls.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 14, y: 14 },
            // `under-window` is deliberately more revealing than the dense
            // sidebar material. Vibrancy already makes the web contents
            // transparent where CSS permits it, so this stays a normal native
            // window (retaining resize behaviour and the system shadow).
            vibrancy: 'under-window' as const,
            visualEffectState: 'followWindow' as const,
          }
        : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        zoomFactor: 1.0,
      },
    });

    // Reset zoom and disable pinch-to-zoom (prevents unintentional zoom
    // changes from trackpad gestures while the app is in the background)
    win.webContents.setZoomLevel(0);
    win.webContents.setVisualZoomLevelLimits(1, 1);

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

    const ctx = new WindowContext(win, normalized, databaseId, sqlite);
    ctx.startupMode = options.startupMode ?? 'restore';
    ctx.temporaryDirectory = options.temporaryDirectory ?? null;
    const wcId = win.webContents.id;

    this.contexts.set(wcId, ctx);
    this.dbPathIndex.set(normalized, wcId);

    // Track in recent files
    if (!ctx.temporaryDirectory) {
      try { rememberAccount(normalized, databaseId); } catch (error) { console.warn('[ACCOUNTS] Could not update the recovery index:', String(error)); }
      addRecentFile(normalized);
    }

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
        databaseId: ctx.databaseId,
        personName: ctx.localAuthPersonnel?.name ?? undefined,
        onDataChanged: (tables) => {
          ctx.checkPersonnelSurvival(tables);
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
            staleReason: status.staleReason,
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
        staleReason: null,
      };
      ctx.sendToRenderer('localSync:statusChanged', failedStatus);
    }
  }

  /** Returns true if the window will reload (caller's JS context will be destroyed). */
  async switchWindowToFile(webContentsId: number, dbPath: string): Promise<boolean> {
    if (this.updatePreparing) return false;
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

    // Create new context for the same window
    const { db: sqlite, databaseId } = openDatabase(normalized);

    // Advisory lock: warn if another device may have this file open
    const lockConflict = acquireDbLock(normalized);
    if (lockConflict) {
      const openedAt = new Date(lockConflict.openedAt);
      const timeStr = isNaN(openedAt.getTime()) ? lockConflict.openedAt : openedAt.toLocaleString();
      const response = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: 'Database may be open elsewhere',
        message: 'This database appears to be open on another device.',
        detail:
          `According to the lock file, it was opened on ${lockConflict.deviceName} (${lockConflict.hostname}) at ${timeStr}. ` +
          'Opening it here simultaneously could corrupt the database.\n\n' +
          'If the other device has since closed Fidra, this is a stale lock and you can safely continue.',
        buttons: ['Cancel', 'Open Anyway'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 0) {
        releaseDbLock(normalized);
        sqlite.close();
        return false;
      }
    }

    // Warn if the database is in a cloud-synced folder
    warnIfCloudSyncedPath(normalized, win);

    // Tear down old context (but NOT the window)
    releaseDbLock(oldDbPath);
    await ctx.close();

    // Clean up indexes
    this.contexts.delete(webContentsId);
    this.dbPathIndex.delete(oldDbPath);

    const newCtx = new WindowContext(win, normalized, databaseId, sqlite);

    this.contexts.set(webContentsId, newCtx);
    this.dbPathIndex.set(normalized, webContentsId);

    try { rememberAccount(normalized, databaseId); } catch (error) { console.warn('[ACCOUNTS] Could not update the recovery index:', String(error)); }
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

  /**
   * Rebuild a window's context around the same file after its database was replaced
   * on disk (backup restore). The caller has already closed the old connection, so
   * `switchWindowToFile` is no use here — it short-circuits when the path is unchanged
   * and would leave the window holding a dead handle.
   *
   * The advisory db lock is deliberately kept: the file never stopped being ours.
   */
  reopenWindowDatabase(webContentsId: number): boolean {
    const ctx = this.contexts.get(webContentsId);
    if (!ctx) return false;

    const win = ctx.window;
    const dbPath = ctx.dbPath;

    this.contexts.delete(webContentsId);
    this.dbPathIndex.delete(dbPath);

    const { db: sqlite, databaseId } = openDatabase(dbPath);
    const newCtx = new WindowContext(win, dbPath, databaseId, sqlite);

    this.contexts.set(webContentsId, newCtx);
    this.dbPathIndex.set(dbPath, webContentsId);

    win.removeAllListeners('closed');
    win.on('closed', () => {
      newCtx.close().catch((e) => console.error('[WINDOW] Close cleanup error:', e));
      this.contexts.delete(webContentsId);
      this.dbPathIndex.delete(dbPath);
    });

    this.autoStartLocalSync(newCtx);

    // Reload renderer so stores re-fetch from the restored database
    win.webContents.reload();
    return true;
  }

  async closeAll(): Promise<void> {
    const closeTasks: Promise<void>[] = [];
    for (const ctx of this.contexts.values()) {
      closeTasks.push(ctx.close());
    }
    await Promise.all(closeTasks);
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
          // Build a richer body when change count is small and details are available
          let body: string;
          if (totalChanges <= 3) {
            const detailLines: string[] = [];
            for (const counts of Object.values(summary.changes)) {
              if (counts.details) {
                for (const d of counts.details) {
                  detailLines.push(`${d.action}: ${d.label}`);
                }
              }
            }
            body = detailLines.length > 0
              ? `${summary.personName}:\n${detailLines.join('\n')}`
              : `${summary.personName} synced ${totalChanges} change${totalChanges === 1 ? '' : 's'}`;
          } else {
            body = `${summary.personName} synced ${totalChanges} change${totalChanges === 1 ? '' : 's'}`;
          }
          new Notification({ title: 'Fidra', body }).show();
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

/**
 * Show a native info dialog if the database file is in a cloud-synced folder.
 * Sequential access from different devices is fine — only simultaneous access is dangerous.
 * Suppressed if the user previously chose "Don't show again".
 */
function warnIfCloudSyncedPath(dbPath: string, parentWindow?: BrowserWindow): void {
  if (!isCloudSyncedPath(dbPath)) return;

  const settings = loadGlobalSettings();
  if (settings.suppressCloudFolderWarning) return;

  const buttonIndex = dialog.showMessageBoxSync(parentWindow ?? BrowserWindow.getFocusedWindow()!, {
    type: 'info',
    title: 'Database in cloud-synced folder',
    message: 'This database is stored in a cloud-synced folder (OneDrive, iCloud, etc.).',
    detail:
      'This is fine for accessing your database from different devices — just make sure ' +
      'it is not open on two devices at the same time. Simultaneous access can corrupt the database.\n\n' +
      'Wait for cloud sync to finish before opening the file on another device.',
    buttons: ['OK', "Don't show again"],
    defaultId: 0,
  });

  if (buttonIndex === 1) {
    saveGlobalSettings({ ...settings, suppressCloudFolderWarning: true });
  }
}
