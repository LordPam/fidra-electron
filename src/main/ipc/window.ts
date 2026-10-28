import { ipcMain, dialog, BrowserWindow } from 'electron';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { reserveAccountPath } from '../services/account-catalog';
import * as settings from '../services/settings-operations';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import {
  loadGlobalSettings,
  removeRecentFile,
  markFirstRunComplete,
} from '../window/global-settings';


const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function registerWindowHandlers(): void {
  ipcMain.handle('app:getStartupMode', (event) => {
    // Windows created via menu or DB switch already have a file — skip straight to the app
    if (getWindowManager().isStartupComplete(event.sender.id)) {
      return { mode: 'restore' as const };
    }

    const context = resolveContext(event);
    if (context.startupMode !== 'restore') return { mode: context.startupMode };
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

  ipcMain.handle('app:markFirstRunComplete', (event) => {
    markFirstRunComplete();
    getWindowManager().markStartupComplete(event.sender.id);
  });

  ipcMain.handle('window:create', async (event, dbPath?: unknown) => {
    const validPath = dbPath != null ? z.string().parse(dbPath) : undefined;
    try {
      const wm = getWindowManager();
      if (validPath) {
        const ctx = await wm.createWindow(validPath);
        if (!ctx) return { success: false, error: 'Cancelled — database may be open elsewhere' };
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
            if (!ctx2) return { success: false, error: 'Cancelled — database may be open elsewhere' };
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
      markFirstRunComplete();
      await wm.switchWindowToFile(event.sender.id, filePath);
      wm.markStartupComplete(event.sender.id);
      return { filePath, canceled: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[WINDOW] openFileDialog failed to open database:', msg);
      return { filePath: null, canceled: false, error: msg };
    }
  });

  ipcMain.handle('window:createNewDb', async (event, rawOptions?: unknown) => {
    const options = z.object({ chooseLocation: z.boolean() }).optional().parse(rawOptions);
    if (options?.chooseLocation === false) {
      const filePath = reserveAccountPath();
      try {
        markFirstRunComplete();
        await getWindowManager().switchWindowToFile(event.sender.id, filePath);
        getWindowManager().markStartupComplete(event.sender.id);
        return { filePath, canceled: false };
      } catch (error) { return { filePath: null, canceled: false, error: String(error) }; }
    }
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

    if (fs.existsSync(result.filePath)) return { filePath: null, canceled: false, error: 'A file already exists there. Choose another name or open the existing ledger.' };
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
      if (!ctx) return { success: false, error: 'Cancelled — database may be open elsewhere' };
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
            if (!ctx2) return { success: false, error: 'Cancelled — database may be open elsewhere' };
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

  ipcMain.handle('window:switchToFile', async (event, dbPath: unknown) => {
    const validPath = z.string().parse(dbPath);
    try {
      const wcId = event.sender.id;
      const wm = getWindowManager();
      if (!fs.existsSync(validPath)) return { success: false, reloading: false, error: 'This ledger was moved or removed. Choose Open a ledger to find it.' };
      markFirstRunComplete();
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

  // Shared application settings operations.
  ipcMain.handle('settings:getProfile', (event) => settings.settingsGetProfile(resolveContext(event)));
  ipcMain.handle('settings:saveProfile', (event, raw: unknown) => settings.settingsSaveProfile(resolveContext(event), raw));
  ipcMain.handle('settings:getTransactionSettings', (event) => settings.settingsGetTransactionSettings(resolveContext(event)));
  ipcMain.handle('settings:saveTransactionSettings', (event, raw: unknown) => settings.settingsSaveTransactionSettings(resolveContext(event), raw));
  ipcMain.handle('settings:getCurrentUser', (event) => settings.settingsGetCurrentUser(resolveContext(event)));
  ipcMain.handle('settings:getFYStartMonth', (event) => settings.settingsGetFYStartMonth(resolveContext(event)));
  ipcMain.handle('settings:saveFYStartMonth', (event, raw: unknown) => settings.settingsSaveFYStartMonth(resolveContext(event), raw));
  ipcMain.handle('settings:getOrgName', (event) => settings.settingsGetOrgName(resolveContext(event)));
  ipcMain.handle('settings:saveOrgName', (event, raw: unknown) => settings.settingsSaveOrgName(resolveContext(event), raw));
  ipcMain.handle('settings:getCurrentSheet', (event) => settings.settingsGetCurrentSheet(resolveContext(event)));
  ipcMain.handle('settings:saveCurrentSheet', (event, raw: unknown) => settings.settingsSaveCurrentSheet(resolveContext(event), raw));
  ipcMain.handle('settings:getInvoiceDefaults', (event) => settings.settingsGetInvoiceDefaults(resolveContext(event)));
  ipcMain.handle('settings:saveInvoiceDefaults', (event, raw: unknown) => settings.settingsSaveInvoiceDefaults(resolveContext(event), raw));
  ipcMain.handle('settings:getUiPreferences', (event) => settings.settingsGetUiPreferences(resolveContext(event)));
  ipcMain.handle('settings:saveUiPreferences', (event, raw: unknown) => settings.settingsSaveUiPreferences(resolveContext(event), raw));
}
