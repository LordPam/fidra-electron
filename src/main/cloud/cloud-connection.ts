import pg from 'pg';
import type { CloudServerConfig } from '../../shared/ipc-types';

export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  CONFLICT = 'conflict',
}

const TRANSIENT_PATTERNS = [
  'connection refused',
  'connection reset',
  'connection terminated',
  'connection timed out',
  'timeout',
  'network',
  'broken pipe',
  'no route to host',
  'econnrefused',
  'econnreset',
  'etimedout',
  'ehostunreach',
  'pool is closed',
  'cannot perform operation',
  'too many connections',
  'remaining connection slots',
  'row-level security',       // RLS failures can resolve after token refresh
  'row level security',
];

const PERMANENT_PATTERNS = [
  'authentication failed',
  'password authentication failed',
  'permission denied',
  'access denied',
  'invalid password',
  'syntax error',
  'does not exist',
  'already exists',
  'violates unique constraint',
  'violates check constraint',
  'violates foreign key constraint',
  'violates not-null constraint',
  'violates exclusion constraint',
  'invalid input',
];

export function classifyError(error: unknown): ErrorCategory {
  const name = (error as Error)?.constructor?.name ?? '';
  const msg = String(error).toLowerCase();

  if (name.includes('ConcurrencyError') || name.includes('EntityDeletedError') || msg.includes('version conflict')) {
    return ErrorCategory.CONFLICT;
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (msg.includes(pattern)) return ErrorCategory.TRANSIENT;
  }

  for (const pattern of PERMANENT_PATTERNS) {
    if (msg.includes(pattern)) return ErrorCategory.PERMANENT;
  }

  // Default to transient for unknown errors (safer to retry)
  return ErrorCategory.TRANSIENT;
}

export function getUserErrorMessage(error: unknown): string {
  const msg = String(error).toLowerCase();

  if (msg.includes('version conflict') || msg.includes('concurrency')) {
    return 'This record was modified by another user. Please refresh and try again.';
  }
  if (['connection', 'network', 'refused', 'reset'].some((k) => msg.includes(k))) {
    return 'Unable to connect to the server. Please check your internet connection.';
  }
  if (msg.includes('timeout')) {
    return 'The server took too long to respond. Please try again.';
  }
  if (['authentication', 'password', 'permission'].some((k) => msg.includes(k))) {
    return 'Authentication failed. Please check your server credentials.';
  }
  if (msg.includes('too many connections') || msg.includes('pool')) {
    return 'Server is busy. Please wait a moment and try again.';
  }

  return 'A temporary error occurred. Please try again.';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    onRetry?: (attempt: number, delay: number, error: Error) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1.0,
    maxDelay = 10.0,
    backoffFactor = 2.0,
    onRetry,
  } = options;

  let delay = initialDelay * 1000; // convert to ms
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const category = classifyError(e);

      if (category === ErrorCategory.PERMANENT || category === ErrorCategory.CONFLICT) {
        throw lastError;
      }

      if (attempt >= maxRetries) {
        throw lastError;
      }

      onRetry?.(attempt + 1, delay / 1000, lastError);
      await sleep(delay);
      delay = Math.min(delay * backoffFactor, maxDelay * 1000);
    }
  }

  throw lastError ?? new Error('Retry loop completed without result');
}

export class CloudConnection {
  private _pool: pg.Pool | null = null;
  private _isHealthy = false;
  private readonly _config: CloudServerConfig;

  onConnectionLost?: () => void;
  onConnectionRestored?: () => void;
  onRetry?: (attempt: number, delay: number) => void;

  constructor(config: CloudServerConfig) {
    this._config = config;
  }

  get config(): CloudServerConfig {
    return this._config;
  }

  get pool(): pg.Pool {
    if (!this._pool) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this._pool;
  }

  get isConnected(): boolean {
    return this._pool !== null;
  }

  get isHealthy(): boolean {
    return this._isHealthy && this._pool !== null;
  }

