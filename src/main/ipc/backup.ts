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
    const result = await restoreBackup(ctx.sqlite, ctx.dbPath, ctx.databaseId, validPath, ctx.settingsRepo);
    if (result.success) {
      // Reload the window with the restored database
      const wm = getWindowManager();
      await wm.switchWindowToFile(event.sender.id, ctx.dbPath);
    }
    return result;
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
