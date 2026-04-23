import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  SYNCED_TABLES,
  CRR_SCHEMA_VERSION,
  isCrrInitialized,
  markCrrInitialized,
  initializeCrr,
} from '../crr-schema';

describe('SYNCED_TABLES', () => {
  it('contains all 10 expected tables', () => {
    expect(SYNCED_TABLES).toHaveLength(10);
    const expected = [
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
    ];
    for (const table of expected) {
      expect(SYNCED_TABLES).toContain(table);
    }
  });

  it('has a valid schema version', () => {
    expect(CRR_SCHEMA_VERSION).toBe(1);
  });
});

describe('isCrrInitialized / markCrrInitialized', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'device'
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('returns false on fresh database', () => {
    expect(isCrrInitialized(db)).toBe(false);
  });

  it('returns true after marking initialized', () => {
    markCrrInitialized(db);
    expect(isCrrInitialized(db)).toBe(true);
  });

  it('sentinel uses device scope', () => {
    markCrrInitialized(db);
    const row = db.prepare("SELECT scope FROM settings WHERE key = '_crr_initialized'").get() as { scope: string };
    expect(row.scope).toBe('device');
  });
});

describe('initializeCrr', () => {
  let db: Database.Database;

  // Full schema DDL matching connection.ts (with DEFAULTs for CRR compatibility)
  const SCHEMA = `
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '0',
      type TEXT NOT NULL DEFAULT 'expense',
      status TEXT NOT NULL DEFAULT '--',
      sheet TEXT NOT NULL DEFAULT '',
      category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT,
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      modified_at TEXT, modified_by TEXT
    );
    CREATE TABLE planned_templates (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '0',
      type TEXT NOT NULL DEFAULT 'expense',
      frequency TEXT NOT NULL DEFAULT 'once',
      target_sheet TEXT NOT NULL DEFAULT '',
      category TEXT, party TEXT, activity TEXT, end_date TEXT, occurrence_count INTEGER,
      skipped_dates TEXT DEFAULT '[]', fulfilled_dates TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE sheets (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      is_virtual INTEGER DEFAULT 0, is_planned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'expense',
      name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      transaction_id TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      stored_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT, file_size INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT 'create',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      user TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      details TEXT
    );
    CREATE TABLE activity_notes (
      activity TEXT PRIMARY KEY NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'device'
    );
    CREATE TABLE personnel (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      auth_uid TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      invited_by TEXT
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      from_address TEXT,
      to_name TEXT NOT NULL DEFAULT '',
      to_address TEXT,
      line_items TEXT NOT NULL DEFAULT '[]',
      subtotal TEXT NOT NULL DEFAULT '0',
      notes TEXT, bank_details TEXT, planned_template_id TEXT,
      status TEXT DEFAULT 'draft',
      transaction_id TEXT, paid_at TEXT, planned_template_snapshot TEXT,
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      modified_at TEXT, modified_by TEXT
    );
  `;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
  });

  afterEach(() => {
    try { db.prepare('SELECT crsql_finalize()').run(); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
  });

  it('registers all tables as CRRs', () => {
    initializeCrr(db);

    // After CRR registration, crsql_changes should be queryable.
    // The sentinel row in settings produces changesets, so we check for user data only.
    const txChanges0 = db.prepare("SELECT * FROM crsql_changes WHERE \"table\" = 'transactions'").all();
    expect(txChanges0).toEqual([]);

    // Insert data and verify changesets are produced
    db.prepare("INSERT INTO transactions (id, date, amount) VALUES ('tx1', '2026-01-01', '50')").run();
    const txChanges = db.prepare("SELECT * FROM crsql_changes WHERE \"table\" = 'transactions'").all();
    expect(txChanges.length).toBeGreaterThan(0);
  });

  it('skips if already initialized', () => {
    initializeCrr(db);
    // Should not throw on second call
    initializeCrr(db);
    expect(isCrrInitialized(db)).toBe(true);
  });

  it('marks database as initialized', () => {
    expect(isCrrInitialized(db)).toBe(false);
    initializeCrr(db);
    expect(isCrrInitialized(db)).toBe(true);
  });
});
