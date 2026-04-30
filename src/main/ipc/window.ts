import { ipcMain, dialog, BrowserWindow } from 'electron';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import {
  loadGlobalSettings,
  removeRecentFile,
  updateCloudServer,
  removeCloudServer,
  markFirstRunComplete,
  getUiPreferences,
  saveUiPreferences,
} from '../window/global-settings';
import {
  cloudServerConfigSchema,
  profileSchema,
  transactionSettingsSchema,
  invoiceDefaultsSchema,
  uiPreferencesSchema,
} from '../../shared/ipc-schemas';
import type { CloudServerConfig } from '../../shared/ipc-types';
import type { UiPreferences } from '../../shared/global-settings-types';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Resolve the current user's display name.
 * Priority: auth session email → local profile (initials > name) → null.
 */
function getCurrentUser(ctx: import('../window/window-context').WindowContext): { displayName: string; source: 'auth' | 'profile' | 'none' } | null {
  // 1. Auth session (cloud with Supabase Auth)
  if (ctx.authSession?.user?.email) {
    return { displayName: ctx.authSession.user.email, source: 'auth' };
  }

  // 2. Local profile
  const initials = ctx.settingsRepo.getSetting('profile.initials') ?? '';
  const name = ctx.settingsRepo.getSetting('profile.name') ?? '';
  const local = initials || name;
  if (local) {
    return { displayName: local, source: 'profile' };
  }

  return null;
}

