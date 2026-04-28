import { app, BrowserWindow, dialog, shell } from 'electron';
import https from 'node:https';

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
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (win) dialog.showMessageBox(win, { type: 'info', title: 'No Updates', message: `You're on the latest version (v${currentVersion}).` });
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

        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        if (!win) return;

        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Update Available',
          message: `Fidra v${latest} is available (you have v${currentVersion}).`,
          detail: release.body ? String(release.body).slice(0, 300) : undefined,
          buttons: ['Download', 'Later'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) {
            const url = downloadUrl ?? `https://github.com/LordPam/fidra-electron/releases/latest`;
            shell.openExternal(url);
          }
        });
      } catch { /* ignore parse errors */ }
    });
  }).on('error', () => { /* ignore network errors */ });
}
