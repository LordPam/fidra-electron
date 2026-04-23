/**
 * Phase 0: cr-sqlite spike — Go/No-Go gate for Local Sync.
 *
 * Validates that @vlcn.io/crsqlite works with better-sqlite3 in our stack:
 * extension loading, CRR migration, changeset export/import, conflict
 * resolution, delete propagation, and performance.
 *
 * This is a throwaway spike — none of this code ships.
 */
import { describe, test, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';

// Simplified transaction schema matching our domain model
// cr-sqlite requires all NOT NULL columns to have DEFAULT values
// (for forwards/backwards compatibility in CRDT merges).
// This is a key schema constraint to document.
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

const openDbs: Database.Database[] = [];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.loadExtension(extensionPath);
  openDbs.push(db);
  return db;
}

function setupCrrTable(db: Database.Database): void {
  db.exec(CREATE_TRANSACTIONS_SQL);
  db.exec(`SELECT crsql_as_crr('transactions')`);
}

/** Export changesets from db since the given version, optionally excluding a site. */
function exportChanges(
  db: Database.Database,
  sinceVersion: number,
  excludeSiteId?: Uint8Array,
): unknown[] {
  if (excludeSiteId) {
    return db
      .prepare(
        `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
         FROM crsql_changes WHERE db_version > ? AND site_id IS NOT ?`,
      )
      .all(sinceVersion, excludeSiteId);
  }
  return db
    .prepare(
      `SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
       FROM crsql_changes WHERE db_version > ?`,
    )
    .all(sinceVersion);
}

