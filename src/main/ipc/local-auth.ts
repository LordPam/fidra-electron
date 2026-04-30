import os from 'node:os';
import { ipcMain } from 'electron';
import { resolveContext } from './context-resolver';
import {
  localAuthSignInSchema,
  localAuthCreateFirstAdminSchema,
  localAuthInviteMemberSchema,
  localAuthChangePasswordSchema,
} from '../../shared/ipc-schemas';
import { initializeCrr } from '../sync/crr-schema';
import { initializeDeviceIdentity, getDeviceIdentity } from '../sync/device-identity';
import { SyncOrchestrator } from '../sync/sync-orchestrator';
import type { LocalSyncStatus, ImportNotification } from '../../shared/ipc-types';
import type { LocalAuthStatus } from '../../shared/auth-types';
import { writeInviteToken, generateInviteCode } from '../sync/invite-token';
import { syncLog, errorMessage } from '../sync/sync-log';
import { SessionStore, dbPathToSessionId } from '../cloud/auth/session-store';

export function registerLocalAuthHandlers(): void {
  ipcMain.handle('localAuth:signIn', (event, rawData: unknown) => {
    const { email, password } = localAuthSignInSchema.parse(rawData);
    const ctx = resolveContext(event);

    const result = ctx.localAuthService.signIn(email, password);
    if (!result.success || !result.personnel || !result.syncPassphrase) {
      return { success: false, error: result.error ?? 'Sign-in failed' };
    }

    // Store auth state in context
    ctx.localAuthPersonnel = result.personnel;
    ctx.localSyncPassphrase = result.syncPassphrase;
    ctx.authMode = 'localSync';

    // Construct compatibility AuthSession for audit trail / getAuthenticatedPersonnelId
    ctx.authSession = {
      user: {
        id: result.personnel.id,
        email: result.personnel.email,
        personnelId: result.personnel.id,
      },
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
    };

    // Persist session for auto-restore on restart
    persistLocalSession(ctx);

    // Map this device to the signed-in person
    writeDeviceIdForPerson(ctx, result.personnel.id);

    // Start Local Sync orchestrator
    startLocalSyncAfterAuth(ctx);

    return {
      success: true,
      isAdmin: result.personnel.role === 'admin',
    };
  });

  ipcMain.handle('localAuth:createFirstAdmin', (event, rawData: unknown) => {
    const { name, email, password, syncPassphrase } = localAuthCreateFirstAdminSchema.parse(rawData);
    const ctx = resolveContext(event);

    const result = ctx.localAuthService.createFirstAdmin(name, email, password, syncPassphrase);
    if (!result.success || !result.personnel) {
      return { success: false, error: result.error ?? 'Account creation failed' };
    }

    // Store auth state
    ctx.localAuthPersonnel = result.personnel;
    ctx.localSyncPassphrase = result.syncPassphrase ?? syncPassphrase;
    ctx.authMode = 'localSync';

    ctx.authSession = {
      user: {
        id: result.personnel.id,
        email: result.personnel.email,
        personnelId: result.personnel.id,
      },
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
    };

    // Delete legacy plaintext passphrase from settings (now key-wrapped in personnel)
    ctx.settingsRepo.deleteSetting('localSync.passphrase');

    // Persist session for auto-restore on restart
    persistLocalSession(ctx);

    // Map this device to the new admin
    writeDeviceIdForPerson(ctx, result.personnel.id);

    // Start Local Sync orchestrator
    startLocalSyncAfterAuth(ctx);

    return { success: true };
  });

  ipcMain.handle('localAuth:inviteMember', (event, rawData: unknown) => {
    const { name, email, role } = localAuthInviteMemberSchema.parse(rawData);
    const ctx = resolveContext(event);

    // Only admins can invite
    if (ctx.localAuthPersonnel?.role !== 'admin') {
      return { success: false, error: 'Only admins can invite members' };
    }

    if (!ctx.localSyncPassphrase) {
      return { success: false, error: 'Sync passphrase not available' };
    }

    const result = ctx.localAuthService.inviteMember(
      name,
      email,
      role,
      ctx.localAuthPersonnel.id,
    );

    if (!result.success) {
      return result;
    }

    // Generate invite code and write invite token (passphrase wrapped with invite code)
    const inviteCode = generateInviteCode();
    const syncFolder = ctx.settingsRepo.getSetting('localSync.syncFolder');
    if (syncFolder) {
      try {
        writeInviteToken(syncFolder, email, inviteCode, ctx.localSyncPassphrase);
      } catch (e) {
        syncLog('warn', 'Failed to write invite token (non-fatal)', { error: errorMessage(e) });
      }
    }

    return { ...result, inviteCode };
  });

  ipcMain.handle('localAuth:changePassword', (event, rawData: unknown) => {
    const { oldPassword, newPassword } = localAuthChangePasswordSchema.parse(rawData);
    const ctx = resolveContext(event);

    if (!ctx.localAuthPersonnel) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = ctx.localAuthService.changePassword(
      ctx.localAuthPersonnel.id,
      oldPassword,
      newPassword,
    );

    return result;
  });

  ipcMain.handle('localAuth:getAuthStatus', (event): LocalAuthStatus => {
    const ctx = resolveContext(event);
    return {
      authEnabled: ctx.isLocalSyncAuthEnabled,
      isAuthenticated: ctx.localAuthPersonnel != null,
      personnel: ctx.localAuthPersonnel,
      isAdmin: ctx.localAuthPersonnel?.role === 'admin',
    };
  });

  ipcMain.handle('localAuth:signOut', (event) => {
    const ctx = resolveContext(event);

    // Delete persisted session
    const store = new SessionStore();
    store.deleteSession(dbPathToSessionId(ctx.dbPath));

    // Stop Local Sync services (clears localAuthPersonnel + localSyncPassphrase)
    ctx.stopLocalSyncServices();
    ctx.authMode = null;
    ctx.authSession = null;

    return { success: true };
  });
}

