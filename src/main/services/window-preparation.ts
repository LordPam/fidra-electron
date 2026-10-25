import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getWindowManager } from '../window/window-manager';
import { resolveContext } from '../ipc/context-resolver';

const replySchema = z.object({ requestId: z.string().uuid(), reason: z.string().max(1000).nullable() }).strict();
const pending = new Map<number, { id: string; reply: (reason: string | null) => void }>();
let busy = false;

export function registerPreparationHandlers(): void {
  ipcMain.handle('device:prepared', (event, raw: unknown) => {
    resolveContext(event);
    const reply = replySchema.parse(raw);
    const waiting = pending.get(event.sender.id);
    if (waiting?.id === reply.requestId) waiting.reply(reply.reason);
  });
}

/** Hold the window set and IPC writers until the caller completes or aborts. */
export async function withPreparedWindows<T>(work: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Another device action is already running.');
  busy = true;
  const manager = getWindowManager();
  manager.setUpdatePreparing(true);
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  const cleanups: (() => void)[] = [];
  return (async () => {
    const reasons = await Promise.all(windows.map((win) => new Promise<string | null>((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => resolve('A window is still busy. Finish its work and try again.'), 20_000);
      const invalid = () => pending.delete(win.webContents.id);
      pending.set(win.webContents.id, { id, reply: resolve });
      win.webContents.once('did-start-loading', invalid);
      cleanups.push(() => { clearTimeout(timer); win.webContents.removeListener('did-start-loading', invalid); });
      win.webContents.send('device:prepare', id);
    })));
    const blocked = reasons.find(Boolean);
    if (blocked) throw new Error(blocked);
    if (BrowserWindow.getAllWindows().length !== windows.length || windows.some((win) => win.isDestroyed() || !pending.has(win.webContents.id))) {
      throw new Error('The open windows changed. Please try again.');
    }
    if (manager.getAllContexts().some((ctx) => ['importing', 'exporting'].includes(ctx.localSyncOrchestrator?.getStatus().state ?? ''))) {
      throw new Error('Local Sync is finishing a task. Please try again in a moment.');
    }
    return work();
  })().finally(() => {
    for (const cleanup of cleanups) cleanup();
    pending.clear();
    manager.setUpdatePreparing(false);
    for (const win of windows) if (!win.isDestroyed()) win.webContents.send('device:cancelPreparation');
    busy = false;
  });
}
