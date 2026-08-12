import { describe, it, expect } from 'vitest';
import { computeTotal, computeRunningBalances, computePendingTotal } from '../balance';
import type { TransactionRow } from '../../../shared/ipc-types';

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

describe('computeTotal', () => {
  it('adds countable income and subtracts approved expenses', () => {
    const total = computeTotal([
      tx({ id: 'a', type: 'income', status: '--', amount: '100.00' }),
      tx({ id: 'b', type: 'income', status: 'approved', amount: '50.00' }),
      tx({ id: 'c', type: 'expense', status: 'approved', amount: '30.00' }),
    ]);
    expect(total).toBe(120);
  });

  it('ignores uncountable statuses', () => {
    const total = computeTotal([
      tx({ id: 'a', type: 'income', status: 'rejected', amount: '100.00' }),
      tx({ id: 'b', type: 'expense', status: 'pending', amount: '40.00' }),
      tx({ id: 'c', type: 'expense', status: 'planned', amount: '40.00' }),
    ]);
    expect(total).toBe(0);
  });

  it('can exclude transfers', () => {
    const rows = [
      tx({ id: 'a', type: 'income', status: '--', amount: '100.00' }),
      tx({ id: 'b', type: 'expense', status: 'approved', amount: '25.00', linked_id: 'link-1' }),
    ];
    expect(computeTotal(rows)).toBe(75);
    expect(computeTotal(rows, { excludeTransfers: true })).toBe(100);
  });

  it('does not drift over amounts that are inexact in binary floating point', () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      tx({ id: `t${i}`, type: 'income', status: '--', amount: '0.10' }));

    // The naive pounds-at-a-time version lands on 30.000000000000068
    const naive = rows.reduce((s, t) => s + parseFloat(t.amount), 0);
    expect(naive).not.toBe(30);

    expect(computeTotal(rows)).toBe(30);
  });

  it('treats an unreadable amount as zero rather than NaN', () => {
    const total = computeTotal([
      tx({ id: 'a', type: 'income', status: '--', amount: '100.00' }),
      tx({ id: 'b', type: 'income', status: '--', amount: 'corrupt' }),
    ]);
    expect(total).toBe(100);
  });
});

describe('computeRunningBalances', () => {
  it('accumulates in date then created_at order', () => {
    const balances = computeRunningBalances([
      tx({ id: 'b', date: '2026-01-02', type: 'expense', status: 'approved', amount: '30.00' }),
      tx({ id: 'a', date: '2026-01-01', type: 'income', status: '--', amount: '100.00' }),
      tx({ id: 'c', date: '2026-01-03', type: 'income', status: 'approved', amount: '5.00' }),
    ]);

    expect(balances.get('a')).toBe(100);
    expect(balances.get('b')).toBe(70);
    expect(balances.get('c')).toBe(75);
  });

  it('keeps every step exact down the ledger', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      tx({
        id: `t${i}`,
        date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
        type: 'income',
        status: '--',
        amount: '0.07',
      }));

    const balances = computeRunningBalances(rows);
    const final = [...balances.values()].pop();
    expect(final).toBe(7);
  });
});

describe('computePendingTotal', () => {
  it('counts only non-transfer pending expenses', () => {
    const total = computePendingTotal([
      tx({ id: 'a', type: 'expense', status: 'pending', amount: '10.00' }),
      tx({ id: 'b', type: 'expense', status: 'pending', amount: '5.50', linked_id: 'link-1' }),
      tx({ id: 'c', type: 'expense', status: 'approved', amount: '99.00' }),
      tx({ id: 'd', type: 'income', status: 'pending', amount: '99.00' }),
    ]);
    expect(total).toBe(10);
  });
});
