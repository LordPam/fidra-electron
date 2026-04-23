import type { IpcMainInvokeEvent } from 'electron';
import { getWindowManager } from '../window/window-manager';
import type { WindowContext } from '../window/window-context';

export function resolveContext(event: IpcMainInvokeEvent): WindowContext {
  const ctx = getWindowManager().getContext(event.sender.id);
  if (!ctx) {
    throw new Error(`No window context for webContents ${event.sender.id}`);
  }
  return ctx;
}
