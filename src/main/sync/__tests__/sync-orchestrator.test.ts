import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';
import { SyncOrchestrator } from '../sync-orchestrator';
import { packBundle } from '../bundle-format';
import { writeBundleAtomically, ensureSyncFolderStructure } from '../bundle-io';

// ─── Schema DDL (CRR-compatible: all NOT NULL cols have DEFAULTs) ────

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

const PASSPHRASE = 'test-passphrase-123';

// ─── Helpers ─────────────────────────────────────────────────────────

let syncFolder: string;
let dbA: Database.Database;
let dbB: Database.Database;

function createCrDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.loadExtension(extensionPath);
  db.exec(SCHEMA);
  // Register all tables as CRRs
  for (const table of [
    'transactions', 'planned_templates', 'sheets', 'categories',
    'attachments', 'audit_log', 'activity_notes', 'settings',
    'personnel', 'invoices',
  ]) {
    db.exec(`SELECT crsql_as_crr('${table}')`);
  }
  return db;
}

function getSiteId(db: Database.Database): Buffer {
  return (db.prepare('SELECT crsql_site_id() as site_id').get() as { site_id: Buffer }).site_id;
}

function getMaxDbVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

function finalize(db: Database.Database): void {
  try { db.prepare('SELECT crsql_finalize()').run(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
}

function makeOrchestrator(db: Database.Database, deviceId: string, opts?: Partial<{
  onDataChanged: (tables: string[]) => void;
  onConflictsDetected: (count: number) => void;
  onError: (error: string) => void;
}>): SyncOrchestrator {
  return new SyncOrchestrator({
    db,
    syncFolder,
    passphrase: PASSPHRASE,
    deviceId,
    exportDebounceMs: 0, // No debounce in tests
    versionPollMs: 60_000, // Effectively disabled — we call exportNow() directly
    ...opts,
  });
}

beforeEach(() => {
  syncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-orch-'));
  dbA = createCrDb();
  dbB = createCrDb();
});

afterEach(() => {
  finalize(dbA);
  finalize(dbB);
  fs.rmSync(syncFolder, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('SyncOrchestrator', () => {
  test('1: edit A → exportNow() → .bundle exists', () => {
    dbA.prepare("INSERT INTO transactions (id, amount, description) VALUES ('tx-1', '50', 'Coffee')").run();

    const orch = makeOrchestrator(dbA, 'device-a');
    orch.start();

    const result = orch.exportNow();
    expect(result.bundleId).toBeTruthy();
    expect(result.changesetCount).toBeGreaterThan(0);

    // Verify bundle file exists
    const syncDir = path.join(syncFolder, 'sync');
    const files = fs.readdirSync(syncDir).filter((f) => f.endsWith('.bundle'));
    expect(files.length).toBe(1);
    expect(files[0]).toContain('device-a');

    orch.stop();
  });

  test('2: write bundle → importAll() on B → data in B', () => {
    // Create data on A and export
    dbA.prepare("INSERT INTO transactions (id, amount, description) VALUES ('tx-1', '50', 'Coffee')").run();
    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    orchA.exportNow();
    orchA.stop();

    // Import on B — don't call start() which does initial import;
    // call importAll() directly to verify explicit import returns counts
    const orchB = makeOrchestrator(dbB, 'device-b');
    const result = orchB.importAll();
    expect(result.bundlesProcessed).toBe(1);
    expect(result.changesetsApplied).toBeGreaterThan(0);

    // Verify data in B
    const tx = dbB.prepare("SELECT amount, description FROM transactions WHERE id = 'tx-1'").get() as { amount: string; description: string } | undefined;
    expect(tx).toBeTruthy();
    expect(tx!.amount).toBe('50');
    expect(tx!.description).toBe('Coffee');
  });

  test('3: edit A → export → import B → data matches', () => {
    dbA.prepare("INSERT INTO transactions (id, amount, description, type) VALUES ('tx-1', '100', 'Rent', 'expense')").run();
    dbA.prepare("INSERT INTO categories (id, name, type) VALUES ('cat-1', 'Housing', 'expense')").run();

    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    orchA.exportNow();
    orchA.stop();

    const orchB = makeOrchestrator(dbB, 'device-b');
    orchB.start();
    orchB.importAll();

    const tx = dbB.prepare("SELECT * FROM transactions WHERE id = 'tx-1'").get() as Record<string, unknown> | undefined;
    expect(tx).toBeTruthy();
    expect(tx!.amount).toBe('100');
    expect(tx!.description).toBe('Rent');

    const cat = dbB.prepare("SELECT * FROM categories WHERE id = 'cat-1'").get() as Record<string, unknown> | undefined;
    expect(cat).toBeTruthy();
    expect(cat!.name).toBe('Housing');

    orchB.stop();
  });

  test('4: device-scoped setting → export → NOT in bundle', () => {
    // Insert a device-scoped setting (e.g., theme)
    dbA.prepare("INSERT INTO settings (key, value, scope) VALUES ('theme', 'dark', 'device')").run();

    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    const result = orchA.exportNow();

    // Should have no exportable changesets (theme is device-scoped, not in ORG_KEYS)
    expect(result.bundleId).toBeNull();
    expect(result.changesetCount).toBe(0);

    orchA.stop();
  });

  test('5: org-scoped setting → export → IS in bundle', () => {
    // Insert an org-scoped setting (fy_start_month is in ORG_KEYS)
    dbA.prepare("INSERT INTO settings (key, value, scope) VALUES ('fy_start_month', '4', 'org')").run();

    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    const result = orchA.exportNow();
    expect(result.changesetCount).toBeGreaterThan(0);
    orchA.stop();

    // Import on B — don't call start() to get accurate import counts
    const orchB = makeOrchestrator(dbB, 'device-b');
    const importResult = orchB.importAll();
    expect(importResult.bundlesProcessed).toBe(1);

    const setting = dbB.prepare("SELECT value FROM settings WHERE key = 'fy_start_month'").get() as { value: string } | undefined;
    expect(setting).toBeTruthy();
    expect(setting!.value).toBe('4');
  });

  test('6: garbage .bundle → importAll() → no crash, bundle skipped', () => {
    // Write garbage data as a bundle file
    ensureSyncFolderStructure(syncFolder);
    const garbagePath = path.join(syncFolder, 'sync', 'other-device_0000000001.bundle');
    fs.writeFileSync(garbagePath, 'this is not a valid bundle');

    const orchB = makeOrchestrator(dbB, 'device-b');
    orchB.start();
    const result = orchB.importAll();

    expect(result.bundlesSkipped).toBe(1);
    expect(result.bundlesProcessed).toBe(0);

    orchB.stop();
  });

  test('7: A exports → B imports → B version poll → no re-export (D4)', () => {
    // Create data on A and export
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('tx-1', '50')").run();
    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    orchA.exportNow();
    orchA.stop();

    // Import on B
    const orchB = makeOrchestrator(dbB, 'device-b');
    orchB.start();
    orchB.importAll();

    // B's db_version increased from import. If D4 works, exportNow should be a no-op.
    const result = orchB.exportNow();
    expect(result.bundleId).toBeNull();
    expect(result.changesetCount).toBe(0);

    // Verify only one bundle file exists (from A's export, not B's)
    const files = fs.readdirSync(path.join(syncFolder, 'sync')).filter((f) => f.endsWith('.bundle'));
    expect(files.length).toBe(1);
    expect(files[0]).toContain('device-a');

    orchB.stop();
  });

  test('8: both edit critical field → export A → import B → conflict queued', () => {
    // Both create same tx with different amounts
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('tx-1', '100')").run();
    dbB.prepare("INSERT INTO transactions (id, amount) VALUES ('tx-1', '200')").run();

    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    orchA.exportNow();
    orchA.stop();

    let conflictCount = 0;
    const orchB = makeOrchestrator(dbB, 'device-b', {
      onConflictsDetected: (count) => { conflictCount = count; },
    });
    // Call importAll() directly to get accurate counts
    const result = orchB.importAll();

    expect(result.conflictsQueued).toBeGreaterThan(0);
    expect(conflictCount).toBeGreaterThan(0);

    // Verify conflict is in the queue
    const status = orchB.getStatus();
    expect(status.pendingConflicts).toBeGreaterThan(0);
  });

  test('9: import same bundle twice → second is no-op (dedup)', () => {
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('tx-1', '50')").run();
    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();
    orchA.exportNow();
    orchA.stop();

    // Call importAll() directly (no start() which does initial import)
    const orchB = makeOrchestrator(dbB, 'device-b');

    const result1 = orchB.importAll();
    expect(result1.bundlesProcessed).toBe(1);

    // Import again — should be deduped
    const result2 = orchB.importAll();
    expect(result2.bundlesProcessed).toBe(0);
  });

  test('10: start() → isRunning → stop() → not running', () => {
    const orch = makeOrchestrator(dbA, 'device-a');

    expect(orch.isRunning()).toBe(false);
    expect(orch.getStatus().state).toBe('stopped');

    orch.start();
    expect(orch.isRunning()).toBe(true);
    expect(orch.getStatus().state).toBe('idle');

    orch.stop();
    expect(orch.isRunning()).toBe(false);
    expect(orch.getStatus().state).toBe('stopped');
  });
});
