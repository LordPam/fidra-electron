import type { TransactionRow } from '../../shared/ipc-types';
import { fromPence, toPence } from '../../shared/money';

const COUNTABLE_INCOME = new Set(['--', 'approved']);
const COUNTABLE_EXPENSE = new Set(['approved']);

export function computeTotal(
  transactions: TransactionRow[],
  opts?: { excludeTransfers?: boolean },
): number {
  // Accumulated in pence so a long ledger cannot drift; converted once at the end.
  let totalPence = 0;
  for (const t of transactions) {
    if (opts?.excludeTransfers && t.linked_id) continue;
    const amount = toPence(t.amount);
    if (t.type === 'income' && COUNTABLE_INCOME.has(t.status)) {
      totalPence += amount;
    } else if (t.type === 'expense' && COUNTABLE_EXPENSE.has(t.status)) {
      totalPence -= amount;
    }
  }
  return fromPence(totalPence);
}

export function computeRunningBalances(
  transactions: TransactionRow[],
): Map<string, number> {
  const balances = new Map<string, number>();
  let runningPence = 0;

  // Sort by date ASC, then created_at ASC, then id for deterministic tiebreak
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const createdCompare = a.created_at.localeCompare(b.created_at);
    if (createdCompare !== 0) return createdCompare;
    return a.id.localeCompare(b.id);
  });

  for (const t of sorted) {
    const amount = toPence(t.amount);
    if (t.type === 'income' && COUNTABLE_INCOME.has(t.status)) {
      runningPence += amount;
    } else if (t.type === 'expense' && COUNTABLE_EXPENSE.has(t.status)) {
      runningPence -= amount;
    }
    balances.set(t.id, fromPence(runningPence));
  }

  return balances;
}

export function computePendingTotal(transactions: TransactionRow[]): number {
  let totalPence = 0;
  for (const t of transactions) {
    if (t.type === 'expense' && t.status === 'pending' && !t.linked_id) {
      totalPence += toPence(t.amount);
    }
  }
  return fromPence(totalPence);
}
