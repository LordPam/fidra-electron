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
import { syncFolderHasExistingPeers, syncFolderHasInvites, validateSyncFolder } from '../sync/bundle-io';
import { readInvitationIdentity } from '../sync/invitation';
import { newAccountPath } from '../services/account-catalog';
import { readInviteToken, deleteInviteToken } from '../sync/invite-token';
import { openDatabase, getAttachmentStoragePath } from '../database/connection';
import { PersonnelRepo } from '../repositories/personnel-repo';
import { LocalAuthService } from '../services/local-auth-service';
import { localSyncConfigSchema, localSyncResolutionSchema, localSyncMigrationOptsSchema, localSyncJoinViaInviteSchema } from '../../shared/ipc-schemas';
import type { LocalSyncStatus, LocalSyncConflict, MigrationResult, SyncFolderValidation, ImportNotification } from '../../shared/ipc-types';
import { joinLocalSync } from '../sync/migration';
import { syncLog, errorMessage } from '../sync/sync-log';
import { syncGetStatus, syncExportNow, syncImportNow } from '../services/sync-operations';
import { SessionStore, dbPathToSessionId } from '../services/session-store';

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

      // Migration guard: if CRR tables are not yet initialized (first-time Local
      // Sync on this database), check whether the sync folder already has
      // bundles/snapshots from other devices. Joining an existing sync group with
      // CRR-uninitialized data is dangerous: CRR init assigns col_version=1 to all
      // existing rows, which can silently lose against or arbitrarily tie-break
      // with established version histories from peers. Configuring an empty folder
      // (you're the first peer) is safe.
      if (!isCrrInitialized(ctx.sqlite) && syncFolderHasExistingPeers(syncFolder)) {
        return {
          success: false,
          error: 'This sync folder already has data from other devices. '
            + 'Adding a database with existing data to an established sync group '
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
        databaseId: ctx.databaseId,
        personName: ctx.localAuthPersonnel?.name ?? undefined,
        onDataChanged: (tables) => {
          ctx.checkPersonnelSurvival(tables);
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
            staleReason: status.staleReason,
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

  // ─── localSync:reconnect ─────────────────────────────────────────
  // Reconnects an existing Local Sync database to a sync folder after
  // the user signed in (so the passphrase is already in memory from the
  // personnel record). Only requires the folder path — no passphrase.
  ipcMain.handle('localSync:reconnect', (event, rawData: unknown) => {
    const { syncFolder } = z.object({ syncFolder: z.string().min(1) }).parse(rawData);
    const ctx = resolveContext(event);

    if (!ctx.localSyncPassphrase) {
      return { success: false, error: 'Not authenticated — sign in first' };
    }

    try {
      fs.accessSync(syncFolder, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return { success: false, error: 'Cannot access the selected folder. Check permissions.' };
    }

    try {
      // Initialize CRR tables (idempotent)
      initializeCrr(ctx.sqlite);
      const identity = initializeDeviceIdentity(ctx.sqlite, os.hostname());

      // Save the sync folder setting (passphrase stays key-wrapped in personnel)
      ctx.settingsRepo.setSetting(SETTING_SYNC_FOLDER, syncFolder, 'device');

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
          ctx.checkPersonnelSurvival(tables);
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
            staleReason: status.staleReason,
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
      return { success: false, error: message };
    }
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
  ipcMain.handle('localSync:getStatus', (event) => syncGetStatus(resolveContext(event)));

  // ─── localSync:exportNow ──────────────────────────────────────────
  ipcMain.handle('localSync:exportNow', (event) => {
    const ctx = resolveContext(event);
    const orchestrator = ctx.localSyncOrchestrator;
    if (!orchestrator) {
      return { bundleId: null, changesetCount: 0, attachmentCount: 0 };
    }
    try {
      return syncExportNow(ctx);
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
      return syncImportNow(ctx);
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
        // eslint-disable-next-line no-control-regex -- cr-sqlite prefixes keys with binary control bytes
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
      return joinLocalSync({ ...opts, newDbPath: opts.newDbPath ?? newAccountPath() });
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
      const { syncFolder, email, inviteCode, password, newDbPath: chosenPath } = localSyncJoinViaInviteSchema.parse(rawOpts);

      const newDbPath = chosenPath ?? newAccountPath();

      // Read the invite token — passphrase is wrapped with the invite code
      let passphrase: string | null;
      try {
        passphrase = readInviteToken(syncFolder, email, inviteCode);
      } catch (e) {
        // Wrong invite code → AES-GCM auth tag mismatch
        return { success: false, error: e instanceof Error && e.message.includes('expired') ? e.message : 'This invitation could not be verified. Check the shared folder and invitation, or ask for a new one.' };
      }

      if (!passphrase) {
        // Probe the sync folder to differentiate "not invited" from "OneDrive hasn't synced yet"
        const hasInvites = syncFolderHasInvites(syncFolder);
        const hasPeers = syncFolderHasExistingPeers(syncFolder);

        let error = 'No invite found for this email address. Ask your admin to invite you, or use the passphrase to join directly.';
        if (!hasInvites && !hasPeers) {
          error += '\n\nThe sync folder appears empty — OneDrive may not have finished syncing. Wait for OneDrive to sync, then try again.';
        }
        return { success: false, error, retryable: true };
      }

      const invitation = readInvitationIdentity(syncFolder, email, inviteCode);
      // Join using the recovered passphrase
      const result = joinLocalSync({ syncFolder, passphrase, newDbPath, afterImport: (db) => {
        const personnelRepo = new PersonnelRepo(db);
        if (invitation) {
          const group = db.prepare("SELECT value FROM settings WHERE key = 'localSync.groupId'").get() as { value: string } | undefined;
          if (!group?.value) throw new Error('Team data is still arriving through OneDrive. Try again shortly.');
          if (group.value !== invitation.groupId) throw new Error('This shared folder belongs to a different team. Choose the correct folder.');
        }
        const existing = personnelRepo.getByEmail(email);
        const setResult = existing?.password_hash
          ? new LocalAuthService(personnelRepo).signIn(email, password)
          : LocalAuthService.setPasswordForPersonnel(personnelRepo, email, password, passphrase!);
        if (!setResult.success) throw new Error(setResult.error ?? 'Your account could not be activated. Try again after OneDrive finishes syncing.');
        db.prepare("DELETE FROM settings WHERE key = 'localSync.passphrase' AND scope = 'device'").run();
      } });

      // If join failed (e.g. no snapshot), probe folder to differentiate genuine vs OneDrive lag
      if (!result.success && result.error) {
        const hasPeers = syncFolderHasExistingPeers(syncFolder);
        result.retryable = result.error.includes('No snapshot found') || result.error.includes('Personnel record not found') || result.error.includes('Team data is still arriving');
        if (!hasPeers) {
          result.error += '\n\nThe sync folder appears empty — OneDrive may not have finished syncing. Wait for OneDrive to sync, then try again.';
        } else if (result.error.includes('No snapshot found')) {
          result.error += '\n\nBundles exist but no snapshot is available yet. OneDrive may still be syncing — wait and try again, or ask a team member to create a snapshot.';
        }
        return result;
      }

      if (result.success && result.newDbPath) {
        // Open the newly created DB to set the joiner's password
        const { db } = openDatabase(result.newDbPath);
        try {
          const personnelRepo = new PersonnelRepo(db);
          const person = personnelRepo.getByEmail(email);
          if (person) {
            const store = new SessionStore();
            store.saveSession(dbPathToSessionId(result.newDbPath), {
              user: { id: person.id, email: person.email, personnelId: person.id },
              accessToken: passphrase, refreshToken: '', expiresAt: 0,
            });
          }
        } catch (error) {
          syncLog('warn', 'Account created; automatic sign-in unavailable', { error: errorMessage(error) });
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

  // ─── localSync:recoverAttachments ──────────────────────────────────
  // Re-export all local attachment files to the sync shared folder so peers
  // that missed earlier file bundles can pick them up.
  ipcMain.handle('localSync:recoverAttachments', (event) => {
    try {
      const ctx = resolveContext(event);
      const currentDir = getAttachmentStoragePath(ctx.databaseId);
      fs.mkdirSync(currentDir, { recursive: true });

      let exportedCount = 0;
      const orchestrator = ctx.localSyncOrchestrator;
      if (orchestrator) {
        exportedCount = orchestrator.exportAllAttachmentFiles();
      }

      syncLog('info', 'recoverAttachments completed', { exportedCount });
      return { success: true, copiedCount: 0, exportedCount };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      syncLog('error', 'recoverAttachments failed', { error });
      return { success: false, error };
    }
  });
}