/** Import changesets into db. */
function importChanges(db: Database.Database, changes: unknown[]): void {
  const stmt = db.prepare(
    `INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      stmt.run(
        row.table,
        row.pk,
        row.cid,
        row.val,
        row.col_version,
        row.db_version,
        row.site_id,
        row.cl,
        row.seq,
      );
    }
  });
  tx(changes as Record<string, unknown>[]);
}

function getSiteId(db: Database.Database): Buffer {
  const row = db.prepare('SELECT crsql_site_id() as site_id').get() as {
    site_id: Buffer;
  };
  return row.site_id;
}

afterEach(() => {
  for (const db of openDbs) {
    try {
      db.prepare('SELECT crsql_finalize()').run();
    } catch {
      // ignore if already closed
    }
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  openDbs.length = 0;
});

describe('cr-sqlite spike', () => {
  test('extension loads and crsql_as_crr works', () => {
    const db = createDb();
    db.exec(CREATE_TRANSACTIONS_SQL);

    // Should not throw
    db.exec(`SELECT crsql_as_crr('transactions')`);

    // Verify the table still exists and is queryable
    const info = db.prepare(`PRAGMA table_info(transactions)`).all();
    expect(info.length).toBeGreaterThan(0);
  });

  test('normal CRUD still works on CRR tables', () => {
    const db = createDb();
    setupCrrTable(db);

    // INSERT
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('tx-1', '2026-01-15', 'Club dues', 50.0, 'INCOME', 'APPROVED', 'Main');

    // SELECT
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-1') as Record<
      string,
      unknown
    >;
    expect(row).toBeTruthy();
    expect(row.description).toBe('Club dues');
    expect(row.amount).toBe(50.0);

    // UPDATE
    db.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run(75.0, 'tx-1');
    const updated = db.prepare('SELECT amount FROM transactions WHERE id = ?').get('tx-1') as {
      amount: number;
    };
    expect(updated.amount).toBe(75.0);

    // DELETE
    db.prepare('DELETE FROM transactions WHERE id = ?').run('tx-1');
    const deleted = db.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-1');
    expect(deleted).toBeUndefined();
  });

  test('changeset export captures changes', () => {
    const db = createDb();
    setupCrrTable(db);

    db.prepare(
      `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('tx-1', '2026-01-15', 'Club dues', 50.0, 'INCOME', 'APPROVED', 'Main');

    const changes = exportChanges(db, 0);
    expect(changes.length).toBeGreaterThan(0);

    // Each change should reference the transactions table
    for (const change of changes as Record<string, unknown>[]) {
      expect(change.table).toBe('transactions');
    }
  });

  test('changeset import merges into second database', () => {
    const dbA = createDb();
    const dbB = createDb();
    setupCrrTable(dbA);
    setupCrrTable(dbB);

    // Insert on DB-A
    dbA
      .prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('tx-1', '2026-01-15', 'Club dues', 50.0, 'INCOME', 'APPROVED', 'Main');

    // Export from A, import into B
    const changes = exportChanges(dbA, 0);
    importChanges(dbB, changes);

    // Verify B has the row
    const row = dbB.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-1') as Record<
      string,
      unknown
    >;
    expect(row).toBeTruthy();
    expect(row.description).toBe('Club dues');
    expect(row.amount).toBe(50.0);
  });

  test('bidirectional sync with independent edits', () => {
    const dbA = createDb();
    const dbB = createDb();
    setupCrrTable(dbA);
    setupCrrTable(dbB);

    const siteA = getSiteId(dbA);
    const siteB = getSiteId(dbB);

    // Independent inserts
    dbA
      .prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('tx-1', '2026-01-15', 'From A', 10.0, 'INCOME', 'APPROVED', 'Main');

    dbB
      .prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('tx-2', '2026-01-16', 'From B', 20.0, 'EXPENSE', 'PENDING', 'Main');

    // Exchange changesets (exclude own site to avoid self-import)
    const changesFromA = exportChanges(dbA, 0, siteA);
    const changesFromB = exportChanges(dbB, 0, siteB);

    // A gets B's changes, but we need to import all from the other
    // Actually, export without excluding, then import into the other
    const allFromA = exportChanges(dbA, 0);
    const allFromB = exportChanges(dbB, 0);

    importChanges(dbB, allFromA);
    importChanges(dbA, allFromB);

    // Both should have both rows
    const aRows = dbA.prepare('SELECT id FROM transactions ORDER BY id').all() as {
      id: string;
    }[];
    const bRows = dbB.prepare('SELECT id FROM transactions ORDER BY id').all() as {
      id: string;
    }[];

    expect(aRows.map((r) => r.id)).toEqual(['tx-1', 'tx-2']);
    expect(bRows.map((r) => r.id)).toEqual(['tx-1', 'tx-2']);
  });

  test('same-field conflict resolves deterministically (LWW)', () => {
    const dbA = createDb();
    const dbB = createDb();
    setupCrrTable(dbA);
    setupCrrTable(dbB);

    // Insert on A and sync to B (establish shared baseline)
    dbA
      .prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('tx-1', '2026-01-15', 'Shared', 50.0, 'INCOME', 'APPROVED', 'Main');

    const initial = exportChanges(dbA, 0);
    importChanges(dbB, initial);

    // Record db_version on both after sync
    const versionA = (
      dbA.prepare('SELECT max(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;
    const versionB = (
      dbB.prepare('SELECT max(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;

    // Concurrent conflicting edits
    dbA.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run(100.0, 'tx-1');
    dbB.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run(200.0, 'tx-1');

    // Exchange
    const changesA = exportChanges(dbA, versionA);
    const changesB = exportChanges(dbB, versionB);
    importChanges(dbB, changesA);
    importChanges(dbA, changesB);

    // Both should converge to the same value (LWW)
    const amountA = (
      dbA.prepare('SELECT amount FROM transactions WHERE id = ?').get('tx-1') as {
        amount: number;
      }
    ).amount;
    const amountB = (
      dbB.prepare('SELECT amount FROM transactions WHERE id = ?').get('tx-1') as {
        amount: number;
      }
    ).amount;

    expect(amountA).toBe(amountB);
    // The winner should be one of the two values
    expect([100.0, 200.0]).toContain(amountA);
  });

  test('delete propagates via changeset', () => {
    const dbA = createDb();
    const dbB = createDb();
    setupCrrTable(dbA);
    setupCrrTable(dbB);

    // Insert on A, sync to B
    dbA
      .prepare(
        `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('tx-1', '2026-01-15', 'To delete', 50.0, 'INCOME', 'APPROVED', 'Main');

    const initial = exportChanges(dbA, 0);
    importChanges(dbB, initial);

    // Confirm B has the row
    expect(dbB.prepare('SELECT id FROM transactions WHERE id = ?').get('tx-1')).toBeTruthy();

    const versionA = (
      dbA.prepare('SELECT max(db_version) as v FROM crsql_changes').get() as { v: number }
    ).v;

    // Delete on A
    dbA.prepare('DELETE FROM transactions WHERE id = ?').run('tx-1');

    // Export delete changeset and import into B
    const deleteChanges = exportChanges(dbA, versionA);
    expect(deleteChanges.length).toBeGreaterThan(0);

    importChanges(dbB, deleteChanges);

    // Row should be gone from B
    const row = dbB.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-1');
    expect(row).toBeUndefined();
  });

  test('changeset can be filtered by db_version and site_id', () => {
    const db = createDb();
    setupCrrTable(db);

    const siteId = getSiteId(db);

    db.prepare(
      `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('tx-1', '2026-01-15', 'Test', 50.0, 'INCOME', 'APPROVED', 'Main');

    // Filter: own changes since version 0
    const ownChanges = db
      .prepare(
        `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id IS ?`,
      )
      .all(0, siteId);
    expect(ownChanges.length).toBeGreaterThan(0);

    // Filter: excluding own site (should return nothing since we're the only writer)
    const otherChanges = db
      .prepare(
        `SELECT * FROM crsql_changes WHERE db_version > ? AND site_id IS NOT ?`,
      )
      .all(0, siteId);
    expect(otherChanges.length).toBe(0);
  });

  test('site_id is accessible and unique per database', () => {
    const dbA = createDb();
    const dbB = createDb();
    setupCrrTable(dbA);
    setupCrrTable(dbB);

    const siteA = getSiteId(dbA);
    const siteB = getSiteId(dbB);

    expect(siteA).toBeInstanceOf(Buffer);
    expect(siteB).toBeInstanceOf(Buffer);
    expect(siteA.length).toBeGreaterThan(0);
    expect(siteB.length).toBeGreaterThan(0);

    // Sites should be different
    expect(Buffer.compare(siteA, siteB)).not.toBe(0);
  });

  test('crsql_finalize runs cleanly', () => {
    const db = createDb();
    setupCrrTable(db);

    db.prepare(
      `INSERT INTO transactions (id, date, description, amount, type, status, sheet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('tx-1', '2026-01-15', 'Test', 50.0, 'INCOME', 'APPROVED', 'Main');

    // Should not throw
    expect(() => {
      db.prepare('SELECT crsql_finalize()').run();
    }).not.toThrow();
  });

  test('performance: extension load + CRR migration is fast', () => {
    const start = performance.now();

    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.loadExtension(extensionPath);
    db.exec(CREATE_TRANSACTIONS_SQL);
    db.exec(`SELECT crsql_as_crr('transactions')`);

    const elapsed = performance.now() - start;
    openDbs.push(db);

    console.log(`Extension load + CRR migration: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
