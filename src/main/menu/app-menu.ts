import { Menu, app, dialog, BrowserWindow } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { getWindowManager } from '../window/window-manager';
import { loadGlobalSettings, removeRecentFile } from '../window/global-settings';

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
      const ctx = await getWindowManager().createWindow(entry.path);
      getWindowManager().markStartupComplete(ctx.window.webContents.id);
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
          const win = BrowserWindow.getFocusedWindow();
          const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
            title: 'Create New Fidra Database',
            defaultPath: path.join(os.homedir(), 'Documents', 'finances.fdra'),
            filters: [{ name: 'Fidra Database', extensions: ['fdra'] }],
          });
          if (!result.canceled && result.filePath) {
            const wm = getWindowManager();
            const ctx = await wm.createWindow(result.filePath);
            wm.markStartupComplete(ctx.window.webContents.id);
            buildMenu();
          }
        },
      },
      {
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
            title: 'Open Fidra Database',
            filters: [
              { name: 'Fidra Database', extensions: ['fdra', 'db', 'sqlite'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile'],
          });
          if (!result.canceled && result.filePaths.length > 0) {
            const wm = getWindowManager();
            const ctx = await wm.createWindow(result.filePaths[0]);
            wm.markStartupComplete(ctx.window.webContents.id);
            buildMenu();
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
        click: (_mi, win) => { if (win) win.webContents.zoomLevel += 0.5; },
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

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
