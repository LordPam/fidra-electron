import { describe, it, expect } from 'vitest';
import { DuplicateDetector } from '../csv-duplicate-detector';
import type { TransactionRow } from '../../../shared/ipc-types';
import type { ParsedCsvRow } from '../../../shared/csv-import-types';

function makeTx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: crypto.randomUUID(),
    date: '2024-01-15',
    description: 'Coffee shop',
    amount: '4.50',
    type: 'expense',
    status: '--',
    sheet: 'Main',
    category: null,
    party: null,
    reference: null,
    activity: null,
    notes: null,
    version: 1,
    created_at: '2024-01-15T00:00:00Z',
    modified_at: null,
    modified_by: null,
    ...overrides,
  };
}

function makeParsed(overrides: Partial<ParsedCsvRow> = {}): ParsedCsvRow {
  return {
    rowIndex: 0,
    rawValues: [],
    date: '2024-01-15',
    description: 'Coffee shop',
    amount: 4.50,
    type: 'expense',
    reference: null,
    party: null,
    notes: null,
    category: null,
    parseErrors: [],
    ...overrides,
  };
}

describe('DuplicateDetector', () => {
  it('detects exact match (date + amount + description)', () => {
    const tx = makeTx();
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('exact');
    expect(result.confidence).toBe(1.0);
    expect(result.matchedTransactionIds).toContain(tx.id);
  });

  it('detects content match (same date + amount, different description)', () => {
    const tx = makeTx({ description: 'Something else' });
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('content');
    expect(result.confidence).toBe(0.9);
    expect(result.matchedTransactionIds).toContain(tx.id);
  });

  it('reports multiple content matches with lower confidence', () => {
    const tx1 = makeTx({ id: '1', description: 'AAA' });
    const tx2 = makeTx({ id: '2', description: 'BBB' });
    const detector = new DuplicateDetector([tx1, tx2]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('content');
    expect(result.confidence).toBe(0.7);
    expect(result.matchedTransactionIds).toHaveLength(2);
  });

  it('reports no match for completely different transactions', () => {
    const tx = makeTx({ date: '2023-06-01', amount: '999.99', description: 'Totally different' });
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('handles parsed rows with null date/amount', () => {
    const tx = makeTx();
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed({ date: null }));
    expect(result.matchType).toBe('none');
  });

  it('detects fuzzy match within date window', () => {
    const tx = makeTx({ date: '2024-01-17', description: 'Coffee shoppe' });
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('fuzzy');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('does not fuzzy match outside date window', () => {
    const tx = makeTx({ date: '2024-06-01' });
    const detector = new DuplicateDetector([tx]);
    const result = detector.check(makeParsed());
    expect(result.matchType).toBe('none');
  });
});
