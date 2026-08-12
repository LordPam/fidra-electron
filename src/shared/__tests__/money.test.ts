import { describe, it, expect } from 'vitest';
import {
  parsePence,
  toPence,
  fromPence,
  sumPence,
  sumAmounts,
  penceToAmount,
  toAmountString,
  isValidAmount,
  isPositiveAmount,
} from '../money';

describe('parsePence', () => {
  it('parses plain decimal amounts', () => {
    expect(parsePence('12.34')).toBe(1234);
    expect(parsePence('0.00')).toBe(0);
    expect(parsePence('0.05')).toBe(5);
    expect(parsePence('100')).toBe(10000);
    expect(parsePence('1234.5')).toBe(123450);
  });

  it('handles signs', () => {
    expect(parsePence('-12.34')).toBe(-1234);
    expect(parsePence('+12.34')).toBe(1234);
    expect(parsePence('-0.01')).toBe(-1);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePence('  12.34 ')).toBe(1234);
  });

  it('rounds beyond two decimals half away from zero', () => {
    expect(parsePence('12.345')).toBe(1235);
    expect(parsePence('12.344')).toBe(1234);
    expect(parsePence('-12.345')).toBe(-1235);
    expect(parsePence('0.999')).toBe(100);
  });

  it('rejects what parseFloat would silently accept', () => {
    // parseFloat('12abc') === 12
    expect(parsePence('12abc')).toBeNull();
    // parseFloat('1,234.56') === 1
    expect(parsePence('1,234.56')).toBeNull();
    // parseFloat('£12.34') === NaN, but so is the ' 12 . 34' family
    expect(parsePence('£12.34')).toBeNull();
    expect(parsePence('12 . 34')).toBeNull();
    expect(parsePence('')).toBeNull();
    expect(parsePence('   ')).toBeNull();
    expect(parsePence('abc')).toBeNull();
    expect(parsePence('.')).toBeNull();
    expect(parsePence('12.')).toBeNull();
    expect(parsePence('.5')).toBeNull();
    expect(parsePence('1e3')).toBeNull();
  });

  it('accepts numbers, rounding as a decimal rather than a float', () => {
    expect(parsePence(12.34)).toBe(1234);
    // Math.round(1.005 * 100) is 100 — the float is really 1.00499999999999989
    expect(parsePence(1.005)).toBe(101);
    expect(parsePence(0)).toBe(0);
    expect(parsePence(NaN)).toBeNull();
    expect(parsePence(Infinity)).toBeNull();
  });

  it('rejects amounts too large to hold exactly', () => {
    expect(parsePence('999999999999999999999')).toBeNull();
  });
});

describe('toPence', () => {
  it('falls back to zero for unreadable values', () => {
    expect(toPence('12.34')).toBe(1234);
    expect(toPence('nonsense')).toBe(0);
  });
});

describe('sums', () => {
  it('adds without floating-point drift', () => {
    // The reason this module exists: 0.1 + 0.2 !== 0.3 in floating point
    expect(sumPence(['0.10', '0.20'])).toBe(30);
    expect(sumAmounts(['0.10', '0.20'])).toBe(0.3);

    const naive = ['0.10', '0.20', '0.30'].reduce((s, v) => s + parseFloat(v), 0);
    expect(naive).not.toBe(0.6);
    expect(sumAmounts(['0.10', '0.20', '0.30'])).toBe(0.6);
  });

  it('stays exact over many rows', () => {
    const rows = Array.from({ length: 1000 }, () => '0.01');
    expect(sumPence(rows)).toBe(1000);
    expect(sumAmounts(rows)).toBe(10);
  });

  it('skips unreadable values rather than producing NaN', () => {
    expect(sumAmounts(['1.00', 'corrupt', '2.00'])).toBe(3);
  });

  it('handles an empty list', () => {
    expect(sumPence([])).toBe(0);
    expect(sumAmounts([])).toBe(0);
  });
});

describe('formatting', () => {
  it('renders pence as a storage string', () => {
    expect(penceToAmount(1234)).toBe('12.34');
    expect(penceToAmount(5)).toBe('0.05');
    expect(penceToAmount(0)).toBe('0.00');
    expect(penceToAmount(-1234)).toBe('-12.34');
    expect(penceToAmount(100)).toBe('1.00');
  });

  it('round-trips through pence', () => {
    for (const amount of ['0.00', '0.01', '12.34', '999.99', '-5.50']) {
      expect(penceToAmount(parsePence(amount)!)).toBe(amount);
    }
  });

  it('normalises to the stored format', () => {
    expect(toAmountString('12.3')).toBe('12.30');
    expect(toAmountString('12')).toBe('12.00');
    expect(toAmountString(12.345)).toBe('12.35');
    // parseFloat('bad').toFixed(2) would be the string 'NaN'
    expect(toAmountString('bad')).toBeNull();
  });

  it('converts pence to pounds', () => {
    expect(fromPence(1234)).toBe(12.34);
    expect(fromPence(0)).toBe(0);
  });
});

describe('validation', () => {
  it('recognises valid amounts', () => {
    expect(isValidAmount('12.34')).toBe(true);
    expect(isValidAmount('0')).toBe(true);
    expect(isValidAmount('abc')).toBe(false);
  });

  it('recognises positive amounts', () => {
    expect(isPositiveAmount('12.34')).toBe(true);
    expect(isPositiveAmount('0.00')).toBe(false);
    expect(isPositiveAmount('-1.00')).toBe(false);
    expect(isPositiveAmount('abc')).toBe(false);
  });
});
