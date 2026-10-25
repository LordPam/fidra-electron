import { describe, expect, it } from 'vitest';
import { verifyStatementValues } from '../ai-statement-values';
import type { StatementRow } from '../../../shared/reconciliation-types';

const csv = 'Date,Description,Amount\n2026-10-24,Pool,-12.00\n2026-10-25,Membership,25.00\n';
const row: StatementRow = { sheetId: 'account', source: { statementHash: 'a'.repeat(64), row: 0, date: '2026-10-24', amount: '12.00', type: 'expense', description: 'Pool', evidence: '2026-10-24,Pool,-12.00' }, description: 'Pool hire', party: null, category: null, activity: null, action: 'new' };
describe('independent CSV source validation', () => {
  it('proves ordinary signed ISO-date CSV values without trusting model extraction', () => {
    expect(verifyStatementValues(csv, row)).toBe(true);
    expect(verifyStatementValues(csv, { ...row, source: { ...row.source, row: 1, date: '2026-10-25', description: 'Membership', evidence: '2026-10-25,Membership,25.00', amount: '25.00', type: 'income' } })).toBe(true);
  });
  it('rejects financial contradictions, invented bank IDs and evidence from another row', () => {
    for (const source of [{ amount: '1200.00' }, { type: 'income' as const }, { date: '2026-10-23' }, { bankId: 'invented' }, { evidence: '2026-10-25,Membership,25.00' }, { row: 3 }]) {
      expect(() => verifyStatementValues(csv, { ...row, source: { ...row.source, ...source } })).toThrow();
    }
  });
  it('requires confirmation for ambiguous dates or unsupported layouts', () => {
    expect(verifyStatementValues('Date,Description,Amount\n24/10/2026,Pool,-12.00\n', { ...row, source: { ...row.source, evidence: '24/10/2026,Pool,-12.00' } })).toBe(false);
    expect(verifyStatementValues('When,What,Debit\n2026-10-24,Pool,12.00\n', row)).toBe(false);
  });
});
