import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowContext } from '../../window/window-context';
import { aiAccessPolicySchema } from '../../../shared/ai-access-types';
import type { AiOperationAccess } from '../ai-operation-access';
import { aiRunSync } from '../ai-sync-operations';
import { aiReadSyncStatus } from '../ai-ledger-reads';

let ctx: WindowContext;
let access: AiOperationAccess;
let exportNow: ReturnType<typeof vi.fn>;
let importAll: ReturnType<typeof vi.fn>;
beforeEach(() => {
  exportNow = vi.fn(() => ({ bundleId: 'bundle', changesetCount: 2, attachmentCount: 0 }));
  importAll = vi.fn(() => ({ bundlesProcessed: 1, changesetsApplied: 2, conflictsQueued: 1, bundlesSkipped: 0, attachmentsImported: 0 }));
  ctx = { isClosed: false, isLocalSyncAuthEnabled: false, localAuthPersonnel: null,
    settingsRepo: { getSetting: () => '/SECRET/path' },
    localSyncOrchestrator: { exportNow, importAll, getStatus: () => ({ state: 'error', pendingConflicts: 1, lastError: 'SECRET', staleReason: 'SECRET' }) },
  } as unknown as WindowContext;
  access = { policy: aiAccessPolicySchema.parse({ sheetIds: [], fields: [], permissions: { allAccounts: true, capabilities: ['sync.read', 'sync.run'] } }), isCurrent: () => true };
});
describe('external sync controls', () => {
  it('redacts paths and free-text errors while reporting required native review', () => {
    const result = aiReadSyncStatus(ctx, access, {});
    expect(result).toMatchObject({ enabled: true, state: 'error', pendingConflicts: 1, needsAttention: true });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('calls the same export and import operations without resolving conflicts', () => {
    expect(aiRunSync(ctx, access, { direction: 'both' })).toMatchObject({ exported: { changesetCount: 2 }, imported: { conflictsQueued: 1 } });
    expect(exportNow).toHaveBeenCalledOnce(); expect(importAll).toHaveBeenCalledOnce();
  });
  it('checks current permission between export and import', () => {
    let active = true; access.isCurrent = () => active;
    exportNow.mockImplementation(() => { active = false; return {}; });
    expect(() => aiRunSync(ctx, access, { direction: 'both' })).toThrow('revoked');
    expect(importAll).not.toHaveBeenCalled();
  });
  it('rejects missing capability, signed-out teams, unconfigured sync and arbitrary configuration', () => {
    const narrow = { ...access, policy: aiAccessPolicySchema.parse({ sheetIds: ['main'], fields: [], permissions: {} }) };
    expect(() => aiRunSync(ctx, narrow, { direction: 'both' })).toThrow('permission');
    expect(() => aiRunSync({ ...ctx, isLocalSyncAuthEnabled: true } as WindowContext, access, { direction: 'both' })).toThrow('Sign in');
    expect(() => aiRunSync({ ...ctx, localSyncOrchestrator: null } as WindowContext, access, { direction: 'both' })).toThrow('stopped');
    expect(() => aiRunSync(ctx, access, { direction: 'import', passphrase: 'SECRET' })).toThrow();
    expect(exportNow).not.toHaveBeenCalled(); expect(importAll).not.toHaveBeenCalled();
  });
});