/** Encrypt and persist the current Local Sync auth session to disk. */
function persistLocalSession(ctx: import('../window/window-context').WindowContext): void {
  if (!ctx.localAuthPersonnel || !ctx.localSyncPassphrase) return;
  try {
    const store = new SessionStore();
    const sessionId = dbPathToSessionId(ctx.dbPath);
    store.saveSession(sessionId, {
      user: {
        id: ctx.localAuthPersonnel.id,
        email: ctx.localAuthPersonnel.email,
        personnelId: ctx.localAuthPersonnel.id,
      },
      accessToken: ctx.localSyncPassphrase,
      refreshToken: '',
      expiresAt: 0,
    });
  } catch (e) {
    syncLog('warn', 'Failed to persist local auth session (non-fatal)', { error: errorMessage(e) });
  }
}

/** Write this device's deviceId to the personnel record for device→person mapping. */
function writeDeviceIdForPerson(ctx: import('../window/window-context').WindowContext, personnelId: string): void {
  try {
    const identity = getDeviceIdentity(ctx.sqlite);
    if (identity) {
      ctx.personnelRepo.updateDeviceId(personnelId, identity.deviceId);
    }
  } catch (e) {
    syncLog('warn', 'Failed to write device_id for personnel (non-fatal)', { error: errorMessage(e) });
  }
}

function startLocalSyncAfterAuth(ctx: import('../window/window-context').WindowContext, retry = false): void {
  const syncFolder = ctx.settingsRepo.getSetting('localSync.syncFolder');
  if (!syncFolder || !ctx.localSyncPassphrase) return;

  try {
    initializeCrr(ctx.sqlite);
    const identity = initializeDeviceIdentity(ctx.sqlite, os.hostname());

    // Re-write device_id with CRR triggers guaranteed active.
    // The earlier writeDeviceIdForPerson call may have run before initializeCrr,
    // so the write wouldn't have generated a CRR changeset for sync.
    if (ctx.localAuthPersonnel) {
      try {
        ctx.personnelRepo.updateDeviceId(ctx.localAuthPersonnel.id, identity.deviceId);
      } catch { /* non-fatal */ }
    }

    // Stop any existing orchestrator
    if (ctx.localSyncOrchestrator) {
      ctx.localSyncOrchestrator.stop();
    }

    const orchestrator = new SyncOrchestrator({
      db: ctx.sqlite,
      syncFolder,
      passphrase: ctx.localSyncPassphrase,
      deviceId: identity.deviceId,
      dbPath: ctx.dbPath,
      databaseId: ctx.databaseId,
      personName: ctx.localAuthPersonnel?.name ?? undefined,
      onDataChanged: (tables) => {
        ctx.sendToRenderer('localSync:dataChanged', { tables });
      },
      onConflictsDetected: (count) => {
        ctx.sendToRenderer('localSync:conflictsDetected', { count });
      },
      onStatusChanged: (status) => {
        const fullStatus: LocalSyncStatus = {
          enabled: true,
          state: status.state,
          lastExportAt: status.lastExportAt,
          lastImportAt: status.lastImportAt,
          pendingConflicts: status.pendingConflicts,
          lastError: status.lastError,
          syncFolder,
        };
        ctx.sendToRenderer('localSync:statusChanged', fullStatus);
      },
      onError: (message) => {
        ctx.sendToRenderer('localSync:error', { message });
      },
      onImportSummary: (notification: ImportNotification) => {
        if (notification.isStartupCatchup && notification.summaries.length > 0) {
          ctx.pendingStartupSummary = notification;
        }
        ctx.sendToRenderer('localSync:importSummary', notification);
      },
    });

    ctx.localSyncOrchestrator = orchestrator;
    orchestrator.start();

    // Push initial status to renderer immediately so LocalSyncIndicator
    // picks it up even if it mounts slightly after the orchestrator starts.
    const initialStatus = orchestrator.getStatus();
    ctx.sendToRenderer('localSync:statusChanged', {
      enabled: true,
      state: initialStatus.state,
      lastExportAt: initialStatus.lastExportAt,
      lastImportAt: initialStatus.lastImportAt,
      pendingConflicts: initialStatus.pendingConflicts,
      lastError: initialStatus.lastError,
      syncFolder,
    } satisfies LocalSyncStatus);

    console.log(`[WINDOW ${ctx.dbName}] Local Sync started after auth (folder: ${syncFolder})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[WINDOW ${ctx.dbName}] Local Sync start after auth failed:`, msg);
    ctx.sendToRenderer('localSync:error', { message: `Start failed: ${msg}` });

    // Retry once after a delay — covers transient issues like OneDrive folder
    // not yet available. The user is authenticated so we have the passphrase.
    if (!retry) {
      setTimeout(() => {
        if (ctx.isClosed || ctx.localSyncOrchestrator) return;
        syncLog('info', 'Retrying Local Sync start after transient failure');
        startLocalSyncAfterAuth(ctx, true);
      }, 5000);
    }
  }
}
