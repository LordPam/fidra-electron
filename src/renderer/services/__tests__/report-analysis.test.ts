import { describe, it, expect } from 'vitest';
import {
  getComparisonPeriod,
  getFYComparisonPeriod,
  computeSummaryWithDeltas,
  buildCategoryBreakdownWithDeltas,
  buildPartyBreakdown,
} from '../report-analysis';
import type { TransactionRow } from '../../../shared/ipc-types';

function tx(overrides: Partial<TransactionRow> & { id: string }): TransactionRow {
  return {
    date: '2026-03-15',
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
    created_at: '2026-03-15T00:00:00.000Z',
    modified_at: null,
    modified_by: null,
    ...overrides,
  };
}

describe('getComparisonPeriod', () => {
  it('steps back by the exact length of the period, not by a calendar month', () => {
    // March is 31 days, so the preceding 31-day window starts on 29 January.
    // Worth knowing when reading a report: "previous period" for a calendar month
    // is not the previous calendar month, and straddles two of them.
    expect(getComparisonPeriod('2026-03-01', '2026-03-31')).toEqual({
      start: '2026-01-29',
      end: '2026-02-28',
    });
  });

  it('always ends the day before the period starts', () => {
    const { end } = getComparisonPeriod('2026-03-01', '2026-03-31');
    expect(end).toBe('2026-02-28');
  });

  it('handles a single day', () => {
    expect(getComparisonPeriod('2026-03-02', '2026-03-02')).toEqual({
      start: '2026-03-01',
      end: '2026-03-01',
    });
  });

  it('preserves the length of the period', () => {
    // Counted in UTC: measuring in local time makes a range that crosses a DST
    // boundary come out an hour short of a whole number of days.
    const days = (start: string, end: string): number =>
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;

    const previous = getComparisonPeriod('2026-03-01', '2026-03-31');
    expect(days(previous.start, previous.end)).toBe(days('2026-03-01', '2026-03-31'));
  });
});

describe('getFYComparisonPeriod', () => {
  it('maps a period onto the previous financial year', () => {
    // April-start financial year
    expect(getFYComparisonPeriod('2026-05-01', '2026-05-31', 4)).toEqual({
      start: '2025-05-01',
      end: '2025-05-31',
    });
  });

  it('handles a period in the tail of an April-start year', () => {
    // January 2026 belongs to the FY that began April 2025
    expect(getFYComparisonPeriod('2026-01-01', '2026-01-31', 4)).toEqual({
      start: '2025-01-01',
      end: '2025-01-31',
    });
  });
});

describe('computeSummaryWithDeltas', () => {
  const current = [
    tx({ id: 'i1', type: 'income', status: 'approved', amount: '100.00' }),
    tx({ id: 'i2', type: 'income', status: '--', amount: '50.00' }),
    tx({ id: 'e1', type: 'expense', status: 'approved', amount: '30.00' }),
  ];

  it('totals income and expenditure, and nets them', () => {
    const { current: summary } = computeSummaryWithDeltas(current, null);

    expect(summary.totalIncome).toBe(150);
    expect(summary.totalExpenditure).toBe(30);
    expect(summary.net).toBe(120);
    expect(summary.transactionCount).toBe(3);
  });

  it('leaves out statuses that do not count', () => {
    const { current: summary } = computeSummaryWithDeltas([
      ...current,
      tx({ id: 'r1', type: 'expense', status: 'rejected', amount: '999.00' }),
      tx({ id: 'p1', type: 'expense', status: 'pending', amount: '999.00' }),
      tx({ id: 'pl1', type: 'income', status: 'planned', amount: '999.00' }),
    ], null);

    expect(summary.totalExpenditure).toBe(30);
    expect(summary.totalIncome).toBe(150);
  });

  it('keeps transfers out of the totals and counts them separately', () => {
    const { current: summary } = computeSummaryWithDeltas([
      ...current,
      tx({ id: 'tOut', type: 'expense', status: 'approved', amount: '40.00', linked_id: 'link-1' }),
      tx({ id: 'tIn', type: 'income', status: 'approved', amount: '40.00', linked_id: 'link-1' }),
    ], null);

    expect(summary.totalIncome).toBe(150);
    expect(summary.totalExpenditure).toBe(30);
    // Counted once, from the expense side
    expect(summary.transferVolume).toBe(40);
  });

  it('reports no deltas without a comparison', () => {
    expect(computeSummaryWithDeltas(current, null).deltas).toBeNull();
    // An empty comparison period is the same as none — the bug that used to mark
    // every category "new"
    expect(computeSummaryWithDeltas(current, []).deltas).toBeNull();
    expect(computeSummaryWithDeltas(current, []).comparison).toBeNull();
  });

  it('computes deltas and flags large swings', () => {
    const comparison = [
      tx({ id: 'c1', type: 'income', status: 'approved', amount: '100.00' }),
      tx({ id: 'c2', type: 'expense', status: 'approved', amount: '30.00' }),
    ];

    const { deltas } = computeSummaryWithDeltas(current, comparison);

    expect(deltas!.totalIncome).toEqual({ absolute: 50, percent: 50, flagged: true });
    // Unchanged, so below the 25% flag threshold
    expect(deltas!.totalExpenditure).toEqual({ absolute: 0, percent: 0, flagged: false });
  });

  it('treats growth from zero as 100 per cent', () => {
    const { deltas } = computeSummaryWithDeltas(
      [tx({ id: 'i1', type: 'income', status: 'approved', amount: '10.00' })],
      [tx({ id: 'c1', type: 'expense', status: 'approved', amount: '10.00' })],
    );

    expect(deltas!.totalIncome.percent).toBe(100);
  });
});

