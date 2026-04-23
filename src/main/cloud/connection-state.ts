/**
 * Connection state management service.
 *
 * Tracks cloud connection status, performs periodic health checks,
 * and manages reconnection attempts with exponential backoff.
 *
 * Port of Python's connection_state.py.
 */

import type { CloudConnection } from './cloud-connection';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

/** Minimal interface used by SyncService to check connectivity. */
export interface ConnectionStateProvider {
  readonly isConnected: boolean;
  reportNetworkError(): void;
}

export class ConnectionStateService implements ConnectionStateProvider {
  private _status: ConnectionStatus = 'connected';
  private _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _isMonitoring = false;
  private _isReconnecting = false;
  private _isHealthChecking = false;

  // Callbacks
  onStatusChanged: ((status: ConnectionStatus) => void) | null = null;
  onHealthCheckCompleted: ((healthy: boolean) => void) | null = null;

  constructor(
    private readonly connection: CloudConnection,
    private readonly healthCheckIntervalMs: number = 30_000,
    private readonly maxReconnectAttempts: number = 5,
  ) {
    // Wire up connection callbacks
    this.connection.onConnectionLost = () => this.onConnectionLost();
    this.connection.onConnectionRestored = () => this.onConnectionRestored();
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get isOffline(): boolean {
    return this._status === 'offline';
  }

  startMonitoring(): void {
    if (this._isMonitoring) return;
    this._isMonitoring = true;
    this._healthCheckTimer = setInterval(
      () => this.doHealthCheck(),
      this.healthCheckIntervalMs,
    );
    console.log(`[CONNECTION] Health monitoring started (interval: ${this.healthCheckIntervalMs}ms)`);
  }

  stopMonitoring(): void {
    this._isMonitoring = false;
    this._isReconnecting = false;
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    console.log('[CONNECTION] Health monitoring stopped');
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (newStatus === this._status) return;
    const old = this._status;
    this._status = newStatus;
    console.log(`[CONNECTION] Status: ${old} -> ${newStatus}`);

    // Speed up health checks when offline, restore normal when connected
    if (this._healthCheckTimer && this._isMonitoring) {
      clearInterval(this._healthCheckTimer);
      const interval = newStatus === 'offline' ? 5000 : this.healthCheckIntervalMs;
      this._healthCheckTimer = setInterval(() => this.doHealthCheck(), interval);
    }

    this.onStatusChanged?.(newStatus);
  }

  private onConnectionLost(): void {
    console.log('[CONNECTION] Connection lost detected');
    this.setStatus('reconnecting');
    this.startReconnection();
  }

  private onConnectionRestored(): void {
    console.log('[CONNECTION] Connection restored');
    this._reconnectAttempts = 0;
    this.setStatus('connected');
  }

  private doHealthCheck(): void {
    if (!this._isMonitoring || this._isHealthChecking) return;
    this.asyncHealthCheck().catch((e) => {
      console.error('[CONNECTION] Health check error:', e instanceof Error ? e.message : String(e));
    });
  }

  private async asyncHealthCheck(): Promise<void> {
    this._isHealthChecking = true;
    try {
      if (this._status === 'offline') {
        await this.attemptOfflineRecovery();
        return;
      }

      const isHealthy = await this.connection.healthCheck();
      if (!this._isMonitoring) return; // Stopped while awaiting
      this.onHealthCheckCompleted?.(isHealthy);

      if (!isHealthy && this._status === 'connected') {
        this.setStatus('reconnecting');
        this.startReconnection();
      } else if (isHealthy && this._status !== 'connected') {
        this._reconnectAttempts = 0;
        this.setStatus('connected');
      }
    } catch (e) {
      console.error('[CONNECTION] Health check error:', e instanceof Error ? e.message : String(e));
      this.onHealthCheckCompleted?.(false);
      if (this._status === 'connected') {
        this.setStatus('reconnecting');
        this.startReconnection();
      }
    } finally {
      this._isHealthChecking = false;
    }
  }

  private async attemptOfflineRecovery(): Promise<void> {
    try {
      await this.connection.reconnect();
      console.log('[RECONNECT] Auto-recovery successful');
      this._reconnectAttempts = 0;
      this.setStatus('connected');
    } catch {
      // Still offline — will try again next health check
    }
  }

  private startReconnection(): void {
    if (this._isReconnecting) return;
    this._isReconnecting = true;
    this._reconnectAttempts = 0;
    console.log('[RECONNECT] Starting reconnection process...');
    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (!this._isReconnecting) return;

    this._reconnectAttempts++;
    console.log(
      `[RECONNECT] Attempt ${this._reconnectAttempts}/${this.maxReconnectAttempts}`,
    );

    try {
      await this.connection.reconnect();
      console.log('[RECONNECT] Success!');
      this._reconnectAttempts = 0;
      this._isReconnecting = false;
      // onConnectionRestored callback will update status
      return;
    } catch (e) {
      console.log(`[RECONNECT] Failed: ${e}`);
    }

    // Check if we should retry or give up
    if (this._reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[RECONNECT] Max attempts reached, going offline');
      this._isReconnecting = false;
      this.setStatus('offline');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delayMs = Math.min(1000 * 2 ** (this._reconnectAttempts - 1), 16_000);
    console.log(`[RECONNECT] Scheduling retry in ${delayMs}ms`);
    this._reconnectTimer = setTimeout(() => this.attemptReconnect(), delayMs);
  }

  async reconnectNow(): Promise<boolean> {
    console.log('[RECONNECT] Manual reconnection requested');
    this._reconnectAttempts = 0;
    this._isReconnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.setStatus('reconnecting');

    try {
      await this.connection.reconnect();
      console.log('[RECONNECT] Manual reconnection successful');
      return true;
    } catch (e) {
      console.log(`[RECONNECT] Manual reconnection failed: ${e}`);
      this.setStatus('offline');
      return false;
    }
  }

  getStatusMessage(): string {
    if (this._status === 'connected') return 'Connected';
    if (this._status === 'reconnecting') {
      if (this._reconnectAttempts > 0) {
        return `Reconnecting (${this._reconnectAttempts}/${this.maxReconnectAttempts})...`;
      }
      return 'Reconnecting...';
    }
    return 'Offline';
  }

  reportNetworkError(): void {
    if (this._status === 'connected') {
      console.log('[RECONNECT] Network error reported - starting reconnection');
      this.setStatus('reconnecting');
      this.startReconnection();
    }
  }
}

/**
 * Lightweight connection state for member mode (PostgREST).
 *
 * Since member mode has no pg.Pool to monitor, connectivity is tracked
 * via an external flag (WindowContext.memberConnected) that is toggled
 * by successful/failed Supabase operations.
 */
export class MemberConnectionState implements ConnectionStateProvider {
  private _connected: boolean;
  onStatusChanged: ((connected: boolean) => void) | null = null;

  constructor(initiallyConnected: boolean) {
    this._connected = initiallyConnected;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  setConnected(connected: boolean): void {
    if (connected === this._connected) return;
    this._connected = connected;
    this.onStatusChanged?.(connected);
  }

  reportNetworkError(): void {
    console.log('[MEMBER-CONN] Network error reported');
    this.setConnected(false);
  }
}
