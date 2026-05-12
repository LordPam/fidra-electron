import { describe, it, expect } from 'vitest';
import { parseCsvText, detectColumnMapping, detectDateFormat, detectDecimalSeparator, parseDate, parseAmount, applyMapping } from '../csv-parser';

describe('parseCsvText', () => {
  it('parses simple CSV', () => {
    const result = parseCsvText('a,b,c\n1,2,3\n4,5,6');
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  });

  it('handles quoted fields', () => {
    const result = parseCsvText('"hello, world",b,c');
    expect(result).toEqual([['hello, world', 'b', 'c']]);
  });

  it('handles escaped quotes', () => {
    const result = parseCsvText('"he said ""hello""",b');
    expect(result).toEqual([['he said "hello"', 'b']]);
  });

  it('handles newlines inside quotes', () => {
    const result = parseCsvText('"line1\nline2",b\nc,d');
    expect(result).toEqual([['line1\nline2', 'b'], ['c', 'd']]);
  });

  it('handles CRLF line endings', () => {
    const result = parseCsvText('a,b\r\nc,d\r\n');
    expect(result).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles empty CSV', () => {
    expect(parseCsvText('')).toEqual([]);
  });

  it('handles single row with no newline', () => {
    const result = parseCsvText('a,b,c');
    expect(result).toEqual([['a', 'b', 'c']]);
  });

  it('handles empty fields', () => {
    const result = parseCsvText('a,,c\n,b,');
    expect(result).toEqual([['a', '', 'c'], ['', 'b', '']]);
  });
});

describe('detectDateFormat', () => {
  it('detects YYYY-MM-DD', () => {
    expect(detectDateFormat(['2024-01-15', '2024-02-20', '2024-12-31'])).toBe('YYYY-MM-DD');
  });

  it('detects DD/MM/YYYY when first group > 12', () => {
    expect(detectDateFormat(['15/01/2024', '20/02/2024', '31/12/2024'])).toBe('DD/MM/YYYY');
  });

  it('detects MM/DD/YYYY when second group > 12', () => {
    expect(detectDateFormat(['01/15/2024', '02/20/2024', '12/31/2024'])).toBe('MM/DD/YYYY');
  });

  it('defaults to DD/MM/YYYY when ambiguous', () => {
    expect(detectDateFormat(['01/02/2024', '03/04/2024'])).toBe('DD/MM/YYYY');
  });

  it('detects DD-Mon-YYYY', () => {
    expect(detectDateFormat(['15-Jan-2024', '20-Feb-2024'])).toBe('DD-Mon-YYYY');
  });

  it('returns null for empty array', () => {
    expect(detectDateFormat([])).toBeNull();
  });
});

describe('detectDecimalSeparator', () => {
  it('detects comma as decimal', () => {
    expect(detectDecimalSeparator(['1.234,56', '789,00'])).toBe(',');
  });

  it('defaults to dot', () => {
    expect(detectDecimalSeparator(['1,234.56', '789.00'])).toBe('.');
  });
});

