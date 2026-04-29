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
  console.log(`[updater] Checking for updates (current: v${currentVersion}, silent: ${silent})`);

  const options = {
    hostname: 'api.github.com',
    path: '/repos/LordPam/fidra-electron/releases/latest',
    headers: { 'User-Agent': `Fidra/${currentVersion}` },
  };

  https.get(options, (res) => {
    // Follow redirects (GitHub API shouldn't redirect, but handle it)
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log(`[updater] Following redirect to ${res.headers.location}`);
      https.get(res.headers.location, { headers: options.headers }, handleResponse).on('error', handleError);
      return;
    }

    handleResponse(res);

    function handleResponse(response: typeof res): void {
      if (response.statusCode !== 200) {
        console.error(`[updater] GitHub API returned status ${response.statusCode}`);
        if (!silent) sendToAllWindows('update:error', `Update check failed (HTTP ${response.statusCode})`);
        return;
      }

      let data = '';
      response.on('data', (chunk: Buffer) => { data += chunk; });
      response.on('end', () => {
        try {
          const release = JSON.parse(data);
          const tagName = release.tag_name as string | undefined;
          if (!tagName) {
            console.error('[updater] No tag_name in release response');
            if (!silent) sendToAllWindows('update:error', 'Update check failed (no version in response)');
            return;
          }

          const latest = tagName.replace(/^v/, '');
          console.log(`[updater] Latest release: v${latest}, current: v${currentVersion}`);

          if (latest === currentVersion) {
            console.log('[updater] Already on latest version');
            if (!silent) sendToAllWindows('update:upToDate', currentVersion);
            return;
          }

          // Simple semver comparison (works for x.y.z)
          const cur = currentVersion.split('.').map(Number);
          const lat = latest.split('.').map(Number);
          const isNewer = lat[0] > cur[0] ||
            (lat[0] === cur[0] && lat[1] > cur[1]) ||
            (lat[0] === cur[0] && lat[1] === cur[1] && lat[2] > cur[2]);

          if (!isNewer) {
            console.log(`[updater] Remote version v${latest} is not newer than v${currentVersion}`);
            if (!silent) sendToAllWindows('update:upToDate', currentVersion);
            return;
          }

          // Find the right download asset for this platform
          const assets = release.assets as { name: string; browser_download_url: string }[];
          console.log(`[updater] Release assets: ${assets.map((a) => a.name).join(', ') || '(none)'}`);

          let downloadUrl: string | undefined;
          if (process.platform === 'darwin') {
            downloadUrl = assets.find((a) => a.name.endsWith('.dmg'))?.browser_download_url;
          } else if (process.platform === 'win32') {
            downloadUrl = assets.find((a) => a.name.endsWith('Setup.exe'))?.browser_download_url;
          }

          if (!downloadUrl) {
            console.warn(`[updater] No ${process.platform} asset found in release v${latest}`);
          }

          const info: UpdateInfo = {
            version: latest,
            currentVersion,
            releaseNotes: release.body ? String(release.body).slice(0, 500) : null,
            downloadUrl: downloadUrl ?? null,
          };
          pendingUpdate = info;
          console.log(`[updater] Update available: v${latest} (download: ${downloadUrl ?? 'release page'})`);
          sendToAllWindows('update:available', info);
        } catch (e) {
          console.error('[updater] Failed to parse release response:', e instanceof Error ? e.message : String(e));
          if (!silent) sendToAllWindows('update:error', 'Update check failed (invalid response)');
        }
      });
    }
  }).on('error', handleError);

  function handleError(e: Error): void {
    console.error('[updater] Network error:', e.message);
    if (!silent) sendToAllWindows('update:error', `Update check failed: ${e.message}`);
  }
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
