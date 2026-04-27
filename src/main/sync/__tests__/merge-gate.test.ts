import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';
import type { CrChangesetRow } from '../bundle-format';
import { classifyChangesets, applyMergeResult, CRSQL_DELETE_SENTINEL } from '../merge-gate';
import { ConflictQueue } from '../conflict-queue';

// ─── Test helpers ───────────────────────────────────────────────────

const CREATE_TRANSACTIONS_SQL = `
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'EXPENSE',
    status TEXT NOT NULL DEFAULT 'PENDING',
    sheet TEXT NOT NULL DEFAULT 'Main',
    category TEXT,
    party TEXT,
    reference TEXT,
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_CATEGORIES_SQL = `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'EXPENSE',
    color TEXT
  )
`;

let localDb: Database.Database;
let remoteDb: Database.Database;
let localSiteId: Buffer;
let remoteSiteId: Buffer;

function createCrDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.loadExtension(extensionPath);
  return db;
}

function getSiteId(db: Database.Database): Buffer {
  return (db.prepare('SELECT crsql_site_id() as site_id').get() as { site_id: Buffer }).site_id;
}

function setupTables(db: Database.Database): void {
  db.exec(CREATE_TRANSACTIONS_SQL);
  db.exec(`SELECT crsql_as_crr('transactions')`);
  db.exec(CREATE_CATEGORIES_SQL);
  db.exec(`SELECT crsql_as_crr('categories')`);
}

/** Export changesets from a db since a given version, excluding a site. */
function exportChanges(
  db: Database.Database,
  sinceVersion: number,
  excludeSiteId?: Buffer,
): CrChangesetRow[] {
  const query = excludeSiteId
    ? db.prepare(
        `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
         FROM crsql_changes WHERE db_version > ? AND site_id IS NOT ?`,
      )
    : db.prepare(
        `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
         FROM crsql_changes WHERE db_version > ?`,
      );

  const args: unknown[] = [sinceVersion];
  if (excludeSiteId) args.push(excludeSiteId);
  return query.all(...args) as CrChangesetRow[];
}

function finalize(db: Database.Database): void {
  try { db.prepare('SELECT crsql_finalize()').run(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
}

beforeEach(() => {
  localDb = createCrDb();
  remoteDb = createCrDb();
  setupTables(localDb);
  setupTables(remoteDb);
  localSiteId = getSiteId(localDb);
  remoteSiteId = getSiteId(remoteDb);
});

afterEach(() => {
  finalize(localDb);
  finalize(remoteDb);
});

// ─── Auto-merge cases ───────────────────────────────────────────────

describe('classifyChangesets — auto-merge', () => {
  test('empty changeset → empty result', () => {
    const result = classifyChangesets(localDb, []);
    expect(result.autoMerge).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  test('non-critical field change → auto-merge', () => {
    // Remote changes 'description' — not a critical field
    remoteDb.prepare(
      `INSERT INTO transactions (id, description) VALUES ('tx-1', 'Coffee')`,
    ).run();

    const changes = exportChanges(remoteDb, 0);
    // Filter to just the description change
    const descChange = changes.filter((c) => c.cid === 'description');
    expect(descChange.length).toBeGreaterThan(0);

    const result = classifyChangesets(localDb, descChange);
    expect(result.autoMerge).toEqual(descChange);
    expect(result.conflicts).toHaveLength(0);
  });

  test('critical field with no local change → auto-merge', () => {
    // Remote sets amount on a tx that local has never seen
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-new', 42.50)`,
    ).run();

    const changes = exportChanges(remoteDb, 0);
    const amountChange = changes.filter((c) => c.cid === 'amount');

    const result = classifyChangesets(localDb, amountChange);
    expect(result.autoMerge).toEqual(amountChange);
    expect(result.conflicts).toHaveLength(0);
  });

  test('new row creation → all fields auto-merge', () => {
    remoteDb.prepare(
      `INSERT INTO transactions (id, date, amount, type, status, sheet)
       VALUES ('tx-new', '2026-01-01', 100, 'INCOME', 'APPROVED', 'Main')`,
    ).run();

    const changes = exportChanges(remoteDb, 0);
    const result = classifyChangesets(localDb, changes);
    expect(result.autoMerge).toEqual(changes);
    expect(result.conflicts).toHaveLength(0);
  });

  test('same value convergence → auto-merge', () => {
    // Both sides insert the same tx with the same amount
    localDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);
    const amountChange = remoteChanges.filter((c) => c.cid === 'amount');

    const result = classifyChangesets(localDb, amountChange);
    // Same value → auto-merge even though both sides changed it
    expect(result.autoMerge).toEqual(amountChange);
    expect(result.conflicts).toHaveLength(0);
  });

  test('unknown/untracked table → auto-merge', () => {
    // categories is not in critical-fields registry
    remoteDb.prepare(
      `INSERT INTO categories (id, name, type) VALUES ('cat-1', 'Food', 'EXPENSE')`,
    ).run();

    const changes = exportChanges(remoteDb, 0);
    const result = classifyChangesets(localDb, changes);
    expect(result.autoMerge).toEqual(changes);
    expect(result.conflicts).toHaveLength(0);
  });

  test('delete with no local edits → auto-merge', () => {
    // Both sides create the same tx
    localDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    // Sync local → remote so they converge
    const localChanges = exportChanges(localDb, 0);
    for (const c of localChanges) {
      remoteDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // Remote deletes (local hasn't edited since sync)
    remoteDb.prepare(`DELETE FROM transactions WHERE id = 'tx-1'`).run();
    const deleteChanges = exportChanges(remoteDb, 1);
    const delMarker = deleteChanges.filter((c) => c.cid === CRSQL_DELETE_SENTINEL);

    // Local has no edits since the initial insert (which came from local site),
    // so hasLocalEdits checks for edits from a DIFFERENT site than remote.
    // The local edits are from localSiteId, not remoteSiteId, so they count.
    // But this is the initial creation — let's test with a clean scenario.
    // Create a fresh local db where the tx was synced FROM remote (not locally created)
    const freshLocal = createCrDb();
    setupTables(freshLocal);

    // Import the remote's creation changes into freshLocal
    const remoteCreation = exportChanges(remoteDb, 0);
    // Only import the non-delete changes (the original creation)
    const creationOnly = remoteCreation.filter((c) => c.cid !== CRSQL_DELETE_SENTINEL);
    for (const c of creationOnly) {
      freshLocal.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // Now classify the delete — freshLocal has no local (non-remote) edits
    const result = classifyChangesets(freshLocal, delMarker);
    expect(result.autoMerge).toEqual(delMarker);
    expect(result.conflicts).toHaveLength(0);

    finalize(freshLocal);
  });
});

