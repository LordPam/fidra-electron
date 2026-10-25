import { parseCsvText } from './csv-parser';
import { parsePence } from '../../shared/money';
import type { StatementRow } from '../../shared/reconciliation-types';

/** Prove common CSV values from original bytes; other layouts need a user answer. */
export function verifyStatementValues(text: string, row: StatementRow): boolean {
  return createStatementValueVerifier(text)(row);
}

/** Parse a statement once for a whole batch, rather than once for every row. */
export function createStatementValueVerifier(text: string): (row: StatementRow) => boolean {
  const table = parseCsvText(text.replace(/^\uFEFF/, ''));
  const headers = table[0]?.map((value) => value.toLowerCase().replace(/[^a-z]/g, '')) ?? [];
  const column = (names: string[]): number => {
    const matches = headers.map((value, index) => names.includes(value) ? index : -1).filter((index) => index >= 0);
    return matches.length === 1 ? matches[0] : -1;
  };
  const date = column(['date', 'transactiondate', 'bookingdate', 'posteddate']);
  const description = column(['description', 'narrative', 'details', 'memo', 'transactiondescription']);
  const amount = column(['amount', 'transactionamount']);
  const bankId = column(['transactionid', 'banktransactionid', 'bankid']);
  const rows = table.slice(1).filter((cells) => cells.some((cell) => cell.trim()));
  return (row) => {
    const source = rows[row.source.row];
    if (!source) throw new Error('The proposed CSV row index does not exist in the original statement.');
    if (row.source.bankId && (bankId < 0 || source[bankId]?.trim() !== row.source.bankId)) throw new Error('Use only a bank transaction ID present in that original CSV row, or omit bankId.');
    if (date < 0 || description < 0 || amount < 0) return false;
    const evidence = parseCsvText(row.source.evidence);
    if (evidence.length !== 1 || evidence[0].length !== source.length || evidence[0].some((value, index) => value !== source[index])) throw new Error('CSV evidence must be the complete original row at its stated index.');
    const rawDate = source[date]?.trim() ?? '';
    const rawAmount = source[amount]?.trim() ?? '';
    if (source[description]?.trim() !== row.source.description.trim()) throw new Error('Preserve the original CSV description in source.description.');
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate !== row.source.date) throw new Error('The proposed date contradicts the original CSV date.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(rawAmount)) return false;
    const negative = rawAmount.startsWith('-');
    const absolute = negative ? rawAmount.slice(1) : rawAmount;
    if (parsePence(absolute) !== parsePence(row.source.amount) || (negative ? 'expense' : 'income') !== row.source.type) throw new Error('The proposed amount or income/expense direction contradicts the original CSV row.');
    return true;
  };
}