export function registerWindowHandlers(): void {
  ipcMain.handle('app:getStartupMode', (event) => {
    // Windows created via menu or DB switch already have a file — skip straight to the app
    if (getWindowManager().isStartupComplete(event.sender.id)) {
      return { mode: 'restore' as const };
    }

    const settings = loadGlobalSettings();
    if (!settings.firstRunComplete) {
      return { mode: 'wizard' as const };
    }
    if (settings.alwaysShowFileChooser) {
      return { mode: 'chooser' as const };
    }
    if (settings.lastOpenedAt) {
      const elapsed = Date.now() - new Date(settings.lastOpenedAt).getTime();
      if (elapsed > STALE_THRESHOLD_MS) {
        return { mode: 'chooser' as const };
      }
    }
    return { mode: 'restore' as const };
  });

  ipcMain.handle('app:markFirstRunComplete', () => {
    markFirstRunComplete();
  });

  ipcMain.handle('window:create', async (event, dbPath?: unknown) => {
    const validPath = dbPath != null ? z.string().parse(dbPath) : undefined;
    try {
      const wm = getWindowManager();
      if (validPath) {
        const ctx = await wm.createWindow(validPath);
        wm.markStartupComplete(ctx.window.webContents.id);
      }
      return { success: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (validPath && (errMsg.includes('unable to open database') || errMsg.includes('ENOENT') || errMsg.includes('EACCES'))) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
          title: 'Re-open Database (macOS requires re-selection)',
          defaultPath: path.dirname(validPath),
          filters: [
            { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          try {
            const wm2 = getWindowManager();
            const ctx2 = await wm2.createWindow(result.filePaths[0]);
            wm2.markStartupComplete(ctx2.window.webContents.id);
            return { success: true };
          } catch (e2) {
            return { success: false, error: String(e2) };
          }
        }
        return { success: false, error: 'File selection canceled' };
      }
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle('window:openFileDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Open Fidra Database',
      filters: [
        { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null, canceled: true };
    }

    const filePath = result.filePaths[0];
    try {
      const wm = getWindowManager();
      // Switch the current window to the chosen file instead of creating a
      // second window. This avoids the first-run bug where the default
      // fidra.db is opened before the user picks their own file.
      await wm.switchWindowToFile(event.sender.id, filePath);
      wm.markStartupComplete(event.sender.id);
      return { filePath, canceled: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[WINDOW] openFileDialog failed to open database:', msg);
      return { filePath: null, canceled: false, error: msg };
    }
  });

  ipcMain.handle('window:createNewDb', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Create New Fidra Database',
      defaultPath: path.join(
        os.homedir(),
        'Documents',
        'finances.fdra',
      ),
      filters: [
        { name: 'Fidra Database', extensions: ['fdra'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { filePath: null, canceled: true };
    }

    try {
      const wm = getWindowManager();
      // Switch the current window instead of creating a new one (avoids
      // orphan default fidra.db on first run).
      await wm.switchWindowToFile(event.sender.id, result.filePath);
      wm.markStartupComplete(event.sender.id);
      return { filePath: result.filePath, canceled: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[WINDOW] createNewDb failed to open database:', msg);
      return { filePath: null, canceled: false, error: msg };
    }
  });

  ipcMain.handle('window:getRecentFiles', () => {
    return loadGlobalSettings().recentFiles;
  });

  ipcMain.handle('window:openRecent', async (event, filePath: unknown) => {
    const validPath = z.string().parse(filePath);
    try {
      const wm = getWindowManager();
      const ctx = await wm.createWindow(validPath);
      wm.markStartupComplete(ctx.window.webContents.id);
      return { success: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // If the file can't be opened (macOS permission / iCloud not materialised),
      // prompt the user to re-select via native dialog which grants OS-level access.
      if (errMsg.includes('unable to open database') || errMsg.includes('ENOENT') || errMsg.includes('EACCES')) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
          title: 'Re-open Database (macOS requires re-selection)',
          defaultPath: path.dirname(validPath),
          filters: [
            { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          try {
            const wm2 = getWindowManager();
            const ctx2 = await wm2.createWindow(result.filePaths[0]);
            wm2.markStartupComplete(ctx2.window.webContents.id);
            return { success: true };
          } catch (e2) {
            return { success: false, error: String(e2) };
          }
        }
        return { success: false, error: 'File selection canceled' };
      }
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle('window:removeRecent', (_event, filePath: unknown) => {
    const validPath = z.string().parse(filePath);
    removeRecentFile(validPath);
  });

  ipcMain.handle('window:getDbInfo', (event) => {
    const ctx = resolveContext(event);
    return { path: ctx.dbPath, name: ctx.dbName };
  });

  ipcMain.handle('window:isCloudWindow', (event) => {
    return resolveContext(event).isCloudWindow;
  });

  ipcMain.handle('window:getCloudServers', () => {
    return loadGlobalSettings().cloudServers;
  });

  ipcMain.handle('window:saveCloudServer', (_event, config: unknown) => {
    const validated = cloudServerConfigSchema.parse(config);
    updateCloudServer(validated);
  });

  ipcMain.handle('window:removeCloudServer', (_event, id: unknown) => {
    const validId = z.string().parse(id);
    removeCloudServer(validId);
  });

  ipcMain.handle('window:openCloudServer', async (_event, serverId: unknown) => {
    const validServerId = z.string().parse(serverId);
    try {
      const wm = getWindowManager();
      const ctx = await wm.createCloudWindow(validServerId);
      wm.markStartupComplete(ctx.window.webContents.id);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('window:switchToFile', async (event, dbPath: unknown) => {
    const validPath = z.string().parse(dbPath);
    try {
      const wcId = event.sender.id;
      const wm = getWindowManager();
      const reloading = await wm.switchWindowToFile(wcId, validPath);
      if (reloading) wm.markStartupComplete(wcId);
      return { success: true, reloading };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('unable to open database') || errMsg.includes('ENOENT') || errMsg.includes('EACCES')) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
          title: 'Re-open Database (macOS requires re-selection)',
          defaultPath: path.dirname(validPath),
          filters: [
            { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          try {
            const wcId = event.sender.id;
            const wm2 = getWindowManager();
            const reloading = await wm2.switchWindowToFile(wcId, result.filePaths[0]);
            if (reloading) wm2.markStartupComplete(wcId);
            return { success: true, reloading };
          } catch (e2) {
            return { success: false, reloading: false, error: String(e2) };
          }
        }
        return { success: false, reloading: false, error: 'File selection canceled' };
      }
      return { success: false, reloading: false, error: errMsg };
    }
  });

  ipcMain.handle('window:switchToCloudServer', async (event, serverId: unknown) => {
    const validServerId = z.string().parse(serverId);
    try {
      const wcId = event.sender.id;
      const wm = getWindowManager();
      const reloading = await wm.switchWindowToCloud(wcId, validServerId);
      if (reloading) wm.markStartupComplete(wcId);
      return { success: true, reloading };
    } catch (e) {
      return { success: false, reloading: false, error: String(e) };
    }
  });

  // Per-database profile
  ipcMain.handle('settings:getProfile', (event) => {
    const ctx = resolveContext(event);
    return {
      name: ctx.settingsRepo.getSetting('profile.name') ?? '',
      initials: ctx.settingsRepo.getSetting('profile.initials') ?? '',
    };
  });

  ipcMain.handle('settings:saveProfile', (event, profile: unknown) => {
    const validated = profileSchema.parse(profile);
    const ctx = resolveContext(event);
    ctx.settingsRepo.setSetting('profile.name', validated.name);
    ctx.settingsRepo.setSetting('profile.initials', validated.initials);
  });

  ipcMain.handle('settings:getTransactionSettings', (event) => {
    const ctx = resolveContext(event);
    return {
      dateOnApprove: ctx.settingsRepo.getSetting('tx.dateOnApprove') === 'true',
      dateOnPlannedConversion: ctx.settingsRepo.getSetting('tx.dateOnPlannedConversion') !== 'false', // default true
    };
  });

  ipcMain.handle('settings:saveTransactionSettings', (event, settings: unknown) => {
    const validated = transactionSettingsSchema.parse(settings);
    const ctx = resolveContext(event);
    ctx.settingsRepo.setSetting('tx.dateOnApprove', String(validated.dateOnApprove));
    ctx.settingsRepo.setSetting('tx.dateOnPlannedConversion', String(validated.dateOnPlannedConversion));
  });

  ipcMain.handle('settings:getCurrentUser', (event) => {
    const ctx = resolveContext(event);
    return getCurrentUser(ctx);
  });

  // Financial year start month (per-database, with cloud sync)
  ipcMain.handle('settings:getFYStartMonth', (event) => {
    const ctx = resolveContext(event);
    const val = ctx.settingsRepo.getSetting('fy.startMonth');
    if (!val) {
      // Persist the default so it participates in cloud sync
      ctx.settingsRepo.setSetting('fy.startMonth', '1');
      return 1;
    }
    return parseInt(val, 10);
  });

  ipcMain.handle('settings:saveFYStartMonth', async (event, month: unknown) => {
    const validMonth = z.number().int().min(1).max(12).parse(month);
    const ctx = resolveContext(event);
    ctx.settingsRepo.setSetting('fy.startMonth', String(validMonth));
    // Sync to cloud if connected (direct write, no queue)
    if (ctx.pgSettingsRepo) {
      await ctx.pgSettingsRepo.setSetting('fy.startMonth', String(validMonth)).catch((e: unknown) => {
        console.error('[CLOUD] Failed to sync FY start month:', e instanceof Error ? (e as Error).message : String(e));
      });
    } else if (ctx.supabaseSettingsRepo) {
      await ctx.supabaseSettingsRepo.setSetting('fy.startMonth', String(validMonth)).catch((e: unknown) => {
        console.error('[CLOUD] Failed to sync FY start month:', e instanceof Error ? (e as Error).message : String(e));
      });
    }
  });

  // Current sheet selection (per-database, UI-only — not synced to cloud)
  ipcMain.handle('settings:getCurrentSheet', (event) => {
    const ctx = resolveContext(event);
    return ctx.settingsRepo.getSetting('ui.currentSheet') ?? 'All Sheets';
  });

  ipcMain.handle('settings:saveCurrentSheet', (event, name: unknown) => {
    const ctx = resolveContext(event);
    const validated = z.string().parse(name);
    ctx.settingsRepo.setSetting('ui.currentSheet', validated);
  });

  // Invoice defaults (per-database, with cloud sync)
  const INVOICE_KEYS = ['fromName', 'fromAddress', 'bankDetails', 'notes', 'logoPath', 'logoData', 'counter', 'accentMode'] as const;

  ipcMain.handle('settings:getInvoiceDefaults', (event) => {
    const ctx = resolveContext(event);
    return {
      fromName: ctx.settingsRepo.getSetting('invoice.fromName') ?? '',
      fromAddress: ctx.settingsRepo.getSetting('invoice.fromAddress') ?? '',
      bankDetails: ctx.settingsRepo.getSetting('invoice.bankDetails') ?? '',
      notes: ctx.settingsRepo.getSetting('invoice.notes') ?? '',
      logoPath: ctx.settingsRepo.getSetting('invoice.logoPath') ?? '',
      logoData: ctx.settingsRepo.getSetting('invoice.logoData') ?? '',
      counter: ctx.settingsRepo.getSetting('invoice.counter') ?? '',
      accentMode: (ctx.settingsRepo.getSetting('invoice.accentMode') as 'fidra' | 'black' | 'logo') ?? 'fidra',
    };
  });

  ipcMain.handle('settings:saveInvoiceDefaults', async (event, defaults: unknown) => {
    const validated = invoiceDefaultsSchema.parse(defaults);
    const ctx = resolveContext(event);
    for (const key of INVOICE_KEYS) {
      ctx.settingsRepo.setSetting(`invoice.${key}`, validated[key]);
    }
    // Sync to cloud if connected (direct write, no queue — matches FY start month pattern)
    const cloudRepo = ctx.pgSettingsRepo ?? ctx.supabaseSettingsRepo;
    if (cloudRepo) {
      for (const key of INVOICE_KEYS) {
        await cloudRepo.setSetting(`invoice.${key}`, validated[key]).catch((e: unknown) => {
          console.error(`[CLOUD] Failed to sync invoice.${key}:`, e instanceof Error ? e.message : String(e));
        });
      }
    }
  });

  // UI preferences
  ipcMain.handle('settings:getUiPreferences', () => getUiPreferences());
  ipcMain.handle('settings:saveUiPreferences', (_event, prefs: unknown) => {
    const validated = uiPreferencesSchema.parse(prefs);
    saveUiPreferences(validated);
  });
}
