import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SheetRepo } from '../sheet-repo';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';

const SCHEMA = `
  CREATE TABLE sheets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    is_virtual INTEGER DEFAULT 0,
    is_planned INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '0',
    type TEXT NOT NULL DEFAULT 'expense',
    status TEXT NOT NULL DEFAULT '--',
    sheet TEXT NOT NULL DEFAULT '',
    category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT,
    linked_id TEXT,
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
    category TEXT, party TEXT, activity TEXT, notes TEXT,
    transfer_target_sheet TEXT,
    end_date TEXT, occurrence_count INTEGER,
    skipped_dates TEXT DEFAULT '[]',
    fulfilled_dates TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    stored_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT,
    file_size INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
`;

let db: Database.Database;
let repo: SheetRepo;

/** A transfer template on `from`, whose income side lands on `to`. */
function insertTransfer(id: string, from: string, to: string | null): void {
  db.prepare(
    `INSERT INTO planned_templates (id, start_date, description, amount, type, frequency,
      target_sheet, transfer_target_sheet, created_at)
     VALUES (?, '2026-01-01', ?, '100.00', 'expense', 'monthly', ?, ?, '2026-01-01')`,
  ).run(id, `Transfer ${from} -> ${to ?? 'none'}`, from, to);
}

function getTemplate(id: string): PlannedTemplateRow | undefined {
  return db.prepare('SELECT * FROM planned_templates WHERE id = ?').get(id) as PlannedTemplateRow | undefined;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  repo = new SheetRepo(db);
  repo.create('s-main', 'Main');
  repo.create('s-savings', 'Savings');
  repo.create('s-events', 'Events');
});

describe('SheetRepo sheet-name cascades', () => {
  describe('renameSheet', () => {
    it('cascades to transactions and both planned sheet columns', () => {
      db.prepare(
        "INSERT INTO transactions (id, date, description, amount, type, status, sheet, created_at) VALUES ('t1', '2026-01-01', 'x', '5.00', 'expense', '--', 'Savings', '2026-01-01')",
      ).run();
      insertTransfer('p-out', 'Savings', 'Main');
      insertTransfer('p-in', 'Main', 'Savings');

      repo.renameSheet('Savings', 'Reserves');

      expect(repo.getByName('Reserves')).not.toBeNull();
      expect((db.prepare("SELECT sheet FROM transactions WHERE id = 't1'").get() as { sheet: string }).sheet).toBe('Reserves');
      expect(getTemplate('p-out')!.target_sheet).toBe('Reserves');
      expect(getTemplate('p-in')!.transfer_target_sheet).toBe('Reserves');
    });

    it('leaves templates that reference other sheets untouched', () => {
      insertTransfer('p-other', 'Main', 'Events');

      repo.renameSheet('Savings', 'Reserves');

      expect(getTemplate('p-other')!.target_sheet).toBe('Main');
      expect(getTemplate('p-other')!.transfer_target_sheet).toBe('Events');
    });
  });

  describe('mergeAndDelete', () => {
    it('repoints transfer destinations at the merge target', () => {
      insertTransfer('p-in', 'Main', 'Savings');

      repo.mergeAndDelete('s-savings', 'Savings', 'Main');

      expect(repo.getByName('Savings')).toBeNull();
      // Main -> Savings becomes Main -> Main: a zero-net self transfer, matching how
      // merge already collapses linked transaction pairs onto one sheet.
      expect(getTemplate('p-in')!.transfer_target_sheet).toBe('Main');
    });

    it('moves templates living on the source sheet to the target', () => {
      insertTransfer('p-out', 'Savings', 'Events');

      repo.mergeAndDelete('s-savings', 'Savings', 'Main');

      expect(getTemplate('p-out')!.target_sheet).toBe('Main');
      expect(getTemplate('p-out')!.transfer_target_sheet).toBe('Events');
    });
  });

  describe('deleteWithTransactions', () => {
    it('nulls out transfer destinations pointing at the deleted sheet', () => {
      insertTransfer('p-in', 'Main', 'Savings');

      repo.deleteWithTransactions('s-savings', 'Savings');

      const survivor = getTemplate('p-in');
      expect(survivor).toBeDefined();
      expect(survivor!.target_sheet).toBe('Main');
      expect(survivor!.transfer_target_sheet).toBeNull();
    });

    it('still deletes templates that live on the deleted sheet', () => {
      insertTransfer('p-out', 'Savings', 'Events');

      repo.deleteWithTransactions('s-savings', 'Savings');

      expect(getTemplate('p-out')).toBeUndefined();
      expect(repo.getByName('Savings')).toBeNull();
    });

    it('deletes transactions and their attachments on the sheet', () => {
      db.prepare(
        "INSERT INTO transactions (id, date, description, amount, type, status, sheet, created_at) VALUES ('t1', '2026-01-01', 'x', '5.00', 'expense', '--', 'Savings', '2026-01-01')",
      ).run();
      db.prepare(
        "INSERT INTO attachments (id, transaction_id, filename, stored_name, created_at) VALUES ('a1', 't1', 'r.pdf', 's.pdf', '2026-01-01')",
      ).run();

      repo.deleteWithTransactions('s-savings', 'Savings');

      expect(db.prepare('SELECT COUNT(*) as c FROM transactions').get()).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM attachments').get()).toEqual({ c: 0 });
    });
  });

  describe('getPlannedOnSheet', () => {
    it('returns templates on the sheet and templates transferring into it', () => {
      insertTransfer('p-out', 'Savings', 'Main');
      insertTransfer('p-in', 'Main', 'Savings');
      insertTransfer('p-unrelated', 'Events', null);

      const ids = repo.getPlannedOnSheet('Savings').map((p) => p.id).sort();

      expect(ids).toEqual(['p-in', 'p-out']);
    });

    it('does not return a template twice when both columns match', () => {
      insertTransfer('p-self', 'Savings', 'Savings');

      expect(repo.getPlannedOnSheet('Savings')).toHaveLength(1);
    });
  });
});
