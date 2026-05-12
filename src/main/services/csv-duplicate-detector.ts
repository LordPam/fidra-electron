import type { TransactionRow } from '../../shared/ipc-types';
import type { ParsedCsvRow, DuplicateMatch } from '../../shared/csv-import-types';

// ─── String Utilities ────────────────────────────────────────────────

function normalizeDescription(desc: string): string {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

function descriptionSimilarity(a: string, b: string): number {
  const na = normalizeDescription(a);
  const nb = normalizeDescription(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

// ─── Duplicate Detector ──────────────────────────────────────────────

export class DuplicateDetector {
  private exactIndex: Map<string, TransactionRow[]>;
  private dateAmountIndex: Map<string, TransactionRow[]>;
  private referenceIndex: Map<string, TransactionRow[]>;
  private fuzzyDateWindowDays: number;
  private allTransactions: TransactionRow[];

  constructor(existingTransactions: TransactionRow[], fuzzyDateWindowDays = 5) {
    this.fuzzyDateWindowDays = fuzzyDateWindowDays;
    this.allTransactions = existingTransactions;
    this.exactIndex = new Map();
    this.dateAmountIndex = new Map();
    this.referenceIndex = new Map();

    for (const tx of existingTransactions) {
      // Exact key: date + amount + normalized description
      const exactKey = `${tx.date}|${tx.amount}|${normalizeDescription(tx.description)}`;
      const arr = this.exactIndex.get(exactKey) ?? [];
      arr.push(tx);
      this.exactIndex.set(exactKey, arr);

      // Date + amount key
      const daKey = `${tx.date}|${tx.amount}`;
      const daArr = this.dateAmountIndex.get(daKey) ?? [];
      daArr.push(tx);
      this.dateAmountIndex.set(daKey, daArr);

      // Reference index
      if (tx.reference) {
        const normRef = tx.reference.toLowerCase().trim();
        const refArr = this.referenceIndex.get(normRef) ?? [];
        refArr.push(tx);
        this.referenceIndex.set(normRef, refArr);
      }
    }
  }

  check(parsed: ParsedCsvRow): DuplicateMatch {
    if (!parsed.date || parsed.amount == null) {
      return { matchType: 'none', matchedTransactionIds: [], confidence: 0, reason: '' };
    }

    const amountStr = parsed.amount.toFixed(2);

    // Layer 1: Exact match (date + amount + description)
    if (parsed.description) {
      const exactKey = `${parsed.date}|${amountStr}|${normalizeDescription(parsed.description)}`;
      const exact = this.exactIndex.get(exactKey);
      if (exact && exact.length > 0) {
        return {
          matchType: 'exact',
          matchedTransactionIds: exact.map((t) => t.id),
          confidence: 1.0,
          reason: 'Exact match on date, amount, and description',
        };
      }
    }

    // Layer 2: Content match (same date + same amount)
    const daKey = `${parsed.date}|${amountStr}`;
    const content = this.dateAmountIndex.get(daKey);
    if (content && content.length > 0) {
      return {
        matchType: 'content',
        matchedTransactionIds: content.map((t) => t.id),
        confidence: content.length === 1 ? 0.9 : 0.7,
        reason: content.length === 1
          ? 'Same date and amount'
          : `${content.length} transactions with same date and amount`,
      };
    }

    // Layer 3: Fuzzy match (date window + description similarity + reference)
    const fuzzyMatches = this.findFuzzyMatches(parsed, amountStr);
    if (fuzzyMatches.length > 0) {
      const best = fuzzyMatches[0];
      return {
        matchType: 'fuzzy',
        matchedTransactionIds: [best.tx.id],
        confidence: best.score,
        reason: `Fuzzy match: ${best.reasons.join(', ')}`,
      };
    }

    return { matchType: 'none', matchedTransactionIds: [], confidence: 0, reason: '' };
  }

  private findFuzzyMatches(
    parsed: ParsedCsvRow,
    amountStr: string,
  ): { tx: TransactionRow; score: number; reasons: string[] }[] {
    const parsedDate = new Date(parsed.date!);
    const results: { tx: TransactionRow; score: number; reasons: string[] }[] = [];

    for (const tx of this.allTransactions) {
      const txDate = new Date(tx.date);
      const daysDiff = Math.abs((parsedDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > this.fuzzyDateWindowDays) continue;

      const reasons: string[] = [];
      let weightedScore = 0;

      // Amount match (35%)
      if (tx.amount === amountStr) {
        weightedScore += 0.35;
        reasons.push('same amount');
      } else {
        continue; // Amount must match for fuzzy
      }

      // Description similarity (35%)
      if (parsed.description && tx.description) {
        const sim = descriptionSimilarity(parsed.description, tx.description);
        if (sim >= 0.5) {
          weightedScore += 0.35 * sim;
          reasons.push(`description ${Math.round(sim * 100)}% similar`);
        }
      }

      // Date proximity (20%) — closer = better
      const dateScore = 1 - daysDiff / this.fuzzyDateWindowDays;
      weightedScore += 0.2 * dateScore;
      if (daysDiff > 0) reasons.push(`${Math.round(daysDiff)}d apart`);

      // Reference match (10%)
      if (parsed.reference && tx.reference) {
        const normParsedRef = parsed.reference.toLowerCase().trim();
        const normTxRef = tx.reference.toLowerCase().trim();
        if (normParsedRef === normTxRef) {
          weightedScore += 0.1;
          reasons.push('same reference');
        }
      }

      if (weightedScore >= 0.5) {
        results.push({ tx, score: Math.min(weightedScore, 0.95), reasons });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
