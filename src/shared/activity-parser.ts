export type DatePrecision = 'day' | 'month' | 'year' | 'none';

export interface ParsedActivity {
  rawActivity: string;
  parsedDatePrefix: string | null;   // start date: "2026-04-15" | "2026-04" | "2026" | null
  parsedEndDate: string | null;      // end date if range, else null
  datePrecision: DatePrecision;      // precision of start date
  displayTitle: string;
}

// YYYY-MM-DD range (en-dash, em-dash, hyphen, or " to ")
const RANGE_RE = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\s*[\u2013\u2014-]\s*(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const RANGE_TO_RE = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\s+to\s+(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/i;

// YYYY-MM-DD, YYYY-MM, YYYY (2000–2099 only)
const DAY_RE = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])\b/;
const YEAR_RE = /^(20\d{2})\b/;

function stripPrefix(raw: string, prefixLen: number): string {
  let rest = raw.slice(prefixLen);
  // Strip leading whitespace, dashes, colons after the date
  rest = rest.replace(/^[\s\-:]+/, '');
  return rest || raw;
}

export function parseActivityDate(raw: string): ParsedActivity {
  const trimmed = raw.trim();

  // Try date range first (YYYY-MM-DD–YYYY-MM-DD or YYYY-MM-DD to YYYY-MM-DD)
  for (const re of [RANGE_RE, RANGE_TO_RE]) {
    const rangeMatch = trimmed.match(re);
    if (rangeMatch) {
      const startDate = `${rangeMatch[1]}-${rangeMatch[2]}-${rangeMatch[3]}`;
      const endDate = `${rangeMatch[4]}-${rangeMatch[5]}-${rangeMatch[6]}`;
      return {
        rawActivity: raw,
        parsedDatePrefix: startDate,
        parsedEndDate: endDate,
        datePrecision: 'day',
        displayTitle: stripPrefix(trimmed, rangeMatch[0].length),
      };
    }
  }

  const dayMatch = trimmed.match(DAY_RE);
  if (dayMatch) {
    const prefix = `${dayMatch[1]}-${dayMatch[2]}-${dayMatch[3]}`;
    return {
      rawActivity: raw,
      parsedDatePrefix: prefix,
      parsedEndDate: null,
      datePrecision: 'day',
      displayTitle: stripPrefix(trimmed, prefix.length),
    };
  }

  const monthMatch = trimmed.match(MONTH_RE);
  if (monthMatch) {
    const prefix = `${monthMatch[1]}-${monthMatch[2]}`;
    return {
      rawActivity: raw,
      parsedDatePrefix: prefix,
      parsedEndDate: null,
      datePrecision: 'month',
      displayTitle: stripPrefix(trimmed, prefix.length),
    };
  }

  const yearMatch = trimmed.match(YEAR_RE);
  if (yearMatch) {
    // Only match if followed by non-digit (avoid matching "2026xyz")
    const afterYear = trimmed[4];
    if (!afterYear || /\D/.test(afterYear)) {
      return {
        rawActivity: raw,
        parsedDatePrefix: yearMatch[1],
        parsedEndDate: null,
        datePrecision: 'year',
        displayTitle: stripPrefix(trimmed, 4),
      };
    }
  }

  return {
    rawActivity: raw,
    parsedDatePrefix: null,
    parsedEndDate: null,
    datePrecision: 'none',
    displayTitle: trimmed,
  };
}
