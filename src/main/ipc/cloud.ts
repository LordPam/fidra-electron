import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { resolveContext } from './context-resolver';
import {
  CloudConnection,
  getUserErrorMessage,
} from '../cloud/cloud-connection';
import { runMigrations, hasPersonnel } from '../cloud/migration-runner';
import { SyncService } from '../cloud/sync-service';
import { ConnectionStateService } from '../cloud/connection-state';
import { ChangeListener } from '../cloud/change-listener';
import { startMemberServices, setupMemberSessionHandler } from '../cloud/member-services';
import { SupabaseAuth } from '../cloud/auth/supabase-auth';
import { SessionStore } from '../cloud/auth/session-store';
import { SessionManager } from '../cloud/auth/session-manager';
import { getCloudServer, updateCloudServer } from '../window/global-settings';
import { cloudServerConfigSchema, personnelRoleSchema, oauthProviderSchema } from '../../shared/ipc-schemas';
import type { CloudServerConfig, SyncConflict } from '../../shared/ipc-types';
import type { PersonnelRole } from '../../shared/auth-types';
import type { WindowContext } from '../window/window-context';

/** Normalise Supabase credentials: old configs stored them as storageUrl/storageKey. */
function getSupabaseCreds(config: CloudServerConfig): { projectUrl: string | undefined; anonKey: string | undefined } {
  return {
    projectUrl: config.projectUrl ?? config.storageUrl,
    anonKey: config.anonKey ?? config.storageKey,
  };
}

function startServices(ctx: WindowContext, conn: CloudConnection): void {
  const queue = ctx.syncQueue;
  const repos = ctx.getCachingRepos();

  if (!queue || !repos.transactions || !repos.planned || !repos.sheets || !repos.categories) {
    console.error('[CLOUD] Cannot start services — caching layer not active');
    return;
  }

  // Connection state service
  ctx.connectionState = new ConnectionStateService(conn);
  ctx.connectionState.onStatusChanged = (status) => {
    ctx.sendToRenderer('connection:statusChanged', status);
  };
  ctx.connectionState.startMonitoring();

  // Sync service
  ctx.syncService = new SyncService(
    queue,
    repos.transactions,
    repos.planned,
    repos.sheets,
    repos.categories,
    ctx.connectionState,
    repos.activityNotes ?? null,
    repos.attachments ?? null,
    repos.invoices ?? null,
    repos.audit ?? null,
    'ask_user',
  );

  ctx.syncService.onSyncStarted = () => {
    ctx.sendToRenderer('sync:statusChanged', {
      isSyncing: true,
      pendingCount: ctx.syncService?.getPendingCount() ?? 0,
    });
  };
  ctx.syncService.onSyncCompleted = (count) => {
    ctx.sendToRenderer('sync:statusChanged', {
      isSyncing: false,
      pendingCount: ctx.syncService?.getPendingCount() ?? 0,
      lastSyncedCount: count,
    });
  };
  ctx.syncService.onSyncFailed = (error) => {
    ctx.sendToRenderer('sync:statusChanged', {
      isSyncing: false,
      pendingCount: ctx.syncService?.getPendingCount() ?? 0,
      error,
    });
  };
  ctx.syncService.onPendingCountChanged = (count) => {
    ctx.sendToRenderer('sync:statusChanged', {
      isSyncing: ctx.syncService?.isSyncing ?? false,
      pendingCount: count,
    });
  };
  ctx.syncService.onConflictDetected = (changeId, local, server) => {
    ctx.sendToRenderer('sync:conflictDetected', { changeId, local, server });
  };

  ctx.syncService.start();

  // Change listener
  ctx.changeListener = new ChangeListener(conn);
  ctx.changeListener.onTablesChanged = (tables) => {
    const refreshPromises: Promise<unknown>[] = [];
    if (tables.has('transactions') && repos.transactions) {
      refreshPromises.push(repos.transactions.refreshFromCloud());
    }
    if (tables.has('planned_templates') && repos.planned) {
      refreshPromises.push(repos.planned.refreshFromCloud());
    }
    if (tables.has('sheets') && repos.sheets) {
      refreshPromises.push(repos.sheets.refreshFromCloud());
    }
    if (tables.has('categories') && repos.categories) {
      refreshPromises.push(repos.categories.refreshFromCloud());
    }
    if (tables.has('activity_notes') && repos.activityNotes) {
      refreshPromises.push(repos.activityNotes.refreshFromCloud());
    }
    if (tables.has('attachments') && repos.attachments) {
      refreshPromises.push(repos.attachments.refreshFromCloud());
    }
    if (tables.has('invoices') && repos.invoices) {
      refreshPromises.push(repos.invoices.refreshFromCloud());
    }
    if (tables.has('audit_log') && repos.audit) {
      refreshPromises.push(repos.audit.refreshFromCloud());
    }
    if (tables.has('db_settings') && ctx.pgSettingsRepo) {
      refreshPromises.push(
        ctx.pgSettingsRepo.getAll().then((settings) => {
          for (const [key, value] of Object.entries(settings)) {
            ctx.settingsRepo.setSetting(key, value);
          }
        }),
      );
    }

    Promise.all(refreshPromises)
      .then(() => {
        if (!ctx.changeListener) return; // Torn down while refreshing
        ctx.sendToRenderer('cloud:dataChanged', [...tables]);
      })
      .catch((e) => console.error('[CLOUD] Refresh after remote changes failed:', e instanceof Error ? e.message : String(e)));
  };
  ctx.changeListener.start().catch((e) => {
    console.error('[CLOUD] Failed to start change listener:', e instanceof Error ? e.message : String(e));
  });

  console.log(`[WINDOW ${ctx.dbName}] Sync service, connection state, and change listener started`);
}

