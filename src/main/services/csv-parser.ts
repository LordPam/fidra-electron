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
    /^\d{1,2}[\-\s][A-Za-z]{3}[\-\s]\d{2,4}$/.test(s) ||
    /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(s);
}

function looksLikeNumber(v: string): boolean {
  const cleaned = v.trim().replace(/[£$€,\s]/g, '');
  return /^-?\d+([.,]\d+)?$/.test(cleaned);
}

// ─── Date Detection ──────────────────────────────────────────────────

export function detectDateFormat(values: string[]): string | null {
  if (values.length === 0) return null;

  const trimmed = values.map((v) => stripTime(v)).filter(Boolean);
  if (trimmed.length === 0) return null;

  // Check for YYYY-MM-DD (ISO)
  if (trimmed.every((v) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(v))) return 'YYYY-MM-DD';

  // Check for Mon DD, YYYY or Month DD, YYYY (US text format)
  if (trimmed.every((v) => /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(v))) return 'Mon DD, YYYY';

  // Check for D-Mon-YYYY/YY or D Mon YYYY/YY (month name formats, allowing single-digit day)
  if (trimmed.every((v) => /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(v))) return 'DD-Mon-YYYY';
  if (trimmed.every((v) => /^\d{1,2}\s[A-Za-z]{3}\s\d{4}$/.test(v))) return 'DD Mon YYYY';
  if (trimmed.every((v) => /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(v))) return 'DD-Mon-YY';
  if (trimmed.every((v) => /^\d{1,2}\s[A-Za-z]{3}\s\d{2}$/.test(v))) return 'DD Mon YY';

  // Numeric formats: D/M/YYYY, D-M-YYYY, D.M.YYYY (allow single-digit day/month, dot separator)
  const numericMatch = trimmed.every((v) => /^\d{1,2}[\/.\\-]\d{1,2}[\/.\\-]\d{2,4}$/.test(v));
  if (numericMatch) {
    // Determine separator (use first value)
    const sep = trimmed[0].match(/[\/.\-]/)?.[0] ?? '/';

    let hasFirstOver12 = false;
    let hasSecondOver12 = false;
    for (const v of trimmed) {
      const parts = v.split(/[\/.\-]/);
      const a = parseInt(parts[0], 10);
      const b = parseInt(parts[1], 10);
      if (a > 12) hasFirstOver12 = true;
      if (b > 12) hasSecondOver12 = true;
    }

    const yearPart = trimmed[0].split(/[\/.\-]/)[2];
    const yearSuffix = yearPart.length <= 2 ? 'YY' : 'YYYY';

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

/** Full month names for US text format parsing */
const FULL_MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function parseDate(value: string, format: string | null): string | null {
  const v = stripTime(value);
  if (!v) return null;

  if (!format) {
    // Try ISO
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
    if (iso) {
      const y = parseInt(iso[1], 10);
      const m = parseInt(iso[2], 10);
      const d = parseInt(iso[3], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  }

  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // US text format: "Jul 01, 2024" or "July 1, 2024" or "Jul 1 2024"
  if (format === 'Mon DD, YYYY') {
    const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
    if (m) {
      const monStr = m[1].toLowerCase();
      const mon = MONTH_NAMES[monStr.slice(0, 3)] ?? FULL_MONTH_NAMES[monStr];
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      if (mon && day >= 1 && day <= 31) {
        return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Month name formats: DD-Mon-YYYY, DD Mon YYYY, DD-Mon-YY, DD Mon YY (single-digit day allowed)
  if (format === 'DD-Mon-YYYY' || format === 'DD Mon YYYY' ||
      format === 'DD-Mon-YY' || format === 'DD Mon YY') {
    const m = /^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})$/.exec(v);
    if (m) {
      const day = parseInt(m[1], 10);
      const mon = MONTH_NAMES[m[2].toLowerCase()];
      let year = parseInt(m[3], 10);
      if (m[3].length <= 2) year = year < 50 ? 2000 + year : 1900 + year;
      if (mon && day >= 1 && day <= 31) {
        return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Numeric formats: DD/MM/YYYY, MM/DD/YYYY, DD.MM.YYYY, DD-MM-YYYY, etc.
  // Find the separator used in the format string
  const sepMatch = format.match(/[\/.\-]/);
  const sep = sepMatch ? sepMatch[0] : '/';
  // Split value on any of the common separators (in case format sep differs slightly)
  const parts = v.split(/[\/.\-]/);
  if (parts.length !== 3) return null;

  const formatParts = format.split(/[\/.\-]/);
  const vals: Record<string, number> = {};
  for (let i = 0; i < 3; i++) {
    const fp = formatParts[i];
    const num = parseInt(parts[i], 10);
    if (isNaN(num)) return null;
    if (fp === 'DD') vals.day = num;
    else if (fp === 'MM') vals.month = num;
    else if (fp === 'YYYY') vals.year = num;
    else if (fp === 'YY') vals.year = num < 50 ? 2000 + num : 1900 + num;
  }

  if (!vals.year || !vals.month || !vals.day) return null;
  if (vals.month < 1 || vals.month > 12) return null;
  if (vals.day < 1 || vals.day > 31) return null;

  return `${vals.year}-${String(vals.month).padStart(2, '0')}-${String(vals.day).padStart(2, '0')}`;
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
