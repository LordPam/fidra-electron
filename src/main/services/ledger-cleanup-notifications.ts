import fs from 'node:fs';
import type { WindowContext } from '../window/window-context';
import type { LedgerCleanupReceipt } from '../../shared/ledger-cleanup-types';

export function notifyLedgerCleanupWindows(context: WindowContext, contexts: WindowContext[], receipt: LedgerCleanupReceipt, recordUndo: boolean) {
  for (const candidate of contexts) {
    try {
      if (candidate.isClosed || fs.realpathSync(candidate.dbPath) !== fs.realpathSync(context.dbPath)) continue;
      candidate.sendToRenderer('localSync:dataChanged', { tables: ['sheets', 'transactions', 'planned_templates', 'invoices', 'categories', 'activity_notes', 'settings', 'audit_log'] });
      if (recordUndo && candidate === context) candidate.sendToRenderer('ai:cleanupCommitted', { id: receipt.id, label: receipt.label, state: receipt.state });
    } catch { console.warn('[AI] Cleanup completed; its window needs a refresh.'); }
  }
}
