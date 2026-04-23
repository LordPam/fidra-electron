import fs from 'node:fs';
import os from 'node:os';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { resolveContext } from './context-resolver';
import { initializeCrr, isCrrInitialized } from '../sync/crr-schema';
import { initializeDeviceIdentity, getDeviceIdentity } from '../sync/device-identity';
import { SyncOrchestrator } from '../sync/sync-orchestrator';
import { ConflictQueue } from '../sync/conflict-queue';
import { deserializeChangesetRow } from '../sync/bundle-format';
import type { SerializedChangesetRow } from '../sync/bundle-format';
import { syncFolderHasExistingPeers, validateSyncFolder } from '../sync/bundle-io';
import { readInviteToken, deleteInviteToken } from '../sync/invite-token';
import { openDatabase } from '../database/connection';
import { PersonnelRepo } from '../repositories/personnel-repo';
import { LocalAuthService } from '../services/local-auth-service';
import { localSyncConfigSchema, localSyncResolutionSchema, localSyncMigrationOptsSchema, localSyncJoinViaInviteSchema } from '../../shared/ipc-schemas';
import type { LocalSyncStatus, LocalSyncConflict, MigrationResult, SyncFolderValidation, ImportNotification } from '../../shared/ipc-types';
import { joinLocalSync, migrateCloudToLocalSync } from '../sync/migration';
import { syncLog, errorMessage } from '../sync/sync-log';
import { SessionStore, dbPathToSessionId } from '../cloud/auth/session-store';

const SETTING_SYNC_FOLDER = 'localSync.syncFolder';
const SETTING_PASSPHRASE = 'localSync.passphrase';

