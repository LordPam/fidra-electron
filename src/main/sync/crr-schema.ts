import type Database from 'better-sqlite3';
import { crsqliteExtensionPath as extensionPath } from '../database/native-paths';

/** All tables that participate in Local Sync (registered as CRRs). */
export const SYNCED_TABLES = [
  'transactions',
  'planned_templates',
  'sheets',
  'categories',
  'invoices',
  'activity_notes',
  'personnel',
  'attachments',
  'audit_log',
  'settings',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Schema version embedded in bundles for compatibility checks. */
export const CRR_SCHEMA_VERSION = 1;

const CRR_SENTINEL_KEY = '_crr_initialized';

/** Check whether CRR initialization has already been performed on this database. */
export function isCrrInitialized(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(CRR_SENTINEL_KEY) as
    | { value: string }
    | undefined;
  return row?.value === '1';
}

/** Mark the database as CRR-initialized (sentinel in settings with device scope). */
export function markCrrInitialized(db: Database.Database): void {
  db.prepare(
    "INSERT INTO settings (key, value, scope) VALUES (?, '1', 'device') ON CONFLICT(key) DO UPDATE SET value = '1'",
  ).run(CRR_SENTINEL_KEY);
}

/**
 * Load cr-sqlite extension and register all synced tables as CRRs.
 *
 * Must be called AFTER schema DDL has been executed (tables must exist).
 * Safe to call multiple times — skips if already initialized, but repairs
 * any tables that lost their CRR triggers (e.g., from table rebuilds in migrations).
 */
export function initializeCrr(db: Database.Database): void {
  if (isCrrInitialized(db)) {
    // Sentinel is set, but table rebuilds in migrations can destroy CRR triggers.
    // Verify each table still has its triggers and re-register any that don't.
    repairCrrTriggers(db);
    return;
  }

  db.loadExtension(extensionPath);

  for (const table of SYNCED_TABLES) {
    db.exec(`SELECT crsql_as_crr('${table}')`);
  }

  markCrrInitialized(db);
}

/**
 * Check each synced table for its CRR triggers and re-register any that are missing.
 * This repairs tables that were rebuilt by migrations after CRR initialization.
 */
function repairCrrTriggers(db: Database.Database): void {
  for (const table of SYNCED_TABLES) {
    // cr-sqlite creates triggers with names like __crsql_itrig_<table>
    const trigger = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name LIKE ? LIMIT 1")
      .get(`%crsql%${table}%`);
    if (!trigger) {
      db.exec(`SELECT crsql_as_crr('${table}')`);
    }
  }
}
