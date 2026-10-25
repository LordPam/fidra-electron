import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { loadGlobalSettings } from '../window/global-settings';
import { getWindowManager } from '../window/window-manager';

/** Open only an existing chosen file. A missing file belongs in the chooser. */
export async function openStartupWindow(): Promise<void> {
  const settings = loadGlobalSettings();
  const legacyDefault = path.join(app.getPath('userData'), 'fidra.db');
  const existing = settings.lastFile ?? (fs.existsSync(legacyDefault) ? legacyDefault : null);
  if (existing && fs.existsSync(existing)) {
    try {
      await getWindowManager().createWindow(existing, { startupMode: settings.firstRunComplete ? 'restore' : 'wizard' });
      return;
    } catch { /* A missing permission or damaged file belongs in the chooser. */ }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-setup-'));
  await getWindowManager().createWindow(path.join(directory, 'setup.db'), {
    startupMode: settings.firstRunComplete ? 'chooser' : 'wizard', temporaryDirectory: directory,
  });
}
