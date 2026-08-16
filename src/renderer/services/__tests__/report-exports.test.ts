import { describe, it, expect } from 'vitest';
import { renderReportHTML } from '../report-html';
import { generateReportMarkdown } from '../report-builder';
import { exportCSV, exportMarkdown, exportTSV } from '../export';
import type { TransactionRow } from '../../../shared/ipc-types';

/**
 * The export generators received mechanical edits when amounts moved to integer
 * pence and had no tests at all. `tsc` proves the types line up; it cannot notice a
 * missing `fromPence`, which would show up as a figure a hundred times too large in
 * a PDF a treasurer hands to a committee.
 *
 * The same ledger is used throughout, chosen so every total can be checked by hand:
 *
 *   income   1000.00 + 250.50 = 1250.50
 *   expenses  300.00 +  45.25 =  345.25
 *   net                          905.25
 *
 * These figures match what the app displays on screen, verified end-to-end in
 * e2e/reports.e2e.ts — so the exports and the UI are held to one source of truth.
 */

function tx(overrides: Partial<TransactionRow> & { id: string }): TransactionRow {
  return {
    date: '2026-08-15',
    description: 'Test',
    amount: '10.00',
    type: 'expense',
    status: 'approved',
    sheet: 'General',
    category: null,
    party: null,
    reference: null,
    activity: null,
    notes: null,
    linked_id: null,
    version: 1,
    created_at: '2026-08-15T09:00:00.000Z',
    modified_at: null,
    modified_by: null,
    ...overrides,
  };
}

const LEDGER: TransactionRow[] = [
  tx({ id: 'i1', type: 'income', status: '--', amount: '1000.00', description: 'Membership subs', category: 'Subs' }),
  tx({ id: 'i2', type: 'income', status: '--', amount: '250.50', description: 'Kit sales', category: 'Sales' }),
  tx({ id: 'e1', type: 'expense', status: 'approved', amount: '300.00', description: 'Pool hire', category: 'Facilities' }),
  tx({ id: 'e2', type: 'expense', status: 'approved', amount: '45.25', description: 'Equipment', category: 'Kit' }),
];

/** Every amount a generator prints, so a stray 100x is impossible to miss. */
function amountsIn(text: string): string[] {
  return [...text.matchAll(/£\s?([\d,]+\.\d{2})/g)].map((m) => m[1]);
}

describe('renderReportHTML (the PDF export)', () => {
  const html = renderReportHTML({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    generatedDate: '2026-08-16',
    transactions: LEDGER,
  });

  it('prints the totals in pounds, not pence', () => {
    expect(html).toContain('1,250.50');
    expect(html).toContain('345.25');
    expect(html).toContain('905.25');
  });

  it('never prints a figure inflated by the pence conversion', () => {
    // 125050.00 or 34525.00 would mean a fromPence was dropped somewhere
    expect(html).not.toContain('125,050');
    expect(html).not.toContain('34,525');
    expect(html).not.toContain('90,525');
  });

  it('produces no NaN, undefined or unrounded values', () => {
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).not.toMatch(/\d\.\d{4,}/);
  });

  it('includes every transaction description', () => {
    for (const t of LEDGER) {
      expect(html).toContain(t.description);
    }
  });

  it('survives an empty period without breaking', () => {
    const empty = renderReportHTML({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      generatedDate: '2026-08-16',
      transactions: [],
    });
    expect(empty).not.toContain('NaN');
    expect(empty.length).toBeGreaterThan(0);
  });

  it('handles an unreadable amount without emitting NaN', () => {
    const corrupt = renderReportHTML({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      generatedDate: '2026-08-16',
      transactions: [...LEDGER, tx({ id: 'bad', amount: 'corrupt', description: 'Corrupt row' })],
    });
    expect(corrupt).not.toContain('NaN');
  });
});

describe('generateReportMarkdown (the markdown report)', () => {
  const md = generateReportMarkdown(LEDGER, {
    title: 'Test Report',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
  });

  it('totals income, expenses and net correctly', () => {
    expect(md).toContain('£1,250.50');
    expect(md).toContain('£345.25');
    expect(md).toContain('£905.25');
  });

  it('does not inflate by a factor of a hundred', () => {
    expect(md).not.toContain('125,050');
    expect(md).not.toContain('34,525');
  });

  it('produces no NaN', () => {
    expect(md).not.toContain('NaN');
    expect(md).not.toContain('undefined');
  });

  it('agrees with the category breakdown it prints', () => {
    // Facilities 300.00 and Kit 45.25 are the only expense categories
    expect(md).toContain('Facilities');
    expect(md).toContain('£300.00');
    expect(md).toContain('£45.25');
  });
});

describe('exportCSV', () => {
  /**
   * Regression: amounts were written with formatCurrency, so "£1,000.00" put an
   * unquoted comma into the row. Every transaction of £1,000 or more silently
   * gained a column, shifting Type, Status, Category and the rest one place right
   * — in exactly the rows a treasurer cares about most.
   */
  it('keeps every row at the same field count, whatever the amount', () => {
    const csv = exportCSV(LEDGER);
    const rows = csv.split('\n');
    const headerFields = rows[0].split(',').length;

    for (const [index, row] of rows.entries()) {
      expect(row.split(',').length, `row ${index} has the wrong field count: ${row}`)
        .toBe(headerFields);
    }
  });

  it('writes amounts as plain decimals a spreadsheet can read as numbers', () => {
    const csv = exportCSV(LEDGER);
    expect(csv).toContain('1000.00');
    expect(csv).toContain('250.50');
    expect(csv).toContain('45.25');
    // No currency symbol and no thousands separator
    expect(amountsIn(csv)).toEqual([]);
    expect(csv).not.toContain('1,000');
    expect(csv).not.toContain('NaN');
  });

  it('holds its shape with a balance column too', () => {
    const csv = exportCSV(LEDGER, true);
    const rows = csv.split('\n');
    const headerFields = rows[0].split(',').length;
    for (const row of rows) {
      expect(row.split(',').length).toBe(headerFields);
    }
  });

  it('keeps a corrupt amount visible rather than turning it into zero', () => {
    const csv = exportCSV([tx({ id: 'bad', amount: 'corrupt' })]);
    // toAmountString returns null, so the raw stored value is written through
    // instead of a confident, wrong £0.00
    expect(csv).toContain('corrupt');
    expect(csv).not.toContain('NaN');
  });
});

describe('other flat exports', () => {
  it('produces markdown and TSV without broken values', () => {
    for (const out of [exportMarkdown(LEDGER), exportTSV(LEDGER)]) {
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('undefined');
    }
    // Markdown is for reading, so it keeps the formatting
    expect(exportMarkdown(LEDGER)).toContain('£1,000.00');
  });

  it('handles an empty ledger', () => {
    expect(() => exportCSV([])).not.toThrow();
    expect(() => exportMarkdown([])).not.toThrow();
    expect(() => exportTSV([])).not.toThrow();
  });
});