// startMemberServices and setupMemberSessionHandler are imported from member-services.ts

// ─── Personnel lookup helper ────────────────────────────────────────

/** Link a Supabase auth user to a personnel record. Uses pg.Pool (bypasses RLS) when available. */
async function linkPersonnel(
  ctx: WindowContext,
  accessToken: string,
  authUid: string,
  email: string,
): Promise<{ success: true; personnelId: string } | { success: false; error: string }> {
  const pool = ctx.cloudConnection?.pool;

  if (pool) {
    // Admin mode: use direct pg.Pool to bypass RLS
    const { rows: byUid } = await pool.query(
      'SELECT id FROM personnel WHERE auth_uid = $1 LIMIT 1',
      [authUid],
    );
    if (byUid.length > 0) return { success: true, personnelId: byUid[0].id };

    // Look up by email (invited but not yet linked)
    const { rows: byEmail } = await pool.query(
      'SELECT id FROM personnel WHERE email = $1 LIMIT 1',
      [email],
    );
    if (byEmail.length === 0) return { success: false, error: 'Not authorized. Ask an admin to invite your email address.' };

    // Link auth_uid to personnel record
    await pool.query('UPDATE personnel SET auth_uid = $1 WHERE id = $2', [authUid, byEmail[0].id]);
    return { success: true, personnelId: byEmail[0].id };
  }

  // Member mode: use Supabase PostgREST client (with user's access token for RLS)
  const config = ctx.serverId ? getCloudServer(ctx.serverId) : null;
  const creds = config ? getSupabaseCreds(config) : { projectUrl: undefined, anonKey: undefined };
  if (!creds.projectUrl || !creds.anonKey) return { success: false, error: 'Missing Supabase credentials' };

  const client = createClient(creds.projectUrl, creds.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  console.log(`[AUTH] linkPersonnel member mode: authUid=${authUid}, email=${email}`);

  const { data: byUid, error: uidErr } = await client.from('personnel').select('id').eq('auth_uid', authUid).maybeSingle();
  console.log(`[AUTH] lookup by auth_uid: data=${JSON.stringify(byUid)}, error=${JSON.stringify(uidErr)}`);
  if (byUid) return { success: true, personnelId: byUid.id };

  const { data: byEmail, error: emailErr } = await client.from('personnel').select('id, email, auth_uid').ilike('email', email).maybeSingle();
  console.log(`[AUTH] lookup by email: data=${JSON.stringify(byEmail)}, error=${JSON.stringify(emailErr)}`);
  if (!byEmail) return { success: false, error: 'Not authorized. Ask an admin to invite your email address.' };

  const { error: updateErr } = await client.from('personnel').update({ auth_uid: authUid }).eq('id', byEmail.id);
  console.log(`[AUTH] update auth_uid: error=${JSON.stringify(updateErr)}`);
  if (updateErr) return { success: false, error: `Failed to link account: ${updateErr.message}` };
  return { success: true, personnelId: byEmail.id };
}

// ─── IPC handlers ───────────────────────────────────────────────────

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:getConfig', (event) => {
    const ctx = resolveContext(event);
    if (!ctx.serverId) return null;
    return getCloudServer(ctx.serverId);
  });

  ipcMain.handle('cloud:saveConfig', (_event, config: unknown) => {
    const validated = cloudServerConfigSchema.parse(config);
    updateCloudServer(validated);
  });

  ipcMain.handle('cloud:deleteConfig', async (event) => {
    const ctx = resolveContext(event);
    await ctx.stopCloudServices();
    ctx.deactivateCachingLayer();
    if (ctx.cloudConnection) {
      await ctx.cloudConnection.close();
      ctx.cloudConnection = null;
    }
  });

  ipcMain.handle('cloud:testConnection', async (_event, connectionString: unknown) => {
    z.string().parse(connectionString);
    const pool = new pg.Pool({
      connectionString: connectionString as string,
      max: 2,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      ssl: { rejectUnauthorized: true },
    });

    pool.on('error', () => {});

    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        return { success: true };
      } finally {
        client.release();
      }
    } catch (e) {
      return { success: false, error: getUserErrorMessage(e) };
    } finally {
      await pool.end().catch(() => {});
    }
  });

  ipcMain.handle('cloud:connect', async (event) => {
    const ctx = resolveContext(event);
    if (!ctx.serverId) {
      return { success: false, error: 'Not a cloud window' };
    }
    // Mutual exclusion: reject if Local Sync is active or configured
    if (ctx.localSyncOrchestrator || ctx.settingsRepo.getSetting('localSync.syncFolder')) {
      return { success: false, error: 'Local Sync is active on this database. Disconnect Local Sync before connecting to Cloud Connect.' };
    }
    const config = getCloudServer(ctx.serverId);
    if (!config) {
      return { success: false, error: 'No cloud server configured' };
    }

    const authMode = config.authMode ?? 'admin';

    const { projectUrl, anonKey } = getSupabaseCreds(config);

    try {
      await ctx.stopCloudServices();

      if (ctx.cloudConnection) {
        await ctx.cloudConnection.close();
      }

      if (authMode === 'member') {
        // Member mode: use Supabase PostgREST — requires auth session
        if (!projectUrl || !anonKey) {
          return { success: false, error: 'Project URL and anon key are required for member mode' };
        }

        // Initialize auth infrastructure
        ctx.authMode = 'member';
        ctx.supabaseAuth = new SupabaseAuth(projectUrl, anonKey);
        const store = new SessionStore();
        ctx.sessionManager = new SessionManager(ctx.serverId, ctx.supabaseAuth, store);

        // Try to restore a saved session
        const session = await ctx.sessionManager.restoreSession();
        if (!session) {
          // No valid session — renderer needs to show sign-in dialog
          return { success: false, error: 'auth_required' };
        }

        ctx.authSession = session;
        const isOffline = ctx.sessionManager.isOfflineSession();

        if (!isOffline) {
          // Online: create authenticated Supabase client for data access
          const supabaseClient = createClient(projectUrl, anonKey, {
            global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
          });

          ctx.activateCachingLayerMember(supabaseClient, config);

          const repos = ctx.getCachingRepos();
          await Promise.all([
            repos.transactions?.refreshFromCloud(),
            repos.planned?.refreshFromCloud(),
            repos.sheets?.refreshFromCloud(),
            repos.categories?.refreshFromCloud(),
            repos.activityNotes?.refreshFromCloud(),
            repos.attachments?.refreshFromCloud(),
            repos.invoices?.refreshFromCloud(),
          ]);
          // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
          if (ctx.supabaseSettingsRepo) {
            const cloudSettings = await ctx.supabaseSettingsRepo.getAll().catch(() => ({}));
            if (Object.keys(cloudSettings).length === 0) {
              const localSettings = ctx.settingsRepo.getAll();
              for (const [key, value] of Object.entries(localSettings)) {
                await ctx.supabaseSettingsRepo.setSetting(key, value).catch(() => {});
              }
            } else {
              for (const [key, value] of Object.entries(cloudSettings)) {
                ctx.settingsRepo.setSetting(key, value);
              }
            }
          }
          ctx.memberConnected = true;
          startMemberServices(ctx);
        }
        // Offline: skip caching layer activation — local SQLite reads/writes continue normally

        // Session change handler — refresh data client on token refresh
        setupMemberSessionHandler(ctx, config);

        // Notify renderer of restored session
        ctx.sendToRenderer('auth:sessionRestored', session);
        if (isOffline) {
          ctx.sendToRenderer('connection:statusChanged', 'offline-authenticated');
        }

        return { success: true, authenticated: true };
      }

      // Admin mode: existing flow (direct pg.Pool)
      ctx.authMode = 'admin';
      const conn = new CloudConnection(config);
      await conn.connect();

      await runMigrations(conn.pool);

      ctx.cloudConnection = conn;
      ctx.activateCachingLayer(conn, config);

      const repos = ctx.getCachingRepos();
      await Promise.all([
        repos.transactions?.refreshFromCloud(),
        repos.planned?.refreshFromCloud(),
        repos.sheets?.refreshFromCloud(),
        repos.categories?.refreshFromCloud(),
        repos.activityNotes?.refreshFromCloud(),
        repos.attachments?.refreshFromCloud(),
        repos.invoices?.refreshFromCloud(),
      ]);

      // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
      if (ctx.pgSettingsRepo) {
        const cloudSettings = await ctx.pgSettingsRepo.getAll().catch(() => ({}));
        if (Object.keys(cloudSettings).length === 0) {
          // Fresh cloud database — push local settings up
          const localSettings = ctx.settingsRepo.getAll();
          for (const [key, value] of Object.entries(localSettings)) {
            await ctx.pgSettingsRepo.setSetting(key, value).catch(() => {});
          }
        } else {
          // Existing cloud database — cloud wins
          for (const [key, value] of Object.entries(cloudSettings)) {
            ctx.settingsRepo.setSetting(key, value);
          }
        }
      }

      startServices(ctx, conn);

      // Admin mode: no auth infrastructure. Supabase credentials (if present)
      // are used only for storage buckets — handled by the caching layer config.

      return { success: true, authenticated: false };
    } catch (e) {
      await ctx.stopCloudServices();
      ctx.deactivateCachingLayer();
      ctx.cloudConnection = null;
      return { success: false, error: getUserErrorMessage(e) };
    }
  });

  ipcMain.handle('cloud:disconnect', async (event) => {
    const ctx = resolveContext(event);
    // Clear the persisted session BEFORE stopCloudServices() nulls sessionManager
    if (ctx.sessionManager) {
      await ctx.sessionManager.clearSession();
    }
    await ctx.stopCloudServices();
    ctx.deactivateCachingLayer();
    if (ctx.cloudConnection) {
      await ctx.cloudConnection.close();
      ctx.cloudConnection = null;
    }
  });

  ipcMain.handle('cloud:getStatus', (event) => {
    const ctx = resolveContext(event);
    const config = ctx.serverId ? getCloudServer(ctx.serverId) : null;
    const authMode = ctx.authMode ?? config?.authMode ?? null;

    // Member mode: explicit tracking via memberConnected flag
    // Admin mode: connected when pg.Pool connection is alive
    const connected = authMode === 'member' ? ctx.memberConnected : (ctx.cloudConnection?.isConnected ?? false);

    let connectionStatus: 'connected' | 'reconnecting' | 'offline' | 'offline-authenticated';
    if (authMode === 'member') {
      if (ctx.memberConnected) connectionStatus = 'connected';
      else if (ctx.sessionManager?.isOfflineSession()) connectionStatus = 'offline-authenticated';
      else if (ctx.authSession) connectionStatus = 'offline'; // have session but lost network
      else connectionStatus = 'offline';
    } else {
      connectionStatus = ctx.connectionState?.status ?? 'offline';
    }

    return {
      connected,
      serverName: config?.name,
      connectionStatus,
      isSyncing: ctx.syncService?.isSyncing ?? false,
      pendingCount: ctx.syncService?.getPendingCount() ?? 0,
      authSession: ctx.authSession ?? null,
      authMode,
    };
  });

  // ─── Sync handlers ──────────────────────────────────────────────

  ipcMain.handle('sync:now', async (event) => {
    const ctx = resolveContext(event);
    if (!ctx.syncService) return 0;
    return ctx.syncService.syncNow();
  });

  ipcMain.handle('sync:getStatus', (event) => {
    const ctx = resolveContext(event);
    const conflicts = ctx.syncQueue?.getConflicts() ?? [];
    const mappedConflicts: SyncConflict[] = conflicts.map((c) => ({
      id: c.id,
      entityType: c.entity_type,
      entityId: c.entity_id,
      localPayload: c.payload,
      error: c.last_error ?? '',
    }));
    return {
      isSyncing: ctx.syncService?.isSyncing ?? false,
      pendingCount: ctx.syncService?.getPendingCount() ?? 0,
      conflicts: mappedConflicts,
    };
  });

  ipcMain.handle('sync:resolveConflict', async (event, changeId: unknown, useLocal: unknown) => {
    const validChangeId = z.string().parse(changeId);
    const validUseLocal = z.boolean().parse(useLocal);
    const ctx = resolveContext(event);
    if (ctx.syncService) {
      await ctx.syncService.resolveConflictWithChoice(validChangeId, validUseLocal);
    }
  });

  // ─── Connection handlers ────────────────────────────────────────

  ipcMain.handle('connection:getStatus', (event) => {
    const ctx = resolveContext(event);
    // Member mode: derive status from memberConnected flag
    if (ctx.authMode === 'member') {
      const status = ctx.memberConnected
        ? 'connected'
        : ctx.sessionManager?.isOfflineSession()
          ? 'offline-authenticated'
          : 'offline';
      return { status };
    }
    return { status: ctx.connectionState?.status ?? 'offline' };
  });

  ipcMain.handle('connection:reconnect', async (event) => {
    const ctx = resolveContext(event);

    // Member mode: attempt a lightweight probe to restore connectivity
    if (ctx.authMode === 'member') {
      if (!ctx.supabaseDataClient) return { success: false };
      try {
        const { error } = await ctx.supabaseDataClient
          .from('sheets')
          .select('id', { count: 'exact', head: true })
          .limit(1);
        if (error) return { success: false };
        ctx.memberConnected = true;
        ctx.memberConnectionState?.setConnected(true);
        ctx.sendToRenderer('connection:statusChanged', 'connected');
        return { success: true };
      } catch {
        return { success: false };
      }
    }

    if (!ctx.connectionState) return { success: false };
    const success = await ctx.connectionState.reconnectNow();
    return { success };
  });

  // ─── Auth handlers ───────────────────────────────────────────────

  ipcMain.handle('auth:signIn', async (event, email: unknown, password: unknown) => {
    const validEmail = z.string().email().parse(email);
    const validPassword = z.string().parse(password);
    const ctx = resolveContext(event);
    if (!ctx.supabaseAuth) return { success: false, error: 'Auth not initialized' };

    const { session, error } = await ctx.supabaseAuth.signIn(validEmail, validPassword);
    if (error || !session) return { success: false, error: error ?? 'Sign-in failed' };

    // Look up personnel record to verify access
    const linked = await linkPersonnel(ctx, session.accessToken, session.user.id, session.user.email);
    if (!linked.success) return { success: false, error: linked.error };

    const fullSession = { ...session, user: { ...session.user, personnelId: linked.personnelId } };
    ctx.sessionManager?.setSession(fullSession);
    ctx.authSession = fullSession;

    // In member mode, activate the Supabase-based caching layer.
    // In admin mode, the pg.Pool caching layer is already active — skip.
    if (ctx.authMode === 'member') {
      const signInConfig = ctx.serverId ? getCloudServer(ctx.serverId) : null;
      const signInCreds = signInConfig ? getSupabaseCreds(signInConfig) : { projectUrl: undefined, anonKey: undefined };
      if (!signInCreds.projectUrl || !signInCreds.anonKey) return { success: false, error: 'Missing Supabase credentials' };
      const supabaseClient = createClient(signInCreds.projectUrl, signInCreds.anonKey, {
        global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });

      ctx.activateCachingLayerMember(supabaseClient, signInConfig!);

      const repos = ctx.getCachingRepos();
      await Promise.all([
        repos.transactions?.refreshFromCloud(),
        repos.planned?.refreshFromCloud(),
        repos.sheets?.refreshFromCloud(),
        repos.categories?.refreshFromCloud(),
        repos.activityNotes?.refreshFromCloud(),
        repos.attachments?.refreshFromCloud(),
        repos.invoices?.refreshFromCloud(),
      ]);
      // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
      if (ctx.supabaseSettingsRepo) {
        const cloudSettings = await ctx.supabaseSettingsRepo.getAll().catch(() => ({}));
        if (Object.keys(cloudSettings).length === 0) {
          const localSettings = ctx.settingsRepo.getAll();
          for (const [key, value] of Object.entries(localSettings)) {
            await ctx.supabaseSettingsRepo.setSetting(key, value).catch(() => {});
          }
        } else {
          for (const [key, value] of Object.entries(cloudSettings)) {
            ctx.settingsRepo.setSetting(key, value);
          }
        }
      }
      ctx.memberConnected = true;
      if (!ctx.syncService) startMemberServices(ctx);
    }

    ctx.sendToRenderer('auth:sessionChanged', fullSession);
    ctx.sendToRenderer('connection:statusChanged', 'connected');
    ctx.sendToRenderer('cloud:dataChanged', [
      'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings',
    ]);

    return { success: true };
  });

  ipcMain.handle('auth:signUp', async (event, email: unknown, password: unknown) => {
    const validEmail = z.string().email().parse(email);
    const validPassword = z.string().parse(password);
    const ctx = resolveContext(event);
    if (!ctx.supabaseAuth) return { success: false, error: 'Auth not initialized' };

    const { session, userId, error } = await ctx.supabaseAuth.signUp(validEmail, validPassword);
    if (error) return { success: false, error };
    // userId is available even when email confirmation is enabled (no session yet)
    if (!session && !userId) return { success: false, error: 'Sign-up returned no session or user ID' };

    return { success: true, needsEmailConfirmation: !session };
  });

  ipcMain.handle('auth:signOut', async (event) => {
    const ctx = resolveContext(event);
    if (ctx.supabaseAuth) {
      await ctx.supabaseAuth.signOut().catch(() => {});
    }
    if (ctx.sessionManager) {
      await ctx.sessionManager.clearSession();
    }
    ctx.authSession = null;
    ctx.deactivateCachingLayer();
    ctx.sendToRenderer('auth:sessionChanged', null);
  });

  ipcMain.handle('auth:getSession', (event) => {
    const ctx = resolveContext(event);
    return ctx.authSession ?? null;
  });

  ipcMain.handle('auth:getOAuthUrl', async (event, provider: unknown) => {
    const validProvider = oauthProviderSchema.parse(provider);
    const ctx = resolveContext(event);
    if (!ctx.supabaseAuth) return { error: 'Auth not initialized' };

    const redirectUrl = 'fidra://auth/callback';
    const { url, error } = await ctx.supabaseAuth.getOAuthUrl(validProvider, redirectUrl);
    if (error || !url) return { error: error ?? 'Failed to get OAuth URL' };

    // Open URL in system browser
    await shell.openExternal(url);
    return { url };
  });

  ipcMain.handle('auth:oauthCallback', async (event, code: unknown) => {
    const validCode = z.string().parse(code);
    const ctx = resolveContext(event);
    if (!ctx.supabaseAuth) return { success: false, error: 'Auth not initialized' };

    const { session, error } = await ctx.supabaseAuth.exchangeCodeForSession(validCode);
    if (error || !session) return { success: false, error: error ?? 'OAuth callback failed' };

    const linked = await linkPersonnel(ctx, session.accessToken, session.user.id, session.user.email);
    if (!linked.success) return { success: false, error: linked.error };

    const fullSession = { ...session, user: { ...session.user, personnelId: linked.personnelId } };
    ctx.sessionManager?.setSession(fullSession);
    ctx.authSession = fullSession;

    // In member mode, activate the Supabase-based caching layer (same as auth:signIn)
    if (ctx.authMode === 'member') {
      const oauthConfig = ctx.serverId ? getCloudServer(ctx.serverId) : null;
      const oauthCreds = oauthConfig ? getSupabaseCreds(oauthConfig) : { projectUrl: undefined, anonKey: undefined };
      if (!oauthCreds.projectUrl || !oauthCreds.anonKey) return { success: false, error: 'Missing Supabase credentials' };
      const supabaseClient = createClient(oauthCreds.projectUrl, oauthCreds.anonKey, {
        global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });

      ctx.activateCachingLayerMember(supabaseClient, oauthConfig!);

      const repos = ctx.getCachingRepos();
      await Promise.all([
        repos.transactions?.refreshFromCloud(),
        repos.planned?.refreshFromCloud(),
        repos.sheets?.refreshFromCloud(),
        repos.categories?.refreshFromCloud(),
        repos.activityNotes?.refreshFromCloud(),
        repos.attachments?.refreshFromCloud(),
        repos.invoices?.refreshFromCloud(),
      ]);
      // Sync db_settings: push local → cloud if cloud is empty, otherwise pull cloud → local
      if (ctx.supabaseSettingsRepo) {
        const cloudSettings = await ctx.supabaseSettingsRepo.getAll().catch(() => ({}));
        if (Object.keys(cloudSettings).length === 0) {
          const localSettings = ctx.settingsRepo.getAll();
          for (const [key, value] of Object.entries(localSettings)) {
            await ctx.supabaseSettingsRepo.setSetting(key, value).catch(() => {});
          }
        } else {
          for (const [key, value] of Object.entries(cloudSettings)) {
            ctx.settingsRepo.setSetting(key, value);
          }
        }
      }
      ctx.memberConnected = true;
      if (!ctx.syncService) startMemberServices(ctx);
    }

    ctx.sendToRenderer('auth:sessionChanged', fullSession);
    ctx.sendToRenderer('connection:statusChanged', 'connected');
    ctx.sendToRenderer('cloud:dataChanged', [
      'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings',
    ]);

    return { success: true };
  });

  ipcMain.handle('auth:adminFirstSetup', async (event, name: unknown, email: unknown, password: unknown) => {
    const validName = z.string().parse(name);
    const validEmail = z.string().email().parse(email);
    const validPassword = z.string().parse(password);
    const ctx = resolveContext(event);
    if (!ctx.cloudConnection) return { success: false, error: 'Not connected to cloud' };

    const setupConfig = ctx.serverId ? getCloudServer(ctx.serverId) : null;
    const setupCreds = setupConfig ? getSupabaseCreds(setupConfig) : { projectUrl: undefined, anonKey: undefined };

    try {
      let authUid: string | null = null;

      // If Supabase Auth credentials are available, create an auth user too
      if (setupCreds.projectUrl && setupCreds.anonKey) {
        const auth = new SupabaseAuth(setupCreds.projectUrl, setupCreds.anonKey);
        const { userId, error } = await auth.signUp(validEmail, validPassword);
        if (error) return { success: false, error };
        // userId is available even when email confirmation is enabled (no session)
        authUid = userId;
      }

      // Insert first personnel record as admin (using direct pg connection)
      await ctx.cloudConnection.pool.query(
        `INSERT INTO personnel (email, name, role, auth_uid)
         VALUES ($1, $2, 'admin', $3)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = 'admin', auth_uid = EXCLUDED.auth_uid`,
        [validEmail, validName, authUid],
      );

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ─── Personnel handlers ──────────────────────────────────────────

  ipcMain.handle('personnel:getAll', async (event) => {
    const ctx = resolveContext(event);
    if (ctx.cloudConnection) {
      const { rows } = await ctx.cloudConnection.pool.query(
        'SELECT * FROM personnel ORDER BY created_at',
      );
      return rows;
    }
    if (ctx.supabaseDataClient) {
      try {
        const { data, error } = await ctx.supabaseDataClient.from('personnel').select('*').order('created_at');
        if (error) throw new Error(error.message);
        return data ?? [];
      } catch (e) {
        // Network failure — mark member as offline and return empty
        if (ctx.memberConnected) {
          ctx.memberConnected = false;
          ctx.memberConnectionState?.setConnected(false);
          ctx.sendToRenderer('connection:statusChanged', 'offline');
        }
        console.warn('[CLOUD] personnel:getAll fetch failed (offline?):', e);
        return [];
      }
    }
    // Fallback: read from local SQLite (Local Sync mode or standalone)
    return ctx.personnelRepo.getAll();
  });

  ipcMain.handle('personnel:invite', async (event, name: unknown, email: unknown, role: unknown) => {
    const validName = z.string().parse(name);
    const validEmail = z.string().email().parse(email);
    const validRole = personnelRoleSchema.parse(role) as PersonnelRole;
    const ctx = resolveContext(event);
    const invitedBy = ctx.authSession?.user.personnelId ?? null;

    if (ctx.cloudConnection) {
      const { rows } = await ctx.cloudConnection.pool.query(
        `INSERT INTO personnel (email, name, role, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [validEmail, validName, validRole, invitedBy],
      );
      return rows[0];
    }
    if (ctx.supabaseDataClient) {
      const { data, error } = await ctx.supabaseDataClient
        .from('personnel')
        .insert({ email: validEmail, name: validName, role: validRole, invited_by: invitedBy })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    throw new Error('No cloud connection');
  });

  ipcMain.handle('personnel:remove', async (event, id: unknown) => {
    const validId = z.string().parse(id);
    const ctx = resolveContext(event);
    // Safeguard: don't remove the last admin
    const pool = ctx.cloudConnection?.pool;
    if (pool) {
      const { rows } = await pool.query(
        "SELECT COUNT(*) as cnt FROM personnel WHERE role = 'admin' AND id != $1",
        [validId],
      );
      if (Number(rows[0].cnt) === 0) {
        return { success: false, error: 'Cannot remove the last admin' };
      }
      // Get auth_uid before deleting personnel record
      const { rows: personnel } = await pool.query(
        'SELECT auth_uid FROM personnel WHERE id = $1',
        [validId],
      );
      const authUid = personnel[0]?.auth_uid;

      // Delete from Supabase Auth BEFORE deleting the personnel record —
      // the RPC's invited_by cleanup references the personnel table.
      if (authUid) {
        try {
          await pool.query('SELECT delete_auth_user($1)', [authUid]);
        } catch (e) {
          // Function may not exist on non-Supabase Postgres — not an error
          console.warn('[AUTH] delete_auth_user failed (may not be Supabase):', e);
        }
      }

      await pool.query('UPDATE personnel SET invited_by = NULL WHERE invited_by = $1', [validId]);
      await pool.query('DELETE FROM personnel WHERE id = $1', [validId]);

      // Self-removal: if the deleted personnel is the current user, force sign-out
      const selfId = ctx.authSession?.user?.personnelId;
      if (selfId === validId) {
        if (ctx.sessionManager) {
          await ctx.sessionManager.clearSession().catch(() => {});
        }
        ctx.authSession = null;
        ctx.sendToRenderer('auth:sessionChanged', null);
      }

      return { success: true };
    }
    if (ctx.supabaseDataClient) {
      const { data: admins } = await ctx.supabaseDataClient
        .from('personnel')
        .select('id')
        .eq('role', 'admin')
        .neq('id', validId);
      if (!admins || admins.length === 0) {
        return { success: false, error: 'Cannot remove the last admin' };
      }
      // Get auth_uid before deleting personnel record
      const { data: target } = await ctx.supabaseDataClient
        .from('personnel')
        .select('auth_uid')
        .eq('id', validId)
        .single();
      const targetAuthUid = target?.auth_uid;

      // Delete from Supabase Auth BEFORE deleting the personnel record —
      // the RPC checks auth.uid() against personnel to verify the caller is admin,
      // so the caller's personnel record must still exist.
      if (targetAuthUid) {
        const { error: rpcError } = await ctx.supabaseDataClient.rpc('delete_auth_user', { target_uid: targetAuthUid });
        if (rpcError) {
          console.error('[AUTH] Failed to delete auth user via RPC:', rpcError.message);
        }
      }

      await ctx.supabaseDataClient.from('personnel').update({ invited_by: null }).eq('invited_by', validId);
      const { error } = await ctx.supabaseDataClient.from('personnel').delete().eq('id', validId);
      if (error) return { success: false, error: error.message };

      // Self-removal: if the deleted personnel is the current user, force sign-out
      const selfId = ctx.authSession?.user?.personnelId;
      if (selfId === validId) {
        if (ctx.sessionManager) {
          await ctx.sessionManager.clearSession().catch(() => {});
        }
        ctx.authSession = null;
        ctx.sendToRenderer('auth:sessionChanged', null);
      }

      return { success: true };
    }

    // Local SQLite fallback (Local Sync mode)
    if (ctx.personnelRepo) {
      // Cannot remove yourself
      if (ctx.localAuthPersonnel?.id === validId) {
        return { success: false, error: 'Cannot remove yourself. Ask another admin to remove you.' };
      }
      // Cannot remove the last admin
      const allPersonnel = ctx.personnelRepo.getAll();
      const otherAdmins = allPersonnel.filter((p) => p.role === 'admin' && p.id !== validId);
      if (otherAdmins.length === 0) {
        const target = allPersonnel.find((p) => p.id === validId);
        if (target?.role === 'admin') {
          return { success: false, error: 'Cannot remove the last admin' };
        }
      }
      const removed = ctx.personnelRepo.remove(validId);
      return { success: removed };
    }

    return { success: false, error: 'No cloud connection' };
  });

  ipcMain.handle('personnel:updateRole', async (event, id: unknown, role: unknown) => {
    const validId = z.string().parse(id);
    const validRole = personnelRoleSchema.parse(role) as PersonnelRole;
    const ctx = resolveContext(event);
    // Safeguard: don't demote the last admin
    if (validRole === 'member') {
      const pool = ctx.cloudConnection?.pool;
      if (pool) {
        const { rows } = await pool.query(
          "SELECT COUNT(*) as cnt FROM personnel WHERE role = 'admin' AND id != $1",
          [validId],
        );
        if (Number(rows[0].cnt) === 0) {
          return { success: false, error: 'Cannot demote the last admin' };
        }
        await pool.query('UPDATE personnel SET role = $1 WHERE id = $2', [validRole, validId]);
        return { success: true };
      }
      if (ctx.supabaseDataClient) {
        const { data: admins } = await ctx.supabaseDataClient
          .from('personnel')
          .select('id')
          .eq('role', 'admin')
          .neq('id', validId);
        if (!admins || admins.length === 0) {
          return { success: false, error: 'Cannot demote the last admin' };
        }
        const { error } = await ctx.supabaseDataClient.from('personnel').update({ role: validRole }).eq('id', validId);
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
    } else {
      const pool = ctx.cloudConnection?.pool;
      if (pool) {
        await pool.query('UPDATE personnel SET role = $1 WHERE id = $2', [validRole, validId]);
        return { success: true };
      }
      if (ctx.supabaseDataClient) {
        const { error } = await ctx.supabaseDataClient.from('personnel').update({ role: validRole }).eq('id', validId);
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
    }

    // Local SQLite fallback (Local Sync mode)
    if (ctx.personnelRepo) {
      if (validRole === 'member') {
        // Cannot demote the last admin
        const allPersonnel = ctx.personnelRepo.getAll();
        const otherAdmins = allPersonnel.filter((p) => p.role === 'admin' && p.id !== validId);
        if (otherAdmins.length === 0) {
          return { success: false, error: 'Cannot demote the last admin' };
        }
      }
      const person = ctx.personnelRepo.getById(validId);
      if (!person) return { success: false, error: 'Personnel not found' };
      ctx.personnelRepo.save({ ...person, role: validRole as PersonnelRole });
      return { success: true };
    }

    return { success: false, error: 'No cloud connection' };
  });
}
