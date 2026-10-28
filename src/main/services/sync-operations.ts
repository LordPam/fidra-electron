import type { WindowContext } from '../window/window-context';
import type { LocalSyncStatus } from '../../shared/ipc-types';
import { assertApplicationPermission } from './application-access';

export function syncGetStatus(ctx: WindowContext): LocalSyncStatus {
  assertApplicationPermission(ctx, 'ledgerUse');
  const syncFolder = ctx.settingsRepo.getSetting('localSync.syncFolder');
  const status = ctx.localSyncOrchestrator?.getStatus();
  return { enabled: !!syncFolder, state: status?.state ?? 'stopped', lastExportAt: status?.lastExportAt ?? null,
    lastImportAt: status?.lastImportAt ?? null, pendingConflicts: status?.pendingConflicts ?? 0,
    lastError: status?.lastError ?? null, syncFolder, staleReason: status?.staleReason ?? null };
}

export function syncExportNow(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.localSyncOrchestrator?.exportNow() ?? { bundleId: null, changesetCount: 0, attachmentCount: 0 };
}

export function syncImportNow(ctx: WindowContext) {
  assertApplicationPermission(ctx, 'ledgerUse');
  return ctx.localSyncOrchestrator?.importAll() ?? { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
}
