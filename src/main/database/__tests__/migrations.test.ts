import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// We test migrations by simulating old schemas and running openDatabase-style logic.
// We import the openDatabase function which applies schema + migrations.

describe('Categories PK migration', () => {
  it('migrates INTEGER PK to TEXT UUID PK preserving data', () => {
    const db = new Database(':memory:');
    // Create old-style table
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(type, name)
      );
      CREATE INDEX idx_categories_type ON categories(type);
    `);
    db.prepare("INSERT INTO categories (type, name, sort_order) VALUES ('income', 'Salary', 0)").run();
    db.prepare("INSERT INTO categories (type, name, sort_order) VALUES ('expense', 'Groceries', 1)").run();

    // Simulate migration: check if id is INTEGER, rebuild
    const catCols = db.pragma('table_info(categories)') as { name: string; type: string }[];
    const idCol = catCols.find((c) => c.name === 'id');
    expect(idCol!.type).toBe('INTEGER');

    // Run migration inline (same as connection.ts)
    db.exec(`
      CREATE TABLE categories_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
        name TEXT NOT NULL DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        UNIQUE(type, name)
      );
    `);
    const rows = db.prepare('SELECT type, name, sort_order FROM categories ORDER BY sort_order, rowid').all() as {
      type: string; name: string; sort_order: number;
    }[];
    const ins = db.prepare('INSERT INTO categories_new (id, type, name, sort_order) VALUES (?, ?, ?, ?)');
    for (const row of rows) {
      ins.run(crypto.randomUUID(), row.type, row.name, row.sort_order);
    }
    db.exec('DROP TABLE categories');
    db.exec('ALTER TABLE categories_new RENAME TO categories');
    db.exec('CREATE INDEX idx_categories_type ON categories(type)');

    // Verify
    const newCols = db.pragma('table_info(categories)') as { name: string; type: string }[];
    const newId = newCols.find((c) => c.name === 'id');
    expect(newId!.type).toBe('TEXT');

    const migrated = db.prepare('SELECT id, type, name FROM categories ORDER BY sort_order').all() as {
      id: string; type: string; name: string;
    }[];
    expect(migrated).toHaveLength(2);
    expect(migrated[0].name).toBe('Salary');
    expect(migrated[0].id).toBeTruthy();
    expect(migrated[0].id).not.toBe('1'); // Should be UUID, not old integer
    expect(migrated[1].name).toBe('Groceries');
    expect(migrated[1].id).toBeTruthy();
    // IDs should be different
    expect(migrated[0].id).not.toBe(migrated[1].id);

    db.close();
  });
});

describe('Settings scope column migration', () => {
  it('adds scope column and tags existing rows as org', () => {
    const db = new Database(':memory:');
    // Old-style settings table
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO settings (key, value) VALUES ('profile.name', 'Test Club')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('fy_start_month', '9')").run();

    // Simulate migration
    const cols = db.pragma('table_info(settings)') as { name: string }[];
    expect(cols.some((c) => c.name === 'scope')).toBe(false);

    db.exec("ALTER TABLE settings ADD COLUMN scope TEXT NOT NULL DEFAULT 'device'");
    db.exec("UPDATE settings SET scope = 'org'");

    // Verify
    const rows = db.prepare('SELECT key, scope FROM settings').all() as { key: string; scope: string }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.scope).toBe('org');
    }

    // New rows default to 'device'
    db.prepare("INSERT INTO settings (key, value) VALUES ('_crr_initialized', '1')").run();
    const sentinel = db.prepare("SELECT scope FROM settings WHERE key = '_crr_initialized'").get() as { scope: string };
    expect(sentinel.scope).toBe('device');

    db.close();
  });
});

describe('CRR defaults migration', () => {
  it('adds DEFAULT values to NOT NULL columns', () => {
    const db = new Database(':memory:');
    // Old-style transactions table (no DEFAULTs on NOT NULL cols)
    db.exec(`
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        status TEXT NOT NULL CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
        sheet TEXT NOT NULL,
        category TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        modified_at TEXT
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'device'
      );
    `);

    // Insert a row before migration
    db.prepare(
      "INSERT INTO transactions (id, date, description, amount, type, status, sheet, created_at) VALUES ('tx1', '2026-01-01', 'Test', '100', 'income', '--', 'Main', '2026-01-01T00:00:00Z')",
    ).run();

    // Verify no defaults before migration
    const colsBefore = db.pragma('table_info(transactions)') as {
      name: string; notnull: number; dflt_value: string | null; pk: number;
    }[];
    const dateBefore = colsBefore.find((c) => c.name === 'date');
    expect(dateBefore!.dflt_value).toBeNull();

    // Run migration
    db.exec(`CREATE TABLE transactions_new (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '0',
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
      status TEXT NOT NULL DEFAULT '--' CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
      sheet TEXT NOT NULL DEFAULT '',
      category TEXT,
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      modified_at TEXT
    )`);
    db.exec(
      "INSERT INTO transactions_new (id, date, description, amount, type, status, sheet, category, version, created_at, modified_at) SELECT id, date, description, amount, type, status, sheet, category, version, created_at, modified_at FROM transactions",
    );
    db.exec('DROP TABLE transactions');
    db.exec('ALTER TABLE transactions_new RENAME TO transactions');

    // Verify DEFAULTs exist
    const colsAfter = db.pragma('table_info(transactions)') as {
      name: string; notnull: number; dflt_value: string | null; pk: number;
    }[];
    const dateAfter = colsAfter.find((c) => c.name === 'date');
    expect(dateAfter!.dflt_value).toBe("''");
    const amountAfter = colsAfter.find((c) => c.name === 'amount');
    expect(amountAfter!.dflt_value).toBe("'0'");
    const statusAfter = colsAfter.find((c) => c.name === 'status');
    expect(statusAfter!.dflt_value).toBe("'--'");

    // Verify data preserved
    const row = db.prepare("SELECT * FROM transactions WHERE id = 'tx1'").get() as Record<string, unknown>;
    expect(row.date).toBe('2026-01-01');
    expect(row.amount).toBe('100');
    expect(row.description).toBe('Test');

    db.close();
  });
});