export function registerLocalSyncHandlers(): void {
  // ─── localSync:configure ──────────────────────────────────────────
  ipcMain.handle('localSync:configure', (event, rawConfig: unknown) => {
    try {
      const { syncFolder, passphrase } = localSyncConfigSchema.parse(rawConfig);

      // Validate folder access
      fs.accessSync(syncFolder, fs.constants.R_OK | fs.constants.W_OK);

      const ctx = resolveContext(event);

      // Mutual exclusion: reject if Cloud Connect is active (admin or member mode)
      if (ctx.cloudConnection || ctx.memberConnected) {
        return { success: false, error: 'Cloud Connect is active on this database. Disconnect Cloud Connect before enabling Local Sync.' };
      }

      // Migration guard: if CRR tables are not yet initialized (first-time Local
      // Sync on this database — e.g. migrating from Cloud Connect), check whether
      // the sync folder already has bundles/snapshots from other devices. Joining
      // an existing sync group with CRR-uninitialized data is dangerous: CRR init
      // assigns col_version=1 to all existing rows, which can silently lose against
      // or arbitrarily tie-break with established version histories from peers.
      // Migrating to an empty folder (you're the first peer) is safe.
      if (!isCrrInitialized(ctx.sqlite) && syncFolderHasExistingPeers(syncFolder)) {
        return {
          success: false,
          error: 'This sync folder already has data from other devices. '
            + 'Migrating a database from Cloud Connect into an existing Local Sync group '
            + 'can cause data conflicts. Use a fresh sync folder to start as the first peer, '
            + 'then have other devices join afterward.',
        };
      }

      // Initialize CRR tables (idempotent)
      initializeCrr(ctx.sqlite);

      // Initialize device identity (idempotent, per-database)
      const identity = initializeDeviceIdentity(ctx.sqlite, os.hostname());

      // Store config in per-db settings (scope=device, never synced)
      ctx.settingsRepo.setSetting(SETTING_SYNC_FOLDER, syncFolder, 'device');
      // Only store plaintext passphrase if auth is not active.
      // When auth is configured, the passphrase is key-wrapped in personnel records.
      if (!ctx.isLocalSyncAuthEnabled && !ctx.localSyncPassphrase) {
        ctx.settingsRepo.setSetting(SETTING_PASSPHRASE, passphrase, 'device');
      }

      // Stop any existing orchestrator
      ctx.stopLocalSyncServices();

      // Use in-memory passphrase from auth if available, otherwise use provided passphrase
      const effectivePassphrase = ctx.localSyncPassphrase ?? passphrase;

      // Create and start orchestrator with push event callbacks
      const orchestrator = new SyncOrchestrator({
        db: ctx.sqlite,
        syncFolder,
        passphrase: effectivePassphrase,
        deviceId: identity.deviceId,
        dbPath: ctx.dbPath,
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

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof z.ZodError) {
        return { success: false, error: `Invalid configuration: ${e.issues.map((issue) => issue.message).join(', ')}` };
      }
      return { success: false, error: message };
    }
  });

  // ─── localSync:getConfig ──────────────────────────────────────────
  ipcMain.handle('localSync:getConfig', (event) => {
    const ctx = resolveContext(event);
    const syncFolder = ctx.settingsRepo.getSetting(SETTING_SYNC_FOLDER);
    if (!syncFolder) return null;

    const identity = getDeviceIdentity(ctx.sqlite);
    if (!identity) return null;

    return {
      syncFolder,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
    };
  });

  // ─── localSync:disconnect ─────────────────────────────────────────
  ipcMain.handle('localSync:disconnect', (event) => {
    const ctx = resolveContext(event);
    ctx.stopLocalSyncServices();

    // Clear auth state
    ctx.authMode = null;
    ctx.authSession = null;

    // Delete persisted session
    try {
      const store = new SessionStore();
      store.deleteSession(dbPathToSessionId(ctx.dbPath));
    } catch { /* non-fatal */ }

    // Remove settings keys
    ctx.settingsRepo.deleteSetting(SETTING_SYNC_FOLDER);
    ctx.settingsRepo.deleteSetting(SETTING_PASSPHRASE);
  });

  // ─── localSync:getStatus ──────────────────────────────────────────
  ipcMain.handle('localSync:getStatus', (event) => {
    const ctx = resolveContext(event);
    const syncFolder = ctx.settingsRepo.getSetting(SETTING_SYNC_FOLDER);
    const orchestrator = ctx.localSyncOrchestrator;

    // Enabled = settings are present (regardless of orchestrator state)
    const enabled = !!syncFolder;

    if (!orchestrator) {
      return {
        enabled,
        state: 'stopped',
        lastExportAt: null,
        lastImportAt: null,
        pendingConflicts: 0,
        lastError: null,
        syncFolder: syncFolder ?? null,
      } satisfies LocalSyncStatus;
    }

    const status = orchestrator.getStatus();
    return {
      enabled,
      state: status.state,
      lastExportAt: status.lastExportAt,
      lastImportAt: status.lastImportAt,
      pendingConflicts: status.pendingConflicts,
      lastError: status.lastError,
      syncFolder: syncFolder ?? null,
    } satisfies LocalSyncStatus;
  });

  // ─── localSync:exportNow ──────────────────────────────────────────
  ipcMain.handle('localSync:exportNow', (event) => {
    const ctx = resolveContext(event);
    const orchestrator = ctx.localSyncOrchestrator;
    if (!orchestrator) {
      return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
    }
    try {
      return orchestrator.exportNow();
    } catch (e) {
      syncLog('error', 'exportNow IPC handler failed', { error: errorMessage(e) });
      return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
    }
  });

  // ─── localSync:importNow ──────────────────────────────────────────
  ipcMain.handle('localSync:importNow', (event) => {
    const ctx = resolveContext(event);
    const orchestrator = ctx.localSyncOrchestrator;
    if (!orchestrator) {
      return { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
    }
    try {
      return orchestrator.importAll();
    } catch (e) {
      syncLog('error', 'importNow IPC handler failed', { error: errorMessage(e) });
      return { bundlesProcessed: 0, changesetsApplied: 0, conflictsQueued: 0, bundlesSkipped: 0, attachmentsImported: 0 };
    }
  });

  // ─── localSync:getConflicts ───────────────────────────────────────
  ipcMain.handle('localSync:getConflicts', (event, entityId?: string) => {
    const ctx = resolveContext(event);
    const queue = new ConflictQueue(ctx.sqlite);
    if (entityId) {
      return queue.getByEntityId(entityId) as LocalSyncConflict[];
    }
    return queue.getUnresolved() as LocalSyncConflict[];
  });

  // ─── localSync:createSnapshot ─────────────────────────────────────
  ipcMain.handle('localSync:createSnapshot', (event) => {
    const ctx = resolveContext(event);
    const orchestrator = ctx.localSyncOrchestrator;
    if (!orchestrator) {
      return { success: false, error: 'Local Sync not active' };
    }
    try {
      const result = orchestrator.createSnapshot();
      return { success: true, path: result.path, changesetCount: result.changesetCount };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── localSync:compact ──────────────────────────────────────────────
  ipcMain.handle('localSync:compact', (event) => {
    const ctx = resolveContext(event);
    const orchestrator = ctx.localSyncOrchestrator;
    if (!orchestrator) return { deletedCount: 0 };
    try {
      return { deletedCount: orchestrator.compact() };
    } catch (e) {
      syncLog('error', 'compact IPC handler failed', { error: errorMessage(e) });
      return { deletedCount: 0 };
    }
  });

  // ─── localSync:resolveConflict ────────────────────────────────────
  ipcMain.handle('localSync:resolveConflict', (event, conflictId: unknown, resolution: unknown) => {
    const parsedId = z.string().min(1).parse(conflictId);
    const parsedResolution = localSyncResolutionSchema.parse(resolution);

    const ctx = resolveContext(event);
    const queue = new ConflictQueue(ctx.sqlite);

    // "manual" = Review Later: dismiss from overlay but leave unresolved
    if (parsedResolution === 'manual') {
      // Don't mark as resolved — just return. The conflict stays in the queue.
      // The overlay removes it from its local array but it persists on next load.
      return { success: true };
    }

    const conflict = queue.getById(parsedId);
    if (!conflict) return { success: false };

    // "accept-remote": apply the stored changeset to crsql_changes
    if (parsedResolution === 'accept-remote' && conflict.changeset_json) {
      try {
        const serialized = JSON.parse(conflict.changeset_json) as SerializedChangesetRow;
        const row = deserializeChangesetRow(serialized);
        // pk must be a Buffer for crsql_changes (cr-sqlite binary pk format)
        const pk = typeof row.pk === 'string' ? Buffer.from(row.pk, 'utf-8') : row.pk;
        ctx.sqlite
          .prepare(
            `INSERT INTO crsql_changes
             ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(row.table, pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
      } catch (e) {
        console.error('[localSync:resolveConflict] Failed to apply remote changeset:', e instanceof Error ? e.message : String(e));
        return { success: false };
      }
    }

    // "keep-local": re-assert the local value by writing it back to the actual
    // table. This bumps col_version higher than the conflicting remote version,
    // so the next export carries a winning changeset that peers will auto-merge.
    // Without this, the local value was already exported at the old col_version
    // and peers would see a tie (same col_version, different values).
    if (parsedResolution === 'keep-local' && conflict.field_name !== '-1') {
      try {
        // Strip leading cr-sqlite binary prefix from entity_id to get the actual PK
        const entityId = conflict.entity_id.replace(/^[\x00-\x1f]+/, '');
        const table = conflict.entity_type;
        const field = conflict.field_name;

        // Read current value and write it back — cr-sqlite bumps col_version
        const current = ctx.sqlite
          .prepare(`SELECT "${field}" FROM "${table}" WHERE id = ?`)
          .get(entityId) as Record<string, unknown> | undefined;
        if (current) {
          ctx.sqlite
            .prepare(`UPDATE "${table}" SET "${field}" = ? WHERE id = ?`)
            .run(current[field] ?? null, entityId);
        }
      } catch (e) {
        syncLog('error', 'keep-local re-assertion failed', { error: errorMessage(e) });
        // Non-fatal — conflict is still resolved locally, just won't propagate immediately
      }
    }

    const success = queue.resolve(parsedId, parsedResolution);

    // Notify renderer that data may have changed (for accept-remote)
    if (parsedResolution === 'accept-remote') {
      ctx.sendToRenderer('localSync:dataChanged', { tables: [conflict.entity_type] });
    }

    // Trigger an export so the resolution propagates to peers.
    if (ctx.localSyncOrchestrator) {
      try { ctx.localSyncOrchestrator.exportNow(); } catch { /* best-effort */ }
    }

    return { success };
  });

  // ─── localSync:joinGroup ─────────────────────────────────────────────
  ipcMain.handle('localSync:joinGroup', (_event, rawOpts: unknown): MigrationResult => {
    try {
      const opts = localSyncMigrationOptsSchema.parse(rawOpts);
      return joinLocalSync(opts);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return { success: false, error: `Invalid options: ${e.issues.map((i) => i.message).join(', ')}` };
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── localSync:migrateFromCloud ──────────────────────────────────────
  ipcMain.handle('localSync:migrateFromCloud', (event, rawOpts: unknown): MigrationResult => {
    try {
      const opts = localSyncMigrationOptsSchema.parse(rawOpts);
      const ctx = resolveContext(event);

      // Guard: reject if Local Sync is already configured on this DB
      if (ctx.localSyncOrchestrator || ctx.settingsRepo.getSetting(SETTING_SYNC_FOLDER)) {
        return { success: false, error: 'Local Sync is already configured on this database.' };
      }

      return migrateCloudToLocalSync({ sourceDbPath: ctx.dbPath, ...opts });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return { success: false, error: `Invalid options: ${e.issues.map((i) => i.message).join(', ')}` };
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── localSync:joinViaInvite ──────────────────────────────────────────
  ipcMain.handle('localSync:joinViaInvite', (_event, rawOpts: unknown): MigrationResult => {
    try {
      const { syncFolder, email, inviteCode, password, newDbPath } = localSyncJoinViaInviteSchema.parse(rawOpts);

      // Read the invite token — passphrase is wrapped with the invite code
      let passphrase: string | null;
      try {
        passphrase = readInviteToken(syncFolder, email, inviteCode);
      } catch (e) {
        // Wrong invite code → AES-GCM auth tag mismatch
        return { success: false, error: 'Incorrect invite code. Please check the code and try again.' };
      }

      if (!passphrase) {
        return {
          success: false,
          error: 'No invite found for this email address. Ask your admin to invite you, or use the passphrase to join directly.',
        };
      }

      // Join using the recovered passphrase
      const result = joinLocalSync({ syncFolder, passphrase, newDbPath });

      if (result.success && result.newDbPath) {
        // Open the newly created DB to set the joiner's password
        const db = openDatabase(result.newDbPath);
        try {
          const personnelRepo = new PersonnelRepo(db);
          const setResult = LocalAuthService.setPasswordForPersonnel(
            personnelRepo,
            email,
            password,
            passphrase,
          );
          if (!setResult.success) {
            syncLog('warn', 'Failed to set joiner password', { error: setResult.error });
          } else {
            // Persist session so autoStartLocalSync auto-restores on window reload
            try {
              const person = personnelRepo.getByEmail(email);
              if (person) {
                const store = new SessionStore();
                store.saveSession(dbPathToSessionId(result.newDbPath!), {
                  user: { id: person.id, email: person.email, personnelId: person.id },
                  accessToken: passphrase,
                  refreshToken: '',
                  expiresAt: 0,
                });
              }
            } catch (e) {
              syncLog('warn', 'Failed to persist session after invite join (non-fatal)', { error: errorMessage(e) });
            }
          }
        } finally {
          db.close();
        }

        // Clean up invite token (best-effort)
        deleteInviteToken(syncFolder, email);
      }

      return result;
    } catch (e) {
      if (e instanceof z.ZodError) {
        return { success: false, error: `Invalid options: ${e.issues.map((i) => i.message).join(', ')}` };
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── localSync:validateFolder ─────────────────────────────────────────
  ipcMain.handle('localSync:validateFolder', (_event, folderPath: unknown): SyncFolderValidation => {
    const parsed = z.string().min(1).parse(folderPath);
    return validateSyncFolder(parsed);
  });

  // ─── localSync:getStartupSummary ──────────────────────────────────
  // Returns (and clears) the stored startup import summary.
  // Solves the race condition where the orchestrator fires the startup
  // notification before the renderer mounts its event listener.
  ipcMain.handle('localSync:getStartupSummary', (event): ImportNotification | null => {
    const ctx = resolveContext(event);
    const summary = ctx.pendingStartupSummary;
    ctx.pendingStartupSummary = null;
    return summary;
  });
}

