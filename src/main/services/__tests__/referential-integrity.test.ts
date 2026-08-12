import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  assertSheetsExist,
  assertSheetNameAvailable,
  findOrphans,
  describeOrphans,
  isEmptyOrphanReport,
  ReferentialIntegrityError,
} from '../referential-integrity';

const SCHEMA = `
  CREATE TABLE sheets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    is_virtual INTEGER DEFAULT 0, is_planned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    sheet TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE planned_templates (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    target_sheet TEXT NOT NULL DEFAULT '',
    transfer_target_sheet TEXT
  );
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    transaction_id TEXT
  );
`;

let db: Database.Database;

function addSheet(id: string, name: string): void {
  db.prepare("INSERT INTO sheets (id, name, created_at) VALUES (?, ?, '2026-01-01')").run(id, name);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  addSheet('s-main', 'Main');
  addSheet('s-savings', 'Savings');
});

describe('assertSheetsExist', () => {
  it('passes for sheets that exist', () => {
    expect(() => assertSheetsExist(db, [
      { label: 'sheet', sheet: 'Main' },
      { label: 'sheet', sheet: 'Savings' },
    ])).not.toThrow();
  });

  it('ignores null references', () => {
    expect(() => assertSheetsExist(db, [{ label: 'transfer target sheet', sheet: null }])).not.toThrow();
  });

  it('rejects a sheet that does not exist', () => {
    expect(() => assertSheetsExist(db, [{ label: 'sheet', sheet: 'Ghost' }]))
      .toThrow(ReferentialIntegrityError);
  });

  it('names what was missing', () => {
    expect(() => assertSheetsExist(db, [{ label: 'target sheet', sheet: 'Ghost' }]))
      .toThrow('No such sheet: target sheet "Ghost"');
  });

  it('is case sensitive, because lookups are', () => {
    // Views query `WHERE sheet = ?`, so "main" would match nothing
    expect(() => assertSheetsExist(db, [{ label: 'sheet', sheet: 'main' }])).toThrow();
  });

  it('reports each missing sheet once for a bulk save', () => {
    let message = '';
    try {
      assertSheetsExist(db, [
        { label: 'sheet', sheet: 'Ghost' },
        { label: 'sheet', sheet: 'Ghost' },
        { label: 'sheet', sheet: 'Main' },
      ]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.match(/Ghost/g)).toHaveLength(1);
  });
});

describe('assertSheetNameAvailable', () => {
  it('allows an unused name', () => {
    expect(() => assertSheetNameAvailable(db, 'Events')).not.toThrow();
  });

  it('rejects a name already taken', () => {
    expect(() => assertSheetNameAvailable(db, 'Main')).toThrow('already exists');
  });

  it('rejects a name differing only in capitalisation', () => {
    // Two sheets called "Main" and "main" look identical in the sidebar and would
    // split the ledger in two
    expect(() => assertSheetNameAvailable(db, 'main')).toThrow('capitalisation');
    expect(() => assertSheetNameAvailable(db, 'MAIN')).toThrow('capitalisation');
  });

  it('lets a sheet keep its own name when renamed', () => {
    expect(() => assertSheetNameAvailable(db, 'Main', 's-main')).not.toThrow();
    // Recapitalising your own sheet is fine
    expect(() => assertSheetNameAvailable(db, 'MAIN', 's-main')).not.toThrow();
    // Taking another sheet's name is not
    expect(() => assertSheetNameAvailable(db, 'Savings', 's-main')).toThrow();
  });
});

describe('findOrphans', () => {
  it('reports nothing for a consistent database', () => {
    db.prepare("INSERT INTO transactions (id, sheet) VALUES ('t1', 'Main')").run();
    db.prepare("INSERT INTO attachments (id, transaction_id) VALUES ('a1', 't1')").run();

    const report = findOrphans(db);

    expect(isEmptyOrphanReport(report)).toBe(true);
    expect(describeOrphans(report)).toEqual([]);
  });

  it('finds attachments whose transaction is gone', () => {
    db.prepare("INSERT INTO attachments (id, transaction_id) VALUES ('a1', 'missing')").run();

    expect(findOrphans(db).attachments).toEqual(['a1']);
  });

  it('finds transactions on a sheet that does not exist', () => {
    db.prepare("INSERT INTO transactions (id, sheet) VALUES ('t1', 'Main')").run();
    db.prepare("INSERT INTO transactions (id, sheet) VALUES ('t2', 'Deleted')").run();

    expect(findOrphans(db).transactions).toEqual(['t2']);
  });

  it('finds planned templates pointing at a missing sheet from either column', () => {
    db.prepare("INSERT INTO planned_templates (id, target_sheet, transfer_target_sheet) VALUES ('p1', 'Main', 'Savings')").run();
    db.prepare("INSERT INTO planned_templates (id, target_sheet, transfer_target_sheet) VALUES ('p2', 'Deleted', NULL)").run();
    db.prepare("INSERT INTO planned_templates (id, target_sheet, transfer_target_sheet) VALUES ('p3', 'Main', 'Deleted')").run();

    expect(findOrphans(db).plannedTemplates.sort()).toEqual(['p2', 'p3']);
  });

  it('finds invoices linked to a transaction that is gone, but not unlinked ones', () => {
    db.prepare("INSERT INTO invoices (id, transaction_id) VALUES ('i1', NULL)").run();
    db.prepare("INSERT INTO invoices (id, transaction_id) VALUES ('i2', 'missing')").run();

    expect(findOrphans(db).invoices).toEqual(['i2']);
  });

  it('describes what it found', () => {
    db.prepare("INSERT INTO attachments (id, transaction_id) VALUES ('a1', 'missing')").run();
    db.prepare("INSERT INTO transactions (id, sheet) VALUES ('t1', 'Deleted')").run();

    expect(describeOrphans(findOrphans(db))).toEqual([
      '1 attachment(s) whose transaction is gone',
      '1 transaction(s) on a sheet that does not exist',
    ]);
  });
});
