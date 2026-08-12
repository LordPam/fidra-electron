import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import { backupPathSchema, backupSettingsSchema } from '../../shared/ipc-schemas';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  getBackupSettings,
  saveBackupSettings,
} from '../services/backup-service';
import { getWindowManager } from '../window/window-manager';

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:create', async (event) => {
    const ctx = resolveContext(event);
    const settings = getBackupSettings(ctx.settingsRepo);
    return await createBackup(ctx.sqlite, ctx.dbPath, ctx.databaseId, 'manual', settings);
  });

  ipcMain.handle('backup:list', (event) => {
    const ctx = resolveContext(event);
    const settings = getBackupSettings(ctx.settingsRepo);
    return listBackups(ctx.dbPath, settings);
  });

  ipcMain.handle('backup:restore', async (event, backupPath: unknown) => {
    const validPath = backupPathSchema.parse(backupPath);
    const ctx = resolveContext(event);
    const wm = getWindowManager();

    // Another window on the same file would keep its own connection — and its WAL —
    // alive across the swap, then replay it over the restored database.
    if (wm.otherWindowsWithFile(event.sender.id, ctx.dbPath).length > 0) {
      return {
        success: false,
        error: 'This database is open in another Fidra window. Close that window and try again.',
      };
    }

    // Nothing may hold the connection while the file underneath it is replaced.
    ctx.stopLocalSyncServices();

    const result = await restoreBackup(ctx.sqlite, ctx.dbPath, ctx.databaseId, validPath, ctx.settingsRepo);

    // The connection is closed whether or not the restore succeeded, so the window
    // needs a fresh context either way — otherwise every later query throws.
    if (result.dbClosed) {
      wm.reopenWindowDatabase(event.sender.id);
    }

    return { success: result.success, error: result.error };
  });

  ipcMain.handle('backup:delete', (_event, backupPath: unknown) => {
    const validPath = backupPathSchema.parse(backupPath);
    return deleteBackup(validPath);
  });

  ipcMain.handle('backup:getSettings', (event) => {
    const ctx = resolveContext(event);
    return getBackupSettings(ctx.settingsRepo);
  });

  ipcMain.handle('backup:saveSettings', (event, settings: unknown) => {
    const validSettings = backupSettingsSchema.parse(settings);
    const ctx = resolveContext(event);
    saveBackupSettings(ctx.settingsRepo, validSettings);
  });
}
