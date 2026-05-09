import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import type { UpdateInfo } from '../../shared/ipc-types';

// ─── Configuration ──────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null; // We log manually below

/** Whether a silent check found nothing — suppresses "up to date" toast. */
let silentCheck = true;

function sendToAllWindows(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

function mapUpdateInfo(raw: ElectronUpdateInfo): UpdateInfo {
  const notes = typeof raw.releaseNotes === 'string'
    ? raw.releaseNotes.slice(0, 500)
    : Array.isArray(raw.releaseNotes)
      ? raw.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n').slice(0, 500)
      : null;

  return {
    version: raw.version,
    currentVersion: app.getVersion(),
    releaseNotes: notes,
    downloadUrl: null, // Not needed — electron-updater handles downloads internally
  };
}

// ─── autoUpdater events ─────────────────────────────────────────────

autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
  console.log(`[updater] Update available: v${info.version}`);
  sendToAllWindows('update:available', mapUpdateInfo(info));
});

autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
  console.log(`[updater] Already on latest version (v${info.version})`);
  if (!silentCheck) {
    sendToAllWindows('update:upToDate', app.getVersion());
  }
});

autoUpdater.on('download-progress', (progress: ProgressInfo) => {
  console.log(`[updater] Download progress: ${progress.percent.toFixed(1)}%`);
  sendToAllWindows('update:downloadProgress', {
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
  });
});

autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
  console.log(`[updater] Update downloaded: v${info.version}`);
  sendToAllWindows('update:downloaded', mapUpdateInfo(info));
});

autoUpdater.on('error', (err: Error) => {
  console.error('[updater] Error:', err.message);
  if (!silentCheck) {
    sendToAllWindows('update:error', err.message);
  }
});

// ─── Public API ─────────────────────────────────────────────────────

export function checkForUpdates(silent = true): void {
  if (!app.isPackaged) {
    console.log('[updater] Skipping update check — app is not packaged');
    return;
  }

  silentCheck = silent;
  console.log(`[updater] Checking for updates (current: v${app.getVersion()}, silent: ${silent})`);
  autoUpdater.checkForUpdates().catch((err: Error) => {
    console.error('[updater] checkForUpdates failed:', err.message);
    if (!silent) {
      sendToAllWindows('update:error', `Update check failed: ${err.message}`);
    }
  });
}

// ─── IPC handler registration ───────────────────────────────────────

export function registerUpdateHandlers(): void {
  ipcMain.handle('app:installUpdate', async () => {
    console.log('[updater] Download requested by user');
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle('app:quitAndInstall', () => {
    console.log('[updater] Quit and install requested by user');
    autoUpdater.quitAndInstall();
  });
}
