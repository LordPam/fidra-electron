import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { retainedAccounts, rememberAccount } from './account-catalog';
import { loadGlobalSettings } from '../window/global-settings';
import { forgetDatabaseCredentials } from './device-credentials';
import { clearDeviceFiles } from './device-files';

export type SquirrelEvent = '--squirrel-install' | '--squirrel-updated' | '--squirrel-uninstall' | '--squirrel-obsolete';
export function squirrelEvent(platform: string, args: string[]): SquirrelEvent | null {
  if (platform !== 'win32') return null;
  return args.find((arg): arg is SquirrelEvent => ['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete'].includes(arg)) ?? null;
}

/** No windows or default DB are created by an installer lifecycle process. */
export async function runSquirrelHelper(event: SquirrelEvent, ownsInstance: boolean): Promise<void> {
  if (event === '--squirrel-uninstall' && ownsInstance) {
    for (const recent of loadGlobalSettings().recentFiles) if (fs.existsSync(recent.path)) rememberAccount(recent.path, 'unknown');
    forgetDatabaseCredentials(retainedAccounts().map((account) => account.path));
    clearDeviceFiles(path.join(os.homedir(), '.fidra'), app.getPath('userData'));
  }
  if (event === '--squirrel-obsolete') return;
  const updater = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  if (!fs.existsSync(updater)) return;
  const action = event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(updater, [action, path.basename(process.execPath)], { stdio: 'ignore' });
    child.once('error', reject); child.once('close', () => resolve());
  });
}
