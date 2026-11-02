import fs from 'node:fs';
import type { WindowContext } from '../window/window-context';
import type { AiSheetCreation } from '../../shared/ai-sheet-types';

/** Other windows refresh through their own authorised reads. Only the requesting
 * window receives the operation's text/receipt and records its Undo command. */
export function notifyAiSheetWindows(context: WindowContext, contexts: WindowContext[], creation: AiSheetCreation, recordUndo = false): void {
  for (const candidate of contexts) {
    try {
      if (candidate.isClosed || fs.realpathSync(candidate.dbPath) !== fs.realpathSync(context.dbPath)) continue;
      candidate.sendToRenderer('localSync:dataChanged', { tables: ['sheets', 'audit_log'] });
      if (recordUndo && candidate === context) candidate.sendToRenderer('ai:sheetCreated', creation);
    } catch { console.warn('[AI] Sheet changed; its window needs a refresh.'); }
  }
}
