import type { TransactionRow } from '../../shared/ipc-types';

const COUNTABLE_INCOME = new Set(['--', 'approved']);
const COUNTABLE_EXPENSE = new Set(['approved']);

export function computeTotal(transactions: TransactionRow[]): number {
  let total = 0;
  for (const t of transactions) {
    const amount = parseFloat(t.amount) || 0;
    if (t.type === 'income' && COUNTABLE_INCOME.has(t.status)) {
      total += amount;
    } else if (t.type === 'expense' && COUNTABLE_EXPENSE.has(t.status)) {
      total -= amount;
    }
  }
  return total;
}

export function computeRunningBalances(
  transactions: TransactionRow[],
): Map<string, number> {
  const balances = new Map<string, number>();
  let running = 0;

  // Sort by date ASC, then created_at ASC, then id for deterministic tiebreak
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const createdCompare = a.created_at.localeCompare(b.created_at);
    if (createdCompare !== 0) return createdCompare;
    return a.id.localeCompare(b.id);
  });

  for (const t of sorted) {
    const amount = parseFloat(t.amount) || 0;
    if (t.type === 'income' && COUNTABLE_INCOME.has(t.status)) {
      running += amount;
    } else if (t.type === 'expense' && COUNTABLE_EXPENSE.has(t.status)) {
      running -= amount;
    }
    balances.set(t.id, running);
  }

  return balances;
}

export function computePendingTotal(transactions: TransactionRow[]): number {
  let total = 0;
  for (const t of transactions) {
    if (t.type === 'expense' && t.status === 'pending') {
      total += parseFloat(t.amount) || 0;
    }
  }
  return total;
}
