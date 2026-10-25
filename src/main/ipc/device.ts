import { app, dialog, ipcMain, shell, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../services/session-store';
import { personalAiBridge } from '../services/ai-runtime';
import { spawn } from 'node:child_process';
import { forgetDatabaseCredentials } from '../services/device-credentials';
import { z } from 'zod';
import { getWindowManager } from '../window/window-manager';
import { loadGlobalSettings } from '../window/global-settings';
import { financialDirectory, rememberAccount, retainedAccounts } from '../services/account-catalog';
import { clearDeviceFiles } from '../services/device-files';
import { withPreparedWindows, registerPreparationHandlers } from '../services/window-preparation';
import { resolveContext } from './context-resolver';

export async function resetOpenDeviceState(afterCleanup: () => Promise<void> = async () => undefined): Promise<void> {
  await withPreparedWindows(async () => {
    personalAiBridge.stop();
    SessionStore.clearMemory();
    const contexts = getWindowManager().getAllContexts();
    // Preserve a recovery index before removing recent-file preferences.
    for (const ctx of contexts) if (!ctx.temporaryDirectory) rememberAccount(ctx.dbPath, ctx.databaseId);
    for (const recent of loadGlobalSettings().recentFiles) {
      if (!retainedAccounts().some((item) => item.path === recent.path) && fs.existsSync(recent.path)) {
        // Keep even unopenable historical locations without touching their DB.
        rememberAccount(recent.path, 'unknown');
      }
    }
    for (const ctx of contexts) {
      ctx.stopLocalSyncServices();
      // Device scope only: no synced personnel or financial row is removed.
      ctx.sqlite.prepare("DELETE FROM settings WHERE key = 'localSync.passphrase' AND scope = 'device'").run();
    }
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    const paths = retainedAccounts().map((account) => account.path);
    await getWindowManager().closeAll();
    forgetDatabaseCredentials(paths);
    clearDeviceFiles(path.join(os.homedir(), '.fidra'), app.getPath('userData'));
    await afterCleanup();
    app.quit();
  });
}

export function registerDeviceHandlers(): void {
  registerPreparationHandlers();
  ipcMain.handle('device:getInfo', (event) => {
    resolveContext(event);
    return { accounts: retainedAccounts(), financialDirectory: financialDirectory(), attachmentDirectory: path.join(os.homedir(), '.fidra', 'attachments') };
  });
  ipcMain.handle('device:showFinancialFiles', async (event) => {
    resolveContext(event);
    fs.mkdirSync(financialDirectory(), { recursive: true });
    const error = await shell.openPath(financialDirectory());
    if (error) throw new Error(error);
  });
  ipcMain.handle('device:reset', async (event, raw: unknown) => {
    const { confirmed, action } = z.object({ confirmed: z.literal(true), action: z.enum(['reset', 'uninstall']).default('reset') }).strict().parse(raw);
    const context = resolveContext(event);
    if (!confirmed) return { success: false };
    if (action === 'uninstall' && !app.isPackaged) return { success: false, error: 'Uninstall is available in installed Fidra builds.' };
    const appBundle = path.resolve(path.dirname(process.execPath), '../..');
    const windowsUninstaller = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    if (action === 'uninstall' && (process.platform === 'darwin' ? !appBundle.endsWith('.app') : process.platform !== 'win32' || !fs.existsSync(windowsUninstaller))) return { success: false, error: 'Use your operating system to remove this build after resetting the device.' };
    const result = await dialog.showMessageBox(context.window, {
      type: 'warning', title: 'Reset this device', message: action === 'uninstall' ? 'Reset this device and uninstall Fidra?' : 'Reset Fidra on this device?',
      detail: 'Your ledgers, attachments, backups and team membership will be kept. All Fidra windows will close. Saved sign-ins, preferences and cached files will be cleared. Reopen Fidra and choose Open a ledger to continue.',
      buttons: ['Cancel', action === 'uninstall' ? 'Uninstall Fidra' : 'Reset device'], defaultId: 0, cancelId: 0,
    });
    if (result.response !== 1) return { success: false };
    try {
      await resetOpenDeviceState(async () => {
        if (action === 'uninstall') {
          if (process.platform === 'darwin') await shell.trashItem(appBundle);
          else await new Promise<void>((resolve, reject) => {
            const child = spawn(windowsUninstaller, ['--uninstall'], { detached: true, stdio: 'ignore' });
            child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
          });
        }
      });
      return { success: true };
    } catch (error) {
      for (const ctx of getWindowManager().getAllContexts()) if (ctx.isClosed) getWindowManager().reopenWindowDatabase(ctx.window.webContents.id);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
