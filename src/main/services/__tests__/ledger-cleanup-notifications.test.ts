import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WindowContext } from '../../window/window-context';
import { notifyLedgerCleanupWindows } from '../ledger-cleanup-notifications';

describe('cleanup notification privacy', () => {
  it('refreshes only the same ledger and sends only a short receipt to the requesting window', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-cleanup-events-'));
    try {
      const same = path.join(root, 'same.fdra'), different = path.join(root, 'different.fdra');
      fs.writeFileSync(same, ''); fs.writeFileSync(different, '');
      const window = (dbPath: string, closed = false) => ({ dbPath, isClosed: closed, sendToRenderer: vi.fn() } as unknown as WindowContext);
      const source = window(same), other = window(same), foreign = window(different), closed = window(same, true);
      const receipt = { id: 'a'.repeat(64), label: 'Synthetic cleanup', state: 'committed' as const, before: [{ description: 'PRIVATE SNAPSHOT' }] };
      notifyLedgerCleanupWindows(source, [source, other, foreign, closed], receipt, true);
      expect(source.sendToRenderer).toHaveBeenCalledWith('ai:cleanupCommitted', { id: receipt.id, label: receipt.label, state: receipt.state });
      expect(JSON.stringify(vi.mocked(source.sendToRenderer).mock.calls)).not.toContain('PRIVATE SNAPSHOT');
      expect(other.sendToRenderer).toHaveBeenCalledExactlyOnceWith('localSync:dataChanged', { tables: ['sheets', 'transactions', 'planned_templates', 'invoices', 'categories', 'activity_notes', 'settings', 'audit_log'] });
      expect(foreign.sendToRenderer).not.toHaveBeenCalled(); expect(closed.sendToRenderer).not.toHaveBeenCalled();
      vi.mocked(source.sendToRenderer).mockClear();
      notifyLedgerCleanupWindows(source, [source], receipt, false);
      expect(source.sendToRenderer).toHaveBeenCalledExactlyOnceWith('localSync:dataChanged', { tables: ['sheets', 'transactions', 'planned_templates', 'invoices', 'categories', 'activity_notes', 'settings', 'audit_log'] });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