// ─── Sequential edit (version ordering) ─────────────────────────────

describe('classifyChangesets — sequential edits (Rule 7a)', () => {
  test('critical field edit after importing peer change → auto-merge (not conflict)', () => {
    // Scenario: A edits amount, B imports A's change, B edits amount again.
    // When A imports B's change, it should auto-merge because B's col_version
    // is higher (B saw A's value before editing).

    // A creates and edits a transaction
    localDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    // Sync A's changes to B
    const aChanges = exportChanges(localDb, 0);
    for (const c of aChanges) {
      remoteDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // B now has A's transaction. B edits the amount (sequential, not concurrent).
    remoteDb.prepare(
      `UPDATE transactions SET amount = 200 WHERE id = 'tx-1'`,
    ).run();

    // Export B's changes (should have higher col_version for amount)
    const bChanges = exportChanges(remoteDb, 0, localSiteId);
    const amountChange = bChanges.filter((c) => c.cid === 'amount');
    expect(amountChange.length).toBeGreaterThan(0);

    // A imports B's change — should auto-merge, NOT conflict
    const result = classifyChangesets(localDb, amountChange);
    expect(result.conflicts).toHaveLength(0);
    expect(result.autoMerge).toEqual(amountChange);
  });

  test('back-and-forth sequential edits → auto-merge each time', () => {
    // A creates tx
    localDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    // Sync A → B
    let changes = exportChanges(localDb, 0);
    for (const c of changes) {
      remoteDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // B edits amount
    remoteDb.prepare(`UPDATE transactions SET amount = 200 WHERE id = 'tx-1'`).run();

    // Sync B → A
    changes = exportChanges(remoteDb, 0, localSiteId);
    const bAmountChanges = changes.filter((c) => c.cid === 'amount');

    // A classifies B's change — should auto-merge
    let result = classifyChangesets(localDb, bAmountChanges);
    expect(result.conflicts).toHaveLength(0);

    // Apply B's changes to A
    for (const c of changes) {
      localDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // A edits amount again
    localDb.prepare(`UPDATE transactions SET amount = 300 WHERE id = 'tx-1'`).run();

    // Sync A → B
    changes = exportChanges(localDb, 0, remoteSiteId);
    const aAmountChanges = changes.filter((c) => c.cid === 'amount');

    // B classifies A's change — should auto-merge
    result = classifyChangesets(remoteDb, aAmountChanges);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── Conflict cases ─────────────────────────────────────────────────

describe('classifyChangesets — conflicts', () => {
  test('critical field with different values → conflict', () => {
    // Both sides create same tx with different amounts
    localDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 200)`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);
    const amountChange = remoteChanges.filter((c) => c.cid === 'amount');

    const result = classifyChangesets(localDb, amountChange);
    expect(result.autoMerge).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);

    const conflict = result.conflicts[0];
    expect(conflict.entityType).toBe('transactions');
    expect(conflict.entityId).toContain('tx-1');
    expect(conflict.fieldName).toBe('amount');
    expect(conflict.localValue).toBe(100);
    expect(conflict.remoteValue).toBe(200);
    expect(conflict.localSiteId).toBe(localSiteId.toString('hex'));
    expect(conflict.remoteSiteId).toBe(remoteSiteId.toString('hex'));
  });

  test('multiple critical fields on same entity — mixed results', () => {
    // Both sides create same tx with some fields same, some different
    localDb.prepare(
      `INSERT INTO transactions (id, amount, date, type, description)
       VALUES ('tx-1', 100, '2026-01-01', 'EXPENSE', 'Coffee')`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount, date, type, description)
       VALUES ('tx-1', 200, '2026-01-01', 'INCOME', 'Tea')`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);

    const result = classifyChangesets(localDb, remoteChanges);

    // amount: 100 vs 200 → conflict
    // date: same '2026-01-01' → auto-merge
    // type: EXPENSE vs INCOME → conflict
    // description: Coffee vs Tea → auto-merge (not critical)
    const conflictFields = result.conflicts.map((c) => c.fieldName).sort();
    expect(conflictFields).toEqual(['amount', 'type']);

    // Non-critical fields + same-value critical fields → auto-merge
    const autoMergeFields = result.autoMerge.map((c) => c.cid).sort();
    expect(autoMergeFields).toContain('date');
    expect(autoMergeFields).toContain('description');
  });

  test('delete-vs-edit conflict', () => {
    // Create tx on REMOTE (local creation is required for cr-sqlite
    // to produce __crsql_del changesets on delete)
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    // Sync creation to local
    const creation = exportChanges(remoteDb, 0);
    for (const c of creation) {
      localDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // Local edits the tx (creates a local change from localSiteId)
    localDb.prepare(
      `UPDATE transactions SET amount = 150 WHERE id = 'tx-1'`,
    ).run();

    // Get remote version before delete
    const remoteVersionBeforeDelete = (
      remoteDb.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;

    // Remote deletes the tx
    remoteDb.prepare(`DELETE FROM transactions WHERE id = 'tx-1'`).run();

    // Export delete changes from remote
    const deleteChanges = exportChanges(remoteDb, remoteVersionBeforeDelete);
    const delMarker = deleteChanges.filter((c) => c.cid === CRSQL_DELETE_SENTINEL);
    expect(delMarker.length).toBeGreaterThan(0);

    // lastExportedVersion = 0 means our local edit hasn't been exported yet,
    // so the deleting peer couldn't have seen it → true concurrent conflict
    const result = classifyChangesets(localDb, delMarker, localSiteId, 0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fieldName).toBe(CRSQL_DELETE_SENTINEL);
    expect(result.conflicts[0].remoteValue).toBe('DELETE');
    expect(result.conflicts[0].remoteSiteId).toBe(remoteSiteId.toString('hex'));
  });

  test('delete auto-merges when local edits were already exported', () => {
    // Create tx on REMOTE
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount) VALUES ('tx-1', 100)`,
    ).run();

    // Sync creation to local
    const creation = exportChanges(remoteDb, 0);
    for (const c of creation) {
      localDb.prepare(
        `INSERT INTO crsql_changes ("table","pk","cid","val","col_version","db_version","site_id","cl","seq")
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
    }

    // Local edits the tx
    localDb.prepare(
      `UPDATE transactions SET amount = 150 WHERE id = 'tx-1'`,
    ).run();

    // Capture the db_version AFTER the local edit — pretend we exported it
    const localDbVersion = (
      localDb.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;

    // Remote deletes the tx
    const remoteVersionBeforeDelete = (
      remoteDb.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;
    remoteDb.prepare(`DELETE FROM transactions WHERE id = 'tx-1'`).run();

    const deleteChanges = exportChanges(remoteDb, remoteVersionBeforeDelete);
    const delMarker = deleteChanges.filter((c) => c.cid === CRSQL_DELETE_SENTINEL);

    // lastExportedVersion = localDbVersion means our edit WAS exported,
    // so the deleting peer should have seen it → auto-merge (no conflict)
    const result = classifyChangesets(localDb, delMarker, localSiteId, localDbVersion);
    expect(result.conflicts).toHaveLength(0);
    expect(result.autoMerge.length).toBeGreaterThan(0);
  });

  test('edit-vs-edit on status field', () => {
    localDb.prepare(
      `INSERT INTO transactions (id, status) VALUES ('tx-1', 'APPROVED')`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, status) VALUES ('tx-1', 'REJECTED')`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);
    const statusChange = remoteChanges.filter((c) => c.cid === 'status');

    const result = classifyChangesets(localDb, statusChange);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fieldName).toBe('status');
    expect(result.conflicts[0].localValue).toBe('APPROVED');
    expect(result.conflicts[0].remoteValue).toBe('REJECTED');
  });

  test('sheet rename conflict', () => {
    // Create a sheet table for this test
    localDb.exec(`CREATE TABLE sheets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      is_virtual INTEGER NOT NULL DEFAULT 0,
      is_planned INTEGER NOT NULL DEFAULT 0
    )`);
    localDb.exec(`SELECT crsql_as_crr('sheets')`);
    remoteDb.exec(`CREATE TABLE sheets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      is_virtual INTEGER NOT NULL DEFAULT 0,
      is_planned INTEGER NOT NULL DEFAULT 0
    )`);
    remoteDb.exec(`SELECT crsql_as_crr('sheets')`);

    localDb.prepare(
      `INSERT INTO sheets (id, name) VALUES ('s-1', 'Alpha')`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO sheets (id, name) VALUES ('s-1', 'Beta')`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);
    const nameChange = remoteChanges.filter((c) => c.cid === 'name');

    const result = classifyChangesets(localDb, nameChange);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fieldName).toBe('name');
    expect(result.conflicts[0].localValue).toBe('Alpha');
    expect(result.conflicts[0].remoteValue).toBe('Beta');
  });
});

// ─── applyMergeResult integration ───────────────────────────────────

describe('applyMergeResult', () => {
  test('applies auto-merge rows and enqueues conflicts', () => {
    // Set up a scenario with mixed auto-merge and conflicts
    localDb.prepare(
      `INSERT INTO transactions (id, amount, description)
       VALUES ('tx-1', 100, 'Local desc')`,
    ).run();
    remoteDb.prepare(
      `INSERT INTO transactions (id, amount, description)
       VALUES ('tx-1', 200, 'Remote desc')`,
    ).run();

    const remoteChanges = exportChanges(remoteDb, 0);
    const result = classifyChangesets(localDb, remoteChanges);

    // Create a conflict queue on a separate in-memory db (like production —
    // conflict queue is in the main sqlite, not the cr-sqlite db)
    const queueDb = new Database(':memory:');
    const queue = new ConflictQueue(queueDb);

    const dbVersionBefore = (
      localDb.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;

    applyMergeResult(localDb, result, queue, 'test-bundle-1');

    // Verify auto-merge rows were applied (db_version should increase)
    const dbVersionAfter = (
      localDb.prepare('SELECT MAX(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;
    expect(dbVersionAfter).toBeGreaterThan(dbVersionBefore);

    // Verify conflicts were enqueued
    expect(queue.count()).toBeGreaterThan(0);
    const conflicts = queue.getUnresolved();
    // amount should be in conflicts
    const amountConflict = conflicts.find((c) => c.field_name === 'amount');
    expect(amountConflict).toBeTruthy();
    expect(amountConflict!.local_value).toBe('100');
    expect(amountConflict!.remote_value).toBe('200');
    expect(amountConflict!.bundle_id).toBe('test-bundle-1');

    queueDb.close();
  });

  test('handles empty result (no changes)', () => {
    const queueDb = new Database(':memory:');
    const queue = new ConflictQueue(queueDb);

    // Should not throw
    applyMergeResult(
      localDb,
      { autoMerge: [], conflicts: [] },
      queue,
      'empty-bundle',
    );

    expect(queue.count()).toBe(0);
    queueDb.close();
  });
});
