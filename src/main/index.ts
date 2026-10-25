import { app, BrowserWindow, session, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { squirrelEvent, runSquirrelHelper } from './services/squirrel-lifecycle';
import { resetOpenDeviceState } from './ipc/device';
import { personalAiBridge } from './services/ai-runtime';

// ─── Startup diagnostic log (written to file since no terminal in Finder) ───
const DIAG_LOG = path.join(
  process.env.HOME ?? '/tmp',
  '.fidra',
  'startup-diag.log',
);
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(DIAG_LOG, line);
  } catch { /* ignore */ }
  console.log('[DIAG]', msg);
}
diag(`Process started — argv: ${process.argv.join(' ')}`);
import { WindowManager, setWindowManager, getWindowManager } from './window/window-manager';
import { loadGlobalSettings, saveGlobalSettings } from './window/global-settings';
import { registerAllHandlers } from './ipc/register-all';
import { buildMenu } from './menu/app-menu';

import { openStartupWindow } from './services/startup';
import { initializeUpdateChecks } from './services/update-checker';

// Single instance lock (Windows/Linux deep link handling)
const installerEvent = squirrelEvent(process.platform, process.argv);
const gotTheLock = app.requestSingleInstanceLock();
if (installerEvent) {
  void app.whenReady().then(() => runSquirrelHelper(installerEvent, gotTheLock)).catch((error: unknown) => {
    console.warn('[INSTALLER] Financial files were kept; device cleanup needs attention:', String(error));
  }).finally(() => app.quit());
}
diag(`Single instance lock acquired: ${gotTheLock}`);
if (!gotTheLock && !installerEvent) {
  diag('Quitting — another instance has the lock');
  app.quit();
} else {
  app.on('second-instance', (_event, args) => {
    if (squirrelEvent(process.platform, args) === '--squirrel-uninstall') {
      personalAiBridge.stop();
      if (getWindowManager().isPreparingOperation) return;
      void resetOpenDeviceState().catch((error: unknown) => {
        for (const ctx of getWindowManager().getAllContexts()) if (ctx.isClosed) getWindowManager().reopenWindowDatabase(ctx.window.webContents.id);
        dialog.showErrorBox('Finish your work before closing Fidra', String(error));
      });
      return;
    }
    // Focus existing window
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      if (allWindows[0].isMinimized()) allWindows[0].restore();
      allWindows[0].focus();
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('[MAIN] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled rejection:', reason);
});

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

app.on('ready', async () => {
  if (installerEvent || !gotTheLock) return;
  diag('app.ready fired');
  // ─── Content Security Policy ────────────────────────────────────
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const csp = [
    `default-src 'self'`,
    // Scripts: self + inline for dark-mode bootstrap; dev adds unsafe-eval for Vite HMR
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // Styles: self + inline (Tailwind) + Google Fonts
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    // Fonts: self + Google Fonts CDN
    `font-src 'self' https://fonts.gstatic.com`,
    // Images: self + data URIs (base64 logos, generated charts)
    `img-src 'self' data:`,
    // Connect: self; dev adds ws: for Vite HMR websocket
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    // No embedding frames, objects, or forms to external targets
    `frame-src 'none'`,
    `object-src 'none'`,
    `form-action 'self'`,
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  setWindowManager(new WindowManager());
  registerAllHandlers();
  buildMenu();

  try {
    const settings = loadGlobalSettings();
    await openStartupWindow();
    diag('Window created successfully');

    const reopenPaths = settings.updateReopenPaths;
    if (Array.isArray(reopenPaths)) {
      for (const reopenPath of [...new Set(reopenPaths)].slice(0, 20)) {
        if (typeof reopenPath !== 'string' || !path.isAbsolute(reopenPath) || !fs.existsSync(reopenPath)) continue;
        await getWindowManager().createWindow(reopenPath).then((ctx) => {
          if (ctx) getWindowManager().markStartupComplete(ctx.window.webContents.id);
        }).catch((error: unknown) => diag(`Could not reopen update window: ${String(error)}`));
      }
      const currentSettings = loadGlobalSettings();
      delete currentSettings.updateReopenPaths;
      saveGlobalSettings(currentSettings);
    }
    initializeUpdateChecks();
  } catch (e) {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    diag(`FAILED to create window: ${msg}`);
    dialog.showErrorBox('Fidra Startup Error', msg);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await openStartupWindow().catch((error: unknown) => {
      dialog.showErrorBox('Fidra Startup Error', String(error));
    });
  }
});
