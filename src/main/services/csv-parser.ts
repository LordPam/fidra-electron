import fs from 'node:fs';
import type { CsvColumnMapping, AmountMode, SignConvention, ParsedCsvRow } from '../../shared/csv-import-types';

// ─── RFC 4180 CSV Parser ─────────────────────────────────────────────

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Final field/row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function readCsvFile(filePath: string, encoding: BufferEncoding = 'utf-8'): { headers: string[]; rows: string[][] } {
  let text = fs.readFileSync(filePath, encoding);
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const allRows = parseCsvText(text);
  if (allRows.length === 0) return { headers: [], rows: [] };

  const headers = allRows[0].map((h) => h.trim());
  const rows = allRows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));
  return { headers, rows };
}

// ─── Column Detection ────────────────────────────────────────────────

const HEADER_SYNONYMS: Record<string, string[]> = {
  date: ['date', 'transaction date', 'txn date', 'booking date', 'value date', 'posted date', 'posting date'],
  description: ['description', 'narrative', 'details', 'memo', 'particulars', 'transaction description'],
  amount: ['amount', 'value', 'sum', 'transaction amount'],
  debit: ['debit', 'debit amount', 'money out', 'withdrawals', 'payments', 'paid out'],
  credit: ['credit', 'credit amount', 'money in', 'deposits', 'receipts', 'paid in'],
  reference: ['reference', 'ref', 'cheque number', 'transaction ref', 'check number'],
  party: ['payee', 'party', 'merchant', 'counterparty', 'beneficiary', 'name'],
  notes: ['notes', 'note', 'comment', 'remarks'],
  category: ['category', 'transaction category'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

export function detectColumnMapping(
  headers: string[],
  sampleRows: string[][],
): { mapping: CsvColumnMapping; amountMode: AmountMode } {
  const mapping: CsvColumnMapping = {
    date: -1,
    description: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    typeIndicator: -1,
    reference: -1,
    party: -1,
    notes: -1,
    category: -1,
  };

  const normalized = headers.map(normalizeHeader);

  // Match by header synonyms
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    for (let i = 0; i < normalized.length; i++) {
      if (synonyms.includes(normalized[i])) {
        (mapping as unknown as Record<string, number>)[field] = i;
        break;
      }
    }
  }

  // Content-based fallback for unmapped columns
  if (mapping.date === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (isAlreadyMapped(mapping, i)) continue;
      const vals = sampleRows.map((r) => r[i] ?? '').filter(Boolean);
      if (vals.length > 0 && vals.every((v) => looksLikeDate(v))) {
        mapping.date = i;
        break;
      }
    }
  }

  if (mapping.amount === -1 && mapping.debit === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (isAlreadyMapped(mapping, i)) continue;
      const vals = sampleRows.map((r) => r[i] ?? '').filter(Boolean);
      if (vals.length > 0 && vals.every((v) => looksLikeNumber(v))) {
        mapping.amount = i;
        break;
      }
    }
  }

  if (mapping.description === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (isAlreadyMapped(mapping, i)) continue;
      const vals = sampleRows.map((r) => r[i] ?? '').filter(Boolean);
      if (vals.length > 0 && vals.every((v) => v.length > 3 && !looksLikeNumber(v) && !looksLikeDate(v))) {
        mapping.description = i;
        break;
      }
    }
  }

  // Determine amount mode
  let amountMode: AmountMode = 'signed';
  if (mapping.debit !== -1 && mapping.credit !== -1) {
    amountMode = 'debit-credit';
  } else if (mapping.typeIndicator !== -1 && mapping.amount !== -1) {
    amountMode = 'amount-with-indicator';
  }

  return { mapping, amountMode };
}

function isAlreadyMapped(mapping: CsvColumnMapping, index: number): boolean {
  return Object.values(mapping).includes(index);
}

/** Strip trailing time component (e.g. " 01:30:57", "T14:00:00Z") from a date string */
function stripTime(v: string): string {
  return v.trim().replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i, '').trim();
}

function looksLikeDate(v: string): boolean {
  const s = stripTime(v);
  return /^\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}$/.test(s) ||
    /^\d{1,2}[\-\s][A-Za-z]{3}[\-\s]\d{2,4}$/.test(s);
}

function looksLikeNumber(v: string): boolean {
  const cleaned = v.trim().replace(/[£$€,\s]/g, '');
  return /^-?\d+([.,]\d+)?$/.test(cleaned);
}

// ─── Date Detection ──────────────────────────────────────────────────