describe('buildCategoryBreakdownWithDeltas', () => {
  const current = [
    tx({ id: 'a', type: 'expense', status: 'approved', amount: '60.00', category: 'Kit' }),
    tx({ id: 'b', type: 'expense', status: 'approved', amount: '40.00', category: 'Travel' }),
    tx({ id: 'c', type: 'expense', status: 'approved', amount: '20.00', category: null }),
  ];

  it('groups by category and works out each share', () => {
    const rows = buildCategoryBreakdownWithDeltas(current, null, 'EXPENSE');
    const kit = rows.find((r) => r.category === 'Kit')!;

    expect(kit.total).toBe(60);
    expect(kit.count).toBe(1);
    expect(kit.pct).toBeCloseTo(50);
    // Uncategorised rows land in "Other"
    expect(rows.map((r) => r.category).sort()).toEqual(['Kit', 'Other', 'Travel']);
  });

  it('marks nothing as new when there is no comparison', () => {
    const rows = buildCategoryBreakdownWithDeltas(current, null, 'EXPENSE');

    expect(rows.every((r) => r.status === 'normal')).toBe(true);
    expect(rows.every((r) => r.delta === null)).toBe(true);
  });

  it('marks categories new, gone or flagged against a comparison', () => {
    const comparison = [
      tx({ id: 'x', type: 'expense', status: 'approved', amount: '40.00', category: 'Travel' }),
      tx({ id: 'y', type: 'expense', status: 'approved', amount: '15.00', category: 'Socials' }),
    ];

    const rows = buildCategoryBreakdownWithDeltas(current, comparison, 'EXPENSE');
    const byCategory = new Map(rows.map((r) => [r.category, r]));

    expect(byCategory.get('Kit')!.status).toBe('new');
    expect(byCategory.get('Socials')!.status).toBe('gone');
    expect(byCategory.get('Travel')!.status).toBe('normal');
    expect(byCategory.get('Travel')!.delta).toEqual({ absolute: 0, percent: 0 });
  });

  it('puts new and gone categories first', () => {
    const comparison = [
      tx({ id: 'x', type: 'expense', status: 'approved', amount: '40.00', category: 'Travel' }),
    ];

    const rows = buildCategoryBreakdownWithDeltas(current, comparison, 'EXPENSE');

    expect(rows[0].status === 'new' || rows[0].status === 'gone').toBe(true);
  });

  it('breaks each category down by description', () => {
    const rows = buildCategoryBreakdownWithDeltas([
      tx({ id: 'a', type: 'expense', status: 'approved', amount: '10.00', category: 'Kit', description: 'Balls' }),
      tx({ id: 'b', type: 'expense', status: 'approved', amount: '30.00', category: 'Kit', description: 'Nets' }),
      tx({ id: 'c', type: 'expense', status: 'approved', amount: '5.00', category: 'Kit', description: 'Balls' }),
    ], null, 'EXPENSE');

    // Biggest first
    expect(rows[0].subItems).toEqual([
      { description: 'Nets', count: 1, amount: 30 },
      { description: 'Balls', count: 2, amount: 15 },
    ]);
  });

  it('separates income from expenditure', () => {
    const mixed = [
      tx({ id: 'a', type: 'expense', status: 'approved', amount: '60.00', category: 'Kit' }),
      tx({ id: 'b', type: 'income', status: 'approved', amount: '90.00', category: 'Subs' }),
    ];

    expect(buildCategoryBreakdownWithDeltas(mixed, null, 'EXPENSE').map((r) => r.category)).toEqual(['Kit']);
    expect(buildCategoryBreakdownWithDeltas(mixed, null, 'INCOME').map((r) => r.category)).toEqual(['Subs']);
  });
});

describe('buildPartyBreakdown', () => {
  it('groups by party, filing the unnamed under "Other"', () => {
    const rows = buildPartyBreakdown([
      tx({ id: 'a', type: 'expense', status: 'approved', amount: '10.00', party: 'Supplier' }),
      tx({ id: 'b', type: 'expense', status: 'approved', amount: '15.00', party: 'Supplier' }),
      tx({ id: 'c', type: 'income', status: 'approved', amount: '40.00', party: 'Supplier' }),
      tx({ id: 'd', type: 'expense', status: 'approved', amount: '99.00', party: null }),
    ]);

    const supplier = rows.find((r) => r.party === 'Supplier')!;
    expect(supplier.count).toBe(3);
    expect(supplier.expenditure).toBe(25);
    expect(supplier.income).toBe(40);
    expect(supplier.net).toBe(15);

    expect(rows.find((r) => r.party === 'Other')!.expenditure).toBe(99);
  });

  it('leaves transfers out', () => {
    const rows = buildPartyBreakdown([
      tx({ id: 'a', type: 'expense', status: 'approved', amount: '10.00', party: 'Supplier' }),
      tx({ id: 't', type: 'expense', status: 'approved', amount: '50.00', party: 'Supplier', linked_id: 'link-1' }),
    ]);

    expect(rows.find((r) => r.party === 'Supplier')!.expenditure).toBe(10);
  });
});
