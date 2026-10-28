import fs from 'node:fs';
import path from 'node:path';
import type { WindowContext } from '../window/window-context';
import type { WindowManager } from '../window/window-manager';
import { backupPathSchema, backupSettingsSchema } from '../../shared/ipc-schemas';
import { assertApplicationPermission } from './application-access';
import { createBackup, listBackups, restoreBackup, deleteBackup, getBackupSettings, saveBackupSettings } from './backup-service';

export function backupsGetSettings(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return getBackupSettings(ctx.settingsRepo);
}
export function backupsList(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return listBackups(ctx.dbPath, getBackupSettings(ctx.settingsRepo)).filter(({ metadata }) =>
    metadata.databaseId ? metadata.databaseId === ctx.databaseId : metadata.dbName === path.basename(ctx.dbPath));
}
export function backupsCreate(ctx: WindowContext, requestKey?: string) {
  assertApplicationPermission(ctx, 'ledgerUse');
  if (requestKey) {
    if (!/^[a-f0-9]{64}$/.test(requestKey)) throw new Error('Invalid backup request key.');
    const existing = backupsList(ctx).find((item) => item.metadata.databaseId === ctx.databaseId && item.metadata.requestKey === requestKey);
    if (existing) return Promise.resolve(existing);
  }
  return createBackup(ctx.sqlite, ctx.dbPath, ctx.databaseId, 'manual', getBackupSettings(ctx.settingsRepo), [], requestKey);
}
export function backupsSaveSettings(ctx: WindowContext, raw: unknown) {
  assertApplicationPermission(ctx, 'ledgerAdministration');
  const settings = backupSettingsSchema.strict().parse(raw);
  ctx.sqlite.transaction(() => saveBackupSettings(ctx.settingsRepo, settings))();
}
function requireListedBackup(ctx: WindowContext, rawPath: unknown) {
  const backupPath = backupPathSchema.parse(rawPath);
  const item = backupsList(ctx).find((candidate) => path.resolve(candidate.path) === path.resolve(backupPath));
  if (!item || fs.lstatSync(item.path).isSymbolicLink()) throw new Error('Choose an existing backup of this ledger from Fidra’s backup list.');
  return item;
}
export function backupsDelete(ctx: WindowContext, rawPath: unknown) {
  assertApplicationPermission(ctx, 'ledgerAdministration');
  return deleteBackup(requireListedBackup(ctx, rawPath).path);
}
export async function backupsRestore(ctx: WindowContext, rawPath: unknown, wm: Pick<WindowManager, 'otherWindowsWithFile' | 'reopenWindowDatabase'>) {
  assertApplicationPermission(ctx, 'ledgerAdministration');
  const backup = requireListedBackup(ctx, rawPath);
  const wcId = ctx.window.webContents.id;
  function checkReplacement() {
    assertApplicationPermission(ctx, 'ledgerAdministration');
    if (wm.otherWindowsWithFile(wcId, ctx.dbPath).length) throw new Error('This database is open in another Fidra window. Close that window and try again.');
    requireListedBackup(ctx, backup.path);
  }
  checkReplacement();
  ctx.stopLocalSyncServices();
  const result = await restoreBackup(ctx.sqlite, ctx.dbPath, ctx.databaseId, backup.path, ctx.settingsRepo, checkReplacement);
  if (result.dbClosed) wm.reopenWindowDatabase(wcId);
  return { success: result.success, error: result.error };
}
