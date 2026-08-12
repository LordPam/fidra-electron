import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PlannedRepo } from '../planned-repo';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';

const SCHEMA = `
  CREATE TABLE planned_templates (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '0',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    frequency TEXT NOT NULL DEFAULT 'once',
    target_sheet TEXT NOT NULL DEFAULT '',
    category TEXT, party TEXT, activity TEXT, notes TEXT,
    transfer_target_sheet TEXT,
    end_date TEXT, occurrence_count INTEGER,
    skipped_dates TEXT DEFAULT '[]', fulfilled_dates TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  );
`;

let db: Database.Database;
let repo: PlannedRepo;

function template(overrides: Partial<PlannedTemplateRow> & { id: string }): PlannedTemplateRow {
  return {
    start_date: '2026-01-01',
    description: 'Monthly subs',
    amount: '10.00',
    type: 'income',
    frequency: 'monthly',
    target_sheet: 'Main',
    category: null,
    party: null,
    activity: null,
    notes: null,
    end_date: null,
    occurrence_count: null,
    skipped_dates: '[]',
    fulfilled_dates: '[]',
    transfer_target_sheet: null,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  repo = new PlannedRepo(db);
});

describe('save', () => {
  it('inserts a new template', () => {
    repo.save(template({ id: 'pt-1' }));

    expect(repo.getById('pt-1')).toMatchObject({
      id: 'pt-1',
      description: 'Monthly subs',
      amount: '10.00',
      frequency: 'monthly',
    });
  });

  it('updates in place rather than replacing', () => {
    repo.save(template({ id: 'pt-1' }));
    repo.save(template({ id: 'pt-1', description: 'Renamed', version: 2 }));

    expect(repo.getAll()).toHaveLength(1);
    expect(repo.getById('pt-1')).toMatchObject({ description: 'Renamed', version: 2 });
  });

  it('keeps created_at from the original insert', () => {
    repo.save(template({ id: 'pt-1', created_at: '2026-01-01T00:00:00.000Z' }));
    repo.save(template({ id: 'pt-1', created_at: '2099-01-01T00:00:00.000Z', version: 2 }));

    // The UPDATE path does not touch created_at
    expect(repo.getById('pt-1')!.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('round-trips transfer templates and occurrence limits', () => {
    repo.save(template({
      id: 'pt-1',
      transfer_target_sheet: 'Savings',
      end_date: '2026-12-31',
      occurrence_count: 6,
      skipped_dates: '["2026-02-01"]',
      fulfilled_dates: '["2026-01-01"]',
    }));

    expect(repo.getById('pt-1')).toMatchObject({
      transfer_target_sheet: 'Savings',
      end_date: '2026-12-31',
      occurrence_count: 6,
      skipped_dates: '["2026-02-01"]',
      fulfilled_dates: '["2026-01-01"]',
    });
  });

  it('returns null for an unknown id', () => {
    expect(repo.getById('nope')).toBeNull();
  });
});

describe('getAll', () => {
  it('orders by start date, earliest first', () => {
    repo.save(template({ id: 'c', start_date: '2026-03-01' }));
    repo.save(template({ id: 'a', start_date: '2026-01-01' }));
    repo.save(template({ id: 'b', start_date: '2026-02-01' }));

    expect(repo.getAll().map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('bulkSave', () => {
  it('inserts and updates in one pass', () => {
    repo.save(template({ id: 'existing', description: 'Before' }));

    repo.bulkSave([
      template({ id: 'existing', description: 'After', version: 2 }),
      template({ id: 'fresh', description: 'New one' }),
    ]);

    expect(repo.getById('existing')).toMatchObject({ description: 'After', version: 2 });
    expect(repo.getById('fresh')).toMatchObject({ description: 'New one' });
  });

  it('applies all rows or none', () => {
    repo.save(template({ id: 'existing', description: 'Before' }));

    // The second row violates the type CHECK constraint
    const broken = { ...template({ id: 'bad' }), type: 'transfer' } as unknown as PlannedTemplateRow;
    expect(() => repo.bulkSave([template({ id: 'good' }), broken])).toThrow();

    expect(repo.getById('good')).toBeNull();
    expect(repo.getById('existing')).toMatchObject({ description: 'Before' });
  });

  it('accepts an empty batch', () => {
    expect(() => repo.bulkSave([])).not.toThrow();
    expect(repo.getAll()).toEqual([]);
  });
});

describe('remove', () => {
  it('reports whether anything was deleted', () => {
    repo.save(template({ id: 'pt-1' }));

    expect(repo.remove('pt-1')).toBe(true);
    expect(repo.remove('pt-1')).toBe(false);
  });
});
