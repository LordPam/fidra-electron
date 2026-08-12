import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { TransactionRepo } from '../transaction-repo';
import type { TransactionRow } from '../../../shared/ipc-types';

const SCHEMA = `
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '0',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    status TEXT NOT NULL DEFAULT '--' CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
    sheet TEXT NOT NULL DEFAULT '',
    category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT,
    linked_id TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    modified_at TEXT, modified_by TEXT
  );
`;

let db: Database.Database;
let repo: TransactionRepo;

function tx(overrides: Partial<TransactionRow> & { id: string }): TransactionRow {
  return {
    date: '2026-01-01',
    description: 'Test',
    amount: '10.00',
    type: 'expense',
    status: 'approved',
    sheet: 'Main',
    category: null,
    party: null,
    reference: null,
    activity: null,
    notes: null,
    linked_id: null,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    modified_at: null,
    modified_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  repo = new TransactionRepo(db);
});

describe('TransactionRepo.saveTransfer', () => {
  it('saves both halves', () => {
    repo.saveTransfer(
      tx({ id: 'out', type: 'expense', sheet: 'Main', linked_id: 'link-1' }),
      tx({ id: 'in', type: 'income', sheet: 'Savings', linked_id: 'link-1' }),
    );

    expect(repo.getByLinkedId('link-1')).toHaveLength(2);
  });

  it('saves neither half when the second one fails', () => {
    const broken = { ...tx({ id: 'in', linked_id: 'link-1' }), type: 'transfer' } as unknown as TransactionRow;

    expect(() => repo.saveTransfer(tx({ id: 'out', linked_id: 'link-1' }), broken)).toThrow();

    // The expense side must not survive on its own — a half-saved transfer
    // silently loses money from the ledger.
    expect(repo.getById('out')).toBeNull();
    expect(repo.getByLinkedId('link-1')).toEqual([]);
  });
});

describe('TransactionRepo.bulkRemove', () => {
  it('returns 0 for an empty batch instead of failing on `IN ()`', () => {
    repo.save(tx({ id: 't1' }));

    expect(repo.bulkRemove([])).toBe(0);
    expect(repo.getById('t1')).not.toBeNull();
  });

  it('deletes the listed rows and leaves the rest', () => {
    repo.save(tx({ id: 't1' }));
    repo.save(tx({ id: 't2' }));
    repo.save(tx({ id: 't3' }));

    expect(repo.bulkRemove(['t1', 't3'])).toBe(2);
    expect(repo.getAll().map((t) => t.id)).toEqual(['t2']);
  });
});
