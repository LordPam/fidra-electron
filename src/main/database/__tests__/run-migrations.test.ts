import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../connection';

/**
 * These drive the real `openDatabase` (SCHEMA_DDL + runMigrations) against
 * hand-built legacy database files, rather than re-implementing migration logic.
 */

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-migrate-'));
  dbPath = path.join(dir, 'legacy.fdra');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A pre-CRR-hardening database: NOT NULL columns without DEFAULTs, a UNIQUE
 * constraint on sheets.name, no `scope` on settings, no auth columns on personnel.
 * `linked_id` and `transfer_target_sheet` are present and populated — those are the
 * columns the old hardcoded copy lists forgot.
 */
function writeLegacyDatabase(): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      sheet TEXT NOT NULL,
      category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT,
      linked_id TEXT,
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      modified_at TEXT, modified_by TEXT
    );
    CREATE TABLE planned_templates (
      id TEXT PRIMARY KEY NOT NULL,
      start_date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount TEXT NOT NULL,
      type TEXT NOT NULL,
      frequency TEXT NOT NULL,
      target_sheet TEXT NOT NULL,
      category TEXT, party TEXT, activity TEXT, notes TEXT,
      transfer_target_sheet TEXT,
      end_date TEXT, occurrence_count INTEGER,
      skipped_dates TEXT DEFAULT '[]', fulfilled_dates TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sheets (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '' UNIQUE,
      is_virtual INTEGER DEFAULT 0, is_planned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE personnel (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      auth_uid TEXT,
      created_at TEXT NOT NULL,
      invited_by TEXT
    );
  `);
  db.prepare(
    `INSERT INTO transactions (id, date, description, amount, type, status, sheet, linked_id, created_at)
     VALUES ('tx1', '2026-01-01', 'Transfer out', '25.00', 'expense', 'approved', 'Main', 'link-1', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO planned_templates (id, start_date, description, amount, type, frequency, target_sheet, transfer_target_sheet, created_at)
     VALUES ('pt1', '2026-01-01', 'Monthly transfer', '25.00', 'expense', 'monthly', 'Main', 'Savings', '2026-01-01')`,
  ).run();
  db.prepare("INSERT INTO sheets (id, name, created_at) VALUES ('s1', 'Main', '2026-01-01')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('fyStartMonth', '4')").run();
  db.prepare(
    "INSERT INTO personnel (id, email, name, role, created_at) VALUES ('p1', 'a@b.com', 'Alice', 'admin', '2026-01-01')",
  ).run();
  db.close();
}

describe('runMigrations on a legacy database', () => {
  it('preserves columns the rebuilt tables gained after the rebuild DDL was written', () => {
    writeLegacyDatabase();

    const { db } = openDatabase(dbPath);

    // The transactions/planned_templates rebuilds used to copy a hardcoded column
    // list that omitted these two, silently dropping their values.
    expect(db.prepare("SELECT linked_id FROM transactions WHERE id = 'tx1'").get())
      .toEqual({ linked_id: 'link-1' });
    expect(db.prepare("SELECT transfer_target_sheet FROM planned_templates WHERE id = 'pt1'").get())
      .toEqual({ transfer_target_sheet: 'Savings' });

    db.close();
  });

  it('adds DEFAULTs, drops the UNIQUE constraint, and keeps row data', () => {
    writeLegacyDatabase();

    const { db } = openDatabase(dbPath);

    const txCols = db.pragma('table_info(transactions)') as {
      name: string; notnull: number; dflt_value: string | null; pk: number;
    }[];
    expect(txCols.filter((c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0)).toEqual([]);

    const sheetIndexes = db.prepare("PRAGMA index_list('sheets')").all() as {
      unique: number; origin: string;
    }[];
    expect(sheetIndexes.some((i) => i.unique === 1 && i.origin !== 'pk')).toBe(false);

    expect(db.prepare("SELECT description FROM transactions WHERE id = 'tx1'").get())
      .toEqual({ description: 'Transfer out' });
    expect(db.prepare("SELECT name FROM sheets WHERE id = 's1'").get()).toEqual({ name: 'Main' });

    db.close();
  });

  it('carries settings and personnel through their PK rebuilds', () => {
    writeLegacyDatabase();

    const { db } = openDatabase(dbPath);

    // scope is new on settings; existing keys are treated as org-scoped
    expect(db.prepare("SELECT value, scope FROM settings WHERE key = 'fyStartMonth'").get())
      .toEqual({ value: '4', scope: 'org' });
    // personnel gained auth + device columns; the original row survives
    const person = db.prepare("SELECT name, role, password_hash FROM personnel WHERE id = 'p1'").get();
    expect(person).toEqual({ name: 'Alice', role: 'admin', password_hash: null });

    db.close();
  });

  it('rolls the whole migration set back when a later step fails', () => {
    writeLegacyDatabase();
    // Booby-trap the UNIQUE-constraint migration, which runs after the table
    // rebuilds: CREATE TABLE sheets_tmp will fail because the name is taken.
    const seed = new Database(dbPath);
    seed.exec('CREATE TABLE sheets_tmp (x TEXT)');
    seed.close();

    expect(() => openDatabase(dbPath)).toThrow();

    // The earlier transactions rebuild must not have been left half-applied.
    const db = new Database(dbPath);
    const txCols = db.pragma('table_info(transactions)') as { name: string; dflt_value: string | null }[];
    expect(txCols.find((c) => c.name === 'date')!.dflt_value).toBeNull();
    expect(db.prepare("SELECT linked_id FROM transactions WHERE id = 'tx1'").get())
      .toEqual({ linked_id: 'link-1' });
    // ...and no rebuild scratch tables were left behind.
    const leftovers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%\\_new' ESCAPE '\\' OR name = 'settings_tmp' OR name = 'personnel_tmp')",
    ).all();
    expect(leftovers).toEqual([]);
    db.close();
  });
});
