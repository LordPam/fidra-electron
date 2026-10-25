import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { UpdatePreparationReply } from '../../shared/update-types';
import { getWindowManager } from '../window/window-manager';
import { loadGlobalSettings, saveGlobalSettings } from '../window/global-settings';
import { resolveContext } from '../ipc/context-resolver';
import { RELEASES_URL, releaseAssetName } from './update-manifest';
import { VerifiedUpdater } from './verified-updater';

let updater: VerifiedUpdater;
let initialized: Promise<unknown> = Promise.resolve();
let startupTimer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let installing = false;
const pending = new Map<number, { requestId: string; resolve: (reply: UpdatePreparationReply) => void }>();
const preparationCleanup: (() => void)[] = [];
const replySchema = z.object({ requestId: z.string().uuid(), reason: z.string().max(1000).nullable() }).strict();

function broadcast(channel: string, value?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, value);
  }
}

export function registerUpdateHandlers(): void {
  // A missing public key must fail closed; development builds never contact the feed.
  const keyPath = path.join(process.resourcesPath, 'update-public-key.pem');
  const publicKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
  updater = new VerifiedUpdater({ directory: path.join(app.getPath('userData'), 'updates'),
    version: app.getVersion(), platform: process.platform, arch: process.arch, publicKey,
    enabled: app.isPackaged && process.env.FIDRA_E2E !== '1' && releaseAssetName(process.platform, process.arch) !== null,
    onChange: (status) => broadcast('updates:status', status) });
  initialized = updater.initialize();

  ipcMain.handle('updates:getStatus', async (event) => { resolveContext(event); await initialized; return updater.getStatus(); });
  ipcMain.handle('updates:check', async (event) => { resolveContext(event); await initialized; return updater.check(); });
  ipcMain.handle('updates:download', async (event) => { resolveContext(event); await initialized; return updater.download(); });
  ipcMain.handle('updates:setAutomatic', async (event, value: unknown) => {
    resolveContext(event);
    const automatic = z.boolean().parse(value);
    await initialized;
    return updater.setAutomatic(automatic).catch((error: unknown) => updater.fail(error));
  });
  ipcMain.handle('updates:remindLater', async (event) => {
    resolveContext(event); await initialized;
    return updater.remindLater().catch((error: unknown) => updater.fail(error));
  });
  ipcMain.handle('updates:openReleasePage', async (event) => {
    resolveContext(event);
    await shell.openExternal(RELEASES_URL);
  });
  ipcMain.handle('updates:prepared', (event, raw: unknown) => {
    resolveContext(event);
    const reply = replySchema.parse(raw);
    const waiting = pending.get(event.sender.id);
    if (waiting?.requestId === reply.requestId) waiting.resolve(reply);
  });
  ipcMain.handle('updates:openInstaller', async (event) => {
    resolveContext(event);
    if (installing) return updater.getStatus();
    installing = true;
    try {
      await initialized;
      await updater.verifiedInstaller();
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error('This window is no longer available.');
      const confirmation = await dialog.showMessageBox(win, {
        type: 'info', title: 'Open Fidra installer', message: 'Close Fidra and open the update installer?',
        detail: 'Fidra will finish saving in every open window, then quit. Complete the installation and reopen Fidra. Your ledgers and Local Sync setup will stay in place.',
        buttons: ['Cancel', 'Open installer'], defaultId: 0, cancelId: 0,
      });
      if (confirmation.response !== 1) return updater.getStatus();
      getWindowManager().setUpdatePreparing(true);
      updater.setPreparing(true);
      const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const replies = await Promise.all(windows.map((window) => prepareWindow(window)));
      const blocked = replies.find((reply) => reply.reason);
      if (blocked) throw new Error(blocked.reason ?? 'A window needs attention.');
      const current = BrowserWindow.getAllWindows();
      if (current.length !== windows.length || windows.some((window) => window.isDestroyed() || !pending.has(window.webContents.id))) {
        throw new Error('The open windows changed. Please try opening the installer again.');
      }
      // Local Sync is optional; do not wait for a network connection or force an export.
      const contexts = getWindowManager().getAllContexts();
      if (contexts.some((ctx) => ['importing', 'exporting'].includes(ctx.localSyncOrchestrator?.getStatus().state ?? ''))) {
        throw new Error('A local sync task is finishing. Please try again in a moment.');
      }
      const installer = await updater.verifiedInstaller();
      const error = await shell.openPath(installer);
      if (error) throw new Error(`The installer could not be opened: ${error}`);
      if (contexts.some((ctx) => ['importing', 'exporting'].includes(ctx.localSyncOrchestrator?.getStatus().state ?? ''))) {
        throw new Error('A local sync task is finishing. Please try again in a moment.');
      }
      if (windows.some((window) => window.isDestroyed() || !pending.has(window.webContents.id))) {
        throw new Error('A window closed or reloaded. Please try again.');
      }
      const settings = loadGlobalSettings();
      settings.updateReopenPaths = contexts.map((ctx) => ctx.dbPath);
      saveGlobalSettings(settings, true);
      await getWindowManager().closeAll();
      app.quit();
      return updater.getStatus();
    } catch (error) {
      // A failed shutdown must not leave a visible window using a closed database.
      const manager = getWindowManager();
      for (const ctx of manager.getAllContexts()) {
        if (ctx.isClosed && !ctx.window.isDestroyed()) {
          manager.reopenWindowDatabase(ctx.window.webContents.id);
        }
      }
      updater.setPreparing(false);
      return updater.fail(error);
    } finally {
      for (const cleanup of preparationCleanup.splice(0)) cleanup();
      pending.clear();
      getWindowManager().setUpdatePreparing(false);
      broadcast('updates:cancelPreparation');
      installing = false;
    }
  });
}

function prepareWindow(window: BrowserWindow): Promise<UpdatePreparationReply> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ requestId, reason: 'A window did not finish preparing. Close any dialogs and try again.' }), 20_000);
    pending.set(window.webContents.id, { requestId, resolve: (reply) => { clearTimeout(timer); resolve(reply); } });
    const invalidate = () => pending.delete(window.webContents.id);
    window.webContents.once('did-start-loading', invalidate);
    preparationCleanup.push(() => { clearTimeout(timer); window.webContents.removeListener('did-start-loading', invalidate); });
    window.webContents.send('updates:prepare', requestId);
  });
}

export async function checkForUpdates(silent = true): Promise<void> {
  await initialized;
  if (silent && !updater.getStatus().automatic) return;
  if (!silent) BrowserWindow.getFocusedWindow()?.webContents.send('updates:showSettings');
  const result = await updater.check();
  if (silent && result.phase === 'available' && result.automatic) await updater.download();
}

export function initializeUpdateChecks(): void {
  startupTimer = setTimeout(() => void checkForUpdates(), 30_000);
  interval = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  powerMonitor.on('resume', onResume);
  app.once('will-quit', () => {
    clearTimeout(startupTimer); clearInterval(interval); powerMonitor.removeListener('resume', onResume);
  });
}

function onResume(): void {
  const last = updater.getStatus().lastCheckedAt;
  if (!last || Date.now() - Date.parse(last) > 6 * 60 * 60 * 1000) void checkForUpdates();
}
