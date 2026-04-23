import type { TransactionRow } from '../../shared/ipc-types';

type StringField = 'description' | 'party' | 'activity' | 'category' | 'reference';

export function getUniqueValues(
  transactions: TransactionRow[],
  field: StringField,
): string[] {
  const seen = new Set<string>();
  for (const t of transactions) {
    const val = t[field];
    if (val) seen.add(val);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}
