/**
 * Real-time change listener using PostgreSQL LISTEN/NOTIFY.
 *
 * Listens for data changes on synced tables and triggers cache refresh
 * so changes from other devices appear in real time.
 *
 * Uses a dedicated pg.Client (not from the pool) to avoid affecting pool
 * sizing. Notifications are debounced to batch rapid changes.
 *
 * IMPORTANT: LISTEN/NOTIFY does not work through connection poolers
 * (PgBouncer, Supavisor) in transaction mode. This module automatically
 * detects Supabase pooler URLs and derives the direct connection URL.
 *
 * Port of Python's change_listener.py.
 */

import pg from 'pg';
import type { CloudConnection } from './cloud-connection';

const NOTIFY_CHANNEL = 'fidra_changes';

const WATCHED_TABLES = [
  'transactions',
  'planned_templates',
  'sheets',
  'categories',
  'activity_notes',
  'attachments',
  'invoices',
  'db_settings',
  'audit_log',
] as const;

type WatchedTable = (typeof WATCHED_TABLES)[number];

/**
 * Convert a pooler connection string to session mode if needed.
 * Supabase pooler URLs use port 6543 (transaction mode), which
 * silently drops LISTEN/NOTIFY. Port 5432 uses session mode.
 */
function getDirectConnectionString(connStr: string): string {
  try {
    const url = new URL(connStr);
    if (url.port === '6543') {
      url.port = '5432';
      console.log(`[LISTEN] Using session mode: ${url.hostname}:5432`);
      return url.toString();
    }
  } catch {
    // Not a valid URL — return as-is
  }
  return connStr;
}

export class ChangeListener {
  private _client: pg.Client | null = null;
  private _isRunning = false;
  private _isStopping = false;
  private _dirtyTables = new Set<string>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _healthTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollBaselines: Record<string, string | null> = {};
  private _pollInitialized = false;
  private _selfTestReceived = false;

  // Callback fired when tables have changed (debounced)
  onTablesChanged: ((tables: Set<string>) => void) | null = null;

  constructor(
    private readonly cloudConnection: CloudConnection,
    private readonly debounceMs: number = 1000,
    private readonly healthCheckMs: number = 60_000,
  ) {}

  get isRunning(): boolean {
    return this._isRunning && this._client !== null;
  }

  async start(): Promise<void> {
    if (this._isRunning || this._isStopping) return;

    try {
      const directDsn = getDirectConnectionString(this.cloudConnection.config.connectionString);
      this._client = new pg.Client({
        connectionString: directDsn,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 10_000,
      });

      await this._client.connect();

      // Handle idle connection errors (e.g. ETIMEDOUT) to prevent uncaught exceptions
      this._client.on('error', (err) => {
        console.warn('[LISTEN] Client background error:', err.message);
        this.restart().catch(() => {});
      });

      // Register notification handler
      this._client.on('notification', (msg) => this.onNotification(msg));

      // Start listening
      await this._client.query(`LISTEN ${NOTIFY_CHANNEL}`);

      // Self-test: verify LISTEN/NOTIFY actually works
      if (!(await this.selfTest())) {
        console.log('[LISTEN] Self-test failed - NOTIFY not received (pooler issue?)');
        await this.cleanup();
        // Fall back to polling only
        this.startPollingOnly();
        return;
      }

      this._isRunning = true;
      this._healthTimer = setInterval(() => this.healthCheck(), this.healthCheckMs);
      this._pollTimer = setInterval(() => this.pollFallback(), this.healthCheckMs);

      console.log('[LISTEN] Change listener started (verified)');
    } catch (e) {
      console.log(`[LISTEN] Failed to start: ${e}`);
      await this.cleanup();
      // Fall back to polling
      this.startPollingOnly();
    }
  }

  async stop(): Promise<void> {
    this._isStopping = true;
    this._isRunning = false;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    this._dirtyTables.clear();
    this._pollBaselines = {};
    this._pollInitialized = false;

    await this.cleanup();
    this._isStopping = false;
    console.log('[LISTEN] Change listener stopped');
  }

  async restart(): Promise<void> {
    if (this._isStopping) return;
    await this.stop();
    await this.start();
  }

  // ─── Polling-only fallback ──────────────────────────────────────

