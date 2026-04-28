import { app, BrowserWindow, ipcMain, shell } from 'electron';
import https from 'node:https';
import type { UpdateInfo } from '../../shared/ipc-types';

const RELEASES_URL = 'https://github.com/LordPam/fidra-electron/releases/latest';

/** Cached release info so the install handler knows what to download. */
let pendingUpdate: UpdateInfo | null = null;

function sendToAllWindows(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

export function checkForUpdates(silent = true): void {
  if (process.defaultApp) {
    console.log('[updater] Skipping update check in dev mode');
    return;
  }

  const currentVersion = app.getVersion();
  const options = {
    hostname: 'api.github.com',
    path: '/repos/LordPam/fidra-electron/releases/latest',
    headers: { 'User-Agent': `Fidra/${currentVersion}` },
  };

  https.get(options, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', (chunk: Buffer) => { data += chunk; });
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latest = (release.tag_name as string).replace(/^v/, '');
        if (latest === currentVersion) {
          if (!silent) {
            sendToAllWindows('update:upToDate', currentVersion);
          }
          return;
        }

        // Simple semver comparison (works for x.y.z)
        const cur = currentVersion.split('.').map(Number);
        const lat = latest.split('.').map(Number);
        const isNewer = lat[0] > cur[0] ||
          (lat[0] === cur[0] && lat[1] > cur[1]) ||
          (lat[0] === cur[0] && lat[1] === cur[1] && lat[2] > cur[2]);
        if (!isNewer) return;

        // Find the right download asset for this platform
        const assets = release.assets as { name: string; browser_download_url: string }[];
        let downloadUrl: string | undefined;
        if (process.platform === 'darwin') {
          downloadUrl = assets.find((a) => a.name.endsWith('.dmg'))?.browser_download_url;
        } else if (process.platform === 'win32') {
          downloadUrl = assets.find((a) => a.name.endsWith('Setup.exe'))?.browser_download_url;
        }

        const info: UpdateInfo = {
          version: latest,
          currentVersion,
          releaseNotes: release.body ? String(release.body).slice(0, 500) : null,
          downloadUrl: downloadUrl ?? null,
        };
        pendingUpdate = info;
        sendToAllWindows('update:available', info);
      } catch { /* ignore parse errors */ }
    });
  }).on('error', () => { /* ignore network errors */ });
}

// ─── Install ────────────────────────────────────────────────────────
//
// Current strategy: open the platform-specific download URL in the
// default browser. The user downloads and installs manually (drag .app
// to /Applications on macOS, run Setup.exe on Windows).
//
// TODO: Once packaging is set up (code signing, notarization), switch
// to Electron's built-in autoUpdater (Squirrel.Mac / Squirrel.Windows)
// which handles download, signature verification, privilege escalation,
// and atomic app replacement automatically. That requires:
//   1. Code-signed + notarized builds
//   2. .zip assets published alongside .dmg (Squirrel.Mac needs zips)
//   3. A Squirrel-compatible feed URL (update.electronjs.org for public
//      GitHub repos, or a custom endpoint)
//
// At that point this entire function is replaced by:
//   autoUpdater.setFeedURL({ url: feedUrl });
//   autoUpdater.checkForUpdates();
//   autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());

async function openDownloadPage(): Promise<void> {
  const url = pendingUpdate?.downloadUrl ?? RELEASES_URL;
  await shell.openExternal(url);
}

// ─── IPC handler registration ───────────────────────────────────────

export function registerUpdateHandlers(): void {
  ipcMain.handle('app:installUpdate', async () => {
    await openDownloadPage();
  });
}
