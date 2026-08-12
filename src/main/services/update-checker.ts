import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import type { UpdateInfo } from '../../shared/ipc-types';

const RELEASES_URL = 'https://github.com/LordPam/fidra-electron/releases/latest';

// ─── Configuration ──────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null; // We log manually below

/** Whether a silent check found nothing — suppresses "up to date" toast. */
let silentCheck = true;

/** Cached version for fallback download URL. */
let latestVersion: string | null = null;

/**
 * Release asset name for the running platform.
 *
 * Must match the `postMake` rename map in forge.config.ts, which appends the arch
 * for anything other than x64. This is where the manual-download fallback used to
 * 404: it hardcoded `Fidra-macOS.dmg`, the x64 name, while every published build is
 * arm64 and therefore `Fidra-macOS-arm64.dmg`. Deriving it by the same rule means
 * the two can only drift if the rule itself changes.
 */
function releaseAssetName(): string | null {
  if (process.platform === 'darwin') {
    return `Fidra-macOS${process.arch !== 'x64' ? `-${process.arch}` : ''}.dmg`;
  }
  if (process.platform === 'win32') {
    return 'Fidra-Windows-Setup.exe';
  }
  return null;
}

/**
 * Direct download for the update, or the releases page when we cannot name the
 * asset — a wrong direct link is worse than a page the user can navigate.
 */
function fallbackDownloadUrl(): string {
  const asset = releaseAssetName();
  if (!latestVersion || !asset) return RELEASES_URL;
  return `https://github.com/LordPam/fidra-electron/releases/download/v${latestVersion}/${asset}`;
}

function sendToAllWindows(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

/** Strip HTML tags from release notes (GitHub returns HTML). */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapUpdateInfo(raw: ElectronUpdateInfo): UpdateInfo {
  let notes: string | null;
  if (typeof raw.releaseNotes === 'string') {
    notes = stripHtml(raw.releaseNotes).slice(0, 500);
  } else if (Array.isArray(raw.releaseNotes)) {
    notes = raw.releaseNotes
      .map((n) => stripHtml(typeof n === 'string' ? n : n.note ?? ''))
      .join('\n')
      .slice(0, 500);
  } else {
    notes = null;
  }

  return {
    version: raw.version,
    currentVersion: app.getVersion(),
    releaseNotes: notes,
    downloadUrl: null,
  };
}

// ─── autoUpdater events ─────────────────────────────────────────────

autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
  console.log(`[updater] Update available: v${info.version}`);
  latestVersion = info.version;
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

  ipcMain.handle('app:quitAndInstall', async () => {
    console.log('[updater] Quit and install requested by user');
    // App is ad-hoc signed — autoUpdater.quitAndInstall() silently fails
    // on unsigned/ad-hoc apps (no throw, just does nothing). Skip it
    // entirely and go straight to the manual download fallback.
    sendToAllWindows('update:installFailed', fallbackDownloadUrl());
  });

  ipcMain.handle('app:openReleaseUrl', async () => {
    const url = fallbackDownloadUrl();
    console.log('[updater] Opening release URL in browser:', url);
    await shell.openExternal(url);
  });
}
