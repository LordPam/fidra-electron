/**
 * Shared member-mode service initialisation.
 *
 * Extracted so that both `cloud.ts` (IPC handlers) and `window-manager.ts`
 * (auto-connect) can reuse the same logic for starting the SyncService,
 * polling timer, and session-change handler.
 */

import { createClient } from '@supabase/supabase-js';
import { SyncService } from './sync-service';
import { MemberConnectionState } from './connection-state';
import type { WindowContext } from '../window/window-context';
import type { CloudServerConfig } from '../../shared/ipc-types';
import { getCloudServer } from '../window/global-settings';

const MEMBER_POLL_INTERVAL_MS = 60_000;

/** Check if an error is a JWT/auth failure (not a network or data error). */
function isAuthError(error: unknown): boolean {
  const msg = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));
  const lower = msg.toLowerCase();
  return lower.includes('jwt') || lower.includes('expired') || lower.includes('unauthorized')
    || lower.includes('invalid_claim') || lower.includes('invalid claim') || lower.includes('401')
    || lower.includes('pgrst301') || lower.includes('not authenticated');
}

/**
 * Start the SyncService and polling timer for a member-mode window.
 * Must be called AFTER `ctx.activateCachingLayerMember()`.
 */
export function startMemberServices(ctx: WindowContext): void {
  const queue = ctx.syncQueue;
  const repos = ctx.getCachingRepos();

  if (!queue || !repos.transactions || !repos.planned || !repos.sheets || !repos.categories) {
    console.error('[CLOUD] Cannot start member services — caching layer not active');
    return;
  }

  // Lightweight connection state backed by memberConnected flag
  const memberState = new MemberConnectionState(ctx.memberConnected);
  ctx.memberConnectionState = memberState;

  // Sync service
  ctx.syncService = new SyncService(
    queue,
    repos.transactions,
    repos.planned,
    repos.sheets,
    repos.categories,
    memberState,
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

  // Polling for remote changes (member mode can't use LISTEN/NOTIFY).
  // Capture timer reference so .then() chains can detect teardown.
  const pollTimer = { cleared: false };
  ctx.memberPollTimer = setInterval(() => {
    if (pollTimer.cleared || !ctx.supabaseDataClient) return;

    if (!ctx.memberConnected) {
      // Offline — probe with a lightweight query to detect recovery
      Promise.resolve(
        ctx.supabaseDataClient
          .from('sheets')
          .select('id', { count: 'exact', head: true })
          .limit(1),
      ).then(({ error }) => {
        if (pollTimer.cleared) return;
        if (error && isAuthError(error.message ?? '')) {
          console.warn('[CLOUD] Offline probe got auth error, attempting token refresh');
          ctx.sessionManager?.restoreSession().then((session) => {
            if (!session && !pollTimer.cleared) {
              // Refresh token is dead — clear session so renderer shows auth gate
              ctx.sessionManager?.clearSession();
            }
          }).catch(() => {});
          return;
        }
        if (!error) {
          console.log('[CLOUD] Member connectivity restored');
          ctx.memberConnected = true;
          memberState.setConnected(true);
          ctx.sendToRenderer('connection:statusChanged', 'connected');
          const cachingRepos = ctx.getCachingRepos();
          Promise.all([
            cachingRepos.transactions?.refreshFromCloud(),
            cachingRepos.planned?.refreshFromCloud(),
            cachingRepos.sheets?.refreshFromCloud(),
            cachingRepos.categories?.refreshFromCloud(),
            cachingRepos.activityNotes?.refreshFromCloud(),
            cachingRepos.attachments?.refreshFromCloud(),
            cachingRepos.invoices?.refreshFromCloud(),
            cachingRepos.audit?.refreshFromCloud(),
            ctx.supabaseSettingsRepo?.getAll().then((settings) => {
              for (const [key, value] of Object.entries(settings)) {
                ctx.settingsRepo.setSetting(key, value);
              }
            }),
          ]).then(() => {
            if (!pollTimer.cleared) {
              ctx.sendToRenderer('cloud:dataChanged', [
                'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings', 'audit_log',
              ]);
            }
          }).catch(() => {});
        }
      }).catch(() => {}); // Still offline, silently continue
      return;
    }

    // Online — refresh all repos
    const cachingRepos = ctx.getCachingRepos();
    Promise.all([
      cachingRepos.transactions?.refreshFromCloud(),
      cachingRepos.planned?.refreshFromCloud(),
      cachingRepos.sheets?.refreshFromCloud(),
      cachingRepos.categories?.refreshFromCloud(),
      cachingRepos.activityNotes?.refreshFromCloud(),
      cachingRepos.attachments?.refreshFromCloud(),
      cachingRepos.invoices?.refreshFromCloud(),
      cachingRepos.audit?.refreshFromCloud(),
      ctx.supabaseSettingsRepo?.getAll().then((settings) => {
        if (pollTimer.cleared) return;
        for (const [key, value] of Object.entries(settings)) {
          ctx.settingsRepo.setSetting(key, value);
        }
      }),
    ]).then(() => {
      if (!pollTimer.cleared) {
        ctx.sendToRenderer('cloud:dataChanged', [
          'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'db_settings', 'audit_log',
        ]);
      }
    }).catch((e) => {
      if (pollTimer.cleared) return;
      if (isAuthError(e)) {
        console.warn('[CLOUD] Member poll auth error, attempting token refresh:', e.message ?? e);
        ctx.sessionManager?.restoreSession().then((session) => {
          if (!session && !pollTimer.cleared) {
            ctx.sessionManager?.clearSession();
          }
        }).catch((refreshErr) => {
          console.error('[CLOUD] Token refresh failed after auth error:', refreshErr);
        });
        return;
      }
      console.warn('[CLOUD] Member poll failed:', e);
      if (ctx.memberConnected) {
        ctx.memberConnected = false;
        memberState.setConnected(false);
        ctx.sendToRenderer('connection:statusChanged', 'offline');
      }
    });
  }, MEMBER_POLL_INTERVAL_MS);

  // Store sentinel cleanup so teardown paths can mark in-flight promises stale
  ctx._memberPollGeneration = pollTimer;

  console.log(`[WINDOW ${ctx.dbName}] Member sync service and polling started`);
}

/**
 * Set up the `onSessionChanged` handler for a member-mode window.
 * Handles token refresh: rebuilds Supabase client, restarts services.
 */
export function setupMemberSessionHandler(
  ctx: WindowContext,
  config: CloudServerConfig,
): void {
  const projectUrl = config.projectUrl ?? config.storageUrl;
  const anonKey = config.anonKey ?? config.storageKey;
  if (!projectUrl || !anonKey) return;

  // Generation counter prevents stale promises from earlier invocations
  // from mutating state after a newer session change has taken over.
  let sessionGeneration = 0;

  ctx.sessionManager!.onSessionChanged = (newSession) => {
    const thisGen = ++sessionGeneration;

    ctx.authSession = newSession;
    ctx.sendToRenderer('auth:sessionChanged', newSession);

    if (!newSession) {
      ctx.memberConnected = false;
      ctx.memberConnectionState?.setConnected(false);
      ctx.sendToRenderer('connection:statusChanged', 'offline');
      return;
    }

    // Session manager went offline (network error during refresh)
    if (ctx.sessionManager!.isOfflineSession()) {
      ctx.memberConnected = false;
      ctx.memberConnectionState?.setConnected(false);
      ctx.sendToRenderer('connection:statusChanged', 'offline-authenticated');
      return;
    }

    // Local Sync is active — auth token refreshed but Cloud sync layer must
    // stay off. Session is updated (above) so auth-gated features still work,
    // but we must not reactivate caching/polling services.
    if (ctx.localSyncOrchestrator) {
      return;
    }

    // Rebuild the Supabase client with the new access token.
    const wasOffline = !ctx.supabaseDataClient;
    if (ctx.syncService) { ctx.syncService.stop(); ctx.syncService = null; }
    if (ctx.memberPollTimer) { clearInterval(ctx.memberPollTimer); ctx.memberPollTimer = null; }
    if (ctx._memberPollGeneration) { ctx._memberPollGeneration.cleared = true; ctx._memberPollGeneration = null; }

    const refreshedClient = createClient(projectUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${newSession.accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    ctx.deactivateCachingLayer();

    // Reload config in case it changed
    const latestConfig = ctx.serverId ? getCloudServer(ctx.serverId) : config;
    ctx.activateCachingLayerMember(refreshedClient, latestConfig ?? config);
    startMemberServices(ctx);

    if (wasOffline) {
      // Coming online for the first time — full refresh
      const repos = ctx.getCachingRepos();
      Promise.all([
        repos.transactions?.refreshFromCloud(),
        repos.planned?.refreshFromCloud(),
        repos.sheets?.refreshFromCloud(),
        repos.categories?.refreshFromCloud(),
        repos.activityNotes?.refreshFromCloud(),
        repos.attachments?.refreshFromCloud(),
        repos.invoices?.refreshFromCloud(),
        repos.audit?.refreshFromCloud(),
      ]).then(() => {
        if (thisGen !== sessionGeneration) return; // Superseded by newer session change
        ctx.memberConnected = true;
        ctx.memberConnectionState?.setConnected(true);
        ctx.sendToRenderer('connection:statusChanged', 'connected');
        ctx.sendToRenderer('cloud:dataChanged', [
          'transactions', 'planned_templates', 'sheets', 'categories', 'activity_notes', 'attachments', 'invoices', 'audit_log',
        ]);
      }).catch((e) => console.error('[CLOUD] Failed to refresh after coming online:', e instanceof Error ? e.message : String(e)));
    } else {
      ctx.memberConnected = true;
      ctx.memberConnectionState?.setConnected(true);
    }
  };
}
