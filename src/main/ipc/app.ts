import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveContext } from './context-resolver';
import { openDialogOptionsSchema, saveDialogOptionsSchema, printToPdfOptionsSchema } from '../../shared/ipc-schemas';

// File-operation handlers (showOpenDialog, showSaveDialog, writeFile, writeFileBinary,
// readFileBase64, printToPDF) are OS-level operations that don't need per-database context,
// so they intentionally skip resolveContext.
export function registerAppHandlers(): void {
  ipcMain.handle('app:getDbPath', (event) => {
    return resolveContext(event).dbPath;
  });

  ipcMain.handle('app:getAboutInfo', () => {
    return {
      version: app.getVersion(),
      description: 'Financial ledger and treasury management for organisations',
      logPath: path.join(os.homedir(), '.fidra', 'logs', 'fidra.log'),
    };
  });

  ipcMain.handle('app:showOpenDialog', async (event, options: unknown) => {
    const validated = openDialogOptionsSchema.parse(options);
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: validated.title,
      filters: validated.filters,
      properties: (validated.properties as ('openFile' | 'multiSelections')[]) ?? ['openFile', 'multiSelections'],
    });
    return { filePaths: result.filePaths, canceled: result.canceled };
  });

  ipcMain.handle('app:showSaveDialog', async (event, options: unknown) => {
    const validated = saveDialogOptionsSchema.parse(options);
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: validated.title,
      defaultPath: validated.defaultPath,
      filters: validated.filters,
    });
    return { filePath: result.filePath, canceled: result.canceled };
  });

  ipcMain.handle('app:writeFile', (_event, filePath: unknown, content: unknown, encoding?: unknown) => {
    const validPath = z.string().parse(filePath);
    const validContent = z.string().parse(content);
    const validEncoding = encoding != null ? z.string().parse(encoding) : 'utf-8';
    fs.writeFileSync(validPath, validContent, { encoding: validEncoding as BufferEncoding });
  });

  ipcMain.handle('app:writeFileBinary', (_event, filePath: unknown, data: unknown) => {
    const validPath = z.string().parse(filePath);
    const validData = z.array(z.number()).parse(data);
    fs.writeFileSync(validPath, Buffer.from(validData));
  });

  ipcMain.handle('app:readFileBase64', (_event, filePath: unknown) => {
    const validPath = z.string().parse(filePath);
    const buf = fs.readFileSync(validPath);
    const ext = validPath.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
    };
    const mime = mimeMap[ext] ?? 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('app:printToPDF', async (_event, html: unknown, options?: unknown) => {
    const validHtml = z.string().parse(html);
    const validOptions = printToPdfOptionsSchema.parse(options);
    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: { offscreen: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(validHtml)}`);
    await win.webContents.executeJavaScript(
      'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 100)))',
    );
    const footerText = (validOptions?.footerText ?? '').replace(/'/g, '&#39;');
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7.5pt;font-family:sans-serif;color:#94a3b8;padding:0 15mm;display:flex;justify-content:space-between;align-items:center"><span>${footerText}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    win.destroy();
    return Array.from(new Uint8Array(pdfBuffer));
  });
}