const DATE_FORMATS = [
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, format: 'YYYY-MM-DD', yIdx: 1, mIdx: 2, dIdx: 3 },
  { pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/, format: null, yIdx: 3, mIdx: null, dIdx: null },   // DD/MM or MM/DD
  { pattern: /^(\d{2})-(\d{2})-(\d{4})$/, format: null, yIdx: 3, mIdx: null, dIdx: null },     // DD-MM or MM-DD
  { pattern: /^(\d{2})\/(\d{2})\/(\d{2})$/, format: null, yIdx: 3, mIdx: null, dIdx: null },   // DD/MM/YY or MM/DD/YY
  { pattern: /^(\d{2})-([A-Za-z]{3})-(\d{4})$/, format: 'DD-Mon-YYYY', yIdx: 3, mIdx: 2, dIdx: 1 },
  { pattern: /^(\d{2})\s([A-Za-z]{3})\s(\d{4})$/, format: 'DD Mon YYYY', yIdx: 3, mIdx: 2, dIdx: 1 },
];

export function detectDateFormat(values: string[]): string | null {
  if (values.length === 0) return null;

  const trimmed = values.map((v) => stripTime(v)).filter(Boolean);

  // Check for YYYY-MM-DD
  if (trimmed.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'YYYY-MM-DD';

  // Check for DD-Mon-YYYY or DD Mon YYYY
  if (trimmed.every((v) => /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(v))) return 'DD-Mon-YYYY';
  if (trimmed.every((v) => /^\d{2}\s[A-Za-z]{3}\s\d{4}$/.test(v))) return 'DD Mon YYYY';

  // Ambiguous DD/MM vs MM/DD — check if any first group > 12
  const slashMatch = trimmed.every((v) => /^\d{2}[\/-]\d{2}[\/-]\d{2,4}$/.test(v));
  if (slashMatch) {
    const sep = trimmed[0].includes('/') ? '/' : '-';
    let hasFirstOver12 = false;
    let hasSecondOver12 = false;
    for (const v of trimmed) {
      const parts = v.split(/[\/-]/);
      const a = parseInt(parts[0], 10);
      const b = parseInt(parts[1], 10);
      if (a > 12) hasFirstOver12 = true;
      if (b > 12) hasSecondOver12 = true;
    }

    const yearPart = trimmed[0].split(/[\/-]/)[2];
    const yearSuffix = yearPart.length === 2 ? 'YY' : 'YYYY';

    if (hasFirstOver12 && !hasSecondOver12) {
      return `DD${sep}MM${sep}${yearSuffix}`;
    } else if (!hasFirstOver12 && hasSecondOver12) {
      return `MM${sep}DD${sep}${yearSuffix}`;
    } else {
      // Default to DD/MM (more common internationally)
      return `DD${sep}MM${sep}${yearSuffix}`;
    }
  }

  return null;
}

export function detectDecimalSeparator(values: string[]): '.' | ',' {
  for (const v of values) {
    const cleaned = v.trim().replace(/[£$€\s]/g, '');
    // Check for comma as decimal: "1.234,56" or "1234,56"
    if (/,\d{2}$/.test(cleaned) && !cleaned.endsWith(',')) {
      return ',';
    }
  }
  return '.';
}

// ─── Parsing Helpers ─────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseDate(value: string, format: string | null): string | null {
  const v = stripTime(value);
  if (!v) return null;

  if (!format) {
    // Try ISO
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (iso) return v;
    return null;
  }

  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return v;
    return null;
  }

  if (format === 'DD-Mon-YYYY' || format === 'DD Mon YYYY') {
    const m = /^(\d{2})[\s-]([A-Za-z]{3})[\s-](\d{4})$/.exec(v);
    if (m) {
      const day = parseInt(m[1], 10);
      const mon = MONTH_NAMES[m[2].toLowerCase()];
      const year = parseInt(m[3], 10);
      if (mon && day >= 1 && day <= 31) {
        return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Handle DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, etc.
  const sep = format.includes('/') ? '/' : '-';
  const parts = v.split(sep);
  if (parts.length !== 3) return null;

  const formatParts = format.split(sep);
  const values: Record<string, number> = {};
  for (let i = 0; i < 3; i++) {
    const fp = formatParts[i];
    const num = parseInt(parts[i], 10);
    if (isNaN(num)) return null;
    if (fp === 'DD') values.day = num;
    else if (fp === 'MM') values.month = num;
    else if (fp === 'YYYY') values.year = num;
    else if (fp === 'YY') values.year = num < 50 ? 2000 + num : 1900 + num;
  }

  if (!values.year || !values.month || !values.day) return null;
  if (values.month < 1 || values.month > 12) return null;
  if (values.day < 1 || values.day > 31) return null;

  return `${values.year}-${String(values.month).padStart(2, '0')}-${String(values.day).padStart(2, '0')}`;
}

export function parseAmount(value: string, decimalSeparator: '.' | ','): number | null {
  if (!value || !value.trim()) return null;
  let cleaned = value.trim().replace(/[£$€\s]/g, '');

  // Handle parentheses for negative: (123.45) → -123.45
  const parenMatch = /^\((.+)\)$/.exec(cleaned);
  if (parenMatch) cleaned = '-' + parenMatch[1];

  // Auto-detect actual separator in this specific value to avoid misinterpreting
  // dot-decimal values (e.g. "3.58") when the configured separator is comma.
  // A dot followed by exactly 1-2 digits at the end is a decimal point, not a
  // thousand separator (which would be followed by exactly 3 digits).
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  const dotIsDecimal = hasDot && /\.\d{1,2}$/.test(cleaned);
  const commaIsDecimal = hasComma && /,\d{1,2}$/.test(cleaned);

  if (decimalSeparator === ',') {
    if (commaIsDecimal) {
      // Configured separator matches: dots are thousands, comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (dotIsDecimal && !hasComma) {
      // Value uses dot as decimal despite comma config — treat dot as decimal
      cleaned = cleaned.replace(/,/g, '');
    } else {
      // Fallback: trust configured separator
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else {
    // Dot separator configured
    if (dotIsDecimal) {
      // Configured separator matches: commas are thousands
      cleaned = cleaned.replace(/,/g, '');
    } else if (commaIsDecimal && !hasDot) {
      // Value uses comma as decimal despite dot config — treat comma as decimal
      cleaned = cleaned.replace(',', '.');
    } else {
      // Fallback: trust configured separator
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Row Mapping ─────────────────────────────────────────────────────

export function applyMapping(
  row: string[],
  rowIndex: number,
  mapping: CsvColumnMapping,
  amountMode: AmountMode,
  signConvention: SignConvention,
  dateFormat: string | null,
  decimalSeparator: '.' | ',',
): ParsedCsvRow {
  const errors: string[] = [];
  const get = (idx: number): string => (idx >= 0 && idx < row.length ? row[idx].trim() : '');

  // Date
  const rawDate = get(mapping.date);
  const date = rawDate ? parseDate(rawDate, dateFormat) : null;
  if (mapping.date >= 0 && !date) errors.push(`Invalid date: "${rawDate}"`);

  // Description
  const description = get(mapping.description) || null;

  // Amount + type
  let amount: number | null = null;
  let type: 'income' | 'expense' | null = null;

  if (amountMode === 'debit-credit') {
    const debitVal = parseAmount(get(mapping.debit), decimalSeparator);
    const creditVal = parseAmount(get(mapping.credit), decimalSeparator);
    if (debitVal != null && debitVal !== 0) {
      amount = Math.abs(debitVal);
      type = 'expense';
    } else if (creditVal != null && creditVal !== 0) {
      amount = Math.abs(creditVal);
      type = 'income';
    } else if (debitVal === 0 && creditVal === 0) {
      amount = 0;
      type = 'expense';
    } else {
      errors.push('No debit or credit value');
    }
  } else if (amountMode === 'amount-with-indicator') {
    amount = parseAmount(get(mapping.amount), decimalSeparator);
    const indicator = get(mapping.typeIndicator).toLowerCase();
    if (indicator.includes('credit') || indicator.includes('cr') || indicator.includes('in')) {
      type = 'income';
    } else {
      type = 'expense';
    }
    if (amount != null) amount = Math.abs(amount);
  } else {
    // signed
    amount = parseAmount(get(mapping.amount), decimalSeparator);
    if (amount != null) {
      if (signConvention === 'positive-income') {
        type = amount >= 0 ? 'income' : 'expense';
      } else {
        type = amount >= 0 ? 'expense' : 'income';
      }
      amount = Math.abs(amount);
    }
  }

  if (amount == null && errors.length === 0) errors.push('Could not parse amount');

  return {
    rowIndex,
    rawValues: row,
    date,
    description,
    amount,
    type,
    reference: get(mapping.reference) || null,
    party: get(mapping.party) || null,
    notes: get(mapping.notes) || null,
    category: get(mapping.category) || null,
    parseErrors: errors,
  };
}