  private startPollingOnly(): void {
    if (this._isStopping) return;
    this._isRunning = true;
    this._pollTimer = setInterval(() => this.pollFallback(), this.healthCheckMs);
    console.log('[LISTEN] Polling-only fallback started');
  }

  // ─── Self-test ──────────────────────────────────────────────────

  private async selfTest(): Promise<boolean> {
    if (!this._client) return false;

    this._selfTestReceived = false;
    const testPayload = '{"table":"_test","op":"TEST"}';
    await this._client.query(`NOTIFY ${NOTIFY_CHANNEL}, '${testPayload}'`);

    // Wait up to 2 seconds
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (this._selfTestReceived) return true;
    }
    return false;
  }

  // ─── Notification handling ──────────────────────────────────────

  private onNotification(msg: pg.Notification): void {
    try {
      const data = JSON.parse(msg.payload ?? '{}') as { table?: string; op?: string };
      const table = data.table;

      // Handle self-test
      if (table === '_test') {
        this._selfTestReceived = true;
        return;
      }

      if (table && (WATCHED_TABLES as readonly string[]).includes(table)) {
        this._dirtyTables.add(table);
        this.restartDebounce();
      }
    } catch (e) {
      console.warn(`[LISTEN] Invalid notification payload: ${msg.payload}`);
    }
  }

  private restartDebounce(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.onDebounceFired(), this.debounceMs);
  }

  private onDebounceFired(): void {
    if (!this._isRunning || this._dirtyTables.size === 0) return;

    const changed = new Set(this._dirtyTables);
    this._dirtyTables.clear();

    console.log(`[LISTEN] Remote changes: ${[...changed].join(', ')}`);
    this.onTablesChanged?.(changed);
  }

  // ─── Health check ───────────────────────────────────────────────

  private async healthCheck(): Promise<void> {
    if (!this._isRunning || !this._client || !this.cloudConnection.isConnected) return;
    try {
      await this._client.query('SELECT 1');
    } catch (e) {
      console.log(`[LISTEN] Health check failed, restarting: ${e}`);
      await this.restart();
    }
  }

  // ─── Polling fallback ──────────────────────────────────────────

  private async pollFallback(): Promise<void> {
    if (!this._isRunning) return;
    if (!this.cloudConnection.isConnected) return;

    // Use the main pool for polling (listener client may not exist in polling-only mode)
    const pool = this.cloudConnection.pool;

    try {
      const changed = new Set<string>();
      const queries: Record<string, string> = {
        transactions: 'SELECT MAX(modified_at)::text FROM transactions',
        planned_templates: 'SELECT MAX(created_at)::text FROM planned_templates',
        sheets: 'SELECT MAX(created_at)::text FROM sheets',
        categories: 'SELECT COUNT(*)::text FROM categories',
        activity_notes: 'SELECT COUNT(*)::text FROM activity_notes',
        attachments: 'SELECT MAX(created_at)::text FROM attachments',
        invoices: 'SELECT MAX(modified_at)::text FROM invoices',
        db_settings: 'SELECT MAX(modified_at)::text FROM db_settings',
        audit_log: 'SELECT MAX(timestamp)::text FROM audit_log',
      };

      for (const [table, query] of Object.entries(queries)) {
        try {
          const { rows } = await pool.query(query);
          const current = rows[0]?.max ?? rows[0]?.count ?? null;

          const baseline = this._pollBaselines[table] ?? null;
          if (this._pollInitialized && current !== baseline) {
            changed.add(table);
          }
          this._pollBaselines[table] = current;
        } catch {
          // Skip this table on error
        }
      }

      if (!this._pollInitialized) {
        this._pollInitialized = true;
        return;
      }

      if (changed.size > 0) {
        console.log(`[LISTEN] Poll detected changes: ${[...changed].join(', ')}`);
        this.onTablesChanged?.(changed);
      }
    } catch (e) {
      console.warn(`[LISTEN] Poll fallback error: ${e}`);
    }
  }

  // ─── Internal ──────────────────────────────────────────────────

  private async cleanup(): Promise<void> {
    if (this._client) {
      try {
        await this._client.end();
      } catch {
        // Connection may already be closed
      }
      this._client = null;
    }
  }
}
