import { app, BrowserWindow, session, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';

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
import { loadGlobalSettings } from './window/global-settings';
import { registerAllHandlers } from './ipc/register-all';
import { buildMenu } from './menu/app-menu';

diag(`electron-squirrel-startup = ${started}`);
if (started) {
  diag('Quitting due to squirrel startup');
  app.quit();
}

updateElectronApp({
  updateSource: {
    type: UpdateSourceType.ElectronPublicUpdateService,
    repo: 'LordPam/fidra-electron',
  },
  updateInterval: '1 hour',
  notifyUser: true,
  logger: {
    log: (...args: unknown[]) => console.log('[updater]', ...args),
    info: (...args: unknown[]) => console.log('[updater]', ...args),
    warn: (...args: unknown[]) => {},   // suppress "no releases" warnings
    error: (...args: unknown[]) => {},  // suppress "invalid response" errors (no releases yet)
  },
});

// Register fidra:// deep link protocol (for OAuth callbacks)
if (process.defaultApp) {
  // Dev mode: register with the full path to electron
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('fidra', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('fidra');
}

// Single instance lock (Windows/Linux deep link handling)
const gotTheLock = app.requestSingleInstanceLock();
diag(`Single instance lock acquired: ${gotTheLock}`);
if (!gotTheLock) {
  diag('Quitting — another instance has the lock');
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux: deep link URL is in argv
    const url = argv.find((arg) => arg.startsWith('fidra://'));
    if (url) handleDeepLink(url);

    // Focus existing window
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      if (allWindows[0].isMinimized()) allWindows[0].restore();
      allWindows[0].focus();
    }
  });
}

// macOS: deep link handling
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url: string): void {
  console.log('[DEEP-LINK] Received:', url);
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
      const code = parsed.searchParams.get('code');
      if (code) {
        // Find the window context that initiated the OAuth flow and dispatch the callback
        const wm = getWindowManager();
        for (const ctx of wm.getAllContexts()) {
          if (ctx.sessionManager) {
            ctx.sendToRenderer('auth:oauthCallback', code);
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error('[DEEP-LINK] Failed to parse URL:', e);
  }
}

// Prevent uncaught pg connection errors from crashing the app
process.on('uncaughtException', (err) => {
  const msg = err?.message ?? '';
  if (msg.includes('Connection terminated') || msg.includes('connection reset') || msg.includes('ECONNRESET')) {
    console.warn('[MAIN] Suppressed transient pg error:', msg);
    return;
  }
  console.error('[MAIN] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  const msg = String(reason);
  if (msg.includes('Connection terminated') || msg.includes('connection reset') || msg.includes('ECONNRESET')) {
    console.warn('[MAIN] Suppressed transient pg rejection:', msg);
    return;
  }
  console.error('[MAIN] Unhandled rejection:', reason);
});

function getDefaultDbPath(): string {
  return path.join(app.getPath('userData'), 'fidra.db');
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

app.on('ready', async () => {
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
    const dbPath = settings.lastFile ?? getDefaultDbPath();
    diag(`Creating window for: ${dbPath}`);
    try {
      await getWindowManager().createWindow(dbPath);
    } catch (e) {
      // If the saved lastFile can't be opened (e.g. iCloud not materialised,
      // file moved/deleted), fall back to the default database path.
      const fallback = getDefaultDbPath();
      if (dbPath !== fallback) {
        diag(`Failed to open ${dbPath}, falling back to ${fallback}: ${e instanceof Error ? e.message : String(e)}`);
        await getWindowManager().createWindow(fallback);
      } else {
        throw e;
      }
    }
    diag('Window created successfully');
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
    try {
      const settings = loadGlobalSettings();
      const dbPath = settings.lastFile ?? getDefaultDbPath();
      try {
        await getWindowManager().createWindow(dbPath);
      } catch (e) {
        const fallback = getDefaultDbPath();
        if (dbPath !== fallback) {
          diag(`activate: fallback to ${fallback}: ${e instanceof Error ? e.message : String(e)}`);
          await getWindowManager().createWindow(fallback);
        } else {
          throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.stack ?? e.message : String(e);
      diag(`activate: FAILED: ${msg}`);
      dialog.showErrorBox('Fidra Startup Error', msg);
    }
  }
});
