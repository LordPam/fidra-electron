import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WindowContext } from '../../window/window-context';
import { notifyAiSheetWindows } from '../ai-sheet-notifications';

let root: string;
const creation = { receiptId: 'a'.repeat(64), state: 'applied' as const,
  sheet: { id: 'new', name: 'Synthetic private sheet' }, currentSheet: { id: 'new', name: 'Synthetic private sheet' } };
function context(file: string, closed = false) {
  return { dbPath: path.join(root, file), isClosed: closed, sendToRenderer: vi.fn() } as unknown as WindowContext;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-sheet-events-'));
  fs.writeFileSync(path.join(root, 'same.fdra'), ''); fs.writeFileSync(path.join(root, 'different.fdra'), '');
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

describe('sheet creation window isolation', () => {
  it('sends the receipt/name only to its requesting window and a data-free refresh signal to other same-ledger windows', () => {
    const source = context('same.fdra'); const other = context('same.fdra');
    const signedOut = { ...context('same.fdra'), isLocalSyncAuthEnabled: true, localAuthPersonnel: null } as WindowContext;
    const different = context('different.fdra'); const closed = context('same.fdra', true);
    notifyAiSheetWindows(source, [source, other, signedOut, different, closed], creation, true);
    expect(source.sendToRenderer).toHaveBeenCalledWith('ai:sheetCreated', creation);
    for (const observer of [other, signedOut]) {
      expect(observer.sendToRenderer).toHaveBeenCalledExactlyOnceWith('localSync:dataChanged', { tables: ['sheets', 'audit_log'] });
      expect(JSON.stringify(vi.mocked(observer.sendToRenderer).mock.calls)).not.toContain(creation.sheet.name);
    }
    expect(different.sendToRenderer).not.toHaveBeenCalled(); expect(closed.sendToRenderer).not.toHaveBeenCalled();
  });
  it('history changes do not record a new Undo command and one closed renderer does not prevent other refresh signals', () => {
    const source = context('same.fdra'); const other = context('same.fdra');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(source.sendToRenderer).mockImplementation(() => { throw new Error('Synthetic renderer closed'); });
    notifyAiSheetWindows(source, [source, other], creation);
    expect(other.sendToRenderer).toHaveBeenCalledExactlyOnceWith('localSync:dataChanged', { tables: ['sheets', 'audit_log'] });
  });
});
