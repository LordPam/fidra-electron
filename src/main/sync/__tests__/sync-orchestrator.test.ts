import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as yieldToRunner } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';
import { SyncOrchestrator } from '../sync-orchestrator';
import { packBundle } from '../bundle-format';
import { CRR_SCHEMA_VERSION } from '../crr-schema';
import { initializeOrBindSyncFolder, bindExistingSyncFolder, readFolderManifest, getFolderBinding } from '../folder-binding';
import { resolveSyncConflict } from '../conflict-resolution';
import { ConflictQueue } from '../conflict-queue';
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
    category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT, linked_id TEXT,
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
  CREATE TABLE sync_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE personnel (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    auth_uid TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    invited_by TEXT
    , device_id TEXT
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

function createCrDb(filePath = ':memory:'): Database.Database {
  const db = new Database(filePath);
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
  prepareTestBinding(db);
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

/** Explicit trusted fixture onboarding; production obtains this identity from an invitation. */
function prepareTestBinding(db: Database.Database): void {
  if (getFolderBinding(db)) return;
  if (fs.existsSync(path.join(syncFolder, '.fidra-sync'))) {
    const manifest = readFolderManifest(syncFolder, PASSPHRASE);
    db.prepare("INSERT INTO settings (key, value, scope) VALUES ('localSync.groupId', ?, 'org') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(manifest.groupId);
    bindExistingSyncFolder(db, syncFolder, PASSPHRASE);
  } else {
    initializeOrBindSyncFolder(db, syncFolder, PASSPHRASE);
  }
  db.prepare("INSERT INTO sync_meta (key, value) VALUES ('sync.lastExportedVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(getMaxDbVersion(db)));
}

beforeEach(() => {
  syncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-orch-'));
  dbA = createCrDb();
  dbB = createCrDb();
  prepareTestBinding(dbA);
  prepareTestBinding(dbB);
});

afterEach(async () => {
  vi.restoreAllMocks();
  finalize(dbA);
  finalize(dbB);
  fs.rmSync(syncFolder, { recursive: true, force: true });
  // Real key derivation is synchronous. Let Vitest receive its reporting RPC
  // replies between cases instead of starving them for the whole test file.
  await yieldToRunner();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('SyncOrchestrator', () => {
  test('a disagreement on one transfer half holds both incoming halves for joint review', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.transaction(() => {
        dbA.prepare("INSERT INTO transactions (id, amount, linked_id) VALUES ('out', '10', 'in')").run();
        dbA.prepare("INSERT INTO transactions (id, amount, linked_id) VALUES ('in', '10', 'out')").run();
      })();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET status = 'pending' WHERE id = 'out'").run();
      dbB.transaction(() => {
        dbB.prepare("UPDATE transactions SET amount = '30'").run();
        dbB.prepare("UPDATE transactions SET status = 'approved' WHERE id = 'out'").run();
      })();
      b.exportNow(); a.importAll();
      expect(dbA.prepare('SELECT amount FROM transactions ORDER BY id').pluck().all()).toEqual(['10', '10']);
      const conflicts = new ConflictQueue(dbA).getUnresolved();
      expect(conflicts).toHaveLength(2);
      for (const conflict of conflicts) {
        expect(conflict.field_name).toBe('__linked_transfer__');
        expect(resolveSyncConflict(dbA, conflict.id, 'accept-remote', 'Reviewer')).toMatchObject({ success: false });
      }
      expect(new ConflictQueue(dbA).count()).toBe(2);
    } finally { a.stop(); b.stop(); }
  });

  test('a changed local row refreshes a stale deletion comparison before accepting a choice', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount, description) VALUES ('stale', '10', 'Original')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '20' WHERE id = 'stale'").run();
      dbB.prepare("DELETE FROM transactions WHERE id = 'stale'").run();
      b.exportNow(); a.importAll();
      const conflict = new ConflictQueue(dbA).getUnresolved()[0];
      dbA.prepare("UPDATE transactions SET description = 'New local detail' WHERE id = 'stale'").run();
      expect(resolveSyncConflict(dbA, conflict.id, 'accept-remote', 'Reviewer')).toMatchObject({ success: false });
      expect(new ConflictQueue(dbA).count()).toBe(1);
      expect(resolveSyncConflict(dbA, conflict.id, 'keep-local', 'Reviewer')).toMatchObject({ success: true });
      expect(dbA.prepare("SELECT description FROM transactions WHERE id = 'stale'").pluck().get()).toBe('New local detail');
    } finally { a.stop(); b.stop(); }
  });

  test('review cannot delete the last local team administrator', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO personnel (id, name, role) VALUES ('admin', 'Initial', 'admin')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE personnel SET name = 'Updated administrator' WHERE id = 'admin'").run();
      dbB.prepare("DELETE FROM personnel WHERE id = 'admin'").run();
      b.exportNow(); a.importAll();
      const conflict = new ConflictQueue(dbA).getUnresolved()[0];
      expect(resolveSyncConflict(dbA, conflict.id, 'accept-remote', 'Reviewer')).toEqual({ success: false, error: 'The last team administrator cannot be removed or demoted.' });
      expect(dbA.prepare("SELECT COUNT(*) FROM personnel WHERE role = 'admin'").pluck().get()).toBe(1);
      expect(new ConflictQueue(dbA).count()).toBe(1);
    } finally { a.stop(); b.stop(); }
  });

  test.each(['keep-local', 'accept-remote'] as const)('a reviewed %s choice publishes a fresh revision and settles the peer’s old review', (choice) => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('resolve', '10')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '20' WHERE id = 'resolve'").run();
      dbA.prepare("UPDATE transactions SET amount = '30' WHERE id = 'resolve'").run();
      dbB.prepare("UPDATE transactions SET amount = '40' WHERE id = 'resolve'").run();
      a.exportNow(); b.exportNow(); a.importAll(); b.importAll();
      const conflict = new ConflictQueue(dbA).getUnresolved().find((row) => row.field_name === 'amount');
      expect(conflict).toBeDefined();
      if (!conflict) throw new Error('Missing financial conflict');
      expect(resolveSyncConflict(dbA, conflict.id, choice, 'Test reviewer').success).toBe(true);
      expect(a.exportNow().changesetCount).toBeGreaterThan(0);
      expect(b.importAll().conflictsQueued).toBe(0);
      const expected = choice === 'keep-local' ? '30' : '40';
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'resolve'").pluck().get()).toBe(expected);
      expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'resolve'").pluck().get()).toBe(expected);
      expect(new ConflictQueue(dbB).count()).toBe(0);
      expect(resolveSyncConflict(dbA, conflict.id, choice, 'Test reviewer').success).toBe(true);
      expect(dbA.prepare("SELECT COUNT(*) FROM audit_log WHERE action = 'SYNC_CONFLICT_RESOLVED'").pluck().get()).toBe(1);
    } finally { a.stop(); b.stop(); }
  });

  test('a resolution audit failure rolls back the chosen field and review status together', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('atomic-resolution', '10')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '20' WHERE id = 'atomic-resolution'").run();
      dbB.prepare("UPDATE transactions SET amount = '30' WHERE id = 'atomic-resolution'").run();
      a.exportNow(); b.exportNow(); a.importAll();
      const conflict = new ConflictQueue(dbA).getUnresolved()[0];
      dbA.exec(`CREATE TRIGGER reject_resolution_audit BEFORE INSERT ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
      expect(() => resolveSyncConflict(dbA, conflict.id, 'accept-remote', 'Reviewer')).toThrow('audit unavailable');
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'atomic-resolution'").pluck().get()).toBe('20');
      expect(new ConflictQueue(dbA).getById(conflict.id)?.resolved_at).toBeNull();
    } finally { a.stop(); b.stop(); }
  });

  test.each(['keep-local', 'accept-remote'] as const)('reviewed delete/edit %s preserves a complete row or publishes the chosen deletion', (choice) => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount, description) VALUES ('resolve-delete', '10', 'Original row')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '99' WHERE id = 'resolve-delete'").run();
      a.exportNow();
      dbB.prepare("DELETE FROM transactions WHERE id = 'resolve-delete'").run();
      b.exportNow(); a.importAll(); b.importAll();
      const conflict = new ConflictQueue(dbA).getUnresolved()[0];
      expect(resolveSyncConflict(dbA, conflict.id, choice, 'Reviewer').success).toBe(true);
      a.exportNow();
      expect(b.importAll().conflictsQueued).toBe(0);
      for (const db of [dbA, dbB]) {
        const row = db.prepare("SELECT amount, description FROM transactions WHERE id = 'resolve-delete'").get();
        if (choice === 'keep-local') expect(row).toEqual({ amount: '99', description: 'Original row' });
        else expect(row).toBeUndefined();
      }
      expect(new ConflictQueue(dbB).count()).toBe(0);
    } finally { a.stop(); b.stop(); }
  });

  test('partial edits cannot silently recreate a deleted entity during review', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('partial-restore', '10')").run();
      a.exportNow(); b.importAll();
      dbB.prepare("DELETE FROM transactions WHERE id = 'partial-restore'").run();
      dbA.prepare("UPDATE transactions SET amount = '50' WHERE id = 'partial-restore'").run();
      a.exportNow(); b.exportNow(); b.importAll();
      const conflict = new ConflictQueue(dbB).getUnresolved()[0];
      expect(resolveSyncConflict(dbB, conflict.id, 'accept-remote', 'Reviewer')).toMatchObject({ success: false });
      expect(dbB.prepare("SELECT id FROM transactions WHERE id = 'partial-restore'").get()).toBeUndefined();
      expect(new ConflictQueue(dbB).count()).toBeGreaterThan(0);
    } finally { a.stop(); b.stop(); }
  });

  test('sequential cross-device financial edits merge with recorded ancestry', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('sequential', '10')").run();
      a.exportNow(); b.importAll();
      dbB.prepare("UPDATE transactions SET amount = '20' WHERE id = 'sequential'").run();
      b.exportNow();
      expect(a.importAll().conflictsQueued).toBe(0);
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'sequential'").pluck().get()).toBe('20');
      dbA.prepare("UPDATE transactions SET amount = '30' WHERE id = 'sequential'").run();
      a.exportNow();
      expect(b.importAll().conflictsQueued).toBe(0);
      expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'sequential'").pluck().get()).toBe('30');
    } finally { a.stop(); b.stop(); }
  });

  test('concurrent offline financial edits require review on both peers despite unequal versions', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('concurrent', '10')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '20' WHERE id = 'concurrent'").run();
      dbA.prepare("UPDATE transactions SET amount = '30' WHERE id = 'concurrent'").run();
      dbB.prepare("UPDATE transactions SET amount = '40' WHERE id = 'concurrent'").run();
      a.exportNow(); b.exportNow();
      expect(a.importAll().conflictsQueued).toBeGreaterThan(0);
      expect(b.importAll().conflictsQueued).toBeGreaterThan(0);
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'concurrent'").pluck().get()).toBe('30');
      expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'concurrent'").pluck().get()).toBe('40');
    } finally { a.stop(); b.stop(); }
  });

  test('an exported edit is protected from an offline peer’s unseen deletion', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('delete-edit', '10')").run();
      a.exportNow(); b.importAll();
      dbA.prepare("UPDATE transactions SET amount = '99' WHERE id = 'delete-edit'").run();
      a.exportNow();
      dbB.prepare("DELETE FROM transactions WHERE id = 'delete-edit'").run();
      b.exportNow();
      expect(a.importAll().conflictsQueued).toBeGreaterThan(0);
      expect(b.importAll().conflictsQueued).toBeGreaterThan(0);
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'delete-edit'").pluck().get()).toBe('99');
      expect(dbB.prepare("SELECT id FROM transactions WHERE id = 'delete-edit'").get()).toBeUndefined();
    } finally { a.stop(); b.stop(); }
  });

  test('a deletion after observing the complete current row auto-merges', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start(); b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('observed-delete', '10')").run();
      a.exportNow(); b.importAll();
      dbB.prepare("DELETE FROM transactions WHERE id = 'observed-delete'").run();
      b.exportNow();
      expect(a.importAll().conflictsQueued).toBe(0);
      expect(dbA.prepare("SELECT id FROM transactions WHERE id = 'observed-delete'").get()).toBeUndefined();
    } finally { a.stop(); b.stop(); }
  });

  test('separate folder replicas require an actual returned receipt before showing peer delivery', () => {
    dbA.prepare("INSERT INTO personnel (id, name, device_id) VALUES ('sam', 'Sam', 'device-b')").run();
    const peerFolder = path.join(syncFolder, 'peer-replica');
    fs.mkdirSync(peerFolder);
    fs.copyFileSync(path.join(syncFolder, '.fidra-sync'), path.join(peerFolder, '.fidra-sync'));
    bindExistingSyncFolder(dbB, peerFolder, PASSPHRASE);
    const a = makeOrchestrator(dbA, 'device-a');
    const b = new SyncOrchestrator({ db: dbB, syncFolder: peerFolder, passphrase: PASSPHRASE, deviceId: 'device-b', versionPollMs: 60_000 });
    try {
      a.start();
      b.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('delivered', '33')").run();
      a.exportNow();
      expect(a.getStatus().delivery.peers[0].pendingBundles).toBeGreaterThan(0);
      fs.cpSync(path.join(syncFolder, 'sync'), path.join(peerFolder, 'sync'), { recursive: true });
      b.importAll();
      expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'delivered'").pluck().get()).toBe('33');
      a.importAll();
      expect(a.getStatus().delivery.peers[0].acknowledgedBundles).toBe(0);
      fs.cpSync(path.join(peerFolder, 'receipts'), path.join(syncFolder, 'receipts'), { recursive: true });
      a.importAll();
      expect(a.getStatus().delivery.peers[0]).toMatchObject({
        personName: 'Sam', pendingBundles: 0, acknowledgedBundles: a.getStatus().delivery.outboundBundles,
      });
    } finally {
      a.stop();
      b.stop();
    }
  });

  test('missing cloud root is reported without recreating any provider ancestors', () => {
    const missingRoot = path.join(syncFolder, 'provider', 'team');
    const orchestrator = new SyncOrchestrator({ db: dbA, syncFolder: missingRoot, deviceId: 'a', passphrase: PASSPHRASE });
    orchestrator.start();
    expect(orchestrator.isRunning()).toBe(false);
    expect(orchestrator.getStatus().state).toBe('error');
    expect(fs.existsSync(path.join(syncFolder, 'provider'))).toBe(false);
  });

  test('import during export debounce does not strand an unsent local transaction', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      a.start();
      b.start();
      dbB.prepare("INSERT INTO transactions (id, amount) VALUES ('local-unsent', '20')").run();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('remote', '30')").run();
      a.exportNow();
      b.importAll();
      expect(dbB.prepare('SELECT COUNT(*) FROM sync_outbound_bundles').pluck().get()).toBe(1);
      b.exportNow();
      a.importAll();
      expect(dbA.prepare("SELECT amount FROM transactions WHERE id = 'local-unsent'").pluck().get()).toBe('20');
    } finally {
      a.stop();
      b.stop();
    }
  });

  test('failed folder write retains exact encrypted payload and sequence across restart', () => {
    finalize(dbA);
    const localFile = path.join(syncFolder, 'local-test.fdra');
    dbA = createCrDb(localFile);
    const a = makeOrchestrator(dbA, 'device-a');
    a.start();
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('durable', '42')").run();
    const write = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('OneDrive unavailable'); });
    expect(a.exportNow().bundleId).toBeNull();
    const pending = dbA.prepare('SELECT sequence_number, payload FROM sync_outbound_bundles').get() as { sequence_number: number; payload: Buffer };
    expect(pending.sequence_number).toBe(1);
    expect(pending.payload.includes(Buffer.from('durable'))).toBe(false);
    // Even a successful inbound scan cannot clear an outstanding delivery error.
    a.importAll();
    expect(a.getStatus().state).toBe('error');
    a.stop();
    write.mockRestore();
    finalize(dbA);
    dbA = new Database(localFile);
    dbA.loadExtension(extensionPath);

    const restarted = makeOrchestrator(dbA, 'device-a');
    try {
      restarted.start();
      expect(fs.readFileSync(path.join(syncFolder, 'sync', 'device-a_0000000001.bundle'))).toEqual(pending.payload);
      expect(dbA.prepare('SELECT COUNT(*) FROM sync_outbound_bundles').pluck().get()).toBe(1);
      expect(restarted.getStatus().lastError).toBeNull();
    } finally {
      restarted.stop();
    }
  });

  test('outbound ciphertext and export checkpoint roll back together', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    a.start();
    try {
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('rollback', '12')").run();
      dbA.exec(`CREATE TRIGGER reject_sequence BEFORE UPDATE ON sync_meta
        WHEN NEW.key = 'sync.sequenceNumber' AND NEW.value != '0'
        BEGIN SELECT RAISE(ABORT, 'simulated checkpoint failure'); END`);
      expect(a.exportNow().bundleId).toBeNull();
      expect(dbA.prepare('SELECT COUNT(*) FROM sync_outbound_bundles').pluck().get()).toBe(0);
      dbA.exec('DROP TRIGGER reject_sequence');
      expect(a.exportNow().bundleId).toBe('device-a_1');
    } finally {
      a.stop();
    }
  });

  test('receipt failure rolls back imported data and a later retry succeeds', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('atomic-import', '15')").run();
    a.start();
    a.stop();
    const b = makeOrchestrator(dbB, 'device-b');
    dbB.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON applied_bundles
      BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END`);
    expect(b.importAll().bundlesSkipped).toBe(1);
    expect(dbB.prepare("SELECT id FROM transactions WHERE id = 'atomic-import'").get()).toBeUndefined();
    dbB.exec('DROP TRIGGER reject_receipt');
    expect(b.importAll().bundlesProcessed).toBe(1);
    expect(b.getStatus().lastError).toBeNull();
  });

  test('a corrupt earlier bundle is retried after a newer sequence was applied', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    a.start();
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('late', '10')").run();
    a.exportNow();
    const firstPath = path.join(syncFolder, 'sync', 'device-a_0000000001.bundle');
    const original = fs.readFileSync(firstPath);
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('early', '20')").run();
    a.exportNow();
    a.stop();
    fs.writeFileSync(firstPath, 'partial download');
    const b = makeOrchestrator(dbB, 'device-b');
    expect(b.importAll()).toMatchObject({ bundlesProcessed: 1, bundlesSkipped: 1 });
    expect(b.getStatus().state).toBe('error');
    fs.writeFileSync(firstPath, original);
    expect(b.importAll().bundlesProcessed).toBe(1);
    expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'late'").pluck().get()).toBe('10');
    expect(b.getStatus().lastError).toBeNull();
  });

  test('a removed or replaced root pauses writes while retaining the outbound bundle', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    a.start();
    // Moving the contents would retain the directory identity; replace the actual root instead.
    const movedRoot = `${syncFolder}-moved`;
    try {
      fs.renameSync(syncFolder, movedRoot);
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('offline', '17')").run();
      expect(a.exportNow().bundleId).toBeNull();
      expect(fs.existsSync(syncFolder)).toBe(false);
      fs.mkdirSync(syncFolder);
      expect(a.exportNow().bundleId).toBeNull();
      expect(fs.existsSync(path.join(syncFolder, 'sync'))).toBe(false);
      expect(dbA.prepare('SELECT COUNT(*) FROM sync_outbound_bundles').pluck().get()).toBe(1);
    } finally {
      a.stop();
      fs.rmSync(syncFolder, { recursive: true, force: true });
      fs.renameSync(movedRoot, syncFolder);
    }
  });

  test('history cleanup is refused and leaves original bundles intact', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('history', '8')").run();
    a.start();
    try {
      expect(a.createSnapshot().coveredDeviceSeqs).toEqual({});
      expect(() => a.compact()).toThrow('History cleanup is paused');
      expect(fs.existsSync(path.join(syncFolder, 'sync', 'device-a_0000000001.bundle'))).toBe(true);
    } finally {
      a.stop();
    }
  });

  test('two windows reserve distinct sequences from the same database', () => {
    finalize(dbA);
    finalize(dbB);
    const localFile = path.join(syncFolder, 'two-windows.fdra');
    dbA = createCrDb(localFile);
    dbB = new Database(localFile);
    dbB.loadExtension(extensionPath);
    const first = makeOrchestrator(dbA, 'shared-device');
    const second = makeOrchestrator(dbB, 'shared-device');
    try {
      first.start();
      second.start();
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('window-a', '10')").run();
      expect(first.exportNow().bundleId).toBe('shared-device_1');
      dbB.prepare("INSERT INTO transactions (id, amount) VALUES ('window-b', '20')").run();
      expect(second.exportNow().bundleId).toBe('shared-device_2');
      expect(first.exportNow().bundleId).toBeNull();
      expect(dbA.prepare('SELECT COUNT(*) FROM sync_outbound_bundles').pluck().get()).toBe(2);
    } finally {
      first.stop();
      second.stop();
    }
  });

  test('existing ledgers never auto-apply a snapshot over local financial values', () => {
    const a = makeOrchestrator(dbA, 'device-a');
    const b = makeOrchestrator(dbB, 'device-b');
    try {
      dbA.prepare("INSERT INTO transactions (id, amount) VALUES ('shared', '200')").run();
      a.start();
      a.createSnapshot();
      a.stop();
      fs.unlinkSync(path.join(syncFolder, 'sync', 'device-a_0000000001.bundle'));
      dbB.prepare("INSERT INTO transactions (id, amount) VALUES ('shared', '100')").run();
      const before = getMaxDbVersion(dbB);
      b.start();
      expect(dbB.prepare("SELECT amount FROM transactions WHERE id = 'shared'").pluck().get()).toBe('100');
      expect(getMaxDbVersion(dbB)).toBe(before);
      expect(dbB.prepare("SELECT COUNT(*) FROM applied_bundles WHERE bundle_id LIKE 'snapshot:%'").pluck().get()).toBe(0);
    } finally {
      a.stop();
      b.stop();
    }
  });

  test('authenticated bundles with mismatched filename identities are rejected', () => {
    const packed = packBundle({
      deviceId: 'real-device', siteId: getSiteId(dbA), sequenceNumber: 1,
      schemaVersion: CRR_SCHEMA_VERSION, changesets: [], passphrase: PASSPHRASE,
      groupId: readFolderManifest(syncFolder, PASSPHRASE).groupId,
    });
    writeBundleAtomically(syncFolder, 'different-device', 1, packed);
    const b = makeOrchestrator(dbB, 'device-b');
    expect(b.importAll()).toMatchObject({ bundlesProcessed: 0, bundlesSkipped: 1 });
    expect(dbB.prepare('SELECT COUNT(*) FROM applied_bundles').pluck().get()).toBe(0);
  });

  test('1: edit A → exportNow() → .bundle exists', () => {
    const orch = makeOrchestrator(dbA, 'device-a');
    orch.start();

    // Insert after start() — start() itself flushes any pre-existing changes
    dbA.prepare("INSERT INTO transactions (id, amount, description) VALUES ('tx-1', '50', 'Coffee')").run();

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
    const orchA = makeOrchestrator(dbA, 'device-a');
    orchA.start();

    // Insert an org-scoped setting (fy_start_month is in ORG_KEYS) after
    // start() — start() itself flushes any pre-existing changes
    dbA.prepare("INSERT INTO settings (key, value, scope) VALUES ('fy_start_month', '4', 'org')").run();

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

    // Don't call start() — its own import scan would consume the bundle first
    const orchB = makeOrchestrator(dbB, 'device-b');
    const result = orchB.importAll();

    expect(result.bundlesSkipped).toBe(1);
    expect(result.bundlesProcessed).toBe(0);
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
    // The lower site owns review in the existing merge protocol. Choose that
    // recipient explicitly rather than relying on randomly generated IDs.
    const aSite = getSiteId(dbA);
    const bSite = getSiteId(dbB);
    if (Buffer.compare(bSite, aSite) >= 0) [dbA, dbB] = [dbB, dbA];
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
