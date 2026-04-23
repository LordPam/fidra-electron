import type { AuthSession } from '../../../shared/auth-types';
import type { SupabaseAuth } from './supabase-auth';
import type { SessionStore } from './session-store';

const REFRESH_MARGIN_SECONDS = 5 * 60; // Refresh 5 minutes before expiry
const OFFLINE_GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** Check if an error is a network-level failure (not an auth rejection). */
function isNetworkError(error: unknown): boolean {
  const msg = typeof error === 'string' ? error : (error instanceof Error ? error.message : String(error));
  const lower = msg.toLowerCase();
  return lower.includes('fetch') || lower.includes('network') || lower.includes('enotfound')
    || lower.includes('econnrefused') || lower.includes('timeout') || lower.includes('dns')
    || lower.includes('socket') || lower.includes('enetunreach') || lower.includes('econnreset');
}

export class SessionManager {
  private _session: AuthSession | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _isOffline = false;

  onSessionChanged?: (session: AuthSession | null) => void;

  constructor(
    private readonly serverId: string,
    private readonly auth: SupabaseAuth,
    private readonly store: SessionStore,
  ) {}

  get session(): AuthSession | null {
    return this._session;
  }

  /** Returns true when the session was restored from disk but the token could not be refreshed due to network issues. */
  isOfflineSession(): boolean {
    return this._isOffline;
  }

  async restoreSession(): Promise<AuthSession | null> {
    const saved = this.store.loadSession(this.serverId);
    if (!saved) return null;

    // Check if token is still valid (with margin)
    const now = Math.floor(Date.now() / 1000);
    if (saved.expiresAt - now < REFRESH_MARGIN_SECONDS) {
      // Token expired or near expiry — try to refresh
      try {
        const { session, error } = await this.auth.refreshSession(saved.refreshToken);
        if (error || !session) {
          // Distinguish network errors from auth rejections
          if (isNetworkError(error ?? '')) {
            return this.enterOfflineMode(saved, now);
          }
          console.warn(`[SESSION] Auth rejected for ${this.serverId}:`, error);
          this.store.deleteSession(this.serverId);
          return null;
        }
        // Preserve personnelId from saved session (refreshSession returns a bare Supabase
        // session that doesn't carry our custom personnelId field)
        const merged: AuthSession = {
          ...session,
          user: { ...session.user, personnelId: saved.user.personnelId || session.user.personnelId },
        };
        this._isOffline = false;
        this.setSession(merged);
        return merged;
      } catch (e) {
        // Network-level exception (e.g., DNS failure, no internet)
        if (isNetworkError(e)) {
          return this.enterOfflineMode(saved, now);
        }
        console.warn(`[SESSION] Refresh exception for ${this.serverId}:`, e);
        this.store.deleteSession(this.serverId);
        return null;
      }
    }

    this._isOffline = false;
    this.setSession(saved);
    return saved;
  }

  setSession(session: AuthSession): void {
    this._isOffline = false;
    this._session = session;
    this.store.saveSession(this.serverId, session);
    this.scheduleRefresh(session);
    this.onSessionChanged?.(session);
  }

  async clearSession(): Promise<void> {
    this.cancelRefreshTimer();
    this._session = null;
    this._isOffline = false;
    this.store.deleteSession(this.serverId);
    this.onSessionChanged?.(null);
  }

  stop(): void {
    this.cancelRefreshTimer();
  }

  /** Enter offline mode — keep the session if within the grace period. */
  private enterOfflineMode(saved: AuthSession, now: number): AuthSession | null {
    // Only allow offline mode within the grace period from when the token was originally issued
    const tokenAge = now - (saved.expiresAt - 3600); // approximate: expiresAt is usually issued + 3600
    if (tokenAge > OFFLINE_GRACE_PERIOD_SECONDS) {
      console.warn(`[SESSION] Offline grace period expired for ${this.serverId}`);
      this.store.deleteSession(this.serverId);
      return null;
    }
    console.log(`[SESSION] Network unavailable, entering offline mode for ${this.serverId}`);
    this._isOffline = true;
    this._session = saved;
    // Schedule a retry in 60 seconds
    this.scheduleRefresh(saved, 60_000);
    return saved;
  }

  private scheduleRefresh(session: AuthSession, overrideMs?: number): void {
    this.cancelRefreshTimer();

    const now = Math.floor(Date.now() / 1000);
    const refreshIn = overrideMs ?? Math.max(0, (session.expiresAt - now - REFRESH_MARGIN_SECONDS)) * 1000;

    this._refreshTimer = setTimeout(async () => {
      try {
        const { session: newSession, error } = await this.auth.refreshSession(session.refreshToken);
        if (error || !newSession) {
          if (isNetworkError(error ?? '')) {
            console.warn(`[SESSION] Auto-refresh network error for ${this.serverId}, retrying in 60s`);
            const wasOffline = this._isOffline;
            this._isOffline = true;
            this.scheduleRefresh(session, 60_000);
            if (!wasOffline) this.onSessionChanged?.(this._session);
            return;
          }
          console.error(`[SESSION] Auto-refresh auth rejected for ${this.serverId}:`, error);
          await this.clearSession();
          return;
        }
        // Preserve personnelId from old session
        const merged: AuthSession = {
          ...newSession,
          user: { ...newSession.user, personnelId: this._session?.user.personnelId ?? newSession.user.personnelId },
        };
        this.setSession(merged);
        console.log(`[SESSION] Token refreshed for ${this.serverId}`);
      } catch (e) {
        if (isNetworkError(e)) {
          console.warn(`[SESSION] Auto-refresh network exception for ${this.serverId}, retrying in 60s`);
          const wasOffline = this._isOffline;
          this._isOffline = true;
          this.scheduleRefresh(session, 60_000);
          if (!wasOffline) this.onSessionChanged?.(this._session);
          return;
        }
        console.error(`[SESSION] Auto-refresh error for ${this.serverId}:`, e);
        await this.clearSession();
      }
    }, refreshIn);
  }

  private cancelRefreshTimer(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }
}