describe('parseDate', () => {
  it('parses YYYY-MM-DD', () => {
    expect(parseDate('2024-01-15', 'YYYY-MM-DD')).toBe('2024-01-15');
  });

  it('parses DD/MM/YYYY', () => {
    expect(parseDate('15/01/2024', 'DD/MM/YYYY')).toBe('2024-01-15');
  });

  it('parses MM/DD/YYYY', () => {
    expect(parseDate('01/15/2024', 'MM/DD/YYYY')).toBe('2024-01-15');
  });

  it('parses DD-Mon-YYYY', () => {
    expect(parseDate('15-Jan-2024', 'DD-Mon-YYYY')).toBe('2024-01-15');
  });

  it('parses DD Mon YYYY', () => {
    expect(parseDate('15 Jan 2024', 'DD Mon YYYY')).toBe('2024-01-15');
  });

  it('parses DD/MM/YY with 2-digit year', () => {
    expect(parseDate('15/01/24', 'DD/MM/YY')).toBe('2024-01-15');
  });

  it('returns null for invalid date', () => {
    expect(parseDate('not a date', 'DD/MM/YYYY')).toBeNull();
  });

  it('returns null for invalid month', () => {
    expect(parseDate('15/13/2024', 'DD/MM/YYYY')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('parses simple number', () => {
    expect(parseAmount('123.45', '.')).toBe(123.45);
  });

  it('parses negative number', () => {
    expect(parseAmount('-123.45', '.')).toBe(-123.45);
  });

  it('parses with currency symbol', () => {
    expect(parseAmount('£123.45', '.')).toBe(123.45);
    expect(parseAmount('$1,234.56', '.')).toBe(1234.56);
    expect(parseAmount('€1.234,56', ',')).toBe(1234.56);
  });

  it('parses parenthesized negative', () => {
    expect(parseAmount('(123.45)', '.')).toBe(-123.45);
  });

  it('parses comma decimal separator', () => {
    expect(parseAmount('1.234,56', ',')).toBe(1234.56);
  });

  it('returns null for empty', () => {
    expect(parseAmount('', '.')).toBeNull();
    expect(parseAmount('  ', '.')).toBeNull();
  });

  it('returns null for non-numeric', () => {
    expect(parseAmount('abc', '.')).toBeNull();
  });
});

describe('detectColumnMapping', () => {
  it('detects standard bank CSV headers', () => {
    const headers = ['Date', 'Description', 'Amount', 'Reference'];
    const sampleRows = [
      ['2024-01-15', 'Coffee shop', '-4.50', 'REF001'],
      ['2024-01-16', 'Salary', '2000.00', 'REF002'],
    ];
    const { mapping, amountMode } = detectColumnMapping(headers, sampleRows);
    expect(mapping.date).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.amount).toBe(2);
    expect(mapping.reference).toBe(3);
    expect(amountMode).toBe('signed');
  });

  it('detects debit/credit columns', () => {
    const headers = ['Date', 'Narrative', 'Debit', 'Credit'];
    const sampleRows = [
      ['2024-01-15', 'Coffee shop', '4.50', ''],
      ['2024-01-16', 'Salary', '', '2000.00'],
    ];
    const { mapping, amountMode } = detectColumnMapping(headers, sampleRows);
    expect(mapping.date).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.debit).toBe(2);
    expect(mapping.credit).toBe(3);
    expect(amountMode).toBe('debit-credit');
  });

  it('handles case-insensitive headers', () => {
    const headers = ['DATE', 'DESCRIPTION', 'AMOUNT'];
    const sampleRows = [['2024-01-15', 'Test', '10.00']];
    const { mapping } = detectColumnMapping(headers, sampleRows);
    expect(mapping.date).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.amount).toBe(2);
  });
});

describe('applyMapping', () => {
  it('applies signed amount mapping', () => {
    const mapping = { date: 0, description: 1, amount: 2, debit: -1, credit: -1, typeIndicator: -1, reference: -1, party: -1, notes: -1, category: -1 };
    const result = applyMapping(['2024-01-15', 'Coffee shop', '-4.50'], 0, mapping, 'signed', 'positive-expense', 'YYYY-MM-DD', '.');
    expect(result.date).toBe('2024-01-15');
    expect(result.description).toBe('Coffee shop');
    expect(result.amount).toBe(4.50);
    expect(result.type).toBe('income'); // negative with positive-expense convention = income
    expect(result.parseErrors).toHaveLength(0);
  });

  it('applies debit-credit mapping', () => {
    const mapping = { date: 0, description: 1, amount: -1, debit: 2, credit: 3, typeIndicator: -1, reference: -1, party: -1, notes: -1, category: -1 };
    const result = applyMapping(['2024-01-15', 'Coffee shop', '4.50', ''], 0, mapping, 'debit-credit', 'positive-expense', 'YYYY-MM-DD', '.');
    expect(result.amount).toBe(4.50);
    expect(result.type).toBe('expense');
  });

  it('records parse errors for invalid date', () => {
    const mapping = { date: 0, description: 1, amount: 2, debit: -1, credit: -1, typeIndicator: -1, reference: -1, party: -1, notes: -1, category: -1 };
    const result = applyMapping(['invalid', 'Test', '10.00'], 0, mapping, 'signed', 'positive-expense', 'YYYY-MM-DD', '.');
    expect(result.date).toBeNull();
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });
});