  async connect(): Promise<void> {
    if (!this._config.connectionString) {
      throw new Error('Database connection string not configured');
    }

    await withRetry(
      async () => {
        this._pool = new pg.Pool({
          connectionString: this._config.connectionString,
          min: this._config.poolMin,
          max: this._config.poolMax,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
          // Disable prepared statements for connection poolers (e.g. Supabase pgbouncer)
          statement_timeout: 30_000,
          ssl: this._config.connectionString!.includes('sslmode=disable')
            ? false
            : { rejectUnauthorized: false },
        });

        // Handle idle connection errors (e.g. ETIMEDOUT) to prevent uncaught exceptions
        this._pool.on('error', (err) => {
          console.warn('[CLOUD] Pool background error:', err.message);
          this._isHealthy = false;
          this.onConnectionLost?.();
        });

        // Test the connection
        const client = await this._pool.connect();
        try {
          await client.query('SELECT 1');
        } finally {
          client.release();
        }
      },
      {
        maxRetries: 3,
        initialDelay: 1.0,
        maxDelay: 10.0,
        onRetry: (attempt, delay) => {
          console.log(`Connection attempt ${attempt} failed, retrying in ${delay.toFixed(1)}s`);
          this.onRetry?.(attempt, delay);
        },
      },
    );

    this._isHealthy = true;
    console.log('Cloud connection pool created successfully');
  }

  async close(): Promise<void> {
    if (this._pool) {
      const pool = this._pool;
      this._pool = null;
      this._isHealthy = false;
      try {
        await pool.end();
        console.log('Cloud connection pool closed');
      } catch (e) {
        console.warn('Pool close failed:', e instanceof Error ? e.message : String(e));
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this._pool) {
      this._isHealthy = false;
      return false;
    }

    let client: pg.PoolClient | null = null;
    try {
      client = await this._pool.connect();
      // Suppress connection-level errors during health check to prevent
      // uncaught exceptions when the server drops the connection mid-query
      client.on('error', () => {});
      await client.query('SELECT 1');

      if (!this._isHealthy) {
        this._isHealthy = true;
        console.log('Cloud connection health restored');
        this.onConnectionRestored?.();
      }
      return true;
    } catch (e) {
      if (this._isHealthy) {
        this._isHealthy = false;
        console.warn('Cloud connection health check failed:', e instanceof Error ? e.message : String(e));
        this.onConnectionLost?.();
      }
      return false;
    } finally {
      try {
        client?.release(true); // destroy the client rather than returning to pool
      } catch {
        // Connection already dead
      }
    }
  }

  async reconnect(): Promise<void> {
    console.log('Reconnect: closing old pool...');
    await this.close();
    console.log('Reconnect: creating new pool...');
    await this.connect();

    // Verify the new pool
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('Reconnect: connection verified');
    } catch (e) {
      console.error('Reconnect: verification failed:', e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      client.release();
    }

    this.onConnectionRestored?.();
  }

  async executeWithRetry<T>(
    fn: (client: pg.PoolClient) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    const wasHealthy = this._isHealthy;

    try {
      const result = await withRetry(
        async () => {
          const client = await this.pool.connect();
          try {
            return await fn(client);
          } finally {
            client.release();
          }
        },
        {
          maxRetries,
          initialDelay: 0.5,
          maxDelay: 5.0,
          onRetry: (attempt, delay, error) => {
            console.warn(`Operation failed (attempt ${attempt}), retrying: ${error.message}`);
            this.onRetry?.(attempt, delay);
          },
        },
      );

      if (!wasHealthy) {
        this._isHealthy = true;
        this.onConnectionRestored?.();
      }
      return result;
    } catch (e) {
      const category = classifyError(e);
      if (category === ErrorCategory.TRANSIENT && wasHealthy) {
        this._isHealthy = false;
        this.onConnectionLost?.();
      }
      throw e;
    }
  }
}

// Singleton instance managed at module level
let _activeConnection: CloudConnection | null = null;

export function getCloudConnection(): CloudConnection | null {
  return _activeConnection;
}

export function setCloudConnection(conn: CloudConnection | null): void {
  _activeConnection = conn;
}
