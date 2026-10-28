import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import { getWindowManager } from '../window/window-manager';
import * as backups from '../services/backup-operations';

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:create', (event) => backups.backupsCreate(resolveContext(event)));
  ipcMain.handle('backup:list', (event) => backups.backupsList(resolveContext(event)));
  ipcMain.handle('backup:restore', (event, rawPath: unknown) => backups.backupsRestore(resolveContext(event), rawPath, getWindowManager()));
  ipcMain.handle('backup:delete', (event, rawPath: unknown) => backups.backupsDelete(resolveContext(event), rawPath));
  ipcMain.handle('backup:getSettings', (event) => backups.backupsGetSettings(resolveContext(event)));
  ipcMain.handle('backup:saveSettings', (event, raw: unknown) => backups.backupsSaveSettings(resolveContext(event), raw));
}
