import { Menu, app, dialog, BrowserWindow } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { getWindowManager } from '../window/window-manager';
import { loadGlobalSettings, removeRecentFile, markFirstRunComplete } from '../window/global-settings';
import { checkForUpdates } from '../services/update-checker';

function buildCloudServersSubmenu(): MenuItemConstructorOptions[] {
  const settings = loadGlobalSettings();

  const items: MenuItemConstructorOptions[] = settings.cloudServers.map((server) => ({
    label: server.name,
    click: async () => {
      const ctx = await getWindowManager().createCloudWindow(server.id);
      getWindowManager().markStartupComplete(ctx.window.webContents.id);
    },
  }));

  if (items.length > 0) {
    items.push({ type: 'separator' });
  }

  items.push({
    label: 'Add Cloud Server...',
    click: () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        win.webContents.send('menu:addCloudServer');
      }
    },
  });

  return items;
}

function buildRecentFilesSubmenu(): MenuItemConstructorOptions[] {
  const settings = loadGlobalSettings();
  if (settings.recentFiles.length === 0) {
    return [{ label: 'No Recent Files', enabled: false }];
  }

  const items: MenuItemConstructorOptions[] = settings.recentFiles.map((entry) => ({
    label: entry.name,
    sublabel: entry.path,
    click: async () => {
      try {
        const wm = getWindowManager();
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        if (win) {
          const reloaded = await wm.switchWindowToFile(win.webContents.id, entry.path);
          wm.markStartupComplete(win.webContents.id);
          if (!reloaded) win.webContents.reload();
        } else {
          const ctx = await wm.createWindow(entry.path);
          wm.markStartupComplete(ctx.window.webContents.id);
        }
        markFirstRunComplete();
        buildMenu();
      } catch (e) {
        console.error('[MENU] Open Recent failed:', e instanceof Error ? e.message : String(e));
        dialog.showErrorBox('Failed to open database', e instanceof Error ? e.message : String(e));
      }
    },
  }));

  items.push({ type: 'separator' });
  items.push({
    label: 'Clear Recent',
    click: () => {
      const settings = loadGlobalSettings();
      for (const entry of settings.recentFiles) {
        removeRecentFile(entry.path);
      }
      buildMenu();
    },
  });

  return items;
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [];

  // macOS app menu
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // File menu
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Database',
        accelerator: 'CmdOrCtrl+N',
        click: async () => {
          console.log('[MENU] New Database clicked');
          const win = BrowserWindow.getFocusedWindow();
          const target = win ?? BrowserWindow.getAllWindows()[0];
          const result = await dialog.showSaveDialog(target, {
            title: 'Create New Fidra Database',
            defaultPath: path.join(os.homedir(), 'Documents', 'finances.fdra'),
            filters: [{ name: 'Fidra Database', extensions: ['fdra'] }],
          });
          if (!result.canceled && result.filePath) {
            try {
              const wm = getWindowManager();
              // Switch the focused window instead of creating a new one
              // (avoids orphan wizard windows and matches the renderer dialog flow)
              if (target) {
                const reloaded = await wm.switchWindowToFile(target.webContents.id, result.filePath);
                wm.markStartupComplete(target.webContents.id);
                if (!reloaded) target.webContents.reload();
              } else {
                const ctx = await wm.createWindow(result.filePath);
                wm.markStartupComplete(ctx.window.webContents.id);
              }
              markFirstRunComplete();
              buildMenu();
            } catch (e) {
              console.error('[MENU] New Database failed:', e instanceof Error ? e.message : String(e));
              dialog.showErrorBox('Failed to create database', e instanceof Error ? e.message : String(e));
            }
          }
        },
      },
      {
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          try {
            console.log('[MENU] Open File clicked');
            const win = BrowserWindow.getFocusedWindow();
            const target = win ?? BrowserWindow.getAllWindows()[0];
            console.log('[MENU] Target window:', target ? 'found' : 'null');
            const result = await dialog.showOpenDialog(target, {
              title: 'Open Fidra Database',
              filters: [
                { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
                { name: 'All Files', extensions: ['*'] },
              ],
              properties: ['openFile'],
            });
            console.log('[MENU] Dialog result:', result.canceled ? 'canceled' : result.filePaths[0]);
            if (!result.canceled && result.filePaths.length > 0) {
              const wm = getWindowManager();
              if (target) {
                const reloaded = await wm.switchWindowToFile(target.webContents.id, result.filePaths[0]);
                wm.markStartupComplete(target.webContents.id);
                // If same file was already loaded (no reload), force a reload so
                // the renderer re-evaluates startup mode and dismisses the wizard
                if (!reloaded) target.webContents.reload();
              } else {
                const ctx = await wm.createWindow(result.filePaths[0]);
                wm.markStartupComplete(ctx.window.webContents.id);
              }
              markFirstRunComplete();
              buildMenu();
            }
          } catch (e) {
            console.error('[MENU] Open File failed:', e instanceof Error ? e.message : String(e));
            dialog.showErrorBox('Failed to open database', e instanceof Error ? e.message : String(e));
          }
        },
      },
      {
        label: 'Open Recent',
        submenu: buildRecentFilesSubmenu(),
      },
      {
        label: 'Open Cloud Server',
        submenu: buildCloudServersSubmenu(),
      },
      { type: 'separator' },
      {
        label: 'Import CSV...',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) {
            win.webContents.send('menu:importCsv');
          }
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  // Edit menu
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  // View menu
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      {
        label: 'Zoom In (Plus)',
        accelerator: 'CommandOrControl+Shift+=',
        visible: false,
        click: (_mi, win) => { if (win && 'webContents' in win) (win as BrowserWindow).webContents.zoomLevel += 0.5; },
      },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  // Window menu
  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            { role: 'front' } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  });

  // Help menu
  template.push({
    role: 'help',
    submenu: [
      {
        label: 'Check for Updates…',
        click: () => checkForUpdates(false),
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
