type SyncLogLevel = 'info' | 'warn' | 'error';

export function syncLog(level: SyncLogLevel, message: string, context?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const prefix = `[sync ${timestamp}]`;
  const suffix = context ? ' ' + JSON.stringify(context) : '';
  switch (level) {
    case 'info':  console.log(`${prefix} ${message}${suffix}`);   break;
    case 'warn':  console.warn(`${prefix} ${message}${suffix}`);  break;
    case 'error': console.error(`${prefix} ${message}${suffix}`); break;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
