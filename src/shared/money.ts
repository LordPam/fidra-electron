/**
 * Money handling for Fidra.
 *
 * Amounts are **stored** as decimal TEXT (`"12.34"`) — that format is part of the
 * sync contract and does not change. Amounts are **computed** in integer pence,
 * because repeatedly adding floating-point pounds accumulates error:
 * `0.1 + 0.2 === 0.30000000000000004`.
 *
 * The other half of the job is parsing. `parseFloat` is too forgiving to trust with
 * money — `parseFloat("12abc")` is `12`, `parseFloat("1,234.56")` is `1`, and the
 * common `parseFloat(x) || 0` idiom turns anything it can't read into a silent zero.
 * `parsePence` accepts only a plain decimal number and says `null` otherwise, so
 * callers have to decide what a bad value means instead of defaulting into one.
 */

/** Optional sign, digits, optional fractional part. No currency symbols, no thousands separators. */
const AMOUNT_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Parse an amount into integer pence, or `null` if it is not a plain decimal number.
 * More than two decimal places are rounded half away from zero, the convention for money.
 */
export function parsePence(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Round-trip through a decimal string: `Math.round(1.005 * 100)` is 100, not 101,
    // because 1.005 is really 1.00499999999999989.
    return parsePence(value.toFixed(4));
  }

  const match = AMOUNT_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  // Three digits: two to keep, one to round on.
  const digits = `${fraction}000`.slice(0, 3);
  let pence = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) pence += 1;

  if (!Number.isSafeInteger(pence)) return null;
  return sign === '-' ? -pence : pence;
}

/**
 * Parse into pence, treating anything unreadable as zero.
 *
 * For reading amounts that are already in the database, where a single corrupt row
 * should not blank out a whole report. Prefer `parsePence` anywhere the value is
 * still on its way in — validation, imports, form submission.
 */
export function toPence(value: string | number): number {
  return parsePence(value) ?? 0;
}

/** Convert pence back to pounds. Do this once, at the end of a calculation. */
export function fromPence(pence: number): number {
  return pence / 100;
}

/**
 * Read a single amount as pounds, treating anything unreadable as zero.
 *
 * The direct replacement for `parseFloat(x) || 0`: same shape, same fallback, but it
 * will not half-read `"12abc"` as `12`. Where several amounts are being added
 * together, prefer `sumAmounts` or accumulate in pence — that is what fixes drift.
 */
export function toAmount(value: string | number): number {
  return fromPence(toPence(value));
}

/** Sum amounts exactly, in pence. Unreadable values count as zero. */
export function sumPence(values: Iterable<string | number>): number {
  let total = 0;
  for (const value of values) {
    total += toPence(value);
  }
  return total;
}

/**
 * Sum amounts and return pounds. The addition happens in integer pence, so only the
 * final division can round — unlike adding pounds one at a time.
 */
export function sumAmounts(values: Iterable<string | number>): number {
  return fromPence(sumPence(values));
}

/** Render pence as a storage string: `1234` → `"12.34"`. */
export function penceToAmount(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(pence));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Normalise an amount to the stored format, or `null` if it is not a valid amount.
 * Replaces `parseFloat(x).toFixed(2)`, which yields `"NaN"` for unreadable input.
 */
export function toAmountString(value: string | number): string | null {
  const pence = parsePence(value);
  return pence === null ? null : penceToAmount(pence);
}

/** Whether a value is a well-formed amount. */
export function isValidAmount(value: string | number): boolean {
  return parsePence(value) !== null;
}

/** Whether a value is a well-formed amount greater than zero. */
export function isPositiveAmount(value: string | number): boolean {
  const pence = parsePence(value);
  return pence !== null && pence > 0;
}
